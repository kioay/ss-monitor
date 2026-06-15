import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { collectBilibili } from "./collectors/bilibili";
import { collectBettaFish } from "./collectors/bettafish";
import { collectDouyin } from "./collectors/douyin";
import { collectTieba } from "./collectors/tieba";
import { gameById, games, getUpdatePolicy, runtimeConfig } from "./config";
import { analysisRulesVersion } from "./analyze";
import { refineItemsWithBettaFishSemantic } from "./bettafishSemantic";
import { refreshCurrentVersionFocus } from "./currentVersion";
import { mergeMonitorHistory } from "./monitorHistory";
import { ensureRiskBacktest } from "./riskBacktest";
import type {
  AlertItem,
  BettaFishPanelCapability,
  GameConfig,
  GameId,
  KeywordEffectiveness,
  MonitorItem,
  MonitorResponse,
  MonitorStats,
  SourceHealth,
  SourceType,
  TopicStat,
  TrendPoint
} from "../src/shared";

const querySchema = z.object({
  games: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : games.map((game) => game.id)
    ),
  windowHours: z.coerce.number().int().min(1).max(24 * 30).default(runtimeConfig.defaultWindowHours),
  limit: z.coerce.number().int().min(1).max(1000).default(300),
  extraKeywords: z
    .string()
    .optional()
    .transform((value) => parseSupplementalKeywords(value || "")),
  force: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
  notify: z
    .string()
    .optional()
    .transform((value) => value !== "0" && value !== "false")
});

type MonitorQuery = z.infer<typeof querySchema>;
type CollectionEntry = {
  createdAt: number;
  items: MonitorItem[];
  health: SourceHealth[];
  gameIds: GameId[];
  analysisVersion?: number;
  extraKeywords?: string[];
};
interface CollectionSnapshotFile {
  version: 1;
  entries: CollectionEntry[];
}

const cache = new Map<string, { createdAt: number; response: MonitorResponse }>();
const collectionCache = new Map<string, CollectionEntry>();
const collectionInFlight = new Map<string, Promise<CollectionEntry>>();
const backgroundSnapshotRefreshes = new Set<string>();
const collectionWindowHours = 24 * 30;
const snapshotMaxAgeMs = 12 * 3_600_000;
let snapshotLoaded = false;

export function parseMonitorQuery(raw: unknown) {
  const query = querySchema.parse(raw);
  const selectedGames = query.games.map((id) => gameById.get(id as GameId)).filter((game): game is GameConfig => Boolean(game));
  const baseGames = selectedGames.length ? selectedGames : games;
  return {
    ...query,
    selectedGames: query.extraKeywords.length ? withSupplementalKeywords(baseGames, query.extraKeywords) : baseGames
  };
}

function parseSupplementalKeywords(raw: string) {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const value of raw.split(/[\s,;|\uFF0C\u3001\uFF1B]+/)) {
    const keyword = value.trim();
    const normalized = normalizeKeywordScope(keyword);
    if (!keyword || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    keywords.push(keyword.slice(0, 40));
    if (keywords.length >= 20) break;
  }
  return keywords;
}

function withSupplementalKeywords(selectedGames: GameConfig[], extraKeywords: string[]): GameConfig[] {
  return selectedGames.map((game) => ({
    ...game,
    bilibiliKeywords: mergeKeywordLists(game.bilibiliKeywords, extraKeywords),
    douyinKeywords: mergeKeywordLists(game.douyinKeywords, extraKeywords)
  }));
}

function mergeKeywordLists(baseKeywords: string[], extraKeywords: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const keyword of [...baseKeywords, ...extraKeywords]) {
    const normalized = normalizeKeywordScope(keyword);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(keyword);
  }
  return merged;
}

