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

const rentalTitle = "玩生死狙击眼馋别人的无尽光影、幻刃？租个号进去突突两把，不好用直接换";
const rentalContentParts: ContentPart[] = [
  { type: "title", text: rentalTitle, count: 1 },
  {
    type: "description",
    text: "小杰选号网是正规租号平台，提供热门端游、手游、Steam等账号租赁服务。号源充足，客服24小时在线，累计订单量已过千万。平台官网: xiaojie.zhanghaodaren.com",
    count: 1
  },
  { type: "tag", text: "生死狙击租号、游戏租号、4399生死狙击、生死狙击、氪金、FPS、娱乐", count: 1 }
];
const rentalAnalysis = analyzeItem({ title: rentalTitle, gameId: "ss1", contentParts: rentalContentParts, metrics: {} });
const rentalItem = makeItem({ title: rentalTitle, contentParts: rentalContentParts, analysis: rentalAnalysis });
const refinedRental = fuseBettaFishSignal(rentalItem, {
  id: "semantic:rental",
  label: "negative",
  score: -1,
  confidence: 1,
  positiveProbability: 0
});

assert.equal(refinedRental.riskLevel, "medium");
assert.ok(refinedRental.riskReasons.includes("账号租赁/交易导流"));

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
