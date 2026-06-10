import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "ssh2";

loadEnv({ path: path.resolve(".env.local") });
loadEnv({ path: path.resolve(".env") });

type ExecResult = {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
};

type LocalCookie = {
  cookieStringB64: string;
  cookieCount: number;
  hasLoginStatus: boolean;
  hasSessionCookie: boolean;
  source: string;
  profileDir: string;
};

const command = process.argv[2] || "status";
const innerCredential = readInnerCredential();
const remoteHost = process.env.DOUYIN_SERVER_HOST || innerCredential.host || "192.168.8.242";
const remotePort = Number(process.env.DOUYIN_SERVER_PORT || "22");
const remoteUser = process.env.DOUYIN_SERVER_USER || "root";
const remotePassword = process.env.DOUYIN_SERVER_PASSWORD || process.env.SYNC_BETTAFISH_PASSWORD || innerCredential.password || "";
const runUser = process.env.DOUYIN_SERVER_RUN_USER || "yq";
const remoteRoot = normalizeRemoteRoot(process.env.DOUYIN_SERVER_BETTAFISH_ROOT || "/opt/BettaFish");
const runtimeDir = `${remoteRoot}/runtime`;
const mediaCrawlerDir = `${remoteRoot}/current/MindSpider/DeepSentimentCrawling/MediaCrawler`;
const pythonPath = process.env.DOUYIN_SERVER_PYTHON || `${remoteRoot}/.venv/bin/python`;
const browserPath = process.env.DOUYIN_SERVER_BROWSER || `${remoteRoot}/playwright-browsers/chromium-1124/chrome-linux/chrome`;
const qrRemotePath = `${runtimeDir}/server-douyin-login-qr.png`;
const loginLogPath = `${runtimeDir}/server-douyin-login.log`;
const autoSmsLogPath = `${runtimeDir}/server-douyin-auto-sms.log`;
const submitLogPath = `${runtimeDir}/server-douyin-submit-sms.log`;
const sessionLogPath = `${runtimeDir}/server-douyin-session.log`;
const screenshotRemotePath = `${runtimeDir}/server-douyin-login-latest.png`;
const profileDir = `${mediaCrawlerDir}/browser_data/cdp_dy_user_data_dir`;
const cookiePayloadPath = `${runtimeDir}/server-douyin-cookie-payload.json`;
const remoteEnvFiles = [`${remoteRoot}/.env`, `${remoteRoot}/current/.env`];
const localQrPath = process.env.DOUYIN_SERVER_QR_LOCAL_PATH
  || path.join(process.env.LOCALAPPDATA || os.tmpdir(), "Temp", "server-douyin-login-qr.png");
const localScreenshotPath = process.env.DOUYIN_SERVER_SCREENSHOT_LOCAL_PATH
  || path.join(process.env.LOCALAPPDATA || os.tmpdir(), "Temp", "server-douyin-login-latest.png");

if (!remotePassword) {
  throw new Error("Set DOUYIN_SERVER_PASSWORD or SYNC_BETTAFISH_PASSWORD before running this script.");
}

function readInnerCredential() {
  const credentialFile = process.env.BETTAFISH_INNER_CREDENTIAL_FILE
    || path.join(os.homedir(), "Desktop", "\u5185\u7f51\u673a.txt");
  if (!existsSync(credentialFile)) return { host: "", password: "" };
  const text = readFileSync(credentialFile, "utf8");
  return {
    host: text.match(/root@([^\r\n]+)/)?.[1]?.trim() || "",
    password: text.match(/password:(.*)/)?.[1]?.trim() || ""
  };
}

const client = await connectSsh();
try {
  switch (command) {
    case "start":
      throw new Error("QR login is disabled for this flow because Douyin labels it unexpectedly. Use: npm run douyin:server-login -- start-phone <phone-number>");
    case "start-qr":
      await uploadHelpers(client);
      await startLogin(client, { loginType: "qrcode" });
      await waitForQr(client);
      await downloadFile(client, qrRemotePath, localQrPath);
      console.log(JSON.stringify({ started: true, qrRemotePath, localQrPath }, null, 2));
      break;
    case "start-phone": {
      const phone = process.argv[3] || process.env.DOUYIN_SERVER_PHONE || "";
      if (!/^\d{8,15}$/.test(phone)) throw new Error("Usage: npm run douyin:server-login -- start-phone <phone-number>");
      await uploadHelpers(client);
      await startLogin(client, { loginType: "phone", phone });
      await waitForPhoneSms(client);
      await downloadLatestScreenshot(client);
      await printStatus(client);
      break;
    }
    case "start-phone-session":
    case "session-phone": {
      const phone = process.argv[3] || process.env.DOUYIN_SERVER_PHONE || "";
      if (!/^\d{8,15}$/.test(phone)) throw new Error("Usage: npm run douyin:server-login -- session-phone <phone-number>");
      await uploadHelpers(client);
      await startStandaloneBrowser(client);
      await runRemote(client, `${pythonPath} ${shellQuote(`${runtimeDir}/server-douyin-session-phone.py`)}`, {
        env: { SERVER_DOUYIN_LOGIN_PHONE: phone },
        timeoutMs: 75_000
      });
      await downloadLatestScreenshot(client);
      await printStatus(client);
      break;
    }
    case "session-resend": {
      const phone = process.argv[3] || process.env.DOUYIN_SERVER_PHONE || "";
      if (!/^\d{8,15}$/.test(phone)) throw new Error("Usage: npm run douyin:server-login -- session-resend <phone-number>");
      await uploadHelpers(client);
      await runRemote(client, `${pythonPath} ${shellQuote(`${runtimeDir}/server-douyin-session-phone.py`)}`, {
        env: { SERVER_DOUYIN_LOGIN_PHONE: phone },
        timeoutMs: 75_000
      });
      await downloadLatestScreenshot(client);
      await printStatus(client);
      break;
    }
    case "sync-cookie":
    case "copy-cookie": {
      const cookie = await extractLocalDouyinCookie();
      await syncCookieToServer(client, cookie);
      console.log(JSON.stringify({
        synced: true,
        cookieCount: cookie.cookieCount,
        hasLoginStatus: cookie.hasLoginStatus,
        hasSessionCookie: cookie.hasSessionCookie,
        source: cookie.source,
        profileDir: cookie.profileDir,
        envFiles: remoteEnvFiles
      }, null, 2));
      break;
    }
    case "start-cookie": {
      await uploadHelpers(client);
      await startLogin(client, { loginType: "cookie" });
      await printStatus(client);
      break;
    }
    case "click-sms":
      await uploadHelpers(client);
      await runRemote(client, `${pythonPath} ${shellQuote(`${runtimeDir}/server-douyin-auto-sms.py`)}`, {
        env: { SERVER_DOUYIN_SMS_WATCH_SECONDS: "20" },
        timeoutMs: 35_000
      });
      await downloadLatestScreenshot(client);
      await printStatus(client);
      break;
    case "submit-code": {
      const code = process.argv[3] || process.env.DOUYIN_SERVER_SMS_CODE || "";
      if (!/^\d{4,8}$/.test(code)) throw new Error("Usage: npm run douyin:server-login -- submit-code <sms-code>");
      await uploadHelpers(client);
      await runRemote(client, `${pythonPath} ${shellQuote(`${runtimeDir}/server-douyin-submit-sms.py`)}`, {
        env: { SERVER_DOUYIN_SMS_CODE: code },
        timeoutMs: 40_000
      });
      await downloadLatestScreenshot(client);
      await printStatus(client);
      break;
    }
    case "screenshot":
      await uploadHelpers(client);
      await runRemote(client, `${pythonPath} ${shellQuote(`${runtimeDir}/server-douyin-screenshot.py`)}`, {
        timeoutMs: 20_000
      });
      await downloadLatestScreenshot(client);
      console.log(JSON.stringify({ localScreenshotPath }, null, 2));
      break;
    case "status":
      await printStatus(client);
      break;
    default:
      throw new Error("Usage: npm run douyin:server-login -- <sync-cookie|start-cookie|start-phone|submit-code|screenshot|status> (legacy QR: start-qr)");
  }
} finally {
  client.end();
}

