import { z } from "zod";
import { collectBilibili } from "./collectors/bilibili";
import { collectTieba } from "./collectors/tieba";
import { stripHtml, uniq } from "./utils";
import {
  inspirationSeedPresets,
  type GameConfig,
  type InspirationAsset,
  type InspirationAssetKind,
  type InspirationCategory,
  type InspirationSeedPreset,
  type InspirationResponse,
  type InspirationStats,
  type MonitorItem,
  type SourceType
} from "../src/shared";

const categoryFilterValues = ["all", "weapon_skin", "character_skin", "general_reference"] as const;
const kindFilterValues = ["all", "video", "image"] as const;

const inspirationQuerySchema = z.object({
  packs: z.string().optional().transform((value) => parseCsv(value || "")),
  windowHours: z.coerce.number().int().min(1).max(24 * 30).default(24 * 30),
  limit: z.coerce.number().int().min(1).max(120).default(48),
  q: z.string().max(120).default(""),
  category: z.enum(categoryFilterValues).default("all"),
  kind: z.enum(kindFilterValues).default("all"),
  refresh: z.string().optional().transform((value) => value === "1" || value === "true"),
  force: z.string().optional().transform((value) => value === "1" || value === "true")
});

type InspirationQuery = z.infer<typeof inspirationQuerySchema>;

const categoryLexicon: Record<InspirationCategory, string[]> = {
  weapon_skin: [
    "武器皮肤",
    "枪械皮肤",
    "武器外观",
    "枪皮",
    "枪械",
    "枪模",
    "近战皮肤",
    "近战武器",
    "检视",
    "换弹",
    "击杀特效",
    "weapon skin",
    "gun skin",
    "melee skin"
  ],
  character_skin: [
    "角色皮肤",
    "人物皮肤",
    "干员皮肤",
    "英雄皮肤",
    "角色时装",
    "套装外观",
    "传家宝",
    "operator skin",
    "character skin",
    "hero skin",
    "outfit"
  ],
  general_reference: [
    "FPS皮肤",
    "TPS皮肤",
    "射击游戏皮肤",
    "皮肤展示",
    "外观展示",
    "赛季皮肤",
    "通行证皮肤",
    "商城皮肤",
    "battle pass",
    "showcase",
    "cosmetic"
  ]
};

const visualTagLexicon: Array<{ tag: string; terms: string[] }> = [
  { tag: "枪械皮肤", terms: ["枪械皮肤", "武器皮肤", "枪皮", "weapon skin", "gun skin"] },
  { tag: "近战武器", terms: ["近战", "刀皮", "近战皮肤", "melee", "knife"] },
  { tag: "角色套装", terms: ["角色皮肤", "人物皮肤", "干员皮肤", "英雄皮肤", "套装", "outfit"] },
  { tag: "检视动画", terms: ["检视", "检视动画", "inspect"] },
  { tag: "换弹/手感", terms: ["换弹", "手感", "reload", "animation"] },
  { tag: "击杀特效", terms: ["击杀特效", "淘汰特效", "终结特效", "kill effect", "finisher"] },
  { tag: "赛季通行证", terms: ["赛季", "通行证", "battle pass", "season"] },
  { tag: "商城轮换", terms: ["商城", "商店", "轮换", "store", "bundle"] },
  { tag: "二创参考", terms: ["同人", "二创", "概念", "设计", "concept", "fan art"] }
];

const sourceOrder: SourceType[] = ["bilibili", "douyin", "tieba", "forum4399", "bettafish"];

type InspirationCollection = {
  createdAt: number;
  items: MonitorItem[];
};

const inspirationCollectionCache = new Map<string, InspirationCollection>();
const inspirationCollectionInFlight = new Map<string, Promise<InspirationCollection>>();
const inspirationCollectionTtlMs = 45 * 60_000;
const referenceGameId = "fps-tps-reference";

const tiebaBarsBySeedId: Record<string, string[]> = {
  valorant: ["无畏契约"],
  apex: ["Apex英雄"],
  "call-of-duty": ["使命召唤"],
  "delta-force": ["三角洲行动"],
  overwatch: ["守望先锋"],
  pubg: ["绝地求生", "PUBG"],
  cs2: ["CS2", "反恐精英"],
  fortnite: ["堡垒之夜"]
};

