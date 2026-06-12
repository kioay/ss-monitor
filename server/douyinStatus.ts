import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { runtimeConfig, getUpdatePolicy } from "./config";
import type {
  BettaFishProbeStatus,
  DouyinCrawlSchedulerState,
  DouyinCrawlServiceStatus,
  DouyinCrawlStatus,
  DouyinCrawlStatusIssue,
  DouyinLoginProfileStatus
} from "../src/shared";

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  code?: number | string | null;
  message?: string;
};

const statusCacheTtlMs = 45_000;
let cachedStatus: { createdAt: number; value: DouyinCrawlStatus } | undefined;

export async function getDouyinCrawlStatus(force = false): Promise<DouyinCrawlStatus> {
  if (!force && cachedStatus && Date.now() - cachedStatus.createdAt < statusCacheTtlMs) return cachedStatus.value;

  const service = await readServiceStatus();
  const scheduler = await readSchedulerState();
  const loginProfile = await inspectLoginProfile();
  const journal = service.available ? await readRecentJournal() : "";
  const issues = makeIssues(service, scheduler, loginProfile, journal);
  const status = statusFromIssues(issues, service);
  const loginOk = !issues.some((issue) => issue.type === "login");
  const crawlOk = !issues.some((issue) => issue.type === "crawl" || issue.type === "config");
  const value: DouyinCrawlStatus = {
    generatedAt: new Date().toISOString(),
    status,
    ok: status === "ok" || status === "skipped",
    loginOk,
    crawlOk,
    message: issues[0]?.message || (status === "skipped" ? "抖音采集状态仅在生产 Linux 服务上检查" : "抖音登录态与采集任务正常"),
    issues,
    ...(runtimeConfig.douyinRemoteLoginUrl ? { remoteLoginUrl: runtimeConfig.douyinRemoteLoginUrl } : {}),
    service,
    scheduler,
    loginProfile
  };

  cachedStatus = { createdAt: Date.now(), value };
  return value;
}

async function readServiceStatus(): Promise<DouyinCrawlServiceStatus> {
  if (process.platform === "win32") {
    return { available: false, message: "systemd is unavailable on Windows" };
  }

  const result = await runCommand("systemctl", [
    "show",
    runtimeConfig.douyinCrawlServiceName,
    "-p",
    "ActiveState",
    "-p",
    "SubState",
    "-p",
    "Result",
    "-p",
    "ExecMainStatus",
    "-p",
    "ExecMainStartTimestamp",
    "-p",
    "ExecMainExitTimestamp",
    "--no-pager"
  ]);

  if (!result.ok) {
    return {
      available: false,
      message: compactCommandMessage(result)
    };
  }

  const values = parseKeyValueText(result.stdout);
  const execStatus = Number(values.ExecMainStatus || "0");
  return {
    available: true,
    activeState: values.ActiveState || "",
    subState: values.SubState || "",
    result: values.Result || "",
    execMainStatus: Number.isFinite(execStatus) ? execStatus : undefined,
    execMainStartTimestamp: normalizeSystemdTimestamp(values.ExecMainStartTimestamp || ""),
    execMainExitTimestamp: normalizeSystemdTimestamp(values.ExecMainExitTimestamp || "")
  };
}

async function readSchedulerState(): Promise<DouyinCrawlSchedulerState> {
  const statePath = runtimeConfig.douyinCrawlStatePath;
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const values = parseKeyValueText(raw);
    const lastCompletedAt = normalizeStateTime(values.last_completed_at || values.lastCompletedAt || "");
    const intervalMinutes = numberValue(values.interval_minutes || values.intervalMinutes);
    const state: DouyinCrawlSchedulerState = {
      exists: true,
      ...(lastCompletedAt ? { lastCompletedAt } : {}),
      ...(values.mode === "day" || values.mode === "night" ? { mode: values.mode } : {}),
      ...(intervalMinutes ? { intervalMinutes } : {}),
      ...(values.login_type ? { loginType: values.login_type } : {}),
      ...(values.save_data_option ? { saveDataOption: values.save_data_option } : {}),
      ...(values.headless ? { headless: values.headless === "true" } : {})
    };

    if (lastCompletedAt) {
      const completedMs = new Date(lastCompletedAt).getTime();
      if (Number.isFinite(completedMs)) {
        state.ageSeconds = Math.max(0, Math.round((Date.now() - completedMs) / 1000));
        if (intervalMinutes) state.nextEligibleAt = new Date(completedMs + intervalMinutes * 60_000).toISOString();
      }
    }
    return state;
  } catch {
    return { exists: false, loginType: runtimeConfig.douyinCrawlLoginType };
  }
}