async function connectSsh() {
  const ssh = new Client();
  await new Promise<void>((resolve, reject) => {
    ssh
      .once("ready", resolve)
      .once("error", reject)
      .connect({
        host: remoteHost,
        port: remotePort,
        username: remoteUser,
        password: remotePassword,
        readyTimeout: 20_000
      });
  });
  return ssh;
}

async function uploadHelpers(ssh: Client) {
  await ensureRuntimeDir(ssh);
  await uploadText(ssh, `${runtimeDir}/server-douyin-login.py`, loginHelperPython(), 0o755);
  await uploadText(ssh, `${runtimeDir}/server-douyin-auto-sms.py`, autoSmsPython(), 0o755);
  await uploadText(ssh, `${runtimeDir}/server-douyin-submit-sms.py`, submitSmsPython(), 0o755);
  await uploadText(ssh, `${runtimeDir}/server-douyin-screenshot.py`, screenshotPython(), 0o755);
  await uploadText(ssh, `${runtimeDir}/server-douyin-session-phone.py`, sessionPhonePython(), 0o755);
  await exec(ssh, `bash -lc ${shellQuote(`chown ${shellQuote(runUser)}:${shellQuote(runUser)} ${shellQuote(runtimeDir)}/server-douyin-*.py`)}`);
}

async function ensureRuntimeDir(ssh: Client) {
  await exec(ssh, `bash -lc ${shellQuote(`mkdir -p ${shellQuote(runtimeDir)} && chown -R ${shellQuote(runUser)}:${shellQuote(runUser)} ${shellQuote(runtimeDir)}`)}`);
}

async function extractLocalDouyinCookie(): Promise<LocalCookie> {
  const explicitCookie = [
    process.env.DOUYIN_COOKIES,
    process.env.DOUYIN_COOKIE,
    process.env.DOUYIN_SERVER_COOKIE
  ].map((value) => (value || "").trim()).find(Boolean);

  if (explicitCookie) {
    return summarizeCookie(explicitCookie, "env", "");
  }

  const localBettaFish = await resolveLocalBettaFishRepo();
  const mediaCrawler = path.join(localBettaFish, "MindSpider", "DeepSentimentCrawling", "MediaCrawler");
  const localProfileDir = process.env.LOCAL_DOUYIN_PROFILE_DIR
    || path.join(mediaCrawler, "browser_data", "cdp_dy_user_data_dir");
  const python = await resolveLocalPython(localBettaFish);
  const result = await runLocal(python, ["-c", localCookieExtractorPython()], {
    cwd: mediaCrawler,
    env: {
      ...process.env,
      LOCAL_DOUYIN_PROFILE_DIR: localProfileDir,
      LOCAL_DOUYIN_CDP_URL: process.env.LOCAL_DOUYIN_CDP_URL || "http://127.0.0.1:9222"
    },
    timeoutMs: 90_000
  });

  if (result.code !== 0) {
    throw new Error(`Local Douyin cookie extraction failed with code ${result.code}: ${result.stderr.slice(0, 1000) || "no stderr"}`);
  }

  let parsed: Partial<LocalCookie>;
  try {
    parsed = JSON.parse(result.stdout) as Partial<LocalCookie>;
  } catch {
    throw new Error("Local Douyin cookie extraction returned non-JSON output.");
  }
  if (!parsed.cookieStringB64 || !parsed.cookieCount) {
    throw new Error("Local Douyin cookie extraction did not find any douyin.com cookies.");
  }
  return {
    cookieStringB64: parsed.cookieStringB64,
    cookieCount: parsed.cookieCount,
    hasLoginStatus: Boolean(parsed.hasLoginStatus),
    hasSessionCookie: Boolean(parsed.hasSessionCookie),
    source: parsed.source || "local-profile",
    profileDir: parsed.profileDir || localProfileDir
  };
}