export async function getInspirationResponse(rawQuery: unknown): Promise<InspirationResponse> {
  const query = inspirationQuerySchema.parse(rawQuery);
  const now = new Date();
  const referenceGame = makeInspirationReferenceGame(query.packs, query.category);
  const collection = await getInspirationCollection(referenceGame, query.windowHours, query.refresh || query.force, now);
  const matchedAssets = buildInspirationAssets(collection.items, {
    query: query.q,
    category: query.category,
    kind: query.kind,
    now
  });
  const assets = matchedAssets.slice(0, query.limit);

  return {
    generatedAt: now.toISOString(),
    windowHours: query.windowHours,
    query: query.q.trim(),
    category: query.category,
    kind: query.kind,
    totalMatched: matchedAssets.length,
    stats: makeInspirationStats(assets),
    seeds: inspirationSeedPresets,
    assets
  };
}

export function makeInspirationReferenceGame(
  seedIds: string[] = [],
  category: "all" | InspirationCategory = "all"
): GameConfig {
  const selectedSeeds = selectInspirationSeeds(seedIds);
  const keywords = inspirationSearchKeywords(selectedSeeds, category);
  return {
    id: referenceGameId,
    name: "FPS/TPS 竞品素材",
    shortName: "竞品素材",
    bilibiliKeywords: keywords,
    douyinKeywords: keywords,
    tiebaBars: tiebaBarsForSeeds(selectedSeeds),
    tiebaKeywords: tiebaKeywordsForCategory(category)
  };
}

async function getInspirationCollection(
  referenceGame: GameConfig,
  windowHours: number,
  refresh: boolean,
  now: Date
): Promise<InspirationCollection> {
  const cacheKey = inspirationCollectionKey(referenceGame, windowHours);
  const cached = inspirationCollectionCache.get(cacheKey);
  if (!refresh && cached && now.getTime() - cached.createdAt < inspirationCollectionTtlMs) return cached;

  const inFlight = inspirationCollectionInFlight.get(cacheKey);
  if (!refresh && inFlight) return inFlight;

  const cutoff = new Date(now.getTime() - windowHours * 3_600_000);
  const task = collectInspirationSources(referenceGame, cutoff)
    .then((items) => {
      const entry = { createdAt: Date.now(), items };
      inspirationCollectionCache.set(cacheKey, entry);
      return entry;
    })
    .finally(() => {
      if (inspirationCollectionInFlight.get(cacheKey) === task) inspirationCollectionInFlight.delete(cacheKey);
    });

  inspirationCollectionInFlight.set(cacheKey, task);
  return task;
}

async function collectInspirationSources(referenceGame: GameConfig, cutoff: Date) {
  const tasks = [
    collectBilibili(referenceGame, cutoff, {
      relevanceMode: "keyword",
      maxKeywords: 20,
      maxPages: 2,
      maxItems: 96,
      sourceLabel: "B站竞品视频"
    }),
    collectTieba(referenceGame, cutoff)
  ];
  const settled = await Promise.allSettled(tasks);
  const items: MonitorItem[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
    } else {
      console.warn("Inspiration source collection failed", result.reason instanceof Error ? result.reason.message : result.reason);
    }
  }

  return uniqueMonitorItems(items)
    .filter((item) => item.gameId === referenceGameId)
    .sort((left, right) => +new Date(right.publishedAt) - +new Date(left.publishedAt));
}

function selectInspirationSeeds(seedIds: string[]) {
  const byId = new Map(inspirationSeedPresets.map((seed) => [seed.id, seed]));
  const selected = seedIds.map((id) => byId.get(id)).filter((seed): seed is InspirationSeedPreset => Boolean(seed));
  return selected.length ? selected : inspirationSeedPresets;
}

function inspirationSearchKeywords(seeds: InspirationSeedPreset[], category: "all" | InspirationCategory) {
  const categoryTerms = category === "all" ? ["皮肤", "外观展示"] : categoryLexicon[category];
  const pairedKeywords = seeds.flatMap((seed) =>
    categoryTerms.slice(0, 5).map((term) => `${seed.label} ${term}`)
  );
  return uniq([...seeds.flatMap((seed) => seed.keywords), ...pairedKeywords])
    .filter((keyword) => !isOwnedProjectKeyword(keyword))
    .slice(0, 28);
}

