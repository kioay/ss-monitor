import type {
  InspirationAsset,
  InspirationAssetKind,
  InspirationCategory,
  InspirationSort,
  InspirationStats,
  MonitorItem,
  SourceType
} from "./shared";

export type InspirationCategoryFilter = "all" | InspirationCategory;
export type InspirationKindFilter = "all" | InspirationAssetKind;

const sourceOrder: SourceType[] = ["bilibili", "douyin", "tieba", "forum4399", "bettafish"];

export function filterInspirationAssets(
  assets: InspirationAsset[],
  options: {
    query?: string;
    category?: InspirationCategoryFilter;
    kind?: InspirationKindFilter;
    sort?: InspirationSort;
    limit?: number;
  }
) {
  const queryTerms = normalizeQueryTerms(options.query || "");
  const category = options.category || "all";
  const kind = options.kind || "all";
  const sort = options.sort || "relevance";
  const filtered = assets
    .filter((asset) => category === "all" || asset.category === category)
    .filter((asset) => kind === "all" || asset.kind === kind)
    .filter((asset) => !queryTerms.length || assetMatchesQuery(asset, queryTerms))
    .sort((left, right) => compareInspirationAssets(left, right, sort));
  return typeof options.limit === "number" ? filtered.slice(0, options.limit) : filtered;
}

export function makeFilteredInspirationStats(assets: InspirationAsset[]): InspirationStats {
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

function assetMatchesQuery(asset: InspirationAsset, terms: string[]) {
  const text = normalizeText([
    asset.item.title,
    asset.item.summary,
    asset.item.author,
    asset.item.keywords.join(" "),
    asset.item.topics.join(" "),
    asset.reason,
    asset.matchedSeeds.join(" "),
    asset.visualTags.join(" "),
    ...asset.item.contentParts.map((part) => part.text)
  ].join("\n"));
  const compact = text.replace(/\s+/g, "");
  return terms.every((term) => text.includes(term) || compact.includes(term.replace(/\s+/g, "")));
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

function normalizeQueryTerms(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return Array.from(new Set(normalized.split(/[\s,;|\uFF0C\u3001\uFF1B]+/).map((term) => term.trim()).filter(Boolean))).slice(0, 8);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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
