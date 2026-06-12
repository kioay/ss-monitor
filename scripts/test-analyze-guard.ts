import assert from "node:assert/strict";
import { analyzeItem } from "../server/analyze";
import { refreshCurrentVersionFocus } from "../server/currentVersion";
import type { GameId } from "../src/shared";
import type { ContentPart } from "../src/shared";

await refreshCurrentVersionFocus(new Date("2026-06-12T12:00:00.000+08:00"));

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

const teamRecruitment = analyze({
  title: "联通一区Azarras战队宣传片！谨以此片献给我们的青春！",
  gameId: "ss1",
  contentParts: [
    { type: "title", text: "联通一区Azarras战队宣传片！谨以此片献给我们的青春！", count: 1 },
    {
      type: "description",
      text: "联通一区Azarras战队招收各路玩家，无论是你是冒险萌新，还是飞升大佬都欢迎！战队氛围非常好，萌新有什么问题可以在战队群里交流！战队每周都有玩具深海飞升车队，和专七突袭等，还有各种三强化，双强化武器，老唯一皮肤等你来家园租赁！有意向的小伙伴可以来群132578055！",
      count: 1
    },
    { type: "tag", text: "Azarras战队、战队收人、战队宣传片、联通一区、冒险模式、生死狙击", count: 1 }
  ],
  metrics: { views: 1297, replies: 41, comments: 41, likes: 69, danmaku: 2, favorites: 18 }
});

assert.equal(teamRecruitment.riskLevel, "low");
assert.deepEqual(teamRecruitment.riskReasons, []);
assert.equal(teamRecruitment.topics.includes("当前版本重点"), false);

const positivePurchaseShowcase = analyze({
  title: "生死狙击氪金1200，拿下瑶光终焉~",
  gameId: "ss1",
  contentParts: [
    { type: "title", text: "生死狙击氪金1200，拿下瑶光终焉~", count: 1 },
    { type: "tag", text: "生死狙击仲夏之梦赛季、4399生死狙击、生死狙击", count: 1 },
    { type: "comment", text: "我也是昨晚拿下了", count: 1 },
    { type: "comment", text: "皮肤是最没用的", count: 1 },
    { type: "comment", text: "好看，断罪原皮那个能量弹感觉好简陋", count: 1 },
    { type: "comment", text: "太好了终于有瑶光强化石了[doge]", count: 1 },
    { type: "comment", text: "氪出强大[doge][doge]，虽然我瑶光已经满配了[吃瓜]", count: 1 }
  ],
  metrics: { views: 924, replies: 17, comments: 17, likes: 26, danmaku: 1, favorites: 2, shares: 1 }
});

assert.equal(positivePurchaseShowcase.riskLevel, "low");
assert.deepEqual(positivePurchaseShowcase.riskReasons, []);

const crystalSkinPurchase = analyze({
  title: "生死狙击到账 10750金币 神秘商店买买买 拿下晶刹新皮肤 这科比神兵便宜多了",
  gameId: "ss1",
  contentParts: [
    { type: "title", text: "生死狙击到账 10750金币 神秘商店买买买 拿下晶刹新皮肤 这科比神兵便宜多了", count: 1 },
    { type: "tag", text: "必剪创作、4399生死狙击、生死狙击", count: 1 },
    { type: "comment", text: "这皮肤真比红莲好看吧，还便宜[doge]", count: 1 },
    { type: "comment", text: "神秘商店有幻锋加幻锋配件吗[doge]", count: 1 },
    { type: "comment", text: "我相信单抽出奇迹[doge]", count: 1 }
  ],
  metrics: { views: 717, replies: 16, comments: 16, likes: 7 }
});

assert.equal(crystalSkinPurchase.riskLevel, "low");
assert.deepEqual(crystalSkinPurchase.riskReasons, []);

const accountRentalLead = analyze({
  title: "玩生死狙击眼馋别人的无尽光影、幻刃？租个号进去突突两把，不好用直接换",
  gameId: "ss1",
  contentParts: [
    { type: "title", text: "玩生死狙击眼馋别人的无尽光影、幻刃？租个号进去突突两把，不好用直接换", count: 1 },
    {
      type: "description",
      text: "小杰选号网是正规租号平台，提供热门端游、手游、Steam等账号租赁服务。号源充足，客服24小时在线，累计订单量已过千万。平台官网: xiaojie.zhanghaodaren.com",
      count: 1
    },
    { type: "tag", text: "生死狙击租号、游戏租号、4399生死狙击、生死狙击、氪金、FPS、娱乐", count: 1 }
  ],
  metrics: { views: 139, replies: 1, comments: 1, likes: 8 }
});

assert.equal(accountRentalLead.riskLevel, "medium");
assert.equal(accountRentalLead.riskReasons[0], "账号租赁/交易导流");

function analyze(input: { title: string; contentParts: ContentPart[]; gameId?: GameId; metrics?: Parameters<typeof analyzeItem>[0]["metrics"] }) {
  return analyzeItem({
    title: input.title,
    gameId: input.gameId || "ss2",
    contentParts: input.contentParts,
    metrics: input.metrics || {}
  });
}
