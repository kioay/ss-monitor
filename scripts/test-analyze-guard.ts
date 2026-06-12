import assert from "node:assert/strict";
import { analyzeItem } from "../server/analyze";
import type { ContentPart } from "../src/shared";

const reportedFalsePositive = analyze({
  title: "免费借号玩4399渠道的",
  contentParts: [
    { type: "title", text: "免费借号玩4399渠道的", count: 1 },
    { type: "description", text: "有炎魔咆哮炫彩巨浪uzi星璇t0枪都有最好的金皮爆破黑金三段不开挂的来加我私聊", count: 1 },
    { type: "post", text: "有炎魔咆哮炫彩巨浪uzi星璇t0枪都有最好的金皮爆破黑金三段不开挂的来加我私聊", count: 1 }
  ]
});

assert.equal(reportedFalsePositive.sentiment, "neutral");
assert.equal(reportedFalsePositive.sentimentScore, 0);
assert.equal(reportedFalsePositive.riskLevel, "low");
assert.deepEqual(reportedFalsePositive.riskReasons, []);
assert.equal(reportedFalsePositive.topics.includes("外挂公平"), false);

const denialPhrases = [
  "全程纯手动没有外挂，正常玩家分享战绩",
  "不是开挂也不是脚本，普通娱乐局",
  "不使用自瞄不使用透视，只打普通匹配",
  "无外挂无科技，绿色账号"
];

for (const text of denialPhrases) {
  const analysis = analyze({ title: text, contentParts: [{ type: "title", text, count: 1 }] });
  assert.equal(analysis.riskLevel, "low", text);
  assert.deepEqual(analysis.riskReasons, [], text);
  assert.equal(analysis.sentiment, "neutral", text);
  assert.equal(analysis.topics.includes("外挂公平"), false, text);
}

const realCheatPromotion = analyze({
  title: "开挂演示加群试用",
  contentParts: [
    { type: "title", text: "开挂演示加群试用", count: 1 },
    { type: "description", text: "锁头透视效果展示，进群体验", count: 1 }
  ]
});

assert.equal(realCheatPromotion.riskLevel, "high");
assert.ok(realCheatPromotion.riskReasons.includes("疑似外挂宣传引流"));
assert.ok(realCheatPromotion.topics.includes("外挂公平"));

function analyze(input: { title: string; contentParts: ContentPart[] }) {
  return analyzeItem({
    title: input.title,
    gameId: "ss2",
    contentParts: input.contentParts,
    metrics: {}
  });
}
