import assert from "node:assert/strict";
import { makeAlerts } from "../server/monitor";
import type { MonitorItem, RiskLevel, RiskSignalSource } from "../src/shared";

const staleThread = makeItem({
  id: "tieba:stale-thread",
  riskLevel: "high",
  riskReasons: ["疑似外挂演示内容"],
  riskSignalSource: "thread",
  riskSignalAt: "2026-06-07T10:00:00.000Z",
  publishedAt: "2026-06-11T10:00:00.000Z"
});

const newReplyRisk = makeItem({
  id: "tieba:new-reply-risk",
  riskLevel: "medium",
  riskReasons: ["新回复带来风险", "命中外挂治理线索"],
  riskSignalSource: "new_reply",
  riskSignalAt: "2026-06-11T11:30:00.000Z",
  publishedAt: "2026-06-11T11:30:00.000Z"
});

const freshThreadRisk = makeItem({
  id: "tieba:fresh-thread-risk",
  riskLevel: "high",
  riskReasons: ["疑似外挂演示内容"],
  riskSignalSource: "thread",
  riskSignalAt: "2026-06-11T09:00:00.000Z",
  publishedAt: "2026-06-11T09:00:00.000Z"
});

const explicitlyStaleThread = makeItem({
  id: "tieba:explicitly-stale-thread",
  riskLevel: "high",
  riskReasons: ["疑似外挂演示内容"],
  riskSignalSource: "stale_thread",
  publishedAt: "2026-06-11T11:00:00.000Z"
});

const alerts = makeAlerts([staleThread, explicitlyStaleThread, newReplyRisk, freshThreadRisk], new Date("2026-06-08T12:00:00.000Z"));

assert.deepEqual(alerts.map((alert) => alert.id), ["tieba:fresh-thread-risk", "tieba:new-reply-risk"]);
assert.equal(alerts.find((alert) => alert.id === "tieba:new-reply-risk")?.reasons[0], "新回复带来风险");
assert.equal(alerts.find((alert) => alert.id === "tieba:new-reply-risk")?.publishedAt, "2026-06-11T11:30:00.000Z");

function makeItem(input: {
  id: string;
  riskLevel: RiskLevel;
  riskReasons: string[];
  riskSignalSource?: RiskSignalSource;
  riskSignalAt?: string;
  publishedAt: string;
}): MonitorItem {
  return {
    id: input.id,
    gameId: "ss1",
    gameName: "生死狙击1",
    source: "tieba",
    sourceLabel: "百度贴吧",
    sourceItemId: input.id.split(":")[1],
    title: input.id,
    author: "tester",
    url: `https://tieba.baidu.com/p/${input.id}`,
    publishedAt: input.publishedAt,
    collectedAt: "2026-06-11T12:00:00.000Z",
    freshnessHours: 1,
    metrics: {},
    contentParts: [{ type: "title", text: input.id, count: 1 }],
    parsedContentCount: 1,
    summary: input.id,
    keywords: [],
    topics: [],
    sentiment: "neutral",
    sentimentScore: 0,
    riskLevel: input.riskLevel,
    riskReasons: input.riskReasons,
    riskSignalSource: input.riskSignalSource,
    riskSignalAt: input.riskSignalAt
  };
}
