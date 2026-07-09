import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { collectBilibili } from "./collectors/bilibili";
import { collectTieba } from "./collectors/tieba";
import { runtimeConfig } from "./config";
import { stripHtml, uniq } from "./utils";
import {
  inspirationSeedPresets,
  type GameConfig,
  type InspirationAsset,
  type InspirationAssetKind,
  type InspirationCategory,
  type InspirationCommercialSignalLevel,
  type InspirationSort,
  type InspirationSourceTier,
  type InspirationSeedPreset,
  type InspirationResponse,
  type InspirationStats,
  type MonitorItem,
  type SourceHealth,
  type SourceType
} from "../src/shared";

const categoryFilterValues = ["all", "weapon_skin", "character_skin", "general_reference"] as const;
const kindFilterValues = ["all", "video", "image"] as const;
const sortValues = ["relevance", "heat", "latest"] as const;

const inspirationQuerySchema = z.object({
  packs: z.string().optional().transform((value) => parseCsv(value || "")),
  windowHours: z.coerce.number().int().min(1).max(24 * 30).default(24 * 30),
  limit: z.coerce.number().int().min(1).max(120).default(48),
  q: z.string().max(120).default(""),
  category: z.enum(categoryFilterValues).default("all"),
  kind: z.enum(kindFilterValues).default("all"),
  sort: z.enum(sortValues).default("relevance"),
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

const sourceTierLabels: Record<InspirationSourceTier, string> = {
  official: "官方/商城",
  creator_video: "实录视频",
  community_image: "玩家图帖",
  community_discussion: "社区讨论",
  derived_reference: "二创/转载"
};

const commercialSignalLabels: Record<InspirationCommercialSignalLevel, string> = {
  strong: "强商业信号",
  moderate: "中商业信号",
  weak: "弱商业信号",
  unknown: "待验证"
};

const officialSourceTerms = [
  "官方",
  "官网",
  "官号",
  "官方账号",
  "official",
  "store page",
  "商城页",
  "赛季页",
  "公告"
];

const derivedReferenceTerms = [
  "二创",
  "同人",
  "转载",
  "搬运",
  "fan art",
  "concept",
  "concept art",
  "概念设计",
  "原画"
];

const commercialMarketTerms = [
  "商城",
  "商店",
  "上架",
  "轮换",
  "礼包",
  "套装",
  "通行证",
  "赛季",
  "限时",
  "联名",
  "battle pass",
  "store",
  "shop",
  "bundle",
  "collab",
  "limited"
];

const specificDesignMaterialTerms = [
  "武器皮肤",
  "枪械皮肤",
  "枪械涂装",
  "武器涂装",
  "装备涂装",
  "武器外观",
  "枪械外观",
  "近战皮肤",
  "角色皮肤",
  "人物皮肤",
  "干员皮肤",
  "英雄皮肤",
  "角色时装",
  "套装外观",
  "皮肤展示",
  "外观展示",
  "外观图集",
  "检视动画",
  "检视动作",
  "填弹动作",
  "赛季皮肤",
  "通行证皮肤",
  "商城皮肤",
  "蓝图枪",
  "枪械蓝图",
  "传家宝",
  "weapon skin",
  "gun skin",
  "melee skin",
  "operator skin",
  "character skin",
  "hero skin",
  "skin bundle",
  "cosmetic bundle",
  "weapon blueprint",
  "tracer pack"
];

const weakDesignMaterialTerms = [
  "皮肤",
  "枪皮",
  "刀皮",
  "手套",
  "套装",
  "外观",
  "商城",
  "商店",
  "轮换",
  "通行证",
  "联名",
  "换弹",
  "手感",
  "skin",
  "outfit",
  "cosmetic",
  "store",
  "bundle"
];

const designPresentationTerms = [
  "展示",
  "外观",
  "图集",
  "预览",
  "一览",
  "合集",
  "鉴赏",
  "爆料",
  "上架",
  "商城",
  "商店",
  "轮换",
  "套装",
  "通行证",
  "联名",
  "检视",
  "击杀特效",
  "淘汰特效",
  "终结特效",
  "特效",
  "蓝图",
  "传家宝",
  "原画",
  "概念",
  "设计",
  "建模",
  "渲染",
  "立绘",
  "showcase",
  "preview",
  "bundle",
  "cosmetic",
  "outfit",
  "inspect",
  "kill effect",
  "finisher",
  "heirloom",
  "blueprint",
  "concept",
  "fan art",
  "render",
  "model",
  "battle pass",
  "tracer pack"
];

const designSearchKeywordTerms = [
  ...specificDesignMaterialTerms,
  ...weakDesignMaterialTerms,
  ...designPresentationTerms
];

const hardNonDesignTerms = [
  "加速器",
  "口令",
  "兑换码",
  "cdk",
  "人手可得",
  "全平台通用",
  "直播录像",
  "直播录播",
  "直播回放",
  "开播",
  "小群",
  "群号",
  "加群",
  "进群",
  "聊天截图",
  "攻略",
  "教学",
  "教程",
  "完整攻略",
  "活动攻略",
  "兑换",
  "领取",
  "别忘领",
  "免费领",
  "白嫖",
  "福利",
  "领券",
  "领皮肤",
  "限时三角券",
  "三角券",
  "g币",
  "g-coin",
  "g coin",
  "限时g币",
  "买什么",
  "用来买什么",
  "怎么用",
  "到底怎么用",
  "请问",
  "问一下",
  "回归玩家",
  "退坑",
  "退坑整理",
  "代价私",
  "记者勿扰",
  "卖号",
  "出号",
  "纯无敌洞",
  "想花不敢花",
  "不敢放开",
  "谁会买",
  "屌样",
  "白皮战术",
  "防止小孩"
];

const softNonDesignTerms = [
  "赛事",
  "比赛",
  "赛段",
  "排名",
  "预测",
  "指挥",
  "冠军",
  "战队",
  "抽象",
  "小视频",
  "精彩集锦",
  "高光",
  "攻略",
  "教学",
  "教程",
  "打法",
  "配装",
  "性价比",
  "ttk",
  "中近作战",
  "胸腹同伤",
  "排位",
  "上分",
  "单排",
  "开局",
  "吃鸡",
  "开黑",
  "闲聊",
  "吐槽",
  "竞猜",
  "抽奖"
];

const sourceOrder: SourceType[] = ["bilibili", "douyin", "tieba", "forum4399", "bettafish"];

type InspirationCollection = {
  createdAt: number;
  items: MonitorItem[];
  health: SourceHealth[];
};
interface InspirationSnapshotFile {
  version: 1;
  entries: Array<InspirationCollection & { cacheKey: string }>;
}

const inspirationCollectionCache = new Map<string, InspirationCollection>();
const inspirationCollectionInFlight = new Map<string, Promise<InspirationCollection>>();
const inspirationCollectionTtlMs = 45 * 60_000;
const inspirationSnapshotMaxEntries = 24;
const referenceGameId = "fps-tps-reference";
const inspirationMaxSearchKeywords = 120;
const inspirationMaxTiebaBars = 32;
let inspirationSnapshotLoaded = false;

const tiebaBarsBySeedId: Record<string, string[]> = {
  valorant: ["无畏契约"],
  apex: ["Apex英雄"],
  "call-of-duty": ["使命召唤"],
  "delta-force": ["三角洲行动"],
  overwatch: ["守望先锋"],
  pubg: ["绝地求生", "PUBG"],
  cs2: ["CS2", "反恐精英"],
  crossfire: ["穿越火线"],
  "crossfire-mobile": ["穿越火线手游", "CF手游"],
  "crossfire-hd": ["CFHD", "穿越火线HD"],
  "counter-strike-online": ["反恐精英online", "CSOL"],
  nz: ["逆战"],
  "nz-future": ["逆战未来"],
  fortnite: ["堡垒之夜"],
  "arena-breakout": ["暗区突围"],
  "lost-light": ["萤火突击"],
  "arc-raiders": ["ARC Raiders"],
  warframe: ["Warframe"],
  bloodstrike: ["BloodStrike", "血战"],
  "peace-elite": ["和平精英"],
  "knives-out": ["荒野行动"],
  halo: ["Halo"],
  doom: ["DOOM"],
  "destiny-2": ["命运2"],
  "rainbow-six-siege": ["彩虹六号"],
  "the-finals": ["THE FINALS"],
  "marvel-rivals": ["漫威争锋"],
  fragpunk: ["FragPunk", "界外狂潮"],
  strinova: ["卡拉彼丘"],
  "escape-from-tarkov": ["逃离塔科夫"],
  "helldivers-2": ["绝地潜兵"]
};

export async function getInspirationResponse(rawQuery: unknown): Promise<InspirationResponse> {
  const query = inspirationQuerySchema.parse(rawQuery);
  const now = new Date();
  const referenceGame = makeInspirationReferenceGame(query.packs, "all");
  const collection = await getInspirationCollection(referenceGame, query.windowHours, query.refresh || query.force, now);
  const matchedAssets = buildInspirationAssets(collection.items, {
    query: query.q,
    category: query.category,
    kind: query.kind,
    sort: query.sort,
    now
  });
  const assets = matchedAssets.slice(0, query.limit);

  return {
    generatedAt: now.toISOString(),
    windowHours: query.windowHours,
    query: query.q.trim(),
    category: query.category,
    kind: query.kind,
    sort: query.sort,
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
  await loadInspirationSnapshot();
  const cached = inspirationCollectionCache.get(cacheKey);
  if (!refresh && cached && now.getTime() - cached.createdAt < inspirationCollectionTtlMs) return cached;

  const inFlight = inspirationCollectionInFlight.get(cacheKey);
  if (!refresh && inFlight) return inFlight;

  const cutoff = new Date(now.getTime() - windowHours * 3_600_000);
  const task = collectInspirationSources(referenceGame, cutoff)
    .then(async (collection) => {
      const previous = inspirationCollectionCache.get(cacheKey);
      const candidateAssetCount = buildInspirationAssets(collection.items, { now }).length;
      const previousAssetCount = previous ? buildInspirationAssets(previous.items, { now }).length : 0;
      const hasBlockedSource = collection.health.some((entry) => entry.blocked);
      if (shouldRetainInspirationCache({ candidateAssetCount, previousAssetCount, hasBlockedSource })) {
        console.warn(
          `Inspiration collection kept previous cache: new=${candidateAssetCount}, previous=${previousAssetCount}, blocked=${hasBlockedSource}`
        );
        return previous as InspirationCollection;
      }

      const entry = { createdAt: Date.now(), items: collection.items, health: collection.health };
      inspirationCollectionCache.set(cacheKey, entry);
      await saveInspirationSnapshot();
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
    {
      source: "bilibili" as const,
      sourceLabel: "B站竞品视频",
      run: () => collectBilibili(referenceGame, cutoff, {
        relevanceMode: "keyword",
        maxKeywords: inspirationMaxSearchKeywords,
        maxPages: 1,
        maxItems: 140,
        sourceLabel: "B站竞品视频"
      })
    },
    { source: "tieba" as const, sourceLabel: "百度贴吧", run: () => collectTieba(referenceGame, cutoff) }
  ];
  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const items: MonitorItem[] = [];
  const health: SourceHealth[] = [];

  for (const [index, result] of settled.entries()) {
    const task = tasks[index];
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
      health.push(result.value.health);
    } else {
      console.warn("Inspiration source collection failed", result.reason instanceof Error ? result.reason.message : result.reason);
      health.push({
        source: task.source,
        sourceLabel: task.sourceLabel,
        gameId: referenceGame.id,
        ok: false,
        fetchedAt: new Date().toISOString(),
        latencyMs: 0,
        itemCount: 0,
        staleDropped: 0,
        blocked: Boolean((result.reason as { blocked?: boolean } | undefined)?.blocked),
        message: result.reason instanceof Error ? result.reason.message : String(result.reason)
      });
    }
  }

  return {
    items: uniqueMonitorItems(items)
      .filter((item) => item.gameId === referenceGameId)
      .sort((left, right) => +new Date(right.publishedAt) - +new Date(left.publishedAt)),
    health
  };
}

export function shouldRetainInspirationCache(input: {
  candidateAssetCount: number;
  previousAssetCount: number;
  hasBlockedSource: boolean;
}) {
  if (input.previousAssetCount <= 0) return false;
  if (input.candidateAssetCount <= 0) return true;
  return input.hasBlockedSource && input.candidateAssetCount < input.previousAssetCount;
}

async function loadInspirationSnapshot() {
  if (inspirationSnapshotLoaded) return;
  inspirationSnapshotLoaded = true;
  try {
    const raw = await fs.readFile(inspirationSnapshotPath(), "utf-8");
    const snapshot = JSON.parse(raw) as InspirationSnapshotFile;
    for (const entry of snapshot.entries || []) {
      if (!entry.cacheKey || !Array.isArray(entry.items) || !entry.items.length) continue;
      inspirationCollectionCache.set(entry.cacheKey, {
        createdAt: Number(entry.createdAt) || Date.now(),
        items: entry.items,
        health: Array.isArray(entry.health) ? entry.health : []
      });
    }
  } catch {
    // Snapshot cache is optional; first successful collection will create it.
  }
}

async function saveInspirationSnapshot() {
  try {
    const entries = Array.from(inspirationCollectionCache.entries())
      .filter(([, entry]) => entry.items.length > 0)
      .sort((left, right) => right[1].createdAt - left[1].createdAt)
      .slice(0, inspirationSnapshotMaxEntries)
      .map(([cacheKey, entry]) => ({ cacheKey, ...entry }));
    const target = inspirationSnapshotPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify({ version: 1, entries }, null, 2));
  } catch (error) {
    console.warn("Inspiration snapshot save failed", error instanceof Error ? error.message : error);
  }
}

function inspirationSnapshotPath() {
  return path.resolve(runtimeConfig.inspirationSnapshotPath);
}

function selectInspirationSeeds(seedIds: string[]) {
  const byId = new Map(inspirationSeedPresets.map((seed) => [seed.id, seed]));
  const selected = seedIds.map((id) => byId.get(id)).filter((seed): seed is InspirationSeedPreset => Boolean(seed));
  return selected.length ? selected : inspirationSeedPresets;
}

function inspirationSearchKeywords(seeds: InspirationSeedPreset[], category: "all" | InspirationCategory) {
  const categoryTerms = category === "all" ? ["皮肤", "外观展示"] : categoryLexicon[category].slice(0, 2);
  const pairedKeywords = seeds.flatMap((seed) =>
    categoryTerms.map((term) => `${seed.label} ${term}`)
  );
  const seedKeywords = seeds.flatMap((seed) => seed.keywords).filter(isDesignSearchKeyword);
  return uniq([...pairedKeywords, ...seedKeywords])
    .filter((keyword) => !isOwnedProjectKeyword(keyword))
    .slice(0, inspirationMaxSearchKeywords);
}

function tiebaBarsForSeeds(seeds: InspirationSeedPreset[]) {
  return uniq(seeds.flatMap((seed) => tiebaBarsBySeedId[seed.id] || [])).slice(0, inspirationMaxTiebaBars);
}

function tiebaKeywordsForCategory(category: "all" | InspirationCategory) {
  if (category === "weapon_skin") return ["武器皮肤", "枪皮", "枪械皮肤", "刀皮", "检视", "击杀特效"];
  if (category === "character_skin") return ["角色皮肤", "干员皮肤", "英雄皮肤", "套装", "外观"];
  return ["皮肤", "外观", "枪皮", "套装", "通行证", "商城", "联名"];
}

function isOwnedProjectKeyword(keyword: string) {
  return /生死狙击|生死1|生死2|SS1|SS2|热油/i.test(keyword);
}

function isDesignSearchKeyword(keyword: string) {
  const normalized = normalizeText(keyword);
  const compact = normalized.replace(/\s+/g, "");
  return countTermHits(normalized, compact, designSearchKeywordTerms) > 0;
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
    sort?: InspirationSort;
    now?: Date;
  } = {}
): InspirationAsset[] {
  const queryTerms = normalizeQueryTerms(options.query || "");
  const categoryFilter = options.category || "all";
  const kindFilter = options.kind || "all";
  const sort = options.sort || "relevance";
  const now = options.now || new Date();

  return items
    .map((item) => classifyInspirationItem(item, queryTerms, now))
    .filter((asset): asset is InspirationAsset => Boolean(asset))
    .filter((asset) => categoryFilter === "all" || asset.category === categoryFilter)
    .filter((asset) => kindFilter === "all" || asset.kind === kindFilter)
    .sort((left, right) => compareInspirationAssets(left, right, sort));
}

function compareInspirationAssets(left: InspirationAsset, right: InspirationAsset, sort: InspirationSort) {
  if (sort === "heat") {
    return heatScore(right.item) - heatScore(left.item)
      || right.score - left.score
      || publishedTime(right.item) - publishedTime(left.item);
  }
  if (sort === "latest") {
    return publishedTime(right.item) - publishedTime(left.item)
      || right.score - left.score
      || heatScore(right.item) - heatScore(left.item);
  }
  return right.score - left.score
    || heatScore(right.item) - heatScore(left.item)
    || publishedTime(right.item) - publishedTime(left.item);
}

function classifyInspirationItem(item: MonitorItem, queryTerms: string[], now: Date): InspirationAsset | undefined {
  const kind = inspirationKind(item);
  if (kind === "image" && !item.thumbnail) return undefined;

  const text = inspirationText(item);
  const normalized = normalizeText(text);
  const compact = normalized.replace(/\s+/g, "");
  const primaryText = inspirationPrimaryText(item);
  const primaryNormalized = normalizeText(primaryText);
  const primaryCompact = primaryNormalized.replace(/\s+/g, "");
  if (queryTerms.length && !queryTerms.every((term) => containsTerm(normalized, compact, term))) return undefined;

  const categoryScores = categoryScoreMap(normalized, compact);
  const category = pickCategory(categoryScores);
  const matchedSeeds = matchedSeedLabels(normalized, compact);
  const visualTags = matchedVisualTags(normalized, compact);
  if (!isDesignInspirationCandidate(normalized, compact, primaryNormalized, primaryCompact, categoryScores, matchedSeeds.length > 0)) return undefined;
  const sourceTier = inspirationSourceTier(item, normalized, compact);
  const commercialSignal = inspirationCommercialSignal(item, normalized, compact, sourceTier);

  const score =
    categoryScores[category] * 18
    + matchedSeeds.length * 16
    + visualTags.length * 9
    + (item.thumbnail ? 10 : 0)
    + (kind === "video" ? 8 : 4)
    + sourceReliabilityScore(sourceTier) / 10
    + commercialSignal.score / 10
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
    sourceTier,
    sourceTierLabel: sourceTierLabels[sourceTier],
    sourceReliability: sourceReliabilityScore(sourceTier),
    commercialSignal,
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

function isDesignInspirationCandidate(
  normalized: string,
  compact: string,
  primaryNormalized: string,
  primaryCompact: string,
  categoryScores: Record<InspirationCategory, number>,
  hasMatchedSeed: boolean
) {
  const specificDesignHits = countTermHits(normalized, compact, specificDesignMaterialTerms);
  const weakDesignHits = countTermHits(normalized, compact, weakDesignMaterialTerms);
  const presentationHits = countTermHits(normalized, compact, designPresentationTerms);
  const categoryHits = Math.max(...Object.values(categoryScores));

  if (countTermHits(primaryNormalized, primaryCompact, hardNonDesignTerms) > 0) return false;

  const hasDesignSignal =
    specificDesignHits > 0
    || (presentationHits > 1 && (weakDesignHits > 0 || categoryHits > 0 || hasMatchedSeed));
  if (!hasDesignSignal) return false;

  const hasSoftNoise = countTermHits(primaryNormalized, primaryCompact, softNonDesignTerms) > 0;
  return !hasSoftNoise || specificDesignHits > 0 || presentationHits > 1;
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

function inspirationSourceTier(item: MonitorItem, normalized: string, compact: string): InspirationSourceTier {
  if (officialSourceTerms.some((term) => containsTerm(normalized, compact, term))) return "official";
  if (derivedReferenceTerms.some((term) => containsTerm(normalized, compact, term))) return "derived_reference";
  if (item.source === "bilibili" || item.source === "douyin") return "creator_video";
  if (item.thumbnail) return "community_image";
  return "community_discussion";
}

function sourceReliabilityScore(tier: InspirationSourceTier) {
  if (tier === "official") return 96;
  if (tier === "creator_video") return 76;
  if (tier === "community_image") return 58;
  if (tier === "community_discussion") return 42;
  return 34;
}

function inspirationCommercialSignal(
  item: MonitorItem,
  normalized: string,
  compact: string,
  sourceTier: InspirationSourceTier
): InspirationAsset["commercialSignal"] {
  const metrics = item.metrics || {};
  const comments = metrics.comments || metrics.replies || 0;
  const marketHits = countTermHits(normalized, compact, commercialMarketTerms);
  const metricScore =
    Math.min(34, (metrics.views || 0) / 18_000)
    + Math.min(24, (metrics.likes || 0) / 800)
    + Math.min(18, comments / 180)
    + Math.min(16, (metrics.favorites || 0) / 240)
    + Math.min(14, (metrics.shares || 0) / 120)
    + Math.min(10, (metrics.danmaku || 0) / 500);
  const score = Math.min(100, Math.round(metricScore + marketHits * 12 + (sourceTier === "official" ? 20 : 0)));
  const reasons: string[] = [];
  if (sourceTier === "official") reasons.push("官方或商城源");
  if (marketHits > 0) reasons.push("命中商城/礼包/通行证信号");
  if ((metrics.views || 0) >= 100_000) reasons.push(`播放${formatCompactNumber(metrics.views || 0)}`);
  if ((metrics.likes || 0) >= 3000) reasons.push(`点赞${formatCompactNumber(metrics.likes || 0)}`);
  if (comments >= 500) reasons.push(`评论${formatCompactNumber(comments)}`);
  if ((metrics.favorites || 0) >= 1000) reasons.push(`收藏${formatCompactNumber(metrics.favorites || 0)}`);

  const level: InspirationCommercialSignalLevel =
    score >= 68 ? "strong" : score >= 34 ? "moderate" : score > 0 ? "weak" : "unknown";
  return {
    level,
    score,
    label: commercialSignalLabels[level],
    reasons: reasons.slice(0, 4)
  };
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

function inspirationPrimaryText(item: MonitorItem) {
  return [
    item.title,
    item.summary,
    item.author,
    item.keywords.join(" "),
    item.topics.join(" "),
    item.riskReasons.join(" "),
    ...item.contentParts
      .filter((part) => part.type === "title" || part.type === "description" || part.type === "tag" || part.type === "post")
      .map((part) => part.text)
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

function heatScore(item: MonitorItem) {
  const metrics = item.metrics || {};
  const comments = metrics.comments || metrics.replies || 0;
  const raw =
    (metrics.views || 0)
    + (metrics.likes || 0) * 20
    + comments * 80
    + (metrics.favorites || 0) * 60
    + (metrics.shares || 0) * 80
    + (metrics.danmaku || 0) * 20;
  return Math.log1p(Math.max(0, raw));
}

function publishedTime(item: MonitorItem) {
  const value = +new Date(item.publishedAt);
  return Number.isFinite(value) ? value : 0;
}

function formatCompactNumber(value: number) {
  if (value >= 10_000) return `${Math.round(value / 1000) / 10}万`;
  return String(value);
}

function inspirationReason(kind: InspirationAssetKind, category: InspirationCategory, tags: string[]) {
  const kindLabel = kind === "video" ? "视频素材" : "图文素材";
  const categoryLabel = category === "weapon_skin" ? "武器皮肤" : category === "character_skin" ? "角色皮肤" : "射击游戏参考";
  const tagText = tags.length ? ` · ${tags.slice(0, 2).join(" / ")}` : "";
  return `${kindLabel} · ${categoryLabel}${tagText}`;
}

export function makeInspirationStats(assets: InspirationAsset[]): InspirationStats {
  const sourceCounts = new Map<SourceType, number>();
  const sourceTierCounts = new Map<InspirationSourceTier, number>();
  const commercialSignalCounts = new Map<InspirationCommercialSignalLevel, number>();
  const detailTagCounts = new Map<string, number>();
  for (const asset of assets) {
    sourceCounts.set(asset.item.source, (sourceCounts.get(asset.item.source) || 0) + 1);
    sourceTierCounts.set(asset.sourceTier, (sourceTierCounts.get(asset.sourceTier) || 0) + 1);
    commercialSignalCounts.set(asset.commercialSignal.level, (commercialSignalCounts.get(asset.commercialSignal.level) || 0) + 1);
    for (const tag of asset.visualTags) detailTagCounts.set(tag, (detailTagCounts.get(tag) || 0) + 1);
  }

  const stats: InspirationStats = {
    total: assets.length,
    videos: assets.filter((asset) => asset.kind === "video").length,
    images: assets.filter((asset) => asset.kind === "image").length,
    weaponSkins: assets.filter((asset) => asset.category === "weapon_skin").length,
    characterSkins: assets.filter((asset) => asset.category === "character_skin").length,
    sourceBreakdown: Array.from(sourceCounts.entries())
      .sort((left, right) => sourceOrder.indexOf(left[0]) - sourceOrder.indexOf(right[0]))
      .map(([source, count]) => ({ source, count })),
    sourceTierBreakdown: Array.from(sourceTierCounts.entries())
      .map(([tier, count]) => ({ tier, label: sourceTierLabels[tier], count }))
      .sort((left, right) => right.count - left.count),
    commercialSignalBreakdown: Array.from(commercialSignalCounts.entries())
      .map(([level, count]) => ({ level, label: commercialSignalLabels[level], count }))
      .sort((left, right) => commercialSignalRank(left.level) - commercialSignalRank(right.level)),
    detailTagBreakdown: Array.from(detailTagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag, "zh-CN"))
      .slice(0, 8),
    gapInsights: []
  };
  return {
    ...stats,
    gapInsights: makeInspirationGapInsights(stats)
  };
}

function commercialSignalRank(level: InspirationCommercialSignalLevel) {
  if (level === "strong") return 0;
  if (level === "moderate") return 1;
  if (level === "weak") return 2;
  return 3;
}

function makeInspirationGapInsights(stats: InspirationStats): InspirationStats["gapInsights"] {
  const gaps: InspirationStats["gapInsights"] = [];
  const officialCount = stats.sourceTierBreakdown.find((entry) => entry.tier === "official")?.count || 0;
  const creatorVideoCount = stats.sourceTierBreakdown.find((entry) => entry.tier === "creator_video")?.count || 0;
  const derivedCount = stats.sourceTierBreakdown.find((entry) => entry.tier === "derived_reference")?.count || 0;
  const strongSignals = stats.commercialSignalBreakdown.find((entry) => entry.level === "strong")?.count || 0;
  const moderateSignals = stats.commercialSignalBreakdown.find((entry) => entry.level === "moderate")?.count || 0;
  const tagSet = new Set(stats.detailTagBreakdown.map((entry) => entry.tag));

  if (stats.total < 12) {
    gaps.push({
      id: "sample-size",
      priority: "high",
      title: "有效素材样本偏少",
      impact: "趋势判断容易被单个爆款或转载样本带偏。",
      actions: ["扩大窗口到30天", "增加强制刷新后再按热度排序", "优先补采商城礼包、检视动画、角色套装关键词"],
      keywords: ["皮肤展示", "bundle", "operator skin", "weapon inspect"]
    });
  }
  if (stats.weaponSkins < 6 || stats.characterSkins < 4) {
    gaps.push({
      id: "category-balance",
      priority: "high",
      title: "武器/角色分类覆盖不均",
      impact: "无法判断当前竞品到底在推枪械外观、角色套装还是综合礼包。",
      actions: ["按武器皮肤和角色皮肤分别采集", "补充近战武器、干员皮肤、通行证套装关键词", "检查未分类素材的细分标签"],
      keywords: ["武器皮肤", "近战皮肤", "角色皮肤", "通行证皮肤"]
    });
  }
  if (stats.sourceBreakdown.length <= 2 || officialCount === 0) {
    gaps.push({
      id: "source-coverage",
      priority: "high",
      title: "官方/海外来源不足",
      impact: "B站和贴吧能反映热度线索，但不能替代官方商城、赛季页和海外实录。",
      actions: ["补接游戏官网公告、商城页、Steam/Epic/主机商店页", "补采YouTube、Reddit、X/Twitter等海外实录", "把官方源作为高可信素材优先展示"],
      keywords: ["official store", "season pass", "YouTube showcase", "reddit skin"]
    });
  }
  if (strongSignals + moderateSignals < Math.min(4, Math.max(1, Math.ceil(stats.total * 0.35)))) {
    gaps.push({
      id: "commercial-signal",
      priority: "medium",
      title: "商业表现信号偏弱",
      impact: "只有视觉素材，缺少播放、互动、商城上架或限时礼包信号时，不适合判断商业吸引力。",
      actions: ["优先查看强/中商业信号素材", "补采带商城、礼包、限时、联名、通行证的内容", "对二创转载只作为视觉参考，不纳入商业判断"],
      keywords: ["商城", "礼包", "限时", "联名"]
    });
  }
  if (!tagSet.has("检视动画") || !tagSet.has("击杀特效")) {
    gaps.push({
      id: "motion-vfx",
      priority: "medium",
      title: "动态检视和特效素材不足",
      impact: "静态图能看造型，但不能判断第一人称观感、击杀反馈和特效包装强度。",
      actions: ["补采inspect、reload、kill effect、finisher关键词", "优先筛选视频素材", "把缩略图裂开或无视频的样本降权"],
      keywords: ["inspect", "reload", "kill effect", "finisher"]
    });
  }
  if (stats.total > 0 && derivedCount / stats.total > 0.35) {
    gaps.push({
      id: "derived-ratio",
      priority: "low",
      title: "二创/转载占比偏高",
      impact: "二创能提供方向灵感，但不能代表真实上架品质和玩家付费反馈。",
      actions: ["保留二创为灵感线索", "同款主题回查官方/实机展示", "商业判断只采用官方或实录视频"],
      keywords: ["官方展示", "实机展示", "store bundle"]
    });
  }
  if (creatorVideoCount === 0 && stats.total > 0) {
    gaps.push({
      id: "video-proof",
      priority: "medium",
      title: "缺少视频实录佐证",
      impact: "无法验证模型细节、动效节奏和第一人称遮挡。",
      actions: ["优先采集视频源", "补搜showcase、preview、inspect", "图片素材仅作为造型参考"],
      keywords: ["showcase", "preview", "inspect"]
    });
  }

  return gaps.slice(0, 5);
}
