import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { currentAnalysisVersion } from "../src/shared";
import type { MonitorItem, MonitorResponse } from "../src/shared";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-monitor-dingtalk-test-"));
process.env.DINGTALK_WEBHOOK = "https://example.com/robot/primary";
process.env.DINGTALK_SS1_EXTRA_WEBHOOKS = "https://example.com/robot/extra-1,https://example.com/robot/extra-2";
process.env.DINGTALK_STATE_PATH = path.join(tempDir, "dingtalk-ss1-state.json");
await fs.writeFile(process.env.DINGTALK_STATE_PATH, JSON.stringify({
  initialized: true,
  lastDailyReportDate: "2026-06-10",
  lastDailyReportSentAt: "2026-06-10T01:30:00.000Z",
  seen: {
    "ss1:tieba:previously-pushed": "2026-06-10T02:00:00.000Z|2026-06-10T03:00:00.000Z|high"
  }
}));

const payloads: Array<{ markdown?: { title?: string; text?: string } }> = [];
globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
  payloads.push(JSON.parse(String(init?.body || "{}")));
  return {
    ok: true,
    json: async () => ({ errcode: 0 })
  } as Response;
}) as typeof fetch;

try {
  const { sendDingTalkDailyReport } = await import("../server/dingtalk");
  const response = makeResponse([
    makeItem("tieba:before-window", "high", "2026-06-10T01:29:00.000Z"),
    makeItem("tieba:previously-pushed", "high", "2026-06-10T03:00:00.000Z"),
    makeItem("tieba:risk", "high", "2026-06-10T02:30:00.000Z"),
    makeItem("tieba:medium", "medium", "2026-06-11T01:59:00.000Z"),
    makeItem("tieba:at-send-time", "high", "2026-06-11T02:00:00.000Z"),
    makeItem("tieba:ss2-risk", "high", "2026-06-10T02:30:00.000Z", "ss2")
  ]);
  const result = await sendDingTalkDailyReport(response, "ss1", new Date("2026-06-11T10:00:00+08:00"));

  assert.equal(result.ok, true);
  assert.equal(result.mode, "daily");
  assert.equal(result.sent, 3);
  assert.equal(result.existing, 1);
  assert.equal(payloads.length, 3);

  for (const payload of payloads) {
    const text = payload.markdown?.text || "";
    assert.equal(payload.markdown?.title?.includes("昨日舆情日报"), false);
    assert.equal(text.includes("本期概况"), true);
    assert.equal(text.includes("统计范围"), true);
    assert.equal(text.includes("tieba:risk"), true);
    assert.equal(text.includes("tieba:medium"), true);
    assert.equal(text.includes("tieba:previously-pushed"), false);
    assert.equal(text.includes("已剔除近 72 小时内推送过的 1 条重点舆情"), true);
    assert.equal(text.includes("tieba:before-window"), false);
    assert.equal(text.includes("tieba:at-send-time"), false);
    assert.equal(text.includes("tieba:ss2-risk"), false);
    assert.equal(text.includes("中高风险持续汇总"), false);
    assert.equal(text.includes("近72小时中高风险存量"), false);
    assert.equal(text.includes("近72小时暂无中高风险舆情存量"), false);
  }

  const state = JSON.parse(await fs.readFile(process.env.DINGTALK_STATE_PATH, "utf-8")) as {
    lastDailyReportDate?: string;
    lastDailyReportSentAt?: string;
    seen?: Record<string, string>;
  };
  assert.equal(state.lastDailyReportDate, "2026-06-11");
  assert.equal(state.lastDailyReportSentAt, "2026-06-11T02:00:00.000Z");
  assert.equal(Boolean(state.seen?.["ss1:tieba:previously-pushed"]), true);
  assert.equal(state.seen?.["ss1:tieba:risk"]?.startsWith("2026-06-11T02:00:00.000Z|"), true);
  assert.equal(state.seen?.["ss1:tieba:medium"]?.startsWith("2026-06-11T02:00:00.000Z|"), true);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

function makeResponse(items: MonitorItem[]): MonitorResponse {
  return {
    generatedAt: "2026-06-11T01:00:00.000Z",
    windowHours: 72,
    freshnessCutoff: "2026-06-08T01:00:00.000Z",
    analysisVersion: currentAnalysisVersion,
    riskBacktest: {
      status: "passed",
      message: "风险回测通过",
      caseCount: 10
    },
    updatePolicy: {
      mode: "day",
      intervalSeconds: 3600,
      nextUpdateAt: "2026-06-11T02:00:00.000Z",
      nightStartHour: 0,
      nightEndHour: 8,
      label: "日间每 1 小时更新"
    },
    cache: {
      hit: false,
      ageSeconds: 0,
      ttlSeconds: 3600
    },
    stats: {
      total: items.length,
      highRisk: items.filter((item) => item.riskLevel === "high").length,
      mediumRisk: items.filter((item) => item.riskLevel === "medium").length,
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

function makeItem(
  id: string,
  riskLevel: MonitorItem["riskLevel"],
  publishedAt: string,
  gameId: MonitorItem["gameId"] = "ss1"
): MonitorItem {
  return {
    id,
    gameId,
    gameName: gameId === "ss1" ? "生死狙击1" : "生死狙击2",
    source: "tieba",
    sourceLabel: "百度贴吧",
    sourceItemId: id.split(":")[1],
    title: id,
    author: "tester",
    url: `https://tieba.baidu.com/p/${id}`,
    publishedAt,
    collectedAt: "2026-06-11T01:00:00.000Z",
    freshnessHours: 22,
    metrics: { replies: 10, comments: 10 },
    contentParts: [{ type: "title", text: id, count: 1 }],
    parsedContentCount: 1,
    summary: id,
    keywords: [],
    topics: ["外挂公平"],
    sentiment: "negative",
    sentimentScore: -0.8,
    riskLevel,
    riskReasons: riskLevel === "high" ? ["疑似外挂演示内容"] : ["命中外挂治理线索"]
  };
}