export async function getMonitorResponse(rawQuery: unknown): Promise<MonitorResponse> {
  const query = parseMonitorQuery(rawQuery);
  const gameIds = query.selectedGames.map((game) => game.id);
  const cacheKey = `${gameIds.join(",")}:${query.windowHours}:${query.limit}:${keywordScopeKey(query.extraKeywords)}`;
  const riskBacktest = await ensureRiskBacktest();
  const cached = cache.get(cacheKey);
  const now = Date.now();
  const currentPolicy = getUpdatePolicy(new Date(now), new Date(cached?.createdAt || now));
  if (!query.force && cached && now - cached.createdAt < currentPolicy.intervalSeconds * 1000) {
    return {
      ...cached.response,
      riskBacktest,
      updatePolicy: currentPolicy,
      cache: {
        hit: true,
        ageSeconds: Math.round((now - cached.createdAt) / 1000),
        ttlSeconds: currentPolicy.intervalSeconds
      }
    };
  }

  const generatedAt = new Date();
  const updatePolicy = getUpdatePolicy(generatedAt, generatedAt);
  const cutoff = new Date(generatedAt.getTime() - query.windowHours * 3_600_000);
  const collection = await getCollection(query.selectedGames, query.force, generatedAt, query.extraKeywords);
  const collectionAgeSeconds = Math.max(0, Math.round((generatedAt.getTime() - collection.createdAt) / 1000));
  const collectionIsStale = collectionAgeSeconds > updatePolicy.intervalSeconds;
  const responseUpdatePolicy = collectionIsStale
    ? { ...updatePolicy, nextUpdateAt: new Date(generatedAt.getTime() + 60_000).toISOString() }
    : updatePolicy;
  const windowItems = collection.items
    .filter((item) => gameIds.includes(item.gameId))
    .filter((item) => new Date(item.publishedAt) >= cutoff)
    .map(normalizeMonitorItemLabel)
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
  const freshItems = windowItems.slice(0, query.limit);
  const responseHealth = collection.health
    .filter((entry) => !entry.gameId || gameIds.includes(entry.gameId))
    .map(normalizeHealthLabel);

  const response: MonitorResponse = {
    generatedAt: generatedAt.toISOString(),
    windowHours: query.windowHours,
    freshnessCutoff: cutoff.toISOString(),
    analysisVersion: analysisRulesVersion,
    riskBacktest,
    updatePolicy: responseUpdatePolicy,
    cache: {
      hit: collectionIsStale,
      ageSeconds: collectionAgeSeconds,
      ttlSeconds: updatePolicy.intervalSeconds
    },
    stats: makeStats(windowItems),
    trends: makeTrends(windowItems, query.windowHours, cutoff, generatedAt),
    topicStats: makeTopicStats(windowItems),
    alerts: makeAlerts(windowItems, cutoff),
    health: responseHealth,
    keywordEffectiveness: makeKeywordEffectiveness(windowItems, query.extraKeywords),
    bettafishCapabilities: makeBettaFishPanelCapabilities(windowItems, responseHealth),
    items: freshItems
  };

  if (!collectionIsStale) cache.set(cacheKey, { createdAt: now, response });
  return response;
}

async function getCollection(selectedGames: GameConfig[], force: boolean, generatedAt: Date, extraKeywords: string[]) {
  const gameIds = selectedGames.map((game) => game.id);
  const exactKey = collectionKey(gameIds, extraKeywords);
  const now = generatedAt.getTime();
  const reusable = force ? undefined : findReusableCollection(gameIds, generatedAt, extraKeywords);
  if (reusable) return reusable;

  const inFlight = collectionInFlight.get(exactKey);
  if (!force && inFlight) return inFlight;

  if (!force) {
    const snapshot = await findReusableSnapshotCollection(gameIds, generatedAt, extraKeywords);
    if (snapshot) {
      collectionCache.set(exactKey, snapshot);
      refreshSnapshotInBackground(selectedGames, exactKey, generatedAt, extraKeywords);
      return snapshot;
    }
  }

  const task = collectAll(selectedGames, new Date(now - collectionWindowHours * 3_600_000)).then(async (collection) => {
    const items = await mergeMonitorHistory(collection.items, gameIds, generatedAt);
    const entry = { createdAt: now, gameIds, items, health: collection.health, analysisVersion: analysisRulesVersion, extraKeywords };
    collectionCache.set(exactKey, entry);
    void saveCollectionSnapshot();
    return entry;
  }).finally(() => {
    if (collectionInFlight.get(exactKey) === task) collectionInFlight.delete(exactKey);
  });

  collectionInFlight.set(exactKey, task);
  return task;
}

