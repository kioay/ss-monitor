import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { Client } from "ssh2";

loadEnv({ path: path.resolve(".env.local"), quiet: true });
loadEnv({ path: path.resolve(".env"), quiet: true });

type HostTarget = {
  name: "inner" | "public";
  host: string;
  port: number;
  username: string;
  password: string;
  repoRoot: string;
  monitorUrl: string;
};

type CheckStatus = "pass" | "fail" | "warn" | "skip";

type Check = {
  name: string;
  status: CheckStatus;
  detail: string;
};

const fullActions = process.argv.includes("--full-actions");
const includeHttpsCheck = !process.argv.includes("--skip-https");
const upstreamRepo = process.env.BETTAFISH_UPSTREAM_URL || "https://github.com/666ghj/BettaFish";
const requiredCredentialKeys = [
  "REPORT_ENGINE_API_KEY",
  "REPORT_ENGINE_BASE_URL",
  "REPORT_ENGINE_MODEL_NAME",
  "QUERY_ENGINE_API_KEY",
  "QUERY_ENGINE_BASE_URL",
  "QUERY_ENGINE_MODEL_NAME",
  "INSIGHT_ENGINE_API_KEY",
  "INSIGHT_ENGINE_BASE_URL",
  "INSIGHT_ENGINE_MODEL_NAME",
  "MEDIA_ENGINE_API_KEY",
  "MEDIA_ENGINE_BASE_URL",
  "MEDIA_ENGINE_MODEL_NAME",
  "TAVILY_API_KEY",
];
const oneOfSearchCredentialKeys = ["ANSPIRE_API_KEY", "BOCHA_WEB_SEARCH_API_KEY"];

const checks: Check[] = [];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const upstreamHead = resolveUpstreamHead();
  addCheck("github.head", upstreamHead ? "pass" : "fail", upstreamHead || "unable to resolve upstream HEAD");

  const targets = resolveTargets();
  addCheck("ssh.targets", targets.length >= 2 ? "pass" : "fail", targets.map((target) => target.name).join(", ") || "none");

  for (const target of targets) {
    const result = await runRemoteProbe(target);
    printRemoteResult(target, result, upstreamHead);
  }

  await probePublicWebsite(includeHttpsCheck);
  await probePublicHttpsServerState(targets, includeHttpsCheck);
  await probePublicBrowserAcceptance(targets);

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), fullActions, checks }, null, 2));
  const failures = checks.filter((check) => check.status === "fail");
  if (failures.length) {
    process.exitCode = 1;
  }
}

