import assert from "node:assert/strict";
import test from "node:test";
import { makeIssues } from "../server/douyinStatus";
import type {
  DouyinCrawlSchedulerState,
  DouyinCrawlServiceStatus,
  DouyinLoginProfileStatus,
  DouyinRemoteLoginStatus
} from "../src/shared";

const service: DouyinCrawlServiceStatus = {
  available: true,
  activeState: "inactive",
  subState: "dead",
  result: "success",
  execMainStatus: 0
};

const profile: DouyinLoginProfileStatus = {
  checked: true,
  profileDir: "/tmp/douyin-profile",
  exists: true,
  cookieDbCount: 1,
  hasSessionCookie: true,
  hasValidSessionCookie: false,
  cookieConfigured: true,
  configReadable: true
};

const scheduler: DouyinCrawlSchedulerState = {
  exists: true,
  loginType: "cookie",
  intervalMinutes: 60,
  lastCompletedAt: "2026-08-25T06:18:01.000Z",
  ageSeconds: 30,
  lastResult: "empty"
};

const activeRemoteLogin: DouyinRemoteLoginStatus = {
  ready: true,
  active: true,
  url: "http://127.0.0.1:6088/vnc.html",
  setupCommand: "sudo bash setup-douyin-remote-login.sh",
  message: "远程登录入口已就绪",
  missing: []
};

test("expired cookie profile raises a login issue even when the task exited successfully", () => {
  const issues = makeIssues(service, scheduler, profile, "");
  assert.ok(issues.some((issue) => issue.type === "login"));
});

test("a successful crawl with an empty result raises a crawl warning", () => {
  const validProfile = { ...profile, hasValidSessionCookie: true };
  const issues = makeIssues(service, scheduler, validProfile, "");
  assert.ok(issues.some((issue) => issue.type === "crawl" && issue.severity === "warning"));
});

test("non-cookie login also rejects an expired session cookie", () => {
  const issues = makeIssues(service, { ...scheduler, loginType: "qrcode", lastResult: "nonempty" }, profile, "");
  assert.ok(issues.some((issue) => issue.type === "login"));
});

test("an active remote browser is reported as a crawl lock, not a login failure", () => {
  const failedService: DouyinCrawlServiceStatus = {
    ...service,
    activeState: "failed",
    subState: "failed",
    result: "exit-code",
    execMainStatus: 1
  };
  const validProfile = { ...profile, hasValidSessionCookie: true };
  const issues = makeIssues(
    failedService,
    { ...scheduler, lastResult: "unknown" },
    validProfile,
    "Browser failed to be ready within 60 seconds\\nCDP browser launch failed",
    activeRemoteLogin
  );
  assert.equal(issues.some((issue) => issue.type === "login"), false);
  assert.ok(issues.some((issue) => issue.message.includes("远程登录浏览器释放")));
});