async function inspectLoginProfile(): Promise<DouyinLoginProfileStatus> {
  const mediaCrawlerDir = runtimeConfig.douyinMediaCrawlerDir;
  const profileDir = path.join(mediaCrawlerDir, "browser_data", "cdp_dy_user_data_dir");

  const python = await runPythonLoginProbe(mediaCrawlerDir, profileDir);
  if (!python.ok) {
    const exists = await pathExists(profileDir);
    return {
      checked: true,
      profileDir,
      exists,
      cookieDbCount: 0,
      hasSessionCookie: false,
      error: compactCommandMessage(python)
    };
  }

  try {
    const parsed = JSON.parse(python.stdout) as Partial<DouyinLoginProfileStatus>;
    return {
      checked: true,
      profileDir,
      exists: Boolean(parsed.exists),
      cookieDbCount: Number(parsed.cookieDbCount || 0),
      hasSessionCookie: Boolean(parsed.hasSessionCookie),
      cookieConfigured: Boolean(parsed.cookieConfigured),
      configReadable: Boolean(parsed.configReadable),
      ...(parsed.latestCookieModifiedAt ? { latestCookieModifiedAt: parsed.latestCookieModifiedAt } : {})
    };
  } catch (error) {
    const exists = await pathExists(profileDir);
    return {
      checked: true,
      profileDir,
      exists,
      cookieDbCount: 0,
      hasSessionCookie: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runPythonLoginProbe(mediaCrawlerDir: string, profileDir: string) {
  const candidates = uniqueStrings([runtimeConfig.bettaFishPython, "python3", "python"]).filter(Boolean);
  const appRoot = process.env.APP_ROOT || (process.platform === "win32" ? "" : "/opt/ss-monitor");
  const script = String.raw`
import json
import os
import sqlite3
import sys
from pathlib import Path

media_crawler_dir = Path(sys.argv[1])
profile = Path(sys.argv[2])
app_root = Path(sys.argv[3]) if sys.argv[3] else None
bettafish_root = Path(sys.argv[4]) if sys.argv[4] else None
cookie_paths = list(profile.glob("**/Network/Cookies")) + list(profile.glob("**/Cookies")) if profile.exists() else []
session_names = {"sessionid", "sessionid_ss", "sid_guard", "sid_tt", "uid_tt", "uid_tt_ss"}
has_session_cookie = False
latest_modified = 0.0
cookie_db_count = 0
cookie_configured = False
config_readable = False

def load_env_file(env_path):
    if not env_path or not env_path.exists():
        return
    try:
        for raw_line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception:
        return

if app_root:
    load_env_file(app_root / ".env")
if bettafish_root:
    load_env_file(bettafish_root / ".env")
    load_env_file(bettafish_root / "current" / ".env")

try:
    os.chdir(media_crawler_dir)
    sys.path.insert(0, str(media_crawler_dir))
    import config
    cookie_configured = bool(getattr(config, "COOKIES", ""))
    config_readable = True
except Exception:
    cookie_configured = False

for cookie_path in cookie_paths:
    try:
        latest_modified = max(latest_modified, cookie_path.stat().st_mtime)
        con = sqlite3.connect(f"file:{cookie_path}?mode=ro", uri=True)
        rows = con.execute(
            "select name, length(value), length(encrypted_value) from cookies "
            "where host_key like '%douyin.com' or host_key like '%amemv.com' or host_key like '%bytedance.com'"
        ).fetchall()
        con.close()
        if rows:
            cookie_db_count += 1
        for name, value_len, encrypted_len in rows:
            if name in session_names and ((value_len or 0) + (encrypted_len or 0) > 0):
                has_session_cookie = True
    except Exception:
        continue

payload = {
    "checked": True,
    "profileDir": str(profile),
    "exists": profile.exists(),
    "cookieDbCount": cookie_db_count,
    "hasSessionCookie": has_session_cookie,
    "cookieConfigured": cookie_configured,
    "configReadable": config_readable,
}
if latest_modified:
    from datetime import datetime, timezone
    payload["latestCookieModifiedAt"] = datetime.fromtimestamp(latest_modified, timezone.utc).isoformat()
print(json.dumps(payload, ensure_ascii=False))
`;

  let lastResult: CommandResult = { ok: false, stdout: "", stderr: "", message: "No Python candidate available" };
  for (const candidate of candidates) {
    const result = await runCommand(candidate, ["-c", script, mediaCrawlerDir, profileDir, appRoot, runtimeConfig.bettaFishRoot], 8_000);
    if (result.ok) return result;
    lastResult = result;
  }
  return lastResult;
}

async function readRecentJournal() {
  const result = await runCommand("journalctl", ["-u", runtimeConfig.douyinCrawlServiceName, "--no-pager", "-n", "120"], 8_000);
  return result.ok ? result.stdout : `${result.stdout}\n${result.stderr}`;
}

function makeIssues(
  service: DouyinCrawlServiceStatus,
  scheduler: DouyinCrawlSchedulerState,
  loginProfile: DouyinLoginProfileStatus,
  journal: string
) {
  const issues: DouyinCrawlStatusIssue[] = [];
  const serviceFailed = service.activeState === "failed" || Boolean(service.result && !["success", "exit-code"].includes(service.result) && service.result !== "");
  const execFailed = service.result === "exit-code" && service.execMainStatus !== undefined && service.execMainStatus !== 0;
  const latestFailed = serviceFailed || execFailed;
  const loginFailure = latestFailed && looksLikeLoginFailure(journal);
  const loginType = (scheduler.loginType || runtimeConfig.douyinCrawlLoginType || "").toLowerCase();
  const usesCookieLogin = loginType === "cookie" || (!loginType && Boolean(loginProfile.cookieConfigured));

  if (!service.available && process.platform !== "win32") {
    issues.push({
      type: "config",
      severity: "warning",
      message: "抖音采集服务状态不可读",
      detail: service.message
    });
  }

  if (loginFailure) {
    issues.push({
      type: "login",
      severity: "error",
      message: "抖音登录态可能已失效",
      detail: "最近一次采集失败日志指向登录、cookie 或验证码流程。"
    });
  } else if (latestFailed) {
    issues.push({
      type: "crawl",
      severity: "error",
      message: "抖音舆情采集任务失败",
      detail: service.execMainStatus !== undefined ? `systemd 退出码 ${service.execMainStatus}` : service.result
    });
  }

  if (service.available && service.activeState !== "activating" && scheduler.exists) {
    const intervalSeconds = Math.max((scheduler.intervalMinutes || 0) * 60, getUpdatePolicy().intervalSeconds);
    if (scheduler.ageSeconds !== undefined && scheduler.ageSeconds > intervalSeconds * 2 + 900) {
      issues.push({
        type: "crawl",
        severity: "warning",
        message: "抖音舆情采集已超时未完成",
        detail: scheduler.lastCompletedAt ? `上次成功：${scheduler.lastCompletedAt}` : undefined
      });
    }
  }

  if (service.available && !scheduler.exists) {
    issues.push({
      type: "crawl",
      severity: "warning",
      message: "抖音采集调度状态文件缺失",
      detail: runtimeConfig.douyinCrawlStatePath
    });
  }

  if (service.available && loginProfile.checked && loginProfile.configReadable === false) {
    issues.push({
      type: "config",
      severity: "warning",
      message: "MediaCrawler 配置状态不可读",
      detail: runtimeConfig.douyinMediaCrawlerDir
    });
  }

  if (service.available && loginProfile.checked && usesCookieLogin && loginProfile.configReadable !== false && !loginProfile.cookieConfigured) {
    issues.push({
      type: "login",
      severity: "error",
      message: "抖音登录 cookie 配置缺失",
      detail: "MediaCrawler 配置中没有可用的抖音 cookie。"
    });
  }

  if (
    service.available
    && loginProfile.checked
    && !usesCookieLogin
    && (!loginProfile.exists || !loginProfile.hasSessionCookie)
  ) {
    issues.push({
      type: "login",
      severity: "error",
      message: "抖音登录态需要重新确认",
      detail: loginProfile.exists ? "MediaCrawler profile 中没有有效登录 cookie。" : "MediaCrawler profile 不存在。"
    });
  }

  if (service.available && loginProfile.error && loginProfile.exists) {
    issues.push({
      type: "login",
      severity: "warning",
      message: "抖音登录态检查不完整",
      detail: loginProfile.error
    });
  }

  return issues;
}

function looksLikeLoginFailure(text: string) {
  return /(login failed|check_login_state|LOGIN_STATUS|Cookie login requested|no Douyin cookie|验证码|身份验证|安全验证|登录态|cookie)/i.test(text);
}

function statusFromIssues(issues: DouyinCrawlStatusIssue[], service: DouyinCrawlServiceStatus): BettaFishProbeStatus {
  if (!service.available && process.platform === "win32") return "skipped";
  if (issues.some((issue) => issue.severity === "error")) return "error";
  if (issues.length) return "warning";
  return "ok";
}

function parseKeyValueText(text: string) {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}

function normalizeSystemdTimestamp(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "n/a") return undefined;
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : trimmed;
}

function normalizeStateTime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : trimmed;
}

function numberValue(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function compactCommandMessage(result: CommandResult) {
  return (result.stderr || result.stdout || result.message || `exit ${result.code ?? "unknown"}`).replace(/\s+/g, " ").trim().slice(0, 240);
}

async function pathExists(candidate: string) {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command: string, args: string[], timeoutMs = 5_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          code: (error as NodeJS.ErrnoException & { code?: number | string | null }).code,
          message: error.message
        });
        return;
      }
      resolve({ ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
