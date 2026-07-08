import assert from "node:assert/strict";
import { buildInspirationAssets, makeInspirationReferenceGame } from "../server/inspiration";
import { inspirationSeedPresets, type ContentPart, type GameId, type MonitorItem, type RiskLevel, type Sentiment, type SourceType } from "../src/shared";

const now = new Date("2026-07-08T06:00:00.000Z");

const weaponVideo = makeItem("weapon-video", {
  source: "bilibili",
  title: "无畏契约新赛季武器皮肤展示：检视动画和击杀特效",
  summary: "枪械皮肤、换弹动画、终结特效完整展示",
  thumbnail: "https://i0.hdslb.com/bfs/archive/example.jpg",
  metrics: { views: 120000, comments: 860, likes: 5400 }
});

const characterImage = makeItem("character-image", {
  source: "tieba",
  title: "三角洲行动干员皮肤套装外观图集",
  summary: "角色皮肤和套装外观参考",
  contentParts: [{ type: "post", text: "干员皮肤、角色时装、套装外观，适合做角色视觉参考。", count: 1 }]
});

const unrelated = makeItem("unrelated", {
  title: "匹配体验反馈",
  summary: "玩家讨论排位匹配时间",
  contentParts: [{ type: "comment", text: "匹配时间太长了", count: 1 }]
});

const nonDesignNoise = [
  makeItem("accelerator-code", {
    source: "bilibili",
    title: "【7月8日】海豚加速器最新口令 全平台通用 人手可得",
    summary: "Apex、三角洲行动加速器口令领取",
    keywords: ["Apex", "三角洲行动"],
    thumbnail: "https://i0.hdslb.com/bfs/archive/accelerator.jpg"
  }),
  makeItem("chat-gun-skin", {
    source: "bilibili",
    title: "单枪皮真不错",
    summary: "聊天截图讨论枪皮",
    keywords: ["VALORANT"],
    thumbnail: "https://i0.hdslb.com/bfs/archive/chat.jpg"
  }),
  makeItem("gameplay-feel", {
    source: "bilibili",
    title: "胸腹同伤！ttk反超常规改法 兼顾中近作战性价比刺客AS Val",
    summary: "视频素材，射击游戏参考，换弹手感",
    keywords: ["Apex", "三角洲行动"],
    thumbnail: "https://i0.hdslb.com/bfs/archive/gameplay.jpg"
  }),
  makeItem("livestream-record", {
    source: "bilibili",
    title: "y神开播了【2026-07-08】【lyyy】直播录像",
    summary: "视频素材，射击游戏参考",
    keywords: ["VALORANT", "PUBG"],
    thumbnail: "https://i0.hdslb.com/bfs/archive/live.jpg"
  }),
  makeItem("esports-prediction", {
    source: "bilibili",
    title: "无畏契约VCT众指挥预测第二赛段最终排名！谁又王朝了？",
    summary: "视频素材，射击游戏参考",
    keywords: ["VALORANT"],
    thumbnail: "https://i0.hdslb.com/bfs/archive/esports.jpg"
  }),
  makeItem("tieba-group-noise", {
    source: "tieba",
    title: "小群18=2",
    summary: "普通吧帖截图，不是外观展示",
    keywords: ["武器皮肤", "枪械皮肤"],
    contentParts: [{ type: "post", text: "小群18=2，加群闲聊。", count: 1 }]
  })
];

const noiseAssets = buildInspirationAssets(nonDesignNoise, { now });
assert.deepEqual(noiseAssets.map((asset) => asset.id), []);

const allAssets = buildInspirationAssets([weaponVideo, characterImage, unrelated], { now });
assert.deepEqual(allAssets.map((asset) => asset.id), ["weapon-video", "character-image"]);
assert.equal(allAssets[0].category, "weapon_skin");
assert.equal(allAssets[0].kind, "video");
assert.ok(allAssets[0].visualTags.includes("枪械皮肤"));
assert.ok(allAssets[0].visualTags.includes("击杀特效"));
assert.ok(allAssets[0].matchedSeeds.includes("VALORANT"));

const characterAssets = buildInspirationAssets([weaponVideo, characterImage], {
  now,
  category: "character_skin"
});
assert.deepEqual(characterAssets.map((asset) => asset.id), ["character-image"]);
assert.equal(characterAssets[0].kind, "image");
assert.ok(characterAssets[0].matchedSeeds.includes("三角洲行动"));

const queryAssets = buildInspirationAssets([weaponVideo, characterImage], {
  now,
  query: "检视"
});
assert.deepEqual(queryAssets.map((asset) => asset.id), ["weapon-video"]);

const referenceGame = makeInspirationReferenceGame([], "weapon_skin");
assert.equal(referenceGame.id, "fps-tps-reference");
assert.equal(referenceGame.name, "FPS/TPS 竞品素材");
assert.ok(referenceGame.bilibiliKeywords.some((keyword) => keyword.includes("VALORANT")));
assert.ok(referenceGame.bilibiliKeywords.some((keyword) => keyword.includes("暗区突围")));
assert.ok(referenceGame.bilibiliKeywords.some((keyword) => keyword.includes("Helldivers 2")));
assert.ok(referenceGame.tiebaBars.includes("无畏契约"));
assert.ok(referenceGame.tiebaBars.includes("三角洲行动"));
assert.ok(!referenceGame.bilibiliKeywords.includes("Apex"));
assert.ok(!referenceGame.bilibiliKeywords.includes("三角洲行动"));
assert.ok(!referenceGame.bilibiliKeywords.join("\n").includes("生死狙击"));

const expectedSeedIds = [
  "arena-breakout",
  "lost-light",
  "arc-raiders",
  "warframe",
  "bloodstrike",
  "peace-elite",
  "knives-out",
  "halo",
  "doom",
  "destiny-2",
  "rainbow-six-siege",
  "the-finals",
  "marvel-rivals",
  "fragpunk",
  "strinova",
  "escape-from-tarkov",
  "helldivers-2"
];
const seedIds = new Set(inspirationSeedPresets.map((seed) => seed.id));
for (const id of expectedSeedIds) assert.ok(seedIds.has(id), id);

const selectedReferenceGame = makeInspirationReferenceGame(["destiny-2", "rainbow-six-siege", "the-finals"], "all");
assert.ok(selectedReferenceGame.tiebaBars.includes("命运2"));
assert.ok(selectedReferenceGame.tiebaBars.includes("彩虹六号"));
assert.ok(selectedReferenceGame.tiebaBars.includes("THE FINALS"));

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
    gameId: "fps-tps-reference" as GameId,
    gameName: "FPS/TPS 竞品素材",
    source: overrides.source || "tieba",
    sourceLabel: overrides.sourceLabel || "测试来源",
    sourceItemId: id,
    title: overrides.title || "ordinary post",
    author: overrides.author || "tester",
    url: overrides.url || `https://example.test/${id}`,
    thumbnail: overrides.thumbnail,
    publishedAt: overrides.publishedAt || "2026-07-08T05:00:00.000Z",
    collectedAt: overrides.collectedAt || now.toISOString(),
    freshnessHours: overrides.freshnessHours ?? 1,
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