function resolveUpstreamHead() {
  try {
    const output = execFileSync("git", ["ls-remote", upstreamRepo, "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return output.trim().split(/\s+/)[0] || "";
  } catch {
    return "";
  }
}

function resolveTargets(): HostTarget[] {
  const targets: HostTarget[] = [];
  const inner = resolveInnerTarget();
  if (inner) targets.push(inner);
  const publicTarget = resolvePublicTarget();
  if (publicTarget) targets.push(publicTarget);
  return targets;
}

function resolveInnerTarget(): HostTarget | undefined {
  const credentialFile = process.env.BETTAFISH_INNER_CREDENTIAL_FILE
    || path.join(os.homedir(), "Desktop", "\u5185\u7f51\u673a.txt");
  if (!fs.existsSync(credentialFile)) return undefined;
  const text = fs.readFileSync(credentialFile, "utf8");
  const host = text.match(/root@([^\r\n]+)/)?.[1]?.trim() || "192.168.8.242";
  const password = text.match(/password:(.*)/)?.[1]?.trim() || "";
  if (!password) return undefined;
  return {
    name: "inner",
    host,
    port: Number(process.env.BETTAFISH_INNER_SSH_PORT || "22"),
    username: "root",
    password,
    repoRoot: process.env.BETTAFISH_INNER_REPO_ROOT || "/opt/BettaFish/current",
    monitorUrl: process.env.BETTAFISH_INNER_MONITOR_URL || "http://127.0.0.1:8787"
  };
}

function resolvePublicTarget(): HostTarget | undefined {
  const remote = process.env.SYNC_CURRENT_VERSION_REMOTE || "";
  const match = remote.match(/^([^@]+)@(.+)$/);
  const password = process.env.SYNC_CURRENT_VERSION_PASSWORD || "";
  if (!match || !password) return undefined;
  return {
    name: "public",
    host: match[2],
    port: Number(process.env.SYNC_CURRENT_VERSION_SSH_PORT || "22"),
    username: match[1],
    password,
    repoRoot: process.env.BETTAFISH_PUBLIC_REPO_ROOT || "/home/yq/BettaFish",
    monitorUrl: process.env.BETTAFISH_PUBLIC_MONITOR_URL || "http://127.0.0.1:8787"
  };
}

async function runRemoteProbe(target: HostTarget) {
  const command = [
    [
      `BETTA_REPO_ROOT=${shellQuote(target.repoRoot)}`,
      `MONITOR_URL=${shellQuote(target.monitorUrl)}`,
      `FULL_ACTIONS=${fullActions ? "1" : "0"}`,
      "python3 - <<'PY'"
    ].join(" "),
    remotePythonProbe(),
    "PY"
  ].join("\n");
  const result = await sshExec(target, command, fullActions ? 180_000 : 90_000);
  if (result.code !== 0) {
    addCheck(`${target.name}.ssh.probe`, "fail", result.stderr || `exit ${result.code}`);
    return undefined;
  }
  try {
    return JSON.parse(result.stdout) as any;
  } catch {
    addCheck(`${target.name}.ssh.probe`, "fail", result.stdout.slice(0, 400));
    return undefined;
  }
}

function printRemoteResult(target: HostTarget, result: any, upstreamHead: string) {
  if (!result) return;
  addCheck(`${target.name}.repo.exists`, result.repoExists ? "pass" : "fail", target.repoRoot);
  addCheck(
    `${target.name}.repo.head`,
    result.gitHeadOk && upstreamHead && result.gitHead === upstreamHead ? "pass" : "fail",
    result.gitHead || result.gitHeadError || "missing"
  );
  addCheck(
    `${target.name}.repo.status`,
    result.gitStatusOk ? result.gitStatus.length === 0 ? "pass" : "warn" : "fail",
    result.gitStatusOk ? result.gitStatus.length ? result.gitStatus.join("; ") : "clean" : result.gitStatusError || "git status failed"
  );
  addCheck(
    `${target.name}.runtime.requirements`,
    result.runtime?.requirementsExists ? "pass" : "fail",
    "requirements.txt"
  );
  addCheck(
    `${target.name}.runtime.envExample`,
    result.runtime?.envExampleExists ? "pass" : "fail",
    ".env.example"
  );
  addCheck(
    `${target.name}.runtime.mediaCrawler`,
    result.runtime?.mediaCrawlerExists ? "pass" : "fail",
    "MindSpider/DeepSentimentCrawling/MediaCrawler"
  );
  addCheck(
    `${target.name}.runtime.python`,
    result.runtime?.pythonVersionOk ? "pass" : "fail",
    `${result.runtime?.runtimePython || "python"}: ${result.runtime?.pythonVersion?.out || result.runtime?.pythonVersion?.err || "missing"}`
  );
  addCheck(
    `${target.name}.runtime.dependencies`,
    result.runtime?.dependenciesOk ? "pass" : "fail",
    result.runtime?.dependencyImports?.out || result.runtime?.dependencyImports?.err || "dependency import failed"
  );
  addCheck(
    `${target.name}.runtime.playwright`,
    result.runtime?.playwrightOk ? "pass" : "fail",
    `${result.runtime?.playwrightNode ? `PLAYWRIGHT_NODEJS_PATH=${result.runtime.playwrightNode}; ` : ""}${result.runtime?.playwrightVersion?.out || result.runtime?.playwrightVersion?.err || "playwright unavailable"}`
  );
  addCheck(
    `${target.name}.runtime.chromium`,
    result.runtime?.chromiumOk ? "pass" : "fail",
    result.runtime?.chromiumCandidates?.join("; ") || "chromium not found"
  );
  addCheck(
    `${target.name}.runtime.chromium.launch`,
    result.runtime?.chromiumLaunchOk ? "pass" : "fail",
    result.runtime?.chromiumLaunch?.out || result.runtime?.chromiumLaunch?.err || "chromium launch failed"
  );
  addCheck(
    `${target.name}.credentials.required`,
    result.missingRequiredKeys.length === 0 ? "pass" : "fail",
    result.missingRequiredKeys.join(", ") || "all required keys set"
  );
  addCheck(`${target.name}.bettafish.status`, result.http.status.ok ? "pass" : "fail", result.http.status.message);
  addCheck(`${target.name}.report.status`, result.http.reportStatus.enginesReady ? "pass" : "fail", result.http.reportStatus.message);
  addCheck(`${target.name}.lab.status`, result.http.lab.ok ? "pass" : "fail", result.http.lab.message);

  for (const action of result.actions) {
    const expectedToFailWithoutCredentials = ["report.generate", "runtime.systemStart"].includes(action.action);
    addCheck(
      `${target.name}.action.${action.action}`,
      action.ok ? "pass" : expectedToFailWithoutCredentials ? "fail" : "fail",
      action.message || `HTTP ${action.http}`
    );
  }
}

async function probePublicWebsite(checkHttps: boolean) {
  const httpPage = await fetchText("http://ss-monitor.qinoay.top/");
  addCheck(
    "public.web.http.page",
    httpPage.ok && looksLikeAppShell(httpPage.text) ? "pass" : "fail",
    httpPage.ok ? `HTTP ${httpPage.status}` : httpPage.error
  );
  const httpLab = await fetchText("http://ss-monitor.qinoay.top/api/bettafish/lab?windowHours=72");
  addCheck(
    "public.web.http.lab",
    httpLab.ok && httpLab.text.includes("test-lab") ? "pass" : "fail",
    httpLab.ok ? `HTTP ${httpLab.status}` : httpLab.error
  );
  if (!checkHttps) {
    addCheck("public.web.https", "skip", "--skip-https");
    return;
  }
  const httpsPage = await fetchText("https://ss-monitor.qinoay.top/");
  addCheck(
    "public.web.https.page",
    httpsPage.ok && looksLikeAppShell(httpsPage.text) ? "pass" : "fail",
    httpsPage.ok ? `HTTPS ${httpsPage.status}` : httpsPage.error
  );
}

async function probePublicHttpsServerState(targets: HostTarget[], checkHttps: boolean) {
  if (!checkHttps) {
    addCheck("public.web.https.server", "skip", "--skip-https");
    return;
  }
  const publicTarget = targets.find((target) => target.name === "public");
  if (!publicTarget) {
    addCheck("public.web.https.server", "skip", "public SSH target unavailable");
    return;
  }

  const command = [
    "nginx_conf=/etc/nginx/nginx.conf",
    "cert_dir=/etc/letsencrypt/live/ss-monitor.qinoay.top",
    "printf 'sudo_n='; if sudo -n true >/dev/null 2>&1; then echo yes; else echo no; fi",
    "printf 'nginx_conf_readable='; if test -r \"$nginx_conf\"; then echo yes; else echo no; fi",
    "printf 'nginx_conf_writable='; if test -w \"$nginx_conf\"; then echo yes; else echo no; fi",
    "printf 'nginx_conf_owner='; if test -e \"$nginx_conf\"; then ls -ld \"$nginx_conf\" | awk '{print $1\":\"$3\":\"$4}'; else echo missing; fi",
    "printf 'cert_dir='; if test -d \"$cert_dir\"; then echo present; else echo missing; fi",
    "printf 'server_http='; if grep -Eq 'server_name[[:space:]]+ss-monitor[.]qinoay[.]top' \"$nginx_conf\" 2>/dev/null; then echo present; else echo missing; fi",
    "printf 'server_https='; if awk 'BEGIN{in_server=0; hit_name=0; hit_443=0; found=0} /server[[:space:]]*\\{/ {in_server=1; hit_name=0; hit_443=0} in_server && /server_name[[:space:]]+ss-monitor[.]qinoay[.]top/ {hit_name=1} in_server && /listen[[:space:]].*443/ {hit_443=1} in_server && /\\}/ {if(hit_name && hit_443){found=1}; in_server=0} END{exit found ? 0 : 1}' \"$nginx_conf\" 2>/dev/null; then echo present; else echo missing; fi"
  ].join("\n");
  const result = await sshExec(publicTarget, command, 30_000);
  if (result.code !== 0) {
    addCheck("public.web.https.server", "fail", result.stderr || result.stdout || `exit ${result.code}`);
    return;
  }

  const facts = parseKeyValueLines(result.stdout);
  const accessDetail = [
    `sudo_n=${facts.sudo_n || "unknown"}`,
    `conf_owner=${facts.nginx_conf_owner || "unknown"}`,
    `conf_writable=${facts.nginx_conf_writable || "unknown"}`
  ].join(" ");
  addCheck(
    "public.web.https.nginx.access",
    facts.sudo_n === "yes" ? "pass" : "fail",
    accessDetail
  );
  addCheck(
    "public.web.https.nginx.config",
    facts.server_https === "present" ? "pass" : "fail",
    `http=${facts.server_http || "unknown"} https=${facts.server_https || "unknown"} readable=${facts.nginx_conf_readable || "unknown"}`
  );
  addCheck(
    "public.web.https.certdir",
    facts.cert_dir === "present" ? "pass" : "fail",
    `/etc/letsencrypt/live/ss-monitor.qinoay.top=${facts.cert_dir || "unknown"}`
  );
}

async function probePublicBrowserAcceptance(targets: HostTarget[]) {
  const target = targets.find((candidate) => candidate.name === "inner") || targets[0];
  if (!target) {
    addCheck("public.web.http.browser", "skip", "no SSH target available");
    return;
  }
  const result = await runRemoteBrowserAcceptance(target);
  if (!result) return;

  const detail = browserAcceptanceDetail(target, result);
  addCheck(
    "public.web.http.browser.page",
    result.ok && result.rootCount > 0 && result.tabCount >= 2 ? "pass" : "fail",
    detail
  );
  addCheck(
    "public.web.http.browser.lab",
    result.ok && result.labPageVisible ? "pass" : "fail",
    detail
  );
  addCheck(
    "public.web.http.browser.labApi",
    result.labApi?.ok && result.labApi?.status === 200 && result.labApi?.mode === "test-lab" ? "pass" : "fail",
    detail
  );
  addCheck(
    "public.web.http.browser.errors",
    (result.consoleErrors?.length || 0) === 0 && (result.pageErrors?.length || 0) === 0 ? "pass" : "fail",
    detail
  );
}

async function runRemoteBrowserAcceptance(target: HostTarget) {
  const command = [
    "set -e",
    `export BETTA_REPO_ROOT=${shellQuote(target.repoRoot)}`,
    "export PUBLIC_WEB_URL='http://ss-monitor.qinoay.top/'",
    `export PLAYWRIGHT_BROWSERS_PATH=${shellQuote(defaultPlaywrightBrowsersPath(target))}`,
    "python_bin=python3",
    `for candidate in ${browserPythonCandidates(target).map(shellQuote).join(" ")}; do`,
    "  if [ -x \"$candidate\" ] || command -v \"$candidate\" >/dev/null 2>&1; then",
    "    python_bin=\"$candidate\"",
    "    break",
    "  fi",
    "done",
    "\"$python_bin\" - <<'PY'",
    remoteBrowserAcceptanceProbe(),
    "PY"
  ].join("\n");
  const result = await sshExec(target, command, 90_000);
  if (result.code !== 0) {
    addCheck(
      "public.web.http.browser",
      "fail",
      result.stderr || result.stdout || `browser acceptance exited ${result.code}`
    );
    return undefined;
  }
  try {
    return JSON.parse(result.stdout) as any;
  } catch {
    addCheck("public.web.http.browser", "fail", result.stdout.slice(0, 400) || "invalid browser acceptance JSON");
    return undefined;
  }
}

function browserPythonCandidates(target: HostTarget) {
  const repoParent = path.posix.dirname(target.repoRoot);
  const candidates = [
    `${target.repoRoot}/.venv/bin/python`,
    `${target.repoRoot}/venv/bin/python`,
    `${repoParent}/.venv/bin/python`,
  ];
  if (target.name === "inner") {
    candidates.unshift("/opt/BettaFish/.venv/bin/python");
  } else {
    candidates.push("/opt/ss-monitor/runtime/cpython-3.10.20-20260510/bin/python3");
  }
  candidates.push("python3");
  return [...new Set(candidates)];
}

function defaultPlaywrightBrowsersPath(target: HostTarget) {
  if (target.name === "inner") return "/opt/BettaFish/playwright-browsers";
  return `${path.posix.dirname(target.repoRoot)}/playwright-browsers`;
}

function browserAcceptanceDetail(target: HostTarget, result: any) {
  const labApi = result.labApi || {};
  return [
    `target=${target.name}`,
    `title=${result.title || ""}`,
    `root=${result.rootCount ?? 0}`,
    `tabs=${result.tabCount ?? 0}`,
    `labVisible=${Boolean(result.labPageVisible)}`,
    `api=${labApi.status || 0}`,
    `mode=${labApi.mode || ""}`,
    `operations=${labApi.operations ?? ""}`,
    `consoleErrors=${result.consoleErrors?.length || 0}`,
    `pageErrors=${result.pageErrors?.length || 0}`
  ].join(" ");
}

async function fetchText(url: string) {
  let last = { ok: false, status: 0, text: "", error: "not attempted" };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      last = { ok: response.ok, status: response.status, text, error: "" };
      if (response.ok && text.trim()) return last;
    } catch (error) {
      last = { ok: false, status: 0, text: "", error: errorMessageWithCause(error) };
    }
    await sleep(350 * attempt);
  }
  return last;
}