async function syncCookieToServer(ssh: Client, cookie: LocalCookie) {
  await ensureRuntimeDir(ssh);
  const payload = {
    envFiles: remoteEnvFiles,
    runUser,
    cookieStringB64: cookie.cookieStringB64
  };
  await uploadText(ssh, cookiePayloadPath, `${JSON.stringify(payload)}\n`, 0o600);
  const command = [
    `${shellQuote(pythonPath)} - ${shellQuote(cookiePayloadPath)} <<'PY'`,
    remoteCookieApplyPython(),
    "PY"
  ].join("\n");
  const result = await exec(ssh, `bash -lc ${shellQuote(command)}`, { timeoutMs: 90_000 });
  if (result.code !== 0) {
    throw new Error(`Remote Douyin cookie sync failed with code ${result.code}: ${result.stderr || result.stdout}`);
  }
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

async function startStandaloneBrowser(ssh: Client) {
  const cleanup = [
    "set -e",
    `pkill -f ${shellQuote("[s]erver-douyin-login.py")} || true`,
    `pkill -f ${shellQuote("[x]vfb-run.*server-douyin-login")} || true`,
    `pkill -u ${shellQuote(runUser)} -f ${shellQuote("chrome.*cdp_dy_user_data_dir")} || true`,
    "sleep 1",
    `rm -f ${shellQuote(screenshotRemotePath)}`,
    `: > ${shellQuote(sessionLogPath)}`,
    `chown -R ${shellQuote(runUser)}:${shellQuote(runUser)} ${shellQuote(runtimeDir)}`
  ].join("\n");
  await exec(ssh, `bash -lc ${shellQuote(cleanup)}`, { timeoutMs: 15_000 });

  const browserLaunch = [
    "nohup setsid xvfb-run",
    "-a",
    "-s",
    shellQuote("-screen 0 1920x1080x24"),
    shellQuote(browserPath),
    "--remote-debugging-port=9222",
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=TranslateUI",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--exclude-switches=enable-automation",
    "--disable-infobars",
    shellQuote("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"),
    "--start-maximized",
    `--user-data-dir=${shellQuote(profileDir)}`,
    shellQuote("about:blank")
  ].join(" ");
  const browserCmd = [
    `mkdir -p ${shellQuote(`/tmp/runtime-${runUser}`)}`,
    `chmod 700 ${shellQuote(`/tmp/runtime-${runUser}`)}`,
    `export XDG_RUNTIME_DIR=${shellQuote(`/tmp/runtime-${runUser}`)}`,
    `export PLAYWRIGHT_BROWSERS_PATH=${shellQuote(`${remoteRoot}/playwright-browsers`)}`,
    `${browserLaunch} > ${shellQuote(sessionLogPath)} 2>&1 < /dev/null & echo SESSION_PID:$!`
  ].join("; ");
  const start = await exec(ssh, `runuser -u ${shellQuote(runUser)} -- /bin/bash -lc ${shellQuote(browserCmd)}`, { timeoutMs: 10_000 });
  process.stdout.write(start.stdout);
  process.stderr.write(start.stderr);

  const wait = [
    "for i in $(seq 1 30); do",
    "  if curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1; then exit 0; fi",
    "  sleep 1",
    "done",
    `tail -n 120 ${shellQuote(sessionLogPath)} || true`,
    "exit 1"
  ].join("\n");
  const ready = await exec(ssh, `bash -lc ${shellQuote(wait)}`, { timeoutMs: 40_000 });
  process.stdout.write(ready.stdout);
  process.stderr.write(ready.stderr);
  if (ready.code !== 0) throw new Error("Standalone Douyin browser did not expose CDP before timeout.");
}

async function startLogin(ssh: Client, options: { loginType: "qrcode" | "phone" | "cookie"; phone?: string }) {
  const keywords = (process.env.DOUYIN_SERVER_KEYWORDS || defaultKeywords().join(","))
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const keywordsB64 = Buffer.from(JSON.stringify(keywords), "utf8").toString("base64");
  const cleanup = [
    "set -e",
    `pkill -f ${shellQuote("[s]erver-douyin-login.py")} || true`,
    `pkill -f ${shellQuote("[s]erver_douyin_login.py")} || true`,
    `pkill -f ${shellQuote("[s]erver-douyin-auto-sms.py")} || true`,
    `pkill -f ${shellQuote("[x]vfb-run.*server-douyin-login")} || true`,
    `pkill -f ${shellQuote("[x]vfb-run.*server_douyin_login")} || true`,
    `pkill -u ${shellQuote(runUser)} -f ${shellQuote("chrome.*cdp_dy_user_data_dir")} || true`,
    "sleep 1",
    `rm -f ${shellQuote(qrRemotePath)} ${shellQuote(screenshotRemotePath)}`,
    `: > ${shellQuote(loginLogPath)}`,
    `: > ${shellQuote(autoSmsLogPath)}`,
    `: > ${shellQuote(submitLogPath)}`,
    `chown -R ${shellQuote(runUser)}:${shellQuote(runUser)} ${shellQuote(runtimeDir)}`
  ].join("\n");
  await exec(ssh, `bash -lc ${shellQuote(cleanup)}`, { timeoutMs: 15_000 });

  const loginCmd = [
    `cd ${shellQuote(mediaCrawlerDir)}`,
    `export PLAYWRIGHT_BROWSERS_PATH=${shellQuote(`${remoteRoot}/playwright-browsers`)}`,
    `export SERVER_DOUYIN_CUSTOM_BROWSER=${shellQuote(browserPath)}`,
    `export SERVER_DOUYIN_KEYWORDS_B64=${shellQuote(keywordsB64)}`,
    `export SERVER_DOUYIN_LOGIN_TYPE=${shellQuote(options.loginType)}`,
    `export SERVER_DOUYIN_LOGIN_PHONE=${shellQuote(options.phone || "")}`,
    `export SERVER_DOUYIN_QR_PATH=${shellQuote(qrRemotePath)}`,
    `export SERVER_DOUYIN_HEADLESS=${shellQuote(process.env.SERVER_DOUYIN_HEADLESS || process.env.DOUYIN_SERVER_HEADLESS || "false")}`,
    `export SERVER_DOUYIN_SAVE_OPTION=${shellQuote(process.env.SERVER_DOUYIN_SAVE_OPTION || process.env.DOUYIN_SERVER_SAVE_OPTION || "json")}`,
    "export PYTHONUNBUFFERED=1",
    `nohup setsid xvfb-run -a -s ${shellQuote("-screen 0 1920x1080x24")} ${shellQuote(pythonPath)} ${shellQuote(`${runtimeDir}/server-douyin-login.py`)} > ${shellQuote(loginLogPath)} 2>&1 < /dev/null & echo LOGIN_PID:$!`
  ].join("; ");
  const login = await exec(ssh, `runuser -u ${shellQuote(runUser)} -- /bin/bash -lc ${shellQuote(loginCmd)}`, { timeoutMs: 10_000 });
  process.stdout.write(login.stdout);
  process.stderr.write(login.stderr);

  if (options.loginType !== "qrcode") return;

  const watcherCmd = [
    `cd ${shellQuote(mediaCrawlerDir)}`,
    "export SERVER_DOUYIN_SMS_WATCH_SECONDS=240",
    "export PYTHONUNBUFFERED=1",
    `nohup ${shellQuote(pythonPath)} ${shellQuote(`${runtimeDir}/server-douyin-auto-sms.py`)} > ${shellQuote(autoSmsLogPath)} 2>&1 < /dev/null & echo SMS_WATCHER_PID:$!`
  ].join("; ");
  const watcher = await exec(ssh, `runuser -u ${shellQuote(runUser)} -- /bin/bash -lc ${shellQuote(watcherCmd)}`, { timeoutMs: 10_000 });
  process.stdout.write(watcher.stdout);
  process.stderr.write(watcher.stderr);
}

async function waitForQr(ssh: Client) {
  const check = [
    `for i in $(seq 1 45); do`,
    `  if [ -s ${shellQuote(qrRemotePath)} ]; then ls -l --time-style=full-iso ${shellQuote(qrRemotePath)}; exit 0; fi`,
    "  sleep 1",
    "done",
    `tail -n 160 ${shellQuote(loginLogPath)} || true`,
    "exit 1"
  ].join("\n");
  const result = await exec(ssh, `bash -lc ${shellQuote(check)}`, { timeoutMs: 60_000 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.code !== 0) throw new Error("QR code was not generated before timeout.");
}

async function waitForPhoneSms(ssh: Client) {
  const check = [
    `for i in $(seq 1 60); do`,
    `  if grep -q 'SERVER_DOUYIN_PHONE_SMS_SENT' ${shellQuote(loginLogPath)}; then tail -n 80 ${shellQuote(loginLogPath)}; exit 0; fi`,
    `  if grep -q 'SERVER_DOUYIN_PHONE_SMS_FAILED' ${shellQuote(loginLogPath)}; then tail -n 120 ${shellQuote(loginLogPath)}; exit 1; fi`,
    "  sleep 1",
    "done",
    `tail -n 160 ${shellQuote(loginLogPath)} || true`,
    "exit 1"
  ].join("\n");
  const result = await exec(ssh, `bash -lc ${shellQuote(check)}`, { timeoutMs: 75_000 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.code !== 0) throw new Error("Phone SMS login did not reach the code entry step before timeout.");
}

async function runRemote(ssh: Client, commandLine: string, options: { env?: Record<string, string>; timeoutMs?: number } = {}) {
  const env = Object.entries(options.env || {})
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("; ");
  const commandWithEnv = [env, commandLine].filter(Boolean).join("; ");
  const result = await exec(ssh, `runuser -u ${shellQuote(runUser)} -- /bin/bash -lc ${shellQuote(commandWithEnv)}`, {
    timeoutMs: options.timeoutMs || 30_000
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.code !== 0) throw new Error(`Remote command failed with code ${result.code}.`);
}

async function printStatus(ssh: Client) {
  const script = [
    "date",
    "echo ---process---",
    "ps -eo pid,ppid,user,etime,cmd | egrep 'server-douyin-login|server-douyin-auto-sms|xvfb-run|chrome-linux/chrome' | grep -v egrep || true",
    "echo ---login-log---",
    `tail -n 120 ${shellQuote(loginLogPath)} 2>/dev/null || true`,
    "echo ---auto-sms-log---",
    `tail -n 80 ${shellQuote(autoSmsLogPath)} 2>/dev/null || true`,
    "echo ---submit-log---",
    `tail -n 80 ${shellQuote(submitLogPath)} 2>/dev/null || true`,
    "echo ---session-log---",
    `tail -n 80 ${shellQuote(sessionLogPath)} 2>/dev/null || true`,
    "echo ---recent-json---",
    `find ${shellQuote(remoteRoot)} -path '*/MediaCrawler/data/*' -type f \\( -name '*.json' -o -name '*.jsonl' \\) -printf '%TY-%Tm-%Td %TH:%TM:%TS %s %p\\n' 2>/dev/null | sort | tail -n 40 || true`
  ].join("\n");
  const result = await exec(ssh, `bash -lc ${shellQuote(script)}`, { timeoutMs: 30_000 });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

async function downloadLatestScreenshot(ssh: Client) {
  try {
    await downloadFile(ssh, screenshotRemotePath, localScreenshotPath);
    console.log(JSON.stringify({ localScreenshotPath }, null, 2));
  } catch {
    // A screenshot is helpful but not required for the command to finish.
  }
}

function exec(ssh: Client, commandLine: string, options: { timeoutMs?: number } = {}) {
  return new Promise<ExecResult>((resolve, reject) => {
    const timer = options.timeoutMs
      ? setTimeout(() => reject(new Error(`SSH command timed out after ${options.timeoutMs}ms: ${commandLine.slice(0, 180)}`)), options.timeoutMs)
      : null;
    ssh.exec(commandLine, (err, stream) => {
      if (err) {
        if (timer) clearTimeout(timer);
        reject(err);
        return;
      }
      let stdout = "";
      let stderr = "";
      stream.on("close", (code: number | null, signal: string | null) => {
        if (timer) clearTimeout(timer);
        resolve({ code, signal, stdout, stderr });
      });
      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    });
  });
}

async function uploadText(ssh: Client, remotePath: string, text: string, mode: number) {
  const sftp = await openSftp(ssh);
  await new Promise<void>((resolve, reject) => {
    sftp.writeFile(remotePath, Buffer.from(text, "utf8"), { mode }, (err: Error | undefined) => (
      err ? reject(err) : resolve()
    ));
  });
  if (typeof sftp.end === "function") sftp.end();
}

async function downloadFile(ssh: Client, remotePath: string, localPath: string) {
  const sftp = await openSftp(ssh);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, (err: Error | undefined) => (err ? reject(err) : resolve()));
  });
  if (typeof sftp.end === "function") sftp.end();
}

function openSftp(ssh: Client) {
  return new Promise<any>((resolve, reject) => {
    ssh.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
  });
}

function runLocal(commandLine: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}) {
  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(commandLine, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = options.timeoutMs
      ? setTimeout(() => {
        child.kill();
        reject(new Error(`Local command timed out after ${options.timeoutMs}ms: ${commandLine}`));
      }, options.timeoutMs)
      : null;
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString("utf8");
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString("utf8");
    });
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function resolveLocalBettaFishRepo() {
  const candidates = [
    process.env.BETTAFISH_REPO_DIR || "",
    process.env.SYNC_BETTAFISH_FULL_LOCAL_REPO || "",
    path.resolve(process.cwd(), "..", "BettaFish"),
    path.resolve(process.cwd(), "..", "..", "BettaFish"),
    path.resolve(process.env.USERPROFILE || "", "Documents", "BettaFish"),
    path.resolve(process.env.HOME || "", "BettaFish")
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, "MindSpider", "DeepSentimentCrawling", "MediaCrawler", "main.py"))) {
      return path.resolve(candidate);
    }
  }
  throw new Error("Local BettaFish MediaCrawler repo was not found. Set BETTAFISH_REPO_DIR.");
}

