import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as loadEnv, parse as parseEnv } from "dotenv";
import { Client } from "ssh2";

loadEnv({ path: path.resolve(".env.local"), quiet: true });
loadEnv({ path: path.resolve(".env"), quiet: true });
const defaultCredentialEnvFile = path.resolve(".env.bettafish-credentials.local");
const extraEnvFile = process.env.BETTAFISH_CREDENTIAL_ENV_FILE
  || (fs.existsSync(defaultCredentialEnvFile) ? defaultCredentialEnvFile : "");
if (extraEnvFile) loadNonEmptyEnvFile(extraEnvFile);

type HostTarget = {
  name: "inner" | "public";
  host: string;
  port: number;
  username: string;
  password: string;
  envFiles: string[];
  restartCommand?: string;
};

const dryRun = process.argv.includes("--dry-run");
const restart = process.argv.includes("--restart");
const engineCredentialGroups = [
  {
    prefix: "REPORT_ENGINE",
    keys: ["REPORT_ENGINE_API_KEY", "REPORT_ENGINE_BASE_URL", "REPORT_ENGINE_MODEL_NAME"],
  },
  {
    prefix: "QUERY_ENGINE",
    keys: ["QUERY_ENGINE_API_KEY", "QUERY_ENGINE_BASE_URL", "QUERY_ENGINE_MODEL_NAME"],
  },
  {
    prefix: "INSIGHT_ENGINE",
    keys: ["INSIGHT_ENGINE_API_KEY", "INSIGHT_ENGINE_BASE_URL", "INSIGHT_ENGINE_MODEL_NAME"],
  },
  {
    prefix: "MEDIA_ENGINE",
    keys: ["MEDIA_ENGINE_API_KEY", "MEDIA_ENGINE_BASE_URL", "MEDIA_ENGINE_MODEL_NAME"],
  },
];
const sharedLlmKeys = {
  apiKey: "BETTAFISH_SHARED_LLM_API_KEY",
  baseUrl: "BETTAFISH_SHARED_LLM_BASE_URL",
  modelName: "BETTAFISH_SHARED_LLM_MODEL_NAME",
};
const useOpenAiApiKeyAsSharedLlm = "BETTAFISH_USE_OPENAI_API_KEY_AS_SHARED_LLM";
const requiredKeys = [
  ...engineCredentialGroups.flatMap((group) => group.keys),
  "TAVILY_API_KEY",
];
const oneOfSearchKeys = ["ANSPIRE_API_KEY", "BOCHA_WEB_SEARCH_API_KEY"];
const optionalKeys = [
  "SEARCH_TOOL_TYPE",
  "MINDSPIDER_API_KEY",
  "MINDSPIDER_BASE_URL",
  "MINDSPIDER_MODEL_NAME",
  "FORUM_HOST_API_KEY",
  "FORUM_HOST_BASE_URL",
  "FORUM_HOST_MODEL_NAME",
  "KEYWORD_OPTIMIZER_API_KEY",
  "KEYWORD_OPTIMIZER_BASE_URL",
  "KEYWORD_OPTIMIZER_MODEL_NAME"
];
const allCandidateKeys = [...requiredKeys, ...oneOfSearchKeys, ...optionalKeys];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const values = collectCredentialValues();
  const missing = missingRequiredCredentialKeys(values);
  const targets = resolveTargets();

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    dryRun,
    restart,
    credentialEnvFile: credentialEnvFileForOutput(),
    credentialTemplateExists: fs.existsSync(credentialEnvFileForOutput()),
    credentialKeysPresent: Object.keys(values).sort(),
    sharedLlmKeysPresent: sharedLlmKeysPresent(),
    missingRequiredKeys: missing,
    targets: targets.map((target) => ({ name: target.name, host: target.host, port: target.port, envFiles: target.envFiles })),
    nextSteps: missing.length ? credentialNextSteps() : [],
  }, null, 2));

  if (!targets.length) {
    throw new Error("No SSH targets resolved. Check inner credential file and .env.local public SSH settings.");
  }
  if (missing.length) {
    process.exitCode = 1;
    return;
  }
  if (dryRun) return;

  for (const target of targets) {
    const result = await applyCredentials(target, values);
    if (result.code !== 0) {
      throw new Error(`${target.name} credential apply failed: ${result.stderr || result.stdout || result.code}`);
    }
    console.log(`${target.name}: updated ${target.envFiles.length} env file(s) with ${Object.keys(values).length} key(s)`);
  }
}

function loadNonEmptyEnvFile(envFile: string) {
  const resolved = path.resolve(envFile);
  if (!fs.existsSync(resolved)) return;
  const parsed = parseEnv(fs.readFileSync(resolved));
  for (const [key, value] of Object.entries(parsed)) {
    if (value) process.env[key] = value;
  }
}

function credentialEnvFileForOutput() {
  return path.resolve(extraEnvFile || defaultCredentialEnvFile);
}