function looksLikeAppShell(text: string) {
  return /<div\s+id=["']root["']\s*>/i.test(text) && /<script\b/i.test(text);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addCheck(name: string, status: CheckStatus, detail: string) {
  checks.push({ name, status, detail: compact(detail) });
}

function errorMessageWithCause(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message}: ${cause.message}`;
  }
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") {
    return `${error.message}: ${cause.message}`;
  }
  return error.message;
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

function parseKeyValueLines(output: string) {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_.-]+)=(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

function sshExec(target: HostTarget, command: string, timeoutMs: number) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const client = new Client();
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      try {
        client.end();
      } catch {
        // ignore close failures
      }
      resolve(result);
    };
    client
      .on("ready", () => {
        client.exec(command, (error, stream) => {
          if (error) {
            finish({ code: -1, stdout, stderr: String(error) });
            return;
          }
          const timeout = setTimeout(() => {
            stderr += "\n[TIMEOUT]";
            try {
              stream.close();
            } catch {
              // ignore close failures
            }
            finish({ code: -2, stdout, stderr });
          }, timeoutMs);
          stream.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
          });
          stream.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
          });
          stream.on("close", (code: number) => {
            clearTimeout(timeout);
            finish({ code, stdout, stderr });
          });
        });
      })
      .on("error", (error) => {
        finish({ code: -1, stdout, stderr: error.message });
      })
      .connect({
        host: target.host,
        port: target.port,
        username: target.username,
        password: target.password,
        readyTimeout: 20_000,
        tryKeyboard: false
      });
  });
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function remotePythonProbe() {
  return String.raw`
import json
import os
import re
import shlex
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

repo = os.environ["BETTA_REPO_ROOT"]
monitor = os.environ["MONITOR_URL"].rstrip("/")
full_actions = os.environ.get("FULL_ACTIONS") == "1"
required_keys = ${JSON.stringify(requiredCredentialKeys)}
one_of_search_keys = ${JSON.stringify(oneOfSearchCredentialKeys)}

def run(args, cwd=None, timeout=20):
    try:
        proc = subprocess.run(args, cwd=cwd, universal_newlines=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        return {"code": proc.returncode, "out": proc.stdout.strip(), "err": proc.stderr.strip()}
    except Exception as exc:
        return {"code": -1, "out": "", "err": str(exc)}

def run_shell(command, cwd=None, timeout=20):
    try:
        proc = subprocess.run(command, shell=True, cwd=cwd, universal_newlines=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        return {"code": proc.returncode, "out": proc.stdout.strip(), "err": proc.stderr.strip()}
    except Exception as exc:
        return {"code": -1, "out": "", "err": str(exc)}

def python_version_ok(version_text):
    match = re.search(r"Python\s+(\d+)\.(\d+)", version_text or "")
    if not match:
        return False
    major = int(match.group(1))
    minor = int(match.group(2))
    return major > 3 or (major == 3 and minor >= 9)

def resolve_runtime_python(root):
    app_path = str(root / "app.py")
    proc = run_shell("ps -eo args | grep -F %s | grep -v grep | head -1" % shlex.quote(app_path))
    if proc["code"] == 0 and proc["out"]:
        try:
            parts = shlex.split(proc["out"].splitlines()[0])
            if parts and "python" in Path(parts[0]).name:
                return parts[0]
        except Exception:
            pass
    for script_path in ["/home/yq/bin/start-bettafish-public.sh", str(root / "start.sh")]:
        path = Path(script_path)
        if not path.exists():
            continue
        text = path.read_text(errors="ignore")
        for match in re.finditer(r"(/[^\\s\"']*/python3?)\\s+[^\\n]*app\\.py", text):
            candidate = match.group(1)
            if Path(candidate).exists():
                return candidate
    candidates = [
        str(root / ".venv/bin/python"),
        str(root / "venv/bin/python"),
        str(root.parent / ".venv/bin/python"),
        "/opt/ss-monitor/runtime/cpython-3.10.20-20260510/bin/python3",
        "/opt/BettaFish/.venv/bin/python",
        "python3",
    ]
    for candidate in candidates:
        if candidate == "python3" or Path(candidate).exists():
            return candidate
    return "python3"

def resolve_playwright_node(root):
    candidates = []
    for candidate in [
        "/home/yq/bin/start-bettafish-public.sh",
        "/etc/systemd/system/bettafish-full.service",
        str(root.parent / ".env"),
        str(root / ".env"),
    ]:
        path = Path(candidate)
        if not path.exists():
            continue
        text = path.read_text(errors="ignore")
        for match in re.finditer(r"PLAYWRIGHT_NODEJS_PATH=([^\\s\"']+)", text):
            candidates.append(match.group(1).strip())
    candidates.append("/opt/nodejs/bin/node")
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return ""

def find_chromium(root):
    candidates = []
    seen_candidates = set()
    roots = []
    for candidate in [root, root.parent, Path.home() / ".cache", Path("/opt/BettaFish")]:
        if candidate.exists() and str(candidate) not in [str(existing) for existing in roots]:
            roots.append(candidate)
    for search_root in roots:
        found = run_shell("find . -path '*chrome-linux/chrome' -o -path '*chrome-for-testing*/chrome' | head -20", cwd=str(search_root), timeout=15)
        if found["code"] == 0 and found["out"]:
            for line in found["out"].splitlines():
                relative = line[2:] if line.startswith("./") else line
                full_path = str(search_root / relative)
                if full_path not in seen_candidates:
                    seen_candidates.add(full_path)
                    candidates.append(full_path)
    return candidates[:20]

def test_chromium_launch(runtime_python, playwright_node, candidates):
    if not candidates:
        return {"code": -1, "out": "", "err": "chromium not found"}
    code = r'''
import asyncio
import json
import sys
from playwright.async_api import async_playwright

async def main():
    candidates = json.loads(sys.argv[1])
    errors = []
    async with async_playwright() as p:
        for candidate in candidates:
            browser = None
            try:
                browser = await p.chromium.launch(
                    headless=True,
                    executable_path=candidate,
                    args=["--no-sandbox", "--disable-gpu"],
                )
                page = await browser.new_page()
                await page.goto("data:text/html,<title>ok</title>", wait_until="load", timeout=15000)
                title = await page.title()
                await browser.close()
                if title == "ok":
                    print(candidate)
                    return
                errors.append(candidate + ": unexpected title " + title)
            except Exception as exc:
                if browser:
                    try:
                        await browser.close()
                    except Exception:
                        pass
                errors.append(candidate + ": " + str(exc).splitlines()[0][:240])
    print("\n".join(errors), file=sys.stderr)
    raise SystemExit(1)

asyncio.run(main())
'''
    env = os.environ.copy()
    if playwright_node:
        env["PLAYWRIGHT_NODEJS_PATH"] = playwright_node
    try:
        proc = subprocess.run(
            [runtime_python, "-c", code, json.dumps(candidates[:8])],
            cwd=repo,
            env=env,
            universal_newlines=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=45,
        )
        return {"code": proc.returncode, "out": proc.stdout.strip(), "err": proc.stderr.strip()}
    except Exception as exc:
        return {"code": -1, "out": "", "err": str(exc)}

def parse_env_file(path):
    values = {}
    p = Path(path)
    if not p.exists():
        return values
    for raw in p.read_text(errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values

def merged_env():
    candidates = []
    root = Path(repo)
    if str(root).endswith("/current"):
        candidates.append(str(root.parent / ".env"))
    candidates.append(str(root / ".env"))
    if repo == "/home/yq/BettaFish":
        candidates.append("/home/yq/BettaFish/.env")
    values = {}
    files = []
    for candidate in candidates:
        parsed = parse_env_file(candidate)
        if parsed:
            files.append(candidate)
            values.update(parsed)
    return files, values

def get_json(url, timeout=15):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            text = response.read().decode("utf-8", "replace")
            try:
                data = json.loads(text)
            except Exception:
                data = {}
            return {"ok": 200 <= response.status < 300, "status": response.status, "data": data, "message": text[:240]}
    except Exception as exc:
        return {"ok": False, "status": getattr(exc, "code", 0), "data": {}, "message": str(exc)[:240]}

def post_action(body, timeout=75):
    request = urllib.request.Request(
        monitor + "/api/bettafish/lab/action",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
            data = json.loads(raw)
            return {"action": body["action"], "http": response.status, "ok": bool(data.get("ok")), "message": (data.get("message") or "")[:240]}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            data = json.loads(raw)
        except Exception:
            data = {"message": raw}
        return {"action": body["action"], "http": exc.code, "ok": bool(data.get("ok")), "message": (data.get("message") or raw)[:240]}
    except Exception as exc:
        return {"action": body["action"], "http": 0, "ok": False, "message": str(exc)[:240]}

repo_path = Path(repo)
env_files, env_values = merged_env()
runtime_python = resolve_runtime_python(repo_path)
playwright_node = resolve_playwright_node(repo_path)
playwright_prefix = ""
if playwright_node:
    playwright_prefix = "PLAYWRIGHT_NODEJS_PATH=%s " % shlex.quote(playwright_node)
python_version = run_shell("%s --version" % shlex.quote(runtime_python), cwd=repo)
dependency_imports = run_shell("%s - <<'PY'\nimport flask, dotenv, openai, pydantic\nprint('imports-ok')\nPY" % shlex.quote(runtime_python), cwd=repo)
playwright_version = run_shell("%s%s -m playwright --version" % (playwright_prefix, shlex.quote(runtime_python)), cwd=repo)
chromium_candidates = find_chromium(repo_path)
chromium_launch = test_chromium_launch(runtime_python, playwright_node, chromium_candidates)
git_head = run(["git", "rev-parse", "HEAD"], cwd=repo)
status = run(["git", "status", "--short"], cwd=repo)
report_status = get_json("http://127.0.0.1:5000/api/report/status")
actions = [
    post_action({"action": "sentiment.analyze", "text": "The latest update feels worse and cheaters are more visible."}),
    post_action({"action": "mindspider.status"}),
    post_action({"action": "mindspider.dbProbe"}),
]
if full_actions:
    actions.append(post_action({"action": "report.generate", "query": "SS sentiment smoke report"}))
    actions.append(post_action({"action": "runtime.systemStart", "confirmationPassword": "wooduan"}, timeout=90))

result = {
    "repoExists": repo_path.exists(),
    "gitHeadOk": git_head.get("code") == 0,
    "gitHead": git_head.get("out", ""),
    "gitHeadError": git_head.get("err", ""),
    "gitStatusOk": status.get("code") == 0,
    "gitStatusError": status.get("err", ""),
    "gitStatus": [line for line in status.get("out", "").splitlines() if line],
    "submoduleStatus": run(["git", "submodule", "status", "--recursive"], cwd=repo).get("out", ""),
    "runtime": {
        "requirementsExists": (repo_path / "requirements.txt").exists(),
        "envExampleExists": (repo_path / ".env.example").exists(),
        "mediaCrawlerExists": (repo_path / "MindSpider/DeepSentimentCrawling/MediaCrawler").exists(),
        "runtimePython": runtime_python,
        "pythonVersion": python_version,
        "pythonVersionOk": python_version.get("code") == 0 and python_version_ok(python_version.get("out", "") + " " + python_version.get("err", "")),
        "dependencyImports": dependency_imports,
        "dependenciesOk": dependency_imports.get("code") == 0 and "imports-ok" in dependency_imports.get("out", ""),
        "playwrightNode": playwright_node,
        "playwrightVersion": playwright_version,
        "playwrightOk": playwright_version.get("code") == 0 and "Version" in playwright_version.get("out", ""),
        "chromiumCandidates": chromium_candidates,
        "chromiumOk": bool(chromium_candidates),
        "chromiumLaunch": chromium_launch,
        "chromiumLaunchOk": chromium_launch.get("code") == 0,
    },
    "envFiles": env_files,
    "missingRequiredKeys": [key for key in required_keys if not env_values.get(key)] + ([] if any(env_values.get(key) for key in one_of_search_keys) else [" or ".join(one_of_search_keys)]),
    "http": {
        "status": get_json("http://127.0.0.1:5000/api/status"),
        "reportStatus": {
            "ok": report_status.get("ok", False),
            "enginesReady": bool(report_status.get("data", {}).get("engines_ready")),
            "initialized": bool(report_status.get("data", {}).get("initialized")),
            "message": report_status.get("message", ""),
        },
        "lab": get_json(monitor + "/api/bettafish/lab?windowHours=72"),
    },
    "actions": actions,
}
print(json.dumps(result, ensure_ascii=False))
`;
}

function remoteBrowserAcceptanceProbe() {
  return String.raw`
import asyncio
import json
import os
import subprocess
import traceback
from pathlib import Path

from playwright.async_api import async_playwright

repo = Path(os.environ["BETTA_REPO_ROOT"])
public_web_url = os.environ.get("PUBLIC_WEB_URL", "http://ss-monitor.qinoay.top/")

def find_chromium():
    candidates = []
    seen = set()
    known = [
        "/opt/BettaFish/playwright-browsers/chromium-1124/chrome-linux/chrome",
        "/root/.cache/ms-playwright/chromium-1124/chrome-linux/chrome",
        "/home/yq/.cache/ms-playwright/chromium-1124/chrome-linux/chrome",
        "/home/yq/.cache/chrome-for-testing/chrome-linux64/chrome",
    ]
    for candidate in known:
        path = Path(candidate)
        if path.exists() and candidate not in seen:
            seen.add(candidate)
            candidates.append(candidate)
    roots = [repo, repo.parent, Path.home() / ".cache", Path("/opt/BettaFish")]
    for root in roots:
        if not root.exists():
            continue
        try:
            proc = subprocess.run(
                "find . \\( -path '*chrome-linux/chrome' -o -path '*chrome-for-testing*/chrome' \\) | head -20",
                shell=True,
                cwd=str(root),
                universal_newlines=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=15,
            )
        except Exception:
            continue
        if proc.returncode != 0:
            continue
        for line in proc.stdout.splitlines():
            relative = line[2:] if line.startswith("./") else line
            candidate = str(root / relative)
            if candidate not in seen:
                seen.add(candidate)
                candidates.append(candidate)
    return candidates

async def main():
    console_errors = []
    page_errors = []
    api_events = []
    candidates = find_chromium()
    if not candidates:
        print(json.dumps({"ok": False, "error": "chromium not found"}, ensure_ascii=False))
        raise SystemExit(1)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path=candidates[0],
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = await browser.new_page(viewport={"width": 1366, "height": 900})
        page.on("console", lambda msg: console_errors.append({"type": msg.type, "text": msg.text}) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: page_errors.append(str(exc)))
        page.on("response", lambda res: api_events.append({"url": res.url, "status": res.status}) if "/api/bettafish/lab" in res.url else None)
        await page.goto(public_web_url, wait_until="networkidle", timeout=30000)
        title = await page.title()
        root_count = await page.locator("#root").count()
        tab_count = await page.locator(".page-tabs button").count()
        await page.locator(".page-tabs button").nth(1).click(timeout=10000)
        await page.wait_for_selector(".lab-page", timeout=15000)
        lab_api = await page.evaluate("""async () => {
            try {
                const response = await fetch('/api/bettafish/lab?windowHours=72');
                const data = await response.json();
                return {
                    ok: response.ok,
                    status: response.status,
                    mode: data.mode,
                    actionsEnabled: data.runtime && data.runtime.actionsEnabled,
                    baseUrlConfigured: data.runtime && data.runtime.baseUrlConfigured,
                    operations: Array.isArray(data.operations) ? data.operations.length : null,
                    recommendations: Array.isArray(data.recommendations) ? data.recommendations.length : null
                };
            } catch (error) {
                return { ok: false, error: String(error) };
            }
        }""")
        result = {
            "ok": True,
            "chromium": candidates[0],
            "title": title,
            "rootCount": root_count,
            "tabCount": tab_count,
            "labPageVisible": await page.locator(".lab-page").is_visible(),
            "consoleErrors": console_errors,
            "pageErrors": page_errors,
            "apiEvents": api_events[-5:],
            "labApi": lab_api,
        }
        await browser.close()
    print(json.dumps(result, ensure_ascii=False))

try:
    asyncio.run(main())
except Exception as exc:
    print(json.dumps({"ok": False, "error": str(exc), "traceback": traceback.format_exc()}, ensure_ascii=False))
    raise
`;
}