function findReusableCollection(gameIds: GameId[], now: Date, extraKeywords: string[]) {
  const exact = collectionCache.get(collectionKey(gameIds, extraKeywords));
  if (exact && isFreshCollection(exact, now) && containsAllGames(exact.gameIds, gameIds)) return exact;

  for (const entry of collectionCache.values()) {
    if (sameKeywordScope(entry.extraKeywords, extraKeywords) && isFreshCollection(entry, now) && containsAllGames(entry.gameIds, gameIds)) return entry;
  }
  return undefined;
}

async function findReusableSnapshotCollection(gameIds: GameId[], now: Date, extraKeywords: string[]) {
  await loadCollectionSnapshot();
  const exact = collectionCache.get(collectionKey(gameIds, extraKeywords));
  if (exact && isUsableSnapshot(exact, now) && containsAllGames(exact.gameIds, gameIds)) return collectionEntryWithHistory(exact, gameIds, now);

  const freshEntries = Array.from(collectionCache.values()).filter((entry) =>
    sameKeywordScope(entry.extraKeywords, extraKeywords) && isUsableSnapshot(entry, now)
  );
  const covered = new Set<GameId>();
  const selectedEntries: CollectionEntry[] = [];
  for (const gameId of gameIds) {
    const entry = freshEntries
      .filter((candidate) => candidate.gameIds.includes(gameId))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!entry) return undefined;
    covered.add(gameId);
    if (!selectedEntries.includes(entry)) selectedEntries.push(entry);
  }
  if (!gameIds.every((gameId) => covered.has(gameId))) return undefined;

  return collectionEntryWithHistory(mergeCollectionEntries(gameIds, selectedEntries), gameIds, now);
}

async function collectionEntryWithHistory(entry: CollectionEntry, gameIds: GameId[], now: Date): Promise<CollectionEntry> {
  const items = await mergeMonitorHistory(entry.items, gameIds, now);
  return { ...entry, gameIds, items, analysisVersion: analysisRulesVersion };
}

function isFreshCollection(
  entry: CollectionEntry | undefined,
  now: Date
) {
  if (!entry) return false;
  if (entry.analysisVersion !== analysisRulesVersion) return false;
  const policy = getUpdatePolicy(now, new Date(entry.createdAt));
  return now.getTime() - entry.createdAt < policy.intervalSeconds * 1000;
}

function isUsableSnapshot(entry: CollectionEntry, now: Date) {
  return entry.analysisVersion === analysisRulesVersion && now.getTime() - entry.createdAt < snapshotMaxAgeMs;
}

function mergeCollectionEntries(gameIds: GameId[], entries: CollectionEntry[]): CollectionEntry {
  const seenItems = new Set<string>();
  const items: MonitorItem[] = [];
  const health: SourceHealth[] = [];
  for (const entry of entries.sort((a, b) => b.createdAt - a.createdAt)) {
    for (const item of entry.items) {
      if (!gameIds.includes(item.gameId) || seenItems.has(item.id)) continue;
      seenItems.add(item.id);
      items.push(item);
    }
    health.push(...entry.health.filter((healthEntry) => !healthEntry.gameId || gameIds.includes(healthEntry.gameId)));
  }
  return {
    createdAt: Math.max(...entries.map((entry) => entry.createdAt)),
    gameIds,
    items,
    health,
    analysisVersion: analysisRulesVersion,
    extraKeywords: entries[0]?.extraKeywords || []
  };
}

function refreshSnapshotInBackground(selectedGames: GameConfig[], exactKey: string, generatedAt: Date, extraKeywords: string[]) {
  if (backgroundSnapshotRefreshes.has(exactKey)) return;
  backgroundSnapshotRefreshes.add(exactKey);
  void getCollection(selectedGames, true, generatedAt, extraKeywords).catch((error) => {
    console.error("Background snapshot refresh failed", error);
  }).finally(() => {
    backgroundSnapshotRefreshes.delete(exactKey);
  });
}

function containsAllGames(sourceIds: GameId[], targetIds: GameId[]) {
  return targetIds.every((id) => sourceIds.includes(id));
}

function collectionKey(gameIds: GameId[], extraKeywords: string[] = []) {
  return `${[...gameIds].sort().join(",")}|${keywordScopeKey(extraKeywords)}`;
}

