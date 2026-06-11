import assert from "node:assert/strict";
import { searchMonitorItems } from "../server/search";
import type { ContentPart, GameId, MonitorItem, RiskLevel, Sentiment, SourceType } from "../src/shared";

const now = new Date("2026-06-11T12:00:00.000Z");

const baseOptions = {
  terms: ["cheat"],
  now,
  windowHours: 24 * 30,
  gameIds: ["ss1" as GameId],
  source: "all" as const,
  risk: "all" as const,
  sentiment: "all" as const,
  topic: "all",
  origin: "monitor-history" as const
};

const commentHit = makeItem("comment-hit", {
  title: "normal match video",
  contentParts: [{ type: "comment", text: "player says cheat tool appeared again", count: 1 }]
});

const commentResults = searchMonitorItems([commentHit], baseOptions);
assert.equal(commentResults.length, 1);
assert.ok(commentResults[0].matchedFields.includes("评论"));
assert.match(commentResults[0].snippets[0].text, /cheat/);

const allTermsResults = searchMonitorItems(
  [
    commentHit,
    makeItem("all-terms-hit", {
      title: "cheat report",
      summary: "client crash after match"
    })
  ],
  { ...baseOptions, terms: ["cheat", "crash"] }
);
assert.deepEqual(allTermsResults.map((result) => result.item.id), ["all-terms-hit"]);

const rankingResults = searchMonitorItems(
  [
    commentHit,
    makeItem("title-hit", {
      title: "cheat report in ranked match",
      contentParts: []
    })
  ],
  baseOptions
);
assert.equal(rankingResults[0].item.id, "title-hit");
assert.ok(rankingResults[0].score > rankingResults[1].score);

const filteredResults = searchMonitorItems(
  [
    makeItem("filtered-hit", {
      source: "douyin",
      riskLevel: "high",
      sentiment: "negative",
      topics: ["外挂"],
      title: "cheat complaint"
    }),
    makeItem("filtered-out", {
      source: "bilibili",
      riskLevel: "high",
      sentiment: "negative",
      topics: ["外挂"],
      title: "cheat complaint"
    })
  ],
  {
    ...baseOptions,
    source: "douyin",
    risk: "high",
    sentiment: "negative",
    topic: "外挂"
  }
);
assert.deepEqual(filteredResults.map((result) => result.item.id), ["filtered-hit"]);

function makeItem(
  id: string,
  overrides: Partial<MonitorItem> & {
    source?: SourceType;
    riskLevel?: RiskLevel;
    sentiment?: Sentiment;
    contentParts?: ContentPart[];
  } = {}
): MonitorItem {
  const contentParts = overrides.contentParts || [{ type: "title", text: overrides.title || "ordinary post", count: 1 }];
  return {
    id,
    gameId: "ss1",
    gameName: "生死狙击1",
    source: overrides.source || "tieba",
    sourceLabel: overrides.sourceLabel || "贴吧",
    sourceItemId: id,
    title: overrides.title || "ordinary post",
    author: overrides.author || "tester",
    url: overrides.url || `https://example.test/${id}`,
    publishedAt: overrides.publishedAt || "2026-06-11T10:00:00.000Z",
    collectedAt: overrides.collectedAt || now.toISOString(),
    freshnessHours: overrides.freshnessHours ?? 2,
    metrics: overrides.metrics || {},
    contentParts,
    parsedContentCount: overrides.parsedContentCount || contentParts.length,
    summary: overrides.summary || "plain summary",
    keywords: overrides.keywords || [],
    topics: overrides.topics || [],
    sentiment: overrides.sentiment || "neutral",
    sentimentScore: overrides.sentimentScore ?? 0,
    riskLevel: overrides.riskLevel || "low",
    riskReasons: overrides.riskReasons || []
  };
}
