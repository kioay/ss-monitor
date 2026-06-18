import assert from "node:assert/strict";
import { applyReadMarksToMonitorResponseData, mergeReadMarker } from "../server/readState";
import type { AlertItem, MonitorItem, MonitorResponse } from "../src/shared";

const first = marker("alice", "2026-06-18T08:00:00.000Z");
const updated = mergeReadMarker([first], marker("Alice", "2026-06-18T09:00:00.000Z"));
assert.deepEqual(updated, [marker("Alice", "2026-06-18T09:00:00.000Z")]);

const response = makeResponse();
const marked = applyReadMarksToMonitorResponseData(response, {
  "tieba:older-high": [marker("yq", "2026-06-18T10:00:00.000Z")],
  "tieba:newer-medium": [marker("ops", "2026-06-18T10:05:00.000Z")]
});

assert.deepEqual(
  marked.alerts.map((alert) => alert.id),
  response.alerts.map((alert) => alert.id),
  "read marks must not reorder risk alerts"
);
assert.deepEqual(marked.alerts[0]?.readBy?.map((entry) => entry.userName), ["yq"]);
assert.deepEqual(marked.items[1]?.readBy?.map((entry) => entry.userName), ["ops"]);

function marker(userName: string, readAt: string) {
  return { userName, readAt };
}

function makeResponse(): MonitorResponse {
  const alerts: AlertItem[] = [
    makeAlert("tieba:older-high", "high", "2026-06-18T08:00:00.000Z"),
    makeAlert("tieba:newer-medium", "medium", "2026-06-18T09:00:00.000Z")
  ];
  const items = alerts.map((alert) => makeItem(alert.id, alert.riskLevel, alert.publishedAt));
  return {
    generatedAt: "2026-06-18T10:30:00.000Z",
    windowHours: 72,
    freshnessCutoff: "2026-06-15T10:30:00.000Z",
    analysisVersion: 3,
    riskBacktest: { status: "passed", message: "ok" },
    updatePolicy: {
      mode: "day",
      intervalSeconds: 3600,
      nextUpdateAt: "2026-06-18T11:30:00.000Z",
      nightStartHour: 0,
      nightEndHour: 8,
      label: "日间每 1 小时更新"
    },
    cache: { hit: false, ageSeconds: 0, ttlSeconds: 3600 },
    stats: {
      total: items.length,
      highRisk: 1,
      mediumRisk: 1,
      negativeRate: 1,
      bilibili: 0,
      tieba: items.length,
      douyin: 0,
      forum4399: 0,
      bettafish: 0,
      freshestAt: items[1]?.publishedAt
    },
    trends: [],
    topicStats: [],
    alerts,
    health: [],
    keywordEffectiveness: [],
    items
  };
}

function makeAlert(id: string, riskLevel: AlertItem["riskLevel"], publishedAt: string): AlertItem {
  return {
    id,
    title: id,
    source: "tieba",
    gameName: "SS1",
    riskLevel,
    reasons: ["测试原因"],
    url: `https://tieba.baidu.com/p/${id}`,
    publishedAt
  };
}

function makeItem(id: string, riskLevel: MonitorItem["riskLevel"], publishedAt: string): MonitorItem {
  return {
    id,
    gameId: "ss1",
    gameName: "SS1",
    source: "tieba",
    sourceLabel: "百度贴吧",
    sourceItemId: id,
    title: id,
    author: "tester",
    url: `https://tieba.baidu.com/p/${id}`,
    publishedAt,
    collectedAt: "2026-06-18T10:00:00.000Z",
    freshnessHours: 1,
    metrics: {},
    contentParts: [{ type: "title", text: id }],
    parsedContentCount: 1,
    summary: id,
    keywords: [],
    topics: [],
    sentiment: "negative",
    sentimentScore: -0.8,
    riskLevel,
    riskReasons: ["测试原因"]
  };
}
