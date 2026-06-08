import assert from "node:assert/strict";
import { mergeHistoryItems } from "../server/monitorHistory";
import type { GameId, MonitorItem, SourceType } from "../src/shared";

const now = new Date("2026-06-08T12:00:00.000Z");

const retainedBilibili = makeItem("bilibili:retained", "bilibili", "ss1", 10, "retained old title");
const staleTieba = makeItem("tieba:stale", "tieba", "ss1", 31, "stale title");
const currentTieba = makeItem("tieba:current", "tieba", "ss1", 1, "current title");
const refreshedBilibili = makeItem("bilibili:retained", "bilibili", "ss1", 10, "refreshed title");

const merged = mergeHistoryItems([retainedBilibili, staleTieba], [currentTieba, refreshedBilibili], {
  now,
  retentionHours: 24 * 30,
  maxItems: 5000
});

assert.deepEqual(
  merged.map((item) => item.id),
  ["tieba:current", "bilibili:retained"]
);
assert.equal(merged.find((item) => item.id === "bilibili:retained")?.title, "refreshed title");

const capped = mergeHistoryItems([retainedBilibili], [currentTieba], {
  now,
  retentionHours: 24 * 30,
  maxItems: 1
});

assert.deepEqual(capped.map((item) => item.id), ["tieba:current"]);

function makeItem(id: string, source: SourceType, gameId: GameId, daysAgo: number, title: string): MonitorItem {
  const publishedAt = new Date(now.getTime() - daysAgo * 24 * 3_600_000).toISOString();
  return {
    id,
    gameId,
    gameName: gameId.toUpperCase(),
    source,
    sourceLabel: source,
    sourceItemId: id.split(":")[1],
    title,
    author: "tester",
    url: `${source}://${id}`,
    publishedAt,
    collectedAt: now.toISOString(),
    freshnessHours: daysAgo * 24,
    metrics: {},
    contentParts: [{ type: "title", text: title, count: 1 }],
    parsedContentCount: 1,
    summary: title,
    keywords: [],
    topics: [],
    sentiment: "neutral",
    sentimentScore: 0,
    riskLevel: "low",
    riskReasons: []
  };
}
