import assert from "node:assert/strict";
import test from "node:test";
import { makeIssues } from "../server/douyinStatus";
import type {
  DouyinCrawlSchedulerState,
  DouyinCrawlServiceStatus,
  DouyinLoginProfileStatus
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
