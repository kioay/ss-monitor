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
  type InspirationSort,
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
