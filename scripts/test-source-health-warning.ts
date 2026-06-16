import assert from "node:assert/strict";
import { sourceHealthIssues, sourceHealthWarningText } from "../src/sourceHealth";
import type { SourceHealth } from "../src/shared";

const healthy: SourceHealth = {
  source: "tieba",
  sourceLabel: "百度贴吧",
  gameId: "ss1",
  ok: true,
  fetchedAt: "2026-06-16T00:00:00.000Z",
  latencyMs: 100,
  itemCount: 12,
  staleDropped: 0,
  blocked: false,
  message: "已读取对应吧最新主题。"
};

const captchaBlocked: SourceHealth = {
  source: "forum4399",
  sourceLabel: "4399论坛",
  gameId: "ss1",
  ok: false,
  fetchedAt: "2026-06-16T00:00:00.000Z",
  latencyMs: 200,
  itemCount: 0,
  staleDropped: 0,
  blocked: true,
  message: "4399论坛登录需要验证码，请先手动登录后配置 FORUM_4399_COOKIE"
};

const searchBlocked: SourceHealth = {
  source: "bilibili",
  sourceLabel: "B站视频",
  gameId: "ss1",
  ok: false,
  fetchedAt: "2026-06-16T00:00:00.000Z",
  latencyMs: 300,
  itemCount: 0,
  staleDropped: 0,
  message: "HTTP 403"
};

assert.deepEqual(sourceHealthIssues([healthy]), []);
assert.deepEqual(sourceHealthIssues([healthy, captchaBlocked]).map((entry) => entry.source), ["forum4399"]);
assert.equal(
  sourceHealthWarningText([healthy, captchaBlocked]),
  "4399论坛登录需要验证码，请先手动登录后配置 FORUM_4399_COOKIE"
);
assert.equal(
  sourceHealthWarningText([captchaBlocked, searchBlocked]),
  "4399论坛登录需要验证码，请先手动登录后配置 FORUM_4399_COOKIE / B站视频：HTTP 403"
);
