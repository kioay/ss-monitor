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

const accountSharingComplaintTitle = "dy生死狙击表妹是zpf！";
const accountSharingComplaintParts: ContentPart[] = [
  { type: "title", text: accountSharingComplaintTitle, count: 1 },
  {
    type: "description",
    text: "2025年10月12日，我和网名为生死狙击表妹的用户协商游戏账号共用，对方承诺永久共号，我累计转账3308元。收款后对方拒不履约，多次联系均无回应，随后将微信删除拉黑，既不提供服务也不退款，还刻意歪曲事实。期间多次说谎诱导转账。",
    count: 1
  },
  { type: "post", text: "共号的一律骗子知道不", count: 1 },
  { type: "post", text: "共号你也信?", count: 1 },
  { type: "post", text: "666", count: 1 },
  { type: "post", text: "正常，这种都是骗子", count: 1 },
  { type: "post", text: "我咋碰不上这位好兄弟 我是真心共号的", count: 1 },
  { type: "post", text: "就当作乱斗为了争第一，怒氪3308买王者祝福抢榜，结果还是没能争过第一，钱全打水漂了", count: 1 }
];
const accountSharingComplaintAnalysis = analyzeItem({
  title: accountSharingComplaintTitle,
  gameId: "ss1",
  contentParts: accountSharingComplaintParts,
  metrics: { replies: 10, comments: 10 }
});
const accountSharingComplaint = makeItem({
  title: accountSharingComplaintTitle,
  contentParts: accountSharingComplaintParts,
  analysis: {
    ...accountSharingComplaintAnalysis,
    sentiment: "positive",
    sentimentScore: 0.725,
    riskLevel: "medium",
    riskReasons: ["命中治理类风险词"]
  }
});
const refinedComplaint = fuseBettaFishSignal(accountSharingComplaint, {
  id: "semantic:account-sharing-complaint",
  label: "negative",
  score: -1,
  confidence: 1,
  positiveProbability: 0
});

assert.notEqual(accountSharingComplaintAnalysis.sentiment, "positive");
assert.equal(refinedComplaint.sentiment, "negative");
assert.equal(refinedComplaint.summary.includes("正面反馈较多"), false);

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
