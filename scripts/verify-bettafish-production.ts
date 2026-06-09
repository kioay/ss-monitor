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
  "ANSPIRE_API_KEY",
  "BOCHA_WEB_SEARCH_API_KEY"
];

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
    httpPage.ok && httpPage.text.includes("<title>") ? "pass" : "fail",
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
    httpsPage.ok && httpsPage.text.includes("<title>") ? "pass" : "fail",
    httpsPage.ok ? `HTTPS ${httpsPage.status}` : httpsPage.error
  );
}

async function fetchText(url: string) {
  try {
    const response = await fetch(url);
    return { ok: response.ok, status: response.status, text: await response.text(), error: "" };
  } catch (error) {
    return { ok: false, status: 0, text: "", error: errorMessageWithCause(error) };
  }
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
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

repo = os.environ["BETTA_REPO_ROOT"]
monitor = os.environ["MONITOR_URL"].rstrip("/")
full_actions = os.environ.get("FULL_ACTIONS") == "1"
required_keys = ${JSON.stringify(requiredCredentialKeys)}

def run(args, cwd=None, timeout=20):
    try:
        proc = subprocess.run(args, cwd=cwd, universal_newlines=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
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
    "envFiles": env_files,
    "missingRequiredKeys": [key for key in required_keys if not env_values.get(key)],
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
