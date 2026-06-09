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

const command = process.argv[2] || "status";
const remoteHost = process.env.DOUYIN_SERVER_HOST || "192.168.8.242";
const remotePort = Number(process.env.DOUYIN_SERVER_PORT || "22");
const remoteUser = process.env.DOUYIN_SERVER_USER || "root";
const remotePassword = process.env.DOUYIN_SERVER_PASSWORD || process.env.SYNC_BETTAFISH_PASSWORD || "";
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
const screenshotRemotePath = `${runtimeDir}/server-douyin-login-latest.png`;
const localQrPath = process.env.DOUYIN_SERVER_QR_LOCAL_PATH
  || path.join(process.env.LOCALAPPDATA || os.tmpdir(), "Temp", "server-douyin-login-qr.png");
const localScreenshotPath = process.env.DOUYIN_SERVER_SCREENSHOT_LOCAL_PATH
  || path.join(process.env.LOCALAPPDATA || os.tmpdir(), "Temp", "server-douyin-login-latest.png");

if (!remotePassword) {
  throw new Error("Set DOUYIN_SERVER_PASSWORD or SYNC_BETTAFISH_PASSWORD before running this script.");
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
      throw new Error("Usage: npm run douyin:server-login -- <start-phone|submit-code|screenshot|status> (legacy QR: start-qr)");
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
  await exec(ssh, `bash -lc ${shellQuote(`mkdir -p ${shellQuote(runtimeDir)} && chown -R ${shellQuote(runUser)}:${shellQuote(runUser)} ${shellQuote(runtimeDir)}`)}`);
  await uploadText(ssh, `${runtimeDir}/server-douyin-login.py`, loginHelperPython(), 0o755);
  await uploadText(ssh, `${runtimeDir}/server-douyin-auto-sms.py`, autoSmsPython(), 0o755);
  await uploadText(ssh, `${runtimeDir}/server-douyin-submit-sms.py`, submitSmsPython(), 0o755);
  await uploadText(ssh, `${runtimeDir}/server-douyin-screenshot.py`, screenshotPython(), 0o755);
  await exec(ssh, `bash -lc ${shellQuote(`chown ${shellQuote(runUser)}:${shellQuote(runUser)} ${shellQuote(runtimeDir)}/server-douyin-*.py`)}`);
}

