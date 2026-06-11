import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MonitorItem, MonitorResponse } from "../src/shared";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-monitor-dingtalk-test-"));
process.env.DINGTALK_WEBHOOK = "https://example.com/robot/primary";
process.env.DINGTALK_SS1_EXTRA_WEBHOOKS = "https://example.com/robot/extra-1,https://example.com/robot/extra-2";
process.env.DINGTALK_STATE_PATH = path.join(tempDir, "dingtalk-ss1-state.json");

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
  const response = makeResponse([makeItem("tieba:risk", "high"), makeItem("tieba:medium", "medium")]);
  const result = await sendDingTalkDailyReport(response, "ss1", new Date("2026-06-11T10:00:00+08:00"));

  assert.equal(result.ok, true);
  assert.equal(result.mode, "daily");
  assert.equal(payloads.length, 3);

  for (const payload of payloads) {
    const text = payload.markdown?.text || "";
    assert.equal(text.includes("中高风险持续汇总"), false);
    assert.equal(text.includes("近72小时中高风险存量"), false);
    assert.equal(text.includes("近72小时暂无中高风险舆情存量"), false);
  }
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

function makeResponse(items: MonitorItem[]): MonitorResponse {
  return {
    generatedAt: "2026-06-11T01:00:00.000Z",
    windowHours: 72,
    freshnessCutoff: "2026-06-08T01:00:00.000Z",
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
      bettafish: 0
    },
    trends: [],
    topicStats: [],
    alerts: [],
    health: [],
    items
  };
}

function makeItem(id: string, riskLevel: MonitorItem["riskLevel"]): MonitorItem {
  return {
    id,
    gameId: "ss1",
    gameName: "生死狙击1",
    source: "tieba",
    sourceLabel: "百度贴吧",
    sourceItemId: id.split(":")[1],
    title: id,
    author: "tester",
    url: `https://tieba.baidu.com/p/${id}`,
    publishedAt: "2026-06-10T02:30:00.000Z",
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