function credentialNextSteps() {
  return [
    `Fill ${credentialEnvFileForOutput()} with BETTAFISH_SHARED_LLM_API_KEY, BETTAFISH_SHARED_LLM_BASE_URL, and BETTAFISH_SHARED_LLM_MODEL_NAME, or fill all four explicit upstream engine triplets.`,
    "Set TAVILY_API_KEY and one of ANSPIRE_API_KEY or BOCHA_WEB_SEARCH_API_KEY.",
    "Rerun: npm run apply:bettafish-credentials -- --dry-run",
    "When missingRequiredKeys is empty, run: npm run apply:bettafish-credentials -- --restart"
  ];
}

function missingRequiredCredentialKeys(values: Record<string, string>) {
  const missing = requiredKeys.filter((key) => !values[key]);
  if (!oneOfSearchKeys.some((key) => process.env[key])) {
    missing.push(oneOfSearchKeys.join(" or "));
  }
  return missing;
}

function collectCredentialValues() {
  const values: Record<string, string> = {};
  for (const key of allCandidateKeys) {
    const value = process.env[key];
    if (value) values[key] = value;
  }
  applySharedLlmCredentials(values);
  return values;
}

function applySharedLlmCredentials(values: Record<string, string>) {
  const shared = {
    apiKey: resolveSharedLlmApiKey(),
    baseUrl: process.env[sharedLlmKeys.baseUrl] || "",
    modelName: process.env[sharedLlmKeys.modelName] || "",
  };
  if (!shared.apiKey || !shared.baseUrl || !shared.modelName) return;

  for (const group of engineCredentialGroups) {
    values[`${group.prefix}_API_KEY`] ||= shared.apiKey;
    values[`${group.prefix}_BASE_URL`] ||= shared.baseUrl;
    values[`${group.prefix}_MODEL_NAME`] ||= shared.modelName;
  }
}

function resolveSharedLlmApiKey() {
  if (process.env[sharedLlmKeys.apiKey]) return process.env[sharedLlmKeys.apiKey] || "";
  if (isEnabled(process.env[useOpenAiApiKeyAsSharedLlm]) && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  return "";
}

function sharedLlmKeysPresent() {
  const present = Object.values(sharedLlmKeys).filter((key) => process.env[key]);
  if (!process.env[sharedLlmKeys.apiKey] && isEnabled(process.env[useOpenAiApiKeyAsSharedLlm]) && process.env.OPENAI_API_KEY) {
    present.push("OPENAI_API_KEY via BETTAFISH_USE_OPENAI_API_KEY_AS_SHARED_LLM");
  }
  return present.sort();
}

function isEnabled(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes((value || "").trim().toLowerCase());
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
    envFiles: ["/opt/BettaFish/.env", "/opt/BettaFish/current/.env"],
    restartCommand: "systemctl restart bettafish-full",
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
    envFiles: ["/home/yq/BettaFish/.env"],
    restartCommand: [
      "pkill -f '/home/yq/BettaFish/app.py' 2>/dev/null || true",
      "if [ -x /home/yq/bin/start-bettafish-public.sh ]; then /home/yq/bin/start-bettafish-public.sh; fi",
    ].join("; "),
  };
}

async function applyCredentials(target: HostTarget, values: Record<string, string>) {
  const payload = Buffer.from(JSON.stringify({ envFiles: target.envFiles, values, restart, restartCommand: target.restartCommand || "" }), "utf8").toString("base64");
  const script = Buffer.from(remoteApplyPython(), "utf8").toString("base64");
  const launcher = `import base64; exec(base64.b64decode(${JSON.stringify(script)}).decode("utf-8"))`;
  return sshExec(target, `python3 -c ${shellQuote(launcher)}`, restart ? 90_000 : 45_000, `${payload}\n`);
}

function sshExec(target: HostTarget, command: string, timeoutMs: number, stdin = "") {
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
          if (stdin) {
            stream.write(stdin);
            stream.end();
          }
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
        tryKeyboard: false,
      });
  });
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function remoteApplyPython() {
  return String.raw`
import base64
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

payload = json.loads(base64.b64decode(sys.stdin.read()).decode("utf-8"))
values = payload["values"]
updated = []

def update_env_file(path):
    p = Path(path)
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        lines = []
    else:
        lines = p.read_text(errors="ignore").splitlines()
        backup = str(p) + ".bak.apply-bettafish-credentials"
        shutil.copy2(str(p), backup)
    seen = set()
    out = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            out.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in values:
            out.append("%s=%s" % (key, values[key]))
            seen.add(key)
        else:
            out.append(line)
    for key in sorted(values.keys()):
        if key not in seen:
            out.append("%s=%s" % (key, values[key]))
    p.write_text("\n".join(out).rstrip() + "\n")
    try:
        os.chmod(str(p), 0o600)
    except Exception:
        pass
    updated.append(str(p))

for env_file in payload["envFiles"]:
    update_env_file(env_file)

if payload.get("restart") and payload.get("restartCommand"):
    subprocess.run(payload["restartCommand"], shell=True, check=True)

print(json.dumps({"updated": updated, "keyCount": len(values), "restarted": bool(payload.get("restart"))}, ensure_ascii=False))
`;
}
