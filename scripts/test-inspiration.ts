import assert from "node:assert/strict";
import { buildInspirationAssets } from "../server/inspiration";
import type { ContentPart, GameId, MonitorItem, RiskLevel, Sentiment, SourceType } from "../src/shared";

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

const allAssets = buildInspirationAssets([weaponVideo, characterImage, unrelated], { now });
assert.deepEqual(allAssets.map((asset) => asset.id), ["weapon-video", "character-image"]);
assert.equal(allAssets[0].category, "weapon_skin");
assert.equal(allAssets[0].kind, "video");
assert.ok(allAssets[0].visualTags.includes("枪械皮肤"));
assert.ok(allAssets[0].visualTags.includes("击杀特效"));

const characterAssets = buildInspirationAssets([weaponVideo, characterImage], {
  now,
  category: "character_skin"
});
assert.deepEqual(characterAssets.map((asset) => asset.id), ["character-image"]);
assert.equal(characterAssets[0].kind, "image");
assert.ok(characterAssets[0].matchedSeeds.includes("角色皮肤"));

const queryAssets = buildInspirationAssets([weaponVideo, characterImage], {
  now,
  query: "检视"
});
assert.deepEqual(queryAssets.map((asset) => asset.id), ["weapon-video"]);

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
    gameId: "ss1" as GameId,
    gameName: "生死狙击1",
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
