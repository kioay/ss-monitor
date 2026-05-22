import { z } from "zod";
import { collectBilibili } from "./collectors/bilibili";
import { collectDouyin } from "./collectors/douyin";
import { collectTieba } from "./collectors/tieba";
import { gameById, games, getUpdatePolicy, runtimeConfig } from "./config";
import type {
  AlertItem,
  GameConfig,
  GameId,
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
        : ["ss1", "ss2"]
    ),
  windowHours: z.coerce.number().int().min(1).max(24 * 30).default(runtimeConfig.defaultWindowHours),
  limit: z.coerce.number().int().min(1).max(300).default(120),
  force: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true")
});

type MonitorQuery = z.infer<typeof querySchema>;

const cache = new Map<string, { createdAt: number; response: MonitorResponse }>();

export function parseMonitorQuery(raw: unknown) {
  const query = querySchema.parse(raw);
  const selectedGames = query.games.map((id) => gameById.get(id as GameId)).filter((game): game is GameConfig => Boolean(game));
  return {
    ...query,
    selectedGames: selectedGames.length ? selectedGames : games
  };
}

export async function getMonitorResponse(rawQuery: unknown): Promise<MonitorResponse> {
  const query = parseMonitorQuery(rawQuery);
  const cacheKey = `${query.selectedGames.map((game) => game.id).join(",")}:${query.windowHours}:${query.limit}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();
  const currentPolicy = getUpdatePolicy(new Date(now), new Date(cached?.createdAt || now));
  if (!query.force && cached && now - cached.createdAt < currentPolicy.intervalSeconds * 1000) {
    return {
      ...cached.response,
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
  const { items, health } = await collectAll(query.selectedGames, cutoff);
  const freshItems = items
    .filter((item) => new Date(item.publishedAt) >= cutoff)
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
    .slice(0, query.limit);

  const response: MonitorResponse = {
    generatedAt: generatedAt.toISOString(),
    windowHours: query.windowHours,
    freshnessCutoff: cutoff.toISOString(),
    updatePolicy,
    cache: {
      hit: false,
      ageSeconds: 0,
      ttlSeconds: updatePolicy.intervalSeconds
    },
    stats: makeStats(freshItems),
    trends: makeTrends(freshItems, query.windowHours, cutoff, generatedAt),
    topicStats: makeTopicStats(freshItems),
    alerts: makeAlerts(freshItems),
    health,
    items: freshItems
  };

  cache.set(cacheKey, { createdAt: now, response });
  return response;
}

async function collectAll(selectedGames: GameConfig[], cutoff: Date) {
  const tasks = selectedGames.flatMap((game) => [
    { source: "bilibili" as const, game, run: () => collectBilibili(game, cutoff) },
    { source: "tieba" as const, game, run: () => collectTieba(game, cutoff) },
    { source: "douyin" as const, game, run: () => collectDouyin(game, cutoff) }
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
  return { items, health };
}

function sourceLabel(source: SourceType) {
  if (source === "bilibili") return "B站视频";
  if (source === "douyin") return "抖音视频";
  return "百度贴吧";
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
    freshestAt: items[0]?.publishedAt
  };
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

function makeAlerts(items: MonitorItem[]): AlertItem[] {
  return items
    .filter((item) => item.riskLevel !== "low")
    .sort((a, b) => {
      const riskDelta = riskRank(b.riskLevel) - riskRank(a.riskLevel);
      if (riskDelta) return riskDelta;
      return +new Date(b.publishedAt) - +new Date(a.publishedAt);
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
      publishedAt: item.publishedAt
    }));
}

function riskRank(level: MonitorItem["riskLevel"]) {
  return level === "high" ? 3 : level === "medium" ? 2 : 1;
}