async function resolveLocalPython(localBettaFish: string) {
  const candidates = [
    process.env.BETTAFISH_PYTHON || "",
    process.env.LOCAL_DOUYIN_PYTHON || "",
    path.join(localBettaFish, ".venv-mediacrawler", "Scripts", "python.exe"),
    path.join(localBettaFish, ".venv", "Scripts", "python.exe"),
    "python"
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = await runLocal(candidate, ["--version"], { timeoutMs: 10_000 }).catch(() => undefined);
    if (result && result.code === 0) return candidate;
  }
  throw new Error("Python for local MediaCrawler was not found. Set LOCAL_DOUYIN_PYTHON or BETTAFISH_PYTHON.");
}

async function pathExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function summarizeCookie(cookieString: string, source: string, profileDirValue: string): LocalCookie {
  const pairs = cookieString.split(";").map((entry) => entry.trim()).filter(Boolean);
  return {
    cookieStringB64: Buffer.from(cookieString, "utf8").toString("base64"),
    cookieCount: pairs.length,
    hasLoginStatus: pairs.some((entry) => /^LOGIN_STATUS=1\b/.test(entry)),
    hasSessionCookie: pairs.some((entry) => /^(sessionid|sid_guard|passport_csrf_token)=/i.test(entry)),
    source,
    profileDir: profileDirValue
  };
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeRemoteRoot(value: string) {
  return value.replace(/\/+$/, "") || "/opt/BettaFish";
}

function defaultKeywords() {
  const ss = "\u751f\u6b7b\u72d9\u51fb";
  return [ss, `${ss}1`, `4399${ss}`, `${ss}2`];
}

function localCookieExtractorPython() {
  return String.raw`import asyncio
import base64
import json
import os
from pathlib import Path

from playwright.async_api import async_playwright

DOUYIN_URLS = ["https://www.douyin.com", "https://douyin.com"]
PROFILE_DIR = Path(os.environ.get("LOCAL_DOUYIN_PROFILE_DIR", "browser_data/cdp_dy_user_data_dir")).resolve()
CDP_URL = os.environ.get("LOCAL_DOUYIN_CDP_URL", "http://127.0.0.1:9222").strip()

def resolve_browser_path():
    explicit = os.environ.get("LOCAL_DOUYIN_BROWSER", "").strip()
    candidates = [
        explicit,
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return ""

def cookie_summary(cookie_string, cookies, source):
    names = {item.get("name", ""): item.get("value", "") for item in cookies}
    print(json.dumps({
        "cookieStringB64": base64.b64encode(cookie_string.encode("utf-8")).decode("ascii"),
        "cookieCount": len([item for item in cookie_string.split(";") if item.strip()]),
        "hasLoginStatus": names.get("LOGIN_STATUS") == "1",
        "hasSessionCookie": any(name.lower() in {"sessionid", "sid_guard", "passport_csrf_token"} for name in names),
        "source": source,
        "profileDir": str(PROFILE_DIR),
    }, ensure_ascii=False), flush=True)

def convert_cookies(cookies):
    filtered = []
    seen = set()
    for cookie in cookies or []:
        domain = str(cookie.get("domain") or "")
        name = str(cookie.get("name") or "")
        value = str(cookie.get("value") or "")
        if "douyin.com" not in domain or not name or not value:
            continue
        key = (name, domain, str(cookie.get("path") or ""))
        if key in seen:
            continue
        seen.add(key)
        filtered.append(cookie)
    filtered.sort(key=lambda item: (0 if item.get("name") == "LOGIN_STATUS" else 1, item.get("name") or ""))
    return ";".join([f"{item.get('name')}={item.get('value')}" for item in filtered]), filtered

async def try_cdp(playwright):
    if not CDP_URL:
        return None
    try:
        browser = await playwright.chromium.connect_over_cdp(CDP_URL, timeout=3000)
    except Exception:
        return None
    try:
        cookies = []
        for context in browser.contexts:
            cookies.extend(await context.cookies(DOUYIN_URLS))
        cookie_string, filtered = convert_cookies(cookies)
        if cookie_string:
            return cookie_string, filtered, "local-cdp"
        return None
    finally:
        await browser.close()

async def try_profile(playwright):
    if not PROFILE_DIR.exists():
        raise SystemExit(f"Local Douyin profile not found: {PROFILE_DIR}")
    launch_options = {
        "user_data_dir": str(PROFILE_DIR),
        "headless": True,
        "args": [
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--no-default-browser-check",
        ],
    }
    browser_path = resolve_browser_path()
    if browser_path:
        launch_options["executable_path"] = browser_path
    context = await playwright.chromium.launch_persistent_context(**launch_options)
    try:
        page = context.pages[0] if context.pages else await context.new_page()
        try:
            await page.goto("https://www.douyin.com/", wait_until="domcontentloaded", timeout=20000)
            await page.wait_for_timeout(1500)
        except Exception:
            pass
        cookies = await context.cookies(DOUYIN_URLS)
        cookie_string, filtered = convert_cookies(cookies)
        if not cookie_string:
            raise SystemExit("No douyin.com cookies found in local MediaCrawler profile.")
        return cookie_string, filtered, "local-profile"
    finally:
        await context.close()

async def main():
    async with async_playwright() as playwright:
        result = await try_cdp(playwright)
        if result is None:
            result = await try_profile(playwright)
        cookie_summary(*result)

asyncio.run(main())
`;
}

function remoteCookieApplyPython() {
  return String.raw`import json
import os
import pwd
import shutil
import subprocess
import sys
from pathlib import Path

payload_path = Path(sys.argv[1])
payload = json.loads(payload_path.read_text(encoding="utf-8"))
env_files = [Path(item) for item in payload["envFiles"]]
cookie_b64 = str(payload["cookieStringB64"]).strip()
run_user = str(payload.get("runUser") or "yq")

def set_env_file(path, key, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    replaced = False
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    next_lines = []
    for line in lines:
        if line.startswith(f"{key}="):
            next_lines.append(f"{key}={value}")
            replaced = True
        else:
            next_lines.append(line)
    if not replaced:
        next_lines.append(f"{key}={value}")
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text("\n".join(next_lines) + "\n", encoding="utf-8")
    shutil.move(str(tmp), str(path))
    try:
        user = pwd.getpwnam(run_user)
        os.chown(path, 0, user.pw_gid)
    except Exception:
        pass
    os.chmod(path, 0o640)

if not cookie_b64:
    raise SystemExit("empty cookie payload")

for env_file in env_files:
    set_env_file(env_file, "DOUYIN_COOKIES_B64", cookie_b64)

try:
    payload_path.unlink()
except FileNotFoundError:
    pass

restart = subprocess.run(["systemctl", "restart", "bettafish-full"], text=True, capture_output=True, timeout=60)
if restart.returncode != 0:
    raise SystemExit(restart.stderr or restart.stdout or "systemctl restart failed")

active = subprocess.run(["systemctl", "is-active", "bettafish-full"], text=True, capture_output=True, timeout=20)
print(json.dumps({
    "remoteCookieStored": True,
    "envFiles": [str(path) for path in env_files],
    "cookieB64Length": len(cookie_b64),
    "service": active.stdout.strip(),
}, ensure_ascii=False), flush=True)
`;
}

function loginHelperPython() {
  return String.raw`#!/usr/bin/env python3
import base64
import asyncio
import io
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw

MEDIA_CRAWLER_DIR = Path(os.environ.get("SERVER_DOUYIN_MEDIA_CRAWLER_DIR", "__MEDIA_CRAWLER_DIR__"))
os.chdir(MEDIA_CRAWLER_DIR)
sys.path.insert(0, str(MEDIA_CRAWLER_DIR))

def load_env_file(path):
    env_path = Path(path)
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value

for env_file in ("__REMOTE_ROOT__/.env", "__REMOTE_ROOT__/current/.env"):
    load_env_file(env_file)

def read_cookie_env():
    for name in ("DOUYIN_COOKIES_B64", "DOUYIN_COOKIE_B64", "MEDIA_CRAWLER_DOUYIN_COOKIES_B64"):
        value = os.environ.get(name, "").strip()
        if value:
            return base64.b64decode(value).decode("utf-8")
    for name in ("DOUYIN_COOKIES", "DOUYIN_COOKIE", "MEDIA_CRAWLER_DOUYIN_COOKIES"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""

qr_path = Path(os.environ.get("SERVER_DOUYIN_QR_PATH", "__QR_PATH__"))
qr_path.parent.mkdir(parents=True, exist_ok=True)

def save_qrcode(qr_code):
    if "," in qr_code:
        qr_code = qr_code.split(",", 1)[1]
    image = Image.open(io.BytesIO(base64.b64decode(qr_code)))
    width, height = image.size
    bordered = Image.new("RGB", (width + 20, height + 20), color=(255, 255, 255))
    bordered.paste(image, (10, 10))
    draw = ImageDraw.Draw(bordered)
    draw.rectangle((0, 0, width + 19, height + 19), outline=(0, 0, 0), width=1)
    bordered.save(qr_path)
    print(f"SERVER_DOUYIN_QR={qr_path}", flush=True)

from tools import utils
import tools.crawler_util as crawler_util
utils.show_qrcode = save_qrcode
crawler_util.show_qrcode = save_qrcode

import config
config.ENABLE_CDP_MODE = True
config.SAVE_LOGIN_STATE = True
config.ENABLE_GET_MEIDAS = False
cookie_str = read_cookie_env()
if cookie_str:
    config.COOKIES = cookie_str

custom_browser = os.environ.get("SERVER_DOUYIN_CUSTOM_BROWSER", "")
if custom_browser:
    config.CUSTOM_BROWSER_PATH = custom_browser

login_type = os.environ.get("SERVER_DOUYIN_LOGIN_TYPE", "qrcode").strip() or "qrcode"
if login_type == "cookie":
    if not cookie_str:
        print("SERVER_DOUYIN_COOKIE_MISSING=1", flush=True)
        sys.exit(1)
    cookie_names = [item.split("=", 1)[0].strip() for item in cookie_str.split(";") if "=" in item]
    print("SERVER_DOUYIN_COOKIE_LOADED=" + json.dumps({
        "cookieCount": len(cookie_names),
        "hasLoginStatus": "LOGIN_STATUS" in cookie_names,
        "hasSessionCookie": any(name.lower() in {"sessionid", "sid_guard", "passport_csrf_token"} for name in cookie_names),
    }, ensure_ascii=False), flush=True)

if login_type == "phone":
    from media_platform.douyin.login import DouYinLogin

    async def server_login_by_mobile(self):
        phone = os.environ.get("SERVER_DOUYIN_LOGIN_PHONE", "").strip()
        if not phone:
            print("SERVER_DOUYIN_PHONE_SMS_FAILED=missing-phone", flush=True)
            sys.exit(1)

        page = self.context_page
        utils.logger.info("[ServerDouyinLogin] Begin ordinary Douyin phone-code login ...")
        try:
            phone_placeholder = "\u8bf7\u8f93\u5165\u624b\u673a\u53f7"
            send_code_text = "\u83b7\u53d6\u9a8c\u8bc1\u7801"
            network = []

            def compact(value, limit=600):
                value = str(value or "")
                value = " ".join(value.split())
                return value[:limit] + "...<truncated>" if len(value) > limit else value

            def interesting_url(url):
                lowered = url.lower()
                return any(marker in lowered for marker in ["passport", "login", "sms", "verify", "captcha", "sso", "account"])

            async def capture_response(response):
                try:
                    if len(network) >= 12 or not interesting_url(response.url):
                        return
                    entry = {
                        "url": compact(response.url, 240),
                        "status": response.status,
                        "method": response.request.method,
                    }
                    try:
                        entry["body"] = compact(await response.text())
                    except Exception as exc:
                        entry["bodyError"] = repr(exc)
                    network.append(entry)
                except Exception as exc:
                    network.append({"captureError": repr(exc)})

            page.on("response", lambda response: asyncio.create_task(capture_response(response)))

            for label in ["\u9a8c\u8bc1\u7801\u767b\u5f55", "\u624b\u673a\u53f7\u767b\u5f55"]:
                try:
                    await page.get_by_text(label, exact=True).click(timeout=3000)
                    await page.wait_for_timeout(500)
                    break
                except Exception:
                    pass

            before = await page.evaluate("""() => {
              const visible = (el) => {
                const r = el.getBoundingClientRect();
                const st = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
              };
              return Array.from(document.querySelectorAll('input')).filter(visible).map((el) => {
                const r = el.getBoundingClientRect();
                return { placeholder: el.placeholder || '', type: el.type || '', valueLen: (el.value || '').length, x: r.x, y: r.y, w: r.width, h: r.height };
              });
            }""")

            phone_inputs = page.locator(f'input[placeholder="{phone_placeholder}"]')
            if await phone_inputs.count() == 0:
                print("SERVER_DOUYIN_PHONE_SMS_FAILED=" + json.dumps({"reason": "phone-input-not-found", "inputs": before}, ensure_ascii=False), flush=True)
                sys.exit(1)
            phone_input = phone_inputs.last
            await phone_input.wait_for(state="visible", timeout=5000)
            await phone_input.click(timeout=5000)
            await page.keyboard.press("Control+A")
            await page.keyboard.press("Backspace")
            await page.keyboard.type(phone, delay=35)
            phone_value = await phone_input.input_value()
            if phone_value != phone:
                await phone_input.fill(phone, timeout=5000)
                phone_value = await phone_input.input_value()

            button = page.get_by_text(send_code_text, exact=True).last
            await button.wait_for(state="visible", timeout=5000)
            box = await button.bounding_box()
            click_result = {"clicked": False, "box": box}
            if box:
                await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                await page.wait_for_timeout(120)
                await page.mouse.down()
                await page.wait_for_timeout(80)
                await page.mouse.up()
                click_result["clicked"] = True
            else:
                await button.click(force=True, timeout=5000)
                click_result = {"clicked": True, "box": None, "method": "locator-force"}

            await page.wait_for_timeout(3500)
            after = await page.evaluate("""() => {
              const bodyText = document.body ? document.body.innerText || '' : '';
              const visible = (el) => {
                const r = el.getBoundingClientRect();
                const st = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
              };
              return {
                hasCodeInput: Array.from(document.querySelectorAll('input[placeholder="\u8bf7\u8f93\u5165\u9a8c\u8bc1\u7801"]')).filter(visible).length > 0,
                sendTextVisible: bodyText.includes('\u83b7\u53d6\u9a8c\u8bc1\u7801'),
                bodyHint: bodyText.slice(0, 500),
              };
            }""")
            result = {
                "ok": phone_value == phone and click_result.get("clicked"),
                "phoneValueLen": len(phone_value),
                "click": click_result,
                "after": after,
                "network": network,
            }
            print("SERVER_DOUYIN_PHONE_SMS_RESULT=" + json.dumps(result, ensure_ascii=False), flush=True)
            if not result.get("ok"):
                print("SERVER_DOUYIN_PHONE_SMS_FAILED=" + json.dumps(result, ensure_ascii=False), flush=True)
                sys.exit(1)
            print("SERVER_DOUYIN_PHONE_SMS_SENT=1", flush=True)
        except Exception as exc:
            print(f"SERVER_DOUYIN_PHONE_SMS_FAILED={exc!r}", flush=True)
            sys.exit(1)

    DouYinLogin.login_by_mobile = server_login_by_mobile

keywords_b64 = os.environ.get("SERVER_DOUYIN_KEYWORDS_B64", "")
if keywords_b64:
    keywords = ",".join(json.loads(base64.b64decode(keywords_b64).decode("utf-8")))
else:
    keywords = "\u751f\u6b7b\u72d9\u51fb,\u751f\u6b7b\u72d9\u51fb1,4399\u751f\u6b7b\u72d9\u51fb,\u751f\u6b7b\u72d9\u51fb2"

sys.argv = [
    "main.py",
    "--platform", "dy",
    "--lt", login_type,
    "--type", "search",
    "--keywords", keywords,
    "--save_data_option", os.environ.get("SERVER_DOUYIN_SAVE_OPTION", "json"),
    "--headless", os.environ.get("SERVER_DOUYIN_HEADLESS", "false"),
    "--get_comment", "true",
    "--get_sub_comment", "false",
]

import main as media_main
from tools.app_runner import run

def force_stop():
    crawler = getattr(media_main, "crawler", None)
    if not crawler:
        return
    cdp_manager = getattr(crawler, "cdp_manager", None)
    launcher = getattr(cdp_manager, "launcher", None)
    if launcher:
        try:
            launcher.cleanup()
        except Exception:
            pass

run(media_main.main, media_main.async_cleanup, cleanup_timeout_seconds=15.0, on_first_interrupt=force_stop)
`
    .replace("__MEDIA_CRAWLER_DIR__", mediaCrawlerDir)
    .replaceAll("__REMOTE_ROOT__", remoteRoot)
    .replace("__QR_PATH__", qrRemotePath);
}

function autoSmsPython() {
  return String.raw`#!/usr/bin/env python3
import asyncio
import json
import os
import time
from playwright.async_api import async_playwright

RECEIVE_TEXT = "\u63a5\u6536\u77ed\u4fe1\u9a8c\u8bc1\u7801"
SCREENSHOT_PATH = "__SCREENSHOT_PATH__"

async def main():
    deadline = time.monotonic() + int(os.environ.get("SERVER_DOUYIN_SMS_WATCH_SECONDS", "240"))
    last_error = ""
    async with async_playwright() as p:
        while time.monotonic() < deadline:
            browser = None
            try:
                browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
                pages = []
                for ctx in browser.contexts:
                    pages.extend(ctx.pages)
                page = next((pg for pg in pages if "douyin.com" in pg.url and pg.url.startswith("https://www.douyin.com")), pages[0] if pages else None)
                if page is None:
                    raise RuntimeError("no pages")
                await page.bring_to_front()
                result = await page.evaluate("""(RECEIVE_TEXT) => {
                  const visible = (el) => {
                    const r = el.getBoundingClientRect();
                    const st = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
                  };
                  const items = Array.from(document.querySelectorAll('*'))
                    .filter((el) => visible(el) && (el.innerText || el.textContent || '').trim() === RECEIVE_TEXT)
                    .map((el) => {
                      const r = el.getBoundingClientRect();
                      let node = el;
                      let score = 0;
                      while (node && node !== document.body) {
                        const text = node.innerText || node.textContent || '';
                        if (text.includes('\u8eab\u4efd\u9a8c\u8bc1')) score += 30;
                        if (text.includes('\u53d1\u9001\u77ed\u4fe1\u9a8c\u8bc1')) score += 20;
                        if (node.onclick) score += 10;
                        node = node.parentElement;
                      }
                      return { el, score, x: r.x, y: r.y, w: r.width, h: r.height };
                    })
                    .sort((a, b) => b.score - a.score || (b.w * b.h) - (a.w * a.h));
                  const target = items[0];
                  if (!target) return { clicked: false, reason: 'not-found' };
                  const el = target.el;
                  el.scrollIntoView({ block: 'center', inline: 'center' });
                  for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
                    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
                  }
                  if (typeof el.click === 'function') el.click();
                  return { clicked: true, x: target.x, y: target.y, w: target.w, h: target.h, score: target.score };
                }""", RECEIVE_TEXT)
                if result.get("clicked"):
                    await page.wait_for_timeout(2000)
                    await page.screenshot(path=SCREENSHOT_PATH, full_page=False)
                    print("AUTO_SMS_CLICKED=" + json.dumps(result, ensure_ascii=False), flush=True)
                    return
                last_error = json.dumps(result, ensure_ascii=False)
            except Exception as exc:
                last_error = repr(exc)
            finally:
                if browser:
                    try:
                        await browser.close()
                    except Exception:
                        pass
            await asyncio.sleep(0.5)
    raise SystemExit("AUTO_SMS_TIMEOUT " + last_error)

asyncio.run(main())
`.replace("__SCREENSHOT_PATH__", screenshotRemotePath);
}

function submitSmsPython() {
  return String.raw`#!/usr/bin/env python3
import asyncio
import json
import os
import time
from playwright.async_api import async_playwright

CODE = os.environ.get("SERVER_DOUYIN_SMS_CODE", "")
SCREENSHOT_PATH = "__SCREENSHOT_PATH__"
CODE_PLACEHOLDER = "\u8bf7\u8f93\u5165\u9a8c\u8bc1\u7801"
LOGIN_TEXT = "\u767b\u5f55"

async def main():
    if not CODE:
        raise SystemExit("SERVER_DOUYIN_SMS_CODE is required")

    def compact(value, limit=900):
        value = str(value or "")
        value = " ".join(value.split())
        if len(value) > limit:
            return value[:limit] + "...<truncated>"
        return value

    def interesting_url(url):
        lowered = url.lower()
        markers = [
            "passport",
            "login",
            "sms",
            "verify",
            "captcha",
            "sso",
            "account",
            "douyin.com/aweme",
        ]
        return any(marker in lowered for marker in markers)

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        pages = []
        for ctx in browser.contexts:
            pages.extend(ctx.pages)
        page = next((pg for pg in pages if "douyin.com" in pg.url and pg.url.startswith("https://www.douyin.com")), pages[0])
        network = []
        console_messages = []

        async def capture_response(response):
            try:
                if len(network) >= 24 or not interesting_url(response.url):
                    return
                entry = {
                    "url": compact(response.url, 240),
                    "status": response.status,
                    "method": response.request.method,
                }
                try:
                    entry["body"] = compact(await response.text())
                except Exception as exc:
                    entry["bodyError"] = repr(exc)
                network.append(entry)
            except Exception as exc:
                network.append({"captureError": repr(exc)})

        page.on("response", lambda response: asyncio.create_task(capture_response(response)))
        page.on("console", lambda message: console_messages.append({
            "type": message.type,
            "text": compact(message.text, 300),
        }))

        await page.bring_to_front()
        await page.wait_for_timeout(500)

        before = await page.evaluate("""() => {
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
          };
          const inputs = Array.from(document.querySelectorAll('input')).filter(visible).map((el) => {
              const r = el.getBoundingClientRect();
              return {
                placeholder: el.placeholder || '',
                type: el.type || '',
                valueLen: (el.value || '').length,
                x: Math.round(r.x),
                y: Math.round(r.y),
                w: Math.round(r.width),
                h: Math.round(r.height),
              };
          });
          const buttons = Array.from(document.querySelectorAll('button, [role=button], #douyin_login_comp_btn_id, a, div'))
            .filter((el) => visible(el))
            .map((el) => {
              const text = (el.innerText || el.textContent || '').trim();
              const r = el.getBoundingClientRect();
              return {
                id: el.id || '',
                text,
                disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
                x: Math.round(r.x),
                y: Math.round(r.y),
                w: Math.round(r.width),
                h: Math.round(r.height),
              };
            })
            .filter((item) => item.id === 'douyin_login_comp_btn_id' || item.text === '\u767b\u5f55' || item.text.includes('\u83b7\u53d6\u9a8c\u8bc1\u7801'))
            .slice(0, 12);
          const bodyText = document.body ? document.body.innerText || '' : '';
          return {
            url: location.href,
            title: document.title,
            inputs,
            buttons,
            hasLoginModal: bodyText.includes('\u9a8c\u8bc1\u7801\u767b\u5f55') || bodyText.includes('\u767b\u5f55\u540e\u514d\u8d39'),
            bodyHint: bodyText.slice(0, 400),
          };
        }""")
        print("SUBMIT_PAGE_BEFORE=" + json.dumps(before, ensure_ascii=False), flush=True)

        code_inputs = page.locator(f'input[placeholder="{CODE_PLACEHOLDER}"]')
        if await code_inputs.count() == 0:
            await page.screenshot(path=SCREENSHOT_PATH, full_page=False)
            await browser.close()
            print("SUBMIT_INPUT={\"ok\": false, \"reason\": \"input-not-found\"}", flush=True)
            raise SystemExit(1)

        code_input = code_inputs.last
        await code_input.wait_for(state="visible", timeout=5000)
        await code_input.click(timeout=5000)
        await page.keyboard.press("Control+A")
        await page.keyboard.press("Backspace")
        await page.keyboard.type(CODE, delay=35)
        value = await code_input.input_value()
        if value != CODE:
            await code_input.fill(CODE, timeout=5000)
            value = await code_input.input_value()

        result = await page.evaluate("""(CODE) => {
          const input = Array.from(document.querySelectorAll('input'))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              const st = getComputedStyle(el);
              return el.placeholder === '\u8bf7\u8f93\u5165\u9a8c\u8bc1\u7801' && r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
            })
            .pop();
          if (!input) return { ok: false, reason: 'input-not-found-after-type' };
          input.focus();
          input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: CODE }));
          input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: CODE }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: CODE.slice(-1) }));
          const r = input.getBoundingClientRect();
          return { ok: true, valueLen: input.value.length, x: r.x, y: r.y, w: r.width, h: r.height };
        }""", CODE)
        print("SUBMIT_INPUT=" + json.dumps(result, ensure_ascii=False), flush=True)
        if not result.get("ok") or value != CODE:
            await page.screenshot(path=SCREENSHOT_PATH, full_page=False)
            await browser.close()
            raise SystemExit(1)

        await page.wait_for_timeout(800)

        button = page.locator("#douyin_login_comp_btn_id")
        if await button.count() == 0:
            button = page.get_by_text(LOGIN_TEXT, exact=True).last
        await button.wait_for(state="visible", timeout=5000)
        box = await button.bounding_box()
        click_result = {"clicked": False, "method": "mouse", "box": box}
        if box:
            await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(120)
            await page.mouse.down()
            await page.wait_for_timeout(80)
            await page.mouse.up()
            click_result["clicked"] = True
        else:
            await button.click(force=True, timeout=5000)
            click_result = {"clicked": True, "method": "locator-force", "box": None}
        print("SUBMIT_CLICK=" + json.dumps(click_result, ensure_ascii=False), flush=True)

        post_click_warning = None
        click_attempts = ["mouse"]
        try:
            await page.wait_for_timeout(1800)
            await button.click(force=True, timeout=5000)
            click_attempts.append("locator-force")
            await page.wait_for_timeout(1200)
            await page.keyboard.press("Enter")
            click_attempts.append("enter")
            await page.wait_for_timeout(1200)
        except Exception as exc:
            post_click_warning = repr(exc)

        after = None
        try:
            await page.wait_for_timeout(6000)
            await page.screenshot(path=SCREENSHOT_PATH, full_page=False)
        except Exception:
            pass

        try:
            after = await page.evaluate("""() => {
              const bodyText = document.body ? document.body.innerText || '' : '';
              const visible = (el) => {
                const r = el.getBoundingClientRect();
                const st = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
              };
              return {
                url: location.href,
                title: document.title,
                hasLoginModal: bodyText.includes('\u9a8c\u8bc1\u7801\u767b\u5f55') || bodyText.includes('\u767b\u5f55\u540e\u514d\u8d39'),
                visibleCodeInputs: Array.from(document.querySelectorAll('input[placeholder="\u8bf7\u8f93\u5165\u9a8c\u8bc1\u7801"]')).filter(visible).length,
                bodyHint: bodyText.slice(0, 500),
              };
            }""")
        except Exception as exc:
            after = {"targetClosed": True, "error": repr(exc), "postClickWarning": post_click_warning}
        print("SUBMIT_PAGE_AFTER=" + json.dumps(after, ensure_ascii=False), flush=True)
        print("SUBMIT_CLICK_ATTEMPTS=" + json.dumps(click_attempts, ensure_ascii=False), flush=True)
        print("SUBMIT_NETWORK=" + json.dumps(network, ensure_ascii=False), flush=True)
        print("SUBMIT_CONSOLE=" + json.dumps(console_messages[-12:], ensure_ascii=False), flush=True)
        try:
            await browser.close()
        except Exception:
            pass

asyncio.run(main())
`.replace("__SCREENSHOT_PATH__", screenshotRemotePath);
}

function sessionPhonePython() {
  return String.raw`#!/usr/bin/env python3
import asyncio
import json
import os
from playwright.async_api import async_playwright

PHONE = os.environ.get("SERVER_DOUYIN_LOGIN_PHONE", "")
SCREENSHOT_PATH = "__SCREENSHOT_PATH__"
PHONE_PLACEHOLDER = "\u8bf7\u8f93\u5165\u624b\u673a\u53f7"
SEND_CODE_TEXT = "\u83b7\u53d6\u9a8c\u8bc1\u7801"
SMS_LOGIN_TEXT = "\u9a8c\u8bc1\u7801\u767b\u5f55"
LOGIN_TEXT = "\u767b\u5f55"

def compact(value, limit=700):
    value = str(value or "")
    value = " ".join(value.split())
    return value[:limit] + "...<truncated>" if len(value) > limit else value

def interesting_url(url):
    lowered = url.lower()
    return any(marker in lowered for marker in [
        "passport",
        "login",
        "sms",
        "verify",
        "captcha",
        "sso",
        "account",
    ])

async def main():
    if not PHONE:
        raise SystemExit("SERVER_DOUYIN_LOGIN_PHONE is required")

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        pages = []
        for ctx in browser.contexts:
            pages.extend(ctx.pages)
        page = next((pg for pg in pages if "douyin.com" in pg.url), pages[0] if pages else await browser.contexts[0].new_page())
        network = []
        console_messages = []

        async def capture_response(response):
            try:
                if len(network) >= 20 or not interesting_url(response.url):
                    return
                entry = {
                    "url": compact(response.url, 260),
                    "status": response.status,
                    "method": response.request.method,
                }
                try:
                    entry["body"] = compact(await response.text())
                except Exception as exc:
                    entry["bodyError"] = repr(exc)
                network.append(entry)
            except Exception as exc:
                network.append({"captureError": repr(exc)})

        page.on("response", lambda response: asyncio.create_task(capture_response(response)))
        page.on("console", lambda message: console_messages.append({
            "type": message.type,
            "text": compact(message.text, 300),
        }))

        await page.bring_to_front()
        await page.add_init_script("""() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
          Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
          Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        }""")
        await page.set_extra_http_headers({"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"})
        if "douyin.com" not in page.url:
            await page.goto("https://www.douyin.com/jingxuan", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(3000)

        has_modal = await page.evaluate("""() => {
          const text = document.body ? document.body.innerText || '' : '';
          return text.includes('\u767b\u5f55\u540e\u514d\u8d39') || text.includes('\u9a8c\u8bc1\u7801\u767b\u5f55');
        }""")
        if not has_modal:
            opened = await page.evaluate("""() => {
              const visible = (el) => {
                const r = el.getBoundingClientRect();
                const st = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
              };
              const candidates = Array.from(document.querySelectorAll('*'))
                .filter((el) => visible(el) && (el.innerText || el.textContent || '').trim() === '\u767b\u5f55')
                .map((el) => ({ el, r: el.getBoundingClientRect() }))
                .filter((item) => item.r.y < 90)
                .sort((a, b) => b.r.x - a.r.x);
              const target = candidates[0];
              if (!target) return false;
              target.el.click();
              return true;
            }""")
            await page.wait_for_timeout(2000)
            if not opened:
                print("SESSION_PHONE_OPEN_LOGIN_FAILED", flush=True)

        try:
            await page.get_by_text(SMS_LOGIN_TEXT, exact=True).click(timeout=3000)
            await page.wait_for_timeout(500)
        except Exception:
            pass

        inputs_before = await page.evaluate("""() => {
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
          };
          return Array.from(document.querySelectorAll('input')).filter(visible).map((el) => {
            const r = el.getBoundingClientRect();
            return { placeholder: el.placeholder || '', type: el.type || '', value: el.value || '', x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
          });
        }""")

        phone_inputs = page.locator(f'input[placeholder="{PHONE_PLACEHOLDER}"]')
        if await phone_inputs.count() == 0:
            await page.screenshot(path=SCREENSHOT_PATH, full_page=False)
            print("SESSION_PHONE_RESULT=" + json.dumps({"ok": False, "reason": "phone-input-not-found", "inputs": inputs_before}, ensure_ascii=False), flush=True)
            await browser.close()
            raise SystemExit(1)

        phone_input = phone_inputs.last
        await phone_input.click(timeout=5000)
        await page.keyboard.press("Control+A")
        await page.keyboard.press("Backspace")
        await page.keyboard.type(PHONE, delay=40)
        phone_value = await phone_input.input_value()
        phone_digits = "".join(ch for ch in phone_value if ch.isdigit())
        if phone_digits != PHONE:
            await phone_input.fill(PHONE, timeout=5000)
            phone_value = await phone_input.input_value()
            phone_digits = "".join(ch for ch in phone_value if ch.isdigit())

        button = page.get_by_text(SEND_CODE_TEXT, exact=True).last
        await button.wait_for(state="visible", timeout=5000)
        box = await button.bounding_box()
        click_result = {"clicked": False, "box": box}
        if box:
            await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(150)
            await page.mouse.down()
            await page.wait_for_timeout(90)
            await page.mouse.up()
            click_result["clicked"] = True
        else:
            await button.click(force=True, timeout=5000)
            click_result = {"clicked": True, "box": None, "method": "locator-force"}

        await page.wait_for_timeout(5000)
        await page.screenshot(path=SCREENSHOT_PATH, full_page=False)
        after = await page.evaluate("""() => {
          const text = document.body ? document.body.innerText || '' : '';
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
          };
          return {
            hasLoginModal: text.includes('\u767b\u5f55\u540e\u514d\u8d39') || text.includes('\u9a8c\u8bc1\u7801\u767b\u5f55'),
            hasCodeInput: Array.from(document.querySelectorAll('input[placeholder="\u8bf7\u8f93\u5165\u9a8c\u8bc1\u7801"]')).filter(visible).length > 0,
            hasIdentityQr: text.includes('\u8eab\u4efd\u9a8c\u8bc1') || text.includes('\u5df2\u767b\u5f55\u8d26\u53f7\u7684\u8bbe\u5907\u626b\u7801'),
            sendTextVisible: text.includes('\u83b7\u53d6\u9a8c\u8bc1\u7801'),
            bodyHint: text.slice(0, 600),
          };
        }""")
        result = {
            "ok": phone_digits == PHONE and click_result.get("clicked"),
            "phoneValue": phone_value,
            "phoneDigits": phone_digits,
            "click": click_result,
            "after": after,
            "network": network,
            "console": console_messages[-8:],
        }
        print("SESSION_PHONE_RESULT=" + json.dumps(result, ensure_ascii=False), flush=True)
        await browser.close()

asyncio.run(main())
`.replace("__SCREENSHOT_PATH__", screenshotRemotePath);
}

function screenshotPython() {
  return String.raw`#!/usr/bin/env python3
import asyncio
from playwright.async_api import async_playwright

SCREENSHOT_PATH = "__SCREENSHOT_PATH__"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        pages = []
        for ctx in browser.contexts:
            pages.extend(ctx.pages)
        page = next((pg for pg in pages if "douyin.com" in pg.url and pg.url.startswith("https://www.douyin.com")), pages[0])
        await page.screenshot(path=SCREENSHOT_PATH, full_page=False)
        print("URL=" + page.url)
        print("TITLE=" + await page.title())
        await browser.close()

asyncio.run(main())
`.replace("__SCREENSHOT_PATH__", screenshotRemotePath);
}