function tiebaBarsForSeeds(seeds: InspirationSeedPreset[]) {
  return uniq(seeds.flatMap((seed) => tiebaBarsBySeedId[seed.id] || [])).slice(0, 8);
}

function tiebaKeywordsForCategory(category: "all" | InspirationCategory) {
  if (category === "weapon_skin") return ["武器皮肤", "枪皮", "枪械皮肤", "刀皮", "检视", "击杀特效"];
  if (category === "character_skin") return ["角色皮肤", "干员皮肤", "英雄皮肤", "套装", "外观"];
  return ["皮肤", "外观", "枪皮", "套装", "通行证", "商城", "联名"];
}

function isOwnedProjectKeyword(keyword: string) {
  return /生死狙击|生死1|生死2|SS1|SS2|热油/i.test(keyword);
}

function inspirationCollectionKey(referenceGame: GameConfig, windowHours: number) {
  const keywordKey = referenceGame.bilibiliKeywords.map((keyword) => normalizeText(keyword)).sort().join("|");
  const barKey = referenceGame.tiebaBars.map((bar) => normalizeText(bar)).sort().join("|");
  return `${windowHours}:${keywordKey}:${barKey}`;
}

function uniqueMonitorItems(items: MonitorItem[]) {
  const seen = new Set<string>();
  const unique: MonitorItem[] = [];
  for (const item of items) {
    const key = item.url || item.id;
    if (seen.has(key) || seen.has(item.id)) continue;
    seen.add(key);
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

export function buildInspirationAssets(
  items: MonitorItem[],
  options: {
    query?: string;
    category?: "all" | InspirationCategory;
    kind?: "all" | InspirationAssetKind;
    now?: Date;
  } = {}
): InspirationAsset[] {
  const queryTerms = normalizeQueryTerms(options.query || "");
  const categoryFilter = options.category || "all";
  const kindFilter = options.kind || "all";
  const now = options.now || new Date();

  return items
    .map((item) => classifyInspirationItem(item, queryTerms, now))
    .filter((asset): asset is InspirationAsset => Boolean(asset))
    .filter((asset) => categoryFilter === "all" || asset.category === categoryFilter)
    .filter((asset) => kindFilter === "all" || asset.kind === kindFilter)
    .sort((left, right) => right.score - left.score || +new Date(right.item.publishedAt) - +new Date(left.item.publishedAt));
}

function classifyInspirationItem(item: MonitorItem, queryTerms: string[], now: Date): InspirationAsset | undefined {
  const text = inspirationText(item);
  const normalized = normalizeText(text);
  const compact = normalized.replace(/\s+/g, "");
  if (queryTerms.length && !queryTerms.every((term) => containsTerm(normalized, compact, term))) return undefined;

  const categoryScores = categoryScoreMap(normalized, compact);
  const category = pickCategory(categoryScores);
  const matchedSeeds = matchedSeedLabels(normalized, compact);
  const visualTags = matchedVisualTags(normalized, compact);
  const hasInspirationSignal = matchedSeeds.length > 0 || visualTags.length > 0 || Math.max(...Object.values(categoryScores)) > 0;
  if (!hasInspirationSignal && !queryTerms.length) return undefined;

  const kind = inspirationKind(item);
  const score =
    categoryScores[category] * 18
    + matchedSeeds.length * 16
    + visualTags.length * 9
    + (item.thumbnail ? 10 : 0)
    + (kind === "video" ? 8 : 4)
    + recencyScore(item, now)
    + engagementScore(item);

  return {
    id: item.id,
    item,
    kind,
    category,
    score: Math.round(score),
    matchedSeeds,
    visualTags,
    reason: inspirationReason(kind, category, visualTags)
  };
}

function categoryScoreMap(normalized: string, compact: string): Record<InspirationCategory, number> {
  return {
    weapon_skin: countTermHits(normalized, compact, categoryLexicon.weapon_skin),
    character_skin: countTermHits(normalized, compact, categoryLexicon.character_skin),
    general_reference: countTermHits(normalized, compact, categoryLexicon.general_reference)
  };
}

function pickCategory(scores: Record<InspirationCategory, number>): InspirationCategory {
  if (scores.weapon_skin >= scores.character_skin && scores.weapon_skin > 0) return "weapon_skin";
  if (scores.character_skin > 0) return "character_skin";
  return "general_reference";
}

function matchedSeedLabels(normalized: string, compact: string) {
  return inspirationSeedPresets
    .filter((seed) => seed.keywords.some((keyword) => containsTerm(normalized, compact, keyword)))
    .map((seed) => seed.label);
}

function matchedVisualTags(normalized: string, compact: string) {
  return visualTagLexicon
    .filter((entry) => entry.terms.some((term) => containsTerm(normalized, compact, term)))
    .map((entry) => entry.tag)
    .slice(0, 6);
}

function countTermHits(normalized: string, compact: string, terms: string[]) {
  return terms.filter((term) => containsTerm(normalized, compact, term)).length;
}

function containsTerm(normalized: string, compact: string, term: string) {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  return normalized.includes(normalizedTerm) || compact.includes(normalizedTerm.replace(/\s+/g, ""));
}

function inspirationKind(item: MonitorItem): InspirationAssetKind {
  return item.source === "bilibili" || item.source === "douyin" ? "video" : "image";
}

function inspirationText(item: MonitorItem) {
  return [
    item.title,
    item.summary,
    item.author,
    item.keywords.join(" "),
    item.topics.join(" "),
    item.riskReasons.join(" "),
    ...item.contentParts.map((part) => part.text)
  ].join("\n");
}

function normalizeText(value: string) {
  return stripHtml(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function parseCsv(value: string) {
  return uniq(value.split(/[\s,;|，、；]+/).map((item) => item.trim()).filter(Boolean));
}

function normalizeQueryTerms(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return uniq(normalized.split(/[\s,;|，、；]+/).map((term) => term.trim()).filter(Boolean)).slice(0, 8);
}

function recencyScore(item: MonitorItem, now: Date) {
  const ageHours = Math.max(0, (now.getTime() - new Date(item.publishedAt).getTime()) / 3_600_000);
  if (!Number.isFinite(ageHours)) return 0;
  if (ageHours <= 24) return 18;
  if (ageHours <= 72) return 12;
  if (ageHours <= 168) return 8;
  if (ageHours <= 720) return 4;
  return 0;
}

function engagementScore(item: MonitorItem) {
  const metrics = item.metrics || {};
  const value =
    (metrics.views || 0) / 2000
    + (metrics.likes || 0) / 300
    + (metrics.comments || metrics.replies || 0) / 80
    + (metrics.favorites || 0) / 120
    + (metrics.shares || 0) / 120;
  return Math.min(20, value);
}

function inspirationReason(kind: InspirationAssetKind, category: InspirationCategory, tags: string[]) {
  const kindLabel = kind === "video" ? "视频素材" : "图文素材";
  const categoryLabel = category === "weapon_skin" ? "武器皮肤" : category === "character_skin" ? "角色皮肤" : "射击游戏参考";
  const tagText = tags.length ? ` · ${tags.slice(0, 2).join(" / ")}` : "";
  return `${kindLabel} · ${categoryLabel}${tagText}`;
}

function makeInspirationStats(assets: InspirationAsset[]): InspirationStats {
  const sourceCounts = new Map<SourceType, number>();
  for (const asset of assets) {
    sourceCounts.set(asset.item.source, (sourceCounts.get(asset.item.source) || 0) + 1);
  }

  return {
    total: assets.length,
    videos: assets.filter((asset) => asset.kind === "video").length,
    images: assets.filter((asset) => asset.kind === "image").length,
    weaponSkins: assets.filter((asset) => asset.category === "weapon_skin").length,
    characterSkins: assets.filter((asset) => asset.category === "character_skin").length,
    sourceBreakdown: Array.from(sourceCounts.entries())
      .sort((left, right) => sourceOrder.indexOf(left[0]) - sourceOrder.indexOf(right[0]))
      .map(([source, count]) => ({ source, count }))
  };
}