function keywordScopeKey(extraKeywords: string[] = []) {
  const normalized = extraKeywords.map(normalizeKeywordScope).filter(Boolean).sort();
  return normalized.length ? normalized.join(",") : "base";
}

function sameKeywordScope(left: string[] = [], right: string[] = []) {
  return keywordScopeKey(left) === keywordScopeKey(right);
}

function normalizeKeywordScope(keyword: string) {
  return keyword.trim().toLowerCase();
}

async function loadCollectionSnapshot() {
  if (snapshotLoaded) return;
  snapshotLoaded = true;
  try {
    const raw = await fs.readFile(snapshotPath(), "utf-8");
    const snapshot = JSON.parse(raw) as CollectionSnapshotFile;
    for (const entry of snapshot.entries || []) {
      if (!entry?.gameIds?.length) continue;
      if (entry.analysisVersion !== analysisRulesVersion) continue;
      collectionCache.set(collectionKey(entry.gameIds, entry.extraKeywords || []), entry);
    }
  } catch {
    // Snapshot cache is an optional startup accelerator.
  }
}

async function saveCollectionSnapshot() {
  try {
    const entries = Array.from(collectionCache.values())
      .filter((entry) => Date.now() - entry.createdAt < snapshotMaxAgeMs)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8);
    const target = snapshotPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify({ version: 1, entries }, null, 2));
  } catch (error) {
    console.warn("Monitor snapshot save failed", error instanceof Error ? error.message : error);
  }
}

function snapshotPath() {
  return path.resolve(runtimeConfig.monitorSnapshotPath);
}

async function collectAll(selectedGames: GameConfig[], cutoff: Date) {
  await refreshCurrentVersionFocus();
  const tasks = selectedGames.flatMap((game) => [
    { source: "bilibili" as const, game, run: () => collectBilibili(game, cutoff) },
    { source: "tieba" as const, game, run: () => collectTieba(game, cutoff) },
    { source: "douyin" as const, game, run: () => collectDouyin(game, cutoff) },
    { source: "bettafish" as const, game, run: () => collectBettaFish(game, cutoff) }
  ]);
  const results = await Promise.allSettled(tasks.map((task) => task.run()));

  const items: MonitorItem[] = [];
  const health: SourceHealth[] = [];
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      items.push(...result.value.items);
      health.push(result.value.health);
    } else {
      const task = tasks[index];
      health.push({
        source: task.source,
        sourceLabel: sourceLabel(task.source),
        gameId: task.game.id,
        ok: false,
        fetchedAt: new Date().toISOString(),
        latencyMs: 0,
        itemCount: 0,
        staleDropped: 0,
        message: result.reason instanceof Error ? result.reason.message : String(result.reason)
      });
    }
  }
  const refinedItems = await refineItemsWithBettaFishSemantic(items);
  return { items: refinedItems, health };
}

function sourceLabel(source: SourceType) {
  if (source === "bilibili") return "B站视频";
  if (source === "douyin") return "抖音视频";
  if (source === "bettafish") return "BettaFish导入";
  return "百度贴吧";
}

function normalizeMonitorItemLabel(item: MonitorItem): MonitorItem {
  const label = sourceLabel(item.source);
  return item.sourceLabel === label ? item : { ...item, sourceLabel: label };
}

function normalizeHealthLabel(entry: SourceHealth): SourceHealth {
  const label = sourceLabel(entry.source);
  return entry.sourceLabel === label ? entry : { ...entry, sourceLabel: label };
}

function makeStats(items: MonitorItem[]): MonitorStats {
  const negative = items.filter((item) => item.sentiment === "negative").length;
  return {
    total: items.length,
    highRisk: items.filter((item) => item.riskLevel === "high").length,
    mediumRisk: items.filter((item) => item.riskLevel === "medium").length,
    negativeRate: items.length ? Number((negative / items.length).toFixed(3)) : 0,
    bilibili: items.filter((item) => item.source === "bilibili").length,
    tieba: items.filter((item) => item.source === "tieba").length,
    douyin: items.filter((item) => item.source === "douyin").length,
    bettafish: items.filter((item) => item.source === "bettafish").length,
    freshestAt: items[0]?.publishedAt
  };
}

