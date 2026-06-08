import assert from "node:assert/strict";
import { analyzeItem } from "../server/analyze";
import { fuseBettaFishSignal } from "../server/bettafishSemantic";
import type { ContentPart, MonitorItem } from "../src/shared";

const title = "有没有战火服的号";
const description = "便宜点的，能玩就行";
const contentParts: ContentPart[] = [
  { type: "title", text: title, count: 1 },
  { type: "description", text: description, count: 1 }
];
const analysis = analyzeItem({ title, gameId: "ss1", contentParts, metrics: {} });

assert.equal(analysis.sentiment, "neutral");
assert.equal(analysis.sentimentScore, 0);
assert.equal(analysis.riskLevel, "low");
assert.deepEqual(analysis.riskReasons, []);
assert.ok(analysis.topics.includes("账号/区服询问"));

const item = makeItem({ title, contentParts, analysis });
const refined = fuseBettaFishSignal(item, {
  id: "semantic:test",
  label: "negative",
  score: -0.95,
  confidence: 0.98,
  positiveProbability: 0.025
});

assert.equal(refined.sentiment, "neutral");
assert.equal(refined.sentimentScore, 0);
assert.equal(refined.riskLevel, "low");
assert.deepEqual(refined.riskReasons, []);
assert.equal(refined.summary.includes("BettaFish模型"), false);

function makeItem(input: {
  title: string;
  contentParts: ContentPart[];
  analysis: ReturnType<typeof analyzeItem>;
}): MonitorItem {
  const now = new Date("2026-06-08T12:00:00.000Z").toISOString();
  return {
    id: "tieba:account-server-inquiry",
    gameId: "ss1",
    gameName: "生死狙击1",
    source: "tieba",
    sourceLabel: "百度贴吧",
    sourceItemId: "account-server-inquiry",
    title: input.title,
    author: "tester",
    url: "https://tieba.baidu.com/p/account-server-inquiry",
    publishedAt: now,
    collectedAt: now,
    freshnessHours: 0,
    metrics: {},
    contentParts: input.contentParts,
    parsedContentCount: input.contentParts.length,
    ...input.analysis
  };
}