async function startLogin(ssh: Client, options: { loginType: "qrcode" | "phone"; phone?: string }) {
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

function loginHelperPython() {
  return String.raw`#!/usr/bin/env python3
import base64
import io
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw

MEDIA_CRAWLER_DIR = Path(os.environ.get("SERVER_DOUYIN_MEDIA_CRAWLER_DIR", "__MEDIA_CRAWLER_DIR__"))
os.chdir(MEDIA_CRAWLER_DIR)
sys.path.insert(0, str(MEDIA_CRAWLER_DIR))

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

custom_browser = os.environ.get("SERVER_DOUYIN_CUSTOM_BROWSER", "")
if custom_browser:
    config.CUSTOM_BROWSER_PATH = custom_browser

login_type = os.environ.get("SERVER_DOUYIN_LOGIN_TYPE", "qrcode").strip() or "qrcode"

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
            for label in ["验证码登录", "手机号登录"]:
                try:
                    await page.get_by_text(label, exact=True).click(timeout=3000)
                    await page.wait_for_timeout(500)
                    break
                except Exception:
                    pass

            result = await page.evaluate("""(phone) => {
              const visible = (el) => {
                const r = el.getBoundingClientRect();
                const st = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
              };
              const scoreNode = (el) => {
                let node = el;
                let score = 0;
                while (node && node !== document.body) {
                  const text = node.innerText || node.textContent || '';
                  if (text.includes('验证码登录')) score += 50;
                  if (text.includes('获取验证码')) score += 40;
                  if (text.includes('登录即代表')) score += 15;
                  node = node.parentElement;
                }
                return score;
              };
              const phoneInputs = Array.from(document.querySelectorAll('input'))
                .filter((el) => visible(el) && ((el.placeholder || '').includes('手机号') || el.type === 'tel'))
                .map((el) => {
                  const r = el.getBoundingClientRect();
                  return { el, score: scoreNode(el), x: r.x, y: r.y, w: r.width, h: r.height, placeholder: el.placeholder || '', value: el.value || '' };
                })
                .filter((item) => item.placeholder.includes('手机号') || item.value === '' || item.value === '+86')
                .sort((a, b) => b.score - a.score || b.x - a.x);
              const phoneInput = phoneInputs.find((item) => item.placeholder.includes('手机号')) || phoneInputs[0];
              if (!phoneInput) return { ok: false, reason: 'phone-input-not-found' };
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              phoneInput.el.focus();
              setter.call(phoneInput.el, '');
              phoneInput.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
              setter.call(phoneInput.el, phone);
              phoneInput.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: phone }));
              phoneInput.el.dispatchEvent(new Event('change', { bubbles: true }));

              const buttons = Array.from(document.querySelectorAll('*'))
                .filter((el) => visible(el) && (el.innerText || el.textContent || '').trim() === '获取验证码')
                .map((el) => {
                  const r = el.getBoundingClientRect();
                  return { el, score: scoreNode(el), x: r.x, y: r.y, w: r.width, h: r.height, cls: String(el.className || '') };
                })
                .sort((a, b) => b.score - a.score || (b.w * b.h) - (a.w * a.h));
              const button = buttons[0];
              if (!button) return { ok: false, reason: 'send-button-not-found', phoneInput: { x: phoneInput.x, y: phoneInput.y, w: phoneInput.w, h: phoneInput.h, score: phoneInput.score } };
              const el = button.el;
              for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
                el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
              }
              if (typeof el.click === 'function') el.click();
              return {
                ok: true,
                phoneInput: { x: phoneInput.x, y: phoneInput.y, w: phoneInput.w, h: phoneInput.h, score: phoneInput.score },
                button: { x: button.x, y: button.y, w: button.w, h: button.h, score: button.score, cls: button.cls }
              };
            }""", phone)
            print("SERVER_DOUYIN_PHONE_SMS_RESULT=" + json.dumps(result, ensure_ascii=False), flush=True)
            if not result.get("ok"):
                print("SERVER_DOUYIN_PHONE_SMS_FAILED=" + json.dumps(result, ensure_ascii=False), flush=True)
                sys.exit(1)
            await page.wait_for_timeout(2500)
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
from playwright.async_api import async_playwright

CODE = os.environ.get("SERVER_DOUYIN_SMS_CODE", "")
SCREENSHOT_PATH = "__SCREENSHOT_PATH__"

async def main():
    if not CODE:
        raise SystemExit("SERVER_DOUYIN_SMS_CODE is required")
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        pages = []
        for ctx in browser.contexts:
            pages.extend(ctx.pages)
        page = next((pg for pg in pages if "douyin.com" in pg.url and pg.url.startswith("https://www.douyin.com")), pages[0])
        await page.bring_to_front()
        await page.wait_for_timeout(500)
        result = await page.evaluate("""(CODE) => {
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
          };
          const scoreNode = (el) => {
            let node = el;
            let score = 0;
            while (node && node !== document.body) {
              const text = node.innerText || node.textContent || '';
              if (text.includes('\u63a5\u6536\u77ed\u4fe1\u9a8c\u8bc1\u7801')) score += 50;
              if (text.includes('\u77ed\u4fe1\u5df2\u53d1\u9001\u81f3')) score += 50;
              if (text.includes('\u65e0\u6cd5\u9a8c\u8bc1\u901a\u8fc7')) score += 25;
              if (text.includes('\u9a8c\u8bc1\u7801\u767b\u5f55')) score += 45;
              if (text.includes('\u83b7\u53d6\u9a8c\u8bc1\u7801')) score += 35;
              if (text.includes('\u767b\u5f55\u5373\u4ee3\u8868')) score += 15;
              node = node.parentElement;
            }
            return score;
          };
          const inputs = Array.from(document.querySelectorAll('input'))
            .filter((el) => visible(el) && el.placeholder === '\u8bf7\u8f93\u5165\u9a8c\u8bc1\u7801')
            .map((el) => {
              const r = el.getBoundingClientRect();
              return { el, score: scoreNode(el), x: r.x, y: r.y, w: r.width, h: r.height };
            })
            .sort((a, b) => b.score - a.score || a.x - b.x);
          const input = inputs[0];
          if (!input) return { ok: false, reason: 'input-not-found' };
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          input.el.focus();
          setter.call(input.el, '');
          input.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
          setter.call(input.el, CODE);
          input.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: CODE }));
          input.el.dispatchEvent(new Event('change', { bubbles: true }));
          input.el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: CODE.slice(-1) }));
          return { ok: true, valueLen: input.el.value.length, input: { x: input.x, y: input.y, w: input.w, h: input.h, score: input.score } };
        }""", CODE)
        print("SUBMIT_INPUT=" + json.dumps(result, ensure_ascii=False), flush=True)
        if not result.get("ok"):
            await page.screenshot(path=SCREENSHOT_PATH, full_page=False)
            await browser.close()
            raise SystemExit(1)
        await page.wait_for_timeout(800)
        click_result = await page.evaluate("""() => {
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
          };
          const buttons = Array.from(document.querySelectorAll('*'))
            .filter((el) => {
              if (!visible(el)) return false;
              const text = (el.innerText || el.textContent || '').trim();
              return text === '\u9a8c\u8bc1' || text === '\u767b\u5f55';
            })
            .map((el) => {
              const r = el.getBoundingClientRect();
              let node = el;
              let score = 0;
              while (node && node !== document.body) {
                const text = node.innerText || node.textContent || '';
                if (text.includes('\u63a5\u6536\u77ed\u4fe1\u9a8c\u8bc1\u7801')) score += 50;
                if (text.includes('\u77ed\u4fe1\u5df2\u53d1\u9001\u81f3')) score += 50;
                if (text.includes('\u65e0\u6cd5\u9a8c\u8bc1\u901a\u8fc7')) score += 25;
                if (text.includes('\u9a8c\u8bc1\u7801\u767b\u5f55')) score += 45;
                if (text.includes('\u83b7\u53d6\u9a8c\u8bc1\u7801')) score += 35;
                if (text.includes('\u767b\u5f55\u5373\u4ee3\u8868')) score += 15;
                node = node.parentElement;
              }
              return { el, score, text: (el.innerText || el.textContent || '').trim(), cls: String(el.className || ''), x: r.x, y: r.y, w: r.width, h: r.height };
            })
            .sort((a, b) => b.score - a.score || (b.w * b.h) - (a.w * a.h));
          const button = buttons[0];
          if (!button) return { clicked: false, reason: 'button-not-found' };
          const el = button.el;
          for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          }
          if (typeof el.click === 'function') el.click();
          return { clicked: true, score: button.score, cls: button.cls, x: button.x, y: button.y, w: button.w, h: button.h };
        }""")
        print("SUBMIT_CLICK=" + json.dumps(click_result, ensure_ascii=False), flush=True)
        try:
            await page.wait_for_timeout(8000)
            await page.screenshot(path=SCREENSHOT_PATH, full_page=False)
        except Exception:
            pass
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