export function makeKeywordEffectiveness(items: MonitorItem[], keywords: string[]): KeywordEffectiveness[] {
  return keywords.map((keyword) => {
    const normalizedKeyword = normalizeKeywordScope(keyword);
    const matchedItems = items.filter((item) => monitorItemSearchText(item).includes(normalizedKeyword));
    const latest = matchedItems
      .map((item) => new Date(item.publishedAt))
      .filter((date) => Number.isFinite(date.getTime()))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    const sources = Array.from(new Set(matchedItems.map((item) => item.source))).sort(sourceSort);
    return {
      keyword,
      status: keywordStatus(matchedItems.length),
      matchedItems: matchedItems.length,
      highRisk: matchedItems.filter((item) => item.riskLevel === "high").length,
      mediumRisk: matchedItems.filter((item) => item.riskLevel === "medium").length,
      sources,
      latestAt: latest?.toISOString(),
      sampleTitles: matchedItems.slice(0, 3).map((item) => item.title)
    };
  });
}

function monitorItemSearchText(item: MonitorItem) {
  return [
    item.title,
    item.summary,
    item.author,
    item.keywords.join(" "),
    item.topics.join(" "),
    item.riskReasons.join(" "),
    ...item.contentParts.map((part) => part.text)
  ].join("\n").toLowerCase();
}

function keywordStatus(matchedItems: number): KeywordEffectiveness["status"] {
  if (matchedItems >= 3) return "effective";
  if (matchedItems > 0) return "weak";
  return "no_match";
}

function sourceSort(left: SourceType, right: SourceType) {
  const order: SourceType[] = ["bilibili", "tieba", "douyin", "bettafish"];
  return order.indexOf(left) - order.indexOf(right);
}

function makeBettaFishPanelCapabilities(items: MonitorItem[], health: SourceHealth[]): BettaFishPanelCapability[] {
  const capabilities: BettaFishPanelCapability[] = [];
  const bettaFishItems = items.filter((item) => item.source === "bettafish");
  const bettaFishHealth = health.filter((entry) => entry.source === "bettafish");

  if (bettaFishItems.length > 0) {
    const gamesCovered = new Set(bettaFishItems.map((item) => item.gameName || item.gameId)).size;
    const latest = bettaFishItems[0]?.publishedAt ? formatDateTimeShort(bettaFishItems[0].publishedAt) : "";
    capabilities.push({
      id: "import",
      label: "授权导入",
      value: `${bettaFishItems.length} 条`,
      description: `BettaFish 导入条目已进入总声量、趋势、主题、预警和列表。`,
      evidence: [
        `覆盖 ${gamesCovered} 个项目${latest ? `，最新 ${latest}` : ""}`,
        ...bettaFishHealth
          .filter((entry) => entry.itemCount > 0)
          .slice(0, 2)
          .map((entry) => `${entry.gameId?.toUpperCase() || "ALL"} ${entry.itemCount} 条`)
      ]
    });
  }

  const semanticItems = items.filter(hasBettaFishSemanticEffect);
  if (semanticItems.length > 0) {
    const confirmCount = semanticItems.filter((item) => item.riskReasons.some((reason) => reason.includes("辅助确认负面"))).length;
    const denoiseCount = semanticItems.filter((item) => item.riskReasons.some((reason) => reason.includes("辅助降噪"))).length;
    const affectedRisk = semanticItems.filter((item) => item.riskReasons.some((reason) => reason.includes("BettaFish"))).length;
    capabilities.push({
      id: "semantic",
      label: "语义辅助判定",
      value: `${semanticItems.length} 条`,
      description: "BettaFish 模型结果已写入主面板条目的摘要、情绪或风险原因。",
      evidence: [
        affectedRisk ? `影响风险原因 ${affectedRisk} 条` : "仅影响摘要/情绪判断",
        confirmCount ? `确认负面 ${confirmCount} 条` : "",
        denoiseCount ? `辅助降噪 ${denoiseCount} 条` : "",
        ...semanticItems.slice(0, 2).map((item) => compactCapabilityTitle(item.title))
      ].filter(Boolean)
    });
  }

  const reachableStatus = bettaFishHealth.filter((entry) =>
    entry.ok && /reachable|status endpoint/i.test(entry.message)
  );
  if (reachableStatus.length > 0) {
    capabilities.push({
      id: "status",
      label: "运行状态探针",
      value: `${reachableStatus.length} 项`,
      description: "主面板健康区已接入 BettaFish 状态接口，用于确认外部系统可达。",
      evidence: reachableStatus
        .slice(0, 3)
        .map((entry) => `${entry.gameId?.toUpperCase() || "ALL"} 可达`)
    });
  }

  return capabilities;
}

