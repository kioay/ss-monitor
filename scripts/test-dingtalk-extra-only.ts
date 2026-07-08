import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { currentAnalysisVersion } from "../src/shared";
import type { MonitorItem, MonitorResponse } from "../src/shared";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-monitor-dingtalk-extra-only-"));
process.env.DINGTALK_WEBHOOK = "";
process.env.DINGTALK_SECRET = "";
process.env.DINGTALK_SS2_WEBHOOK = "";
process.env.DINGTALK_SS2_SECRET = "";
process.env.DINGTALK_SS1_EXTRA_WEBHOOKS = "https://example.com/robot/ss1-extra";
process.env.DINGTALK_SS2_EXTRA_WEBHOOKS = "https://example.com/robot/ss2-extra";
process.env.DINGTALK_STATE_PATH = path.join(tempDir, "dingtalk-ss1-state.json");
process.env.DINGTALK_SS2_STATE_PATH = path.join(tempDir, "dingtalk-ss2-state.json");

await Promise.all([
  fs.writeFile(process.env.DINGTALK_STATE_PATH, JSON.stringify(makeState())),
  fs.writeFile(process.env.DINGTALK_SS2_STATE_PATH, JSON.stringify(makeState()))
]);

const payloads: Array<{ url: string; markdown?: { text?: string } }> = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  payloads.push({ url: String(url), ...JSON.parse(String(init?.body || "{}")) });
  return {
    ok: true,
    json: async () => ({ errcode: 0 })
  } as Response;
}) as typeof fetch;

try {
  const { sendDingTalkDailyReport } = await import("../server/dingtalk");
  const response = makeResponse([
    makeItem("tieba:ss1-extra-only", "high", "2026-06-11T01:00:00.000Z", "ss1"),
    makeItem("tieba:ss2-extra-only", "high", "2026-06-11T01:00:00.000Z", "ss2")
  ]);

  const ss1Result = await sendDingTalkDailyReport(response, "ss1", new Date("2026-06-11T10:00:00+08:00"));
  const ss2Result = await sendDingTalkDailyReport(response, "ss2", new Date("2026-06-11T10:00:00+08:00"));

  assert.equal(ss1Result.ok, true);
  assert.equal(ss1Result.mode, "daily");
  assert.equal(ss2Result.ok, true);
  assert.equal(ss2Result.mode, "daily");
  assert.equal(payloads.length, 2);
  assert.equal(payloads.some((payload) => payload.url.includes("ss1-extra")), true);
  assert.equal(payloads.some((payload) => payload.url.includes("ss2-extra")), true);
  assert.equal(payloads.some((payload) => (payload.markdown?.text || "").includes("tieba:ss1-extra-only")), true);
  assert.equal(payloads.some((payload) => (payload.markdown?.text || "").includes("tieba:ss2-extra-only")), true);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

function makeState() {
  return {
    initialized: true,
    lastDailyReportDate: "2026-06-10",
    lastDailyReportSentAt: "2026-06-10T01:30:00.000Z",
    seen: {}
  };
}

function makeResponse(items: MonitorItem[]): MonitorResponse {
  return {
    generatedAt: "2026-06-11T01:00:00.000Z",
    windowHours: 72,
    freshnessCutoff: "2026-06-08T01:00:00.000Z",
    analysisVersion: currentAnalysisVersion,
    riskBacktest: {
      status: "passed",
      message: "risk backtest passed",
      caseCount: 10
    },
    updatePolicy: {
      mode: "day",
      intervalSeconds: 3600,
      nextUpdateAt: "2026-06-11T02:00:00.000Z",
      nightStartHour: 0,
      nightEndHour: 8,
      label: "day update"
    },
    cache: {
      hit: false,
      ageSeconds: 0,
      ttlSeconds: 3600
    },
    stats: {
      total: items.length,
      highRisk: items.length,
      mediumRisk: 0,
      negativeRate: 0,
      bilibili: 0,
      tieba: items.length,
      douyin: 0,
      forum4399: 0,
      bettafish: 0
    },
    trends: [],
    topicStats: [],
    alerts: [],
    health: [],
    keywordEffectiveness: [],
    items
  };
}

function makeItem(id: string, riskLevel: MonitorItem["riskLevel"], publishedAt: string, gameId: MonitorItem["gameId"]): MonitorItem {
  const sourceItemId = id.split(":")[1];
  return {
    id,
    gameId,
    gameName: gameId === "ss1" ? "SS1" : "SS2",
    source: "tieba",
    sourceLabel: "Tieba",
    sourceItemId,
    title: id,
    author: "tester",
    url: `https://tieba.baidu.com/p/${sourceItemId}`,
    publishedAt,
    collectedAt: "2026-06-11T01:00:00.000Z",
    freshnessHours: 1,
    metrics: { replies: 10, comments: 10 },
    contentParts: [{ type: "title", text: id, count: 1 }],
    parsedContentCount: 1,
    summary: id,
    keywords: [],
    topics: ["外挂公平"],
    sentiment: "negative",
    sentimentScore: -0.8,
    riskLevel,
    riskReasons: ["疑似外挂演示内容"]
  };
}