function hasBettaFishSemanticEffect(item: MonitorItem) {
  return item.summary.includes("BettaFish模型") || item.riskReasons.some((reason) => reason.includes("BettaFish"));
}

function compactCapabilityTitle(title: string) {
  const compact = title.replace(/\s+/g, " ").trim();
  return compact.length > 28 ? `${compact.slice(0, 27)}…` : compact;
}

function formatDateTimeShort(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

function makeTrends(items: MonitorItem[], windowHours: number, cutoff: Date, generatedAt: Date): TrendPoint[] {
  const buckets = new Map<string, TrendPoint & { order: number }>();
  const useHourly = windowHours <= 96;

  if (!useHourly) {
    const start = startOfDay(cutoff);
    const end = startOfDay(generatedAt);
    for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 86_400_000) {
      const date = new Date(cursor);
      const bucket = formatDayBucket(date);
      buckets.set(bucket, createTrendPoint(bucket, cursor));
    }
  }

  for (const item of items) {
    const date = new Date(item.publishedAt);
    const order = useHourly ? startOfHour(date).getTime() : startOfDay(date).getTime();
    const bucket = useHourly ? formatHourBucket(date) : formatDayBucket(date);
    const point = buckets.get(bucket) || createTrendPoint(bucket, order);
    point.total += 1;
    if (item.sentiment === "positive") point.positive += 1;
    else if (item.sentiment === "negative") point.negative += 1;
    else point.neutral += 1;
    if (item.riskLevel === "high") point.highRisk += 1;
    buckets.set(bucket, point);
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...point }) => point);
}

function createTrendPoint(bucket: string, order: number): TrendPoint & { order: number } {
  return {
    bucket,
    order,
    total: 0,
    positive: 0,
    neutral: 0,
    negative: 0,
    highRisk: 0
  };
}

function startOfHour(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatHourBucket(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:00`;
}

function formatDayBucket(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function makeTopicStats(items: MonitorItem[]): TopicStat[] {
  const stats = new Map<string, TopicStat>();
  for (const item of items) {
    for (const topic of item.topics) {
      const stat = stats.get(topic) || { topic, count: 0, negative: 0, risk: 0 };
      stat.count += 1;
      if (item.sentiment === "negative") stat.negative += 1;
      if (item.riskLevel !== "low") stat.risk += 1;
      stats.set(topic, stat);
    }
  }
  return Array.from(stats.values())
    .sort((a, b) => b.count - a.count || b.risk - a.risk)
    .slice(0, 10);
}

export function makeAlerts(items: MonitorItem[], freshnessCutoff?: Date): AlertItem[] {
  return items
    .filter((item) => isRiskAlertCandidate(item, freshnessCutoff))
    .sort((a, b) => {
      const riskDelta = riskRank(b.riskLevel) - riskRank(a.riskLevel);
      if (riskDelta) return riskDelta;
      return riskAlertTime(b) - riskAlertTime(a);
    })
    .slice(0, 12)
    .map((item) => ({
      id: item.id,
      title: item.title,
      source: item.source,
      gameName: item.gameName,
      riskLevel: item.riskLevel,
      reasons: item.riskReasons,
      url: item.url,
      publishedAt: item.riskSignalAt || item.publishedAt,
      riskSignalSource: item.riskSignalSource
    }));
}

function isRiskAlertCandidate(item: MonitorItem, freshnessCutoff?: Date) {
  if (item.riskLevel === "low") return false;
  if (freshnessCutoff && item.riskSignalAt && new Date(item.riskSignalAt) < freshnessCutoff) return false;
  return item.riskSignalSource !== "stale_thread" || item.riskLevel === "high";
}

function riskAlertTime(item: MonitorItem) {
  return +new Date(item.riskSignalAt || item.publishedAt);
}

function riskRank(level: MonitorItem["riskLevel"]) {
  return level === "high" ? 3 : level === "medium" ? 2 : 1;
}
