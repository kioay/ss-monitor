import fs from "node:fs/promises";
import path from "node:path";
import { analysisRulesVersion } from "./analyze";
import { runtimeConfig } from "./config";
import { isDouyinMonitorItemGameConsistent } from "./douyinGameRouting";
import type { GameId, MonitorItem } from "../src/shared";

interface MonitorHistoryFile {
  version: 1;
  savedAt: string;
  items: MonitorItem[];
}

interface HistoryMergeOptions {
  now: Date;
  retentionHours: number;
  maxItems: number;
}

let historyLoaded = false;
let historyItems: MonitorItem[] = [];
let saveQueue = Promise.resolve();

export async function mergeMonitorHistory(currentItems: MonitorItem[], gameIds: GameId[], now: Date) {
  try {
    await loadMonitorHistory();
    historyItems = mergeHistoryItems(historyItems, currentItems, {
      now,
      retentionHours: runtimeConfig.monitorHistoryRetentionHours,
      maxItems: runtimeConfig.monitorHistoryMaxItems
    });
    await queueSaveMonitorHistory(historyItems);
    return filterHistoryItems(historyItems, gameIds, now, runtimeConfig.monitorHistoryRetentionHours);
  } catch (error) {
    console.warn("Monitor history merge failed", error instanceof Error ? error.message : error);
    return currentItems;
  }
}

export async function readMonitorHistoryItems(gameIds: GameId[], now: Date, retentionHours: number) {
  await loadMonitorHistory();
  return filterHistoryItems(historyItems, gameIds, now, retentionHours);
}

export function mergeHistoryItems(existingItems: MonitorItem[], currentItems: MonitorItem[], options: HistoryMergeOptions) {
  const cutoffMs = options.now.getTime() - options.retentionHours * 3_600_000;
  const byId = new Map<string, MonitorItem>();

  for (const item of [...existingItems, ...currentItems]) {
    const publishedMs = publishedTime(item);
    if (publishedMs === undefined || publishedMs < cutoffMs) continue;
    if (!isDouyinMonitorItemGameConsistent(item)) continue;
    byId.set(historyKey(item), item);
  }

  return Array.from(byId.values())
    .sort((a, b) => (publishedTime(b) || 0) - (publishedTime(a) || 0))
    .slice(0, options.maxItems);
}

function filterHistoryItems(items: MonitorItem[], gameIds: GameId[], now: Date, retentionHours: number) {
  const cutoffMs = now.getTime() - retentionHours * 3_600_000;
  return items
    .filter((item) => gameIds.includes(item.gameId))
    .filter((item) => {
      const publishedMs = publishedTime(item);
      return publishedMs !== undefined && publishedMs >= cutoffMs;
    })
    .sort((a, b) => (publishedTime(b) || 0) - (publishedTime(a) || 0));
}

async function loadMonitorHistory() {
  if (historyLoaded) return;
  historyLoaded = true;
  try {
    const raw = await fs.readFile(historyPath(), "utf-8");
    const parsed = JSON.parse(raw) as MonitorHistoryFile;
    historyItems = Array.isArray(parsed.items) ? parsed.items.filter(isMonitorItemLike).filter(hasCurrentAnalysisVersion) : [];
  } catch {
    historyItems = [];
  }
}

function queueSaveMonitorHistory(items: MonitorItem[]) {
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(async () => {
      const target = historyPath();
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(
        target,
        `${JSON.stringify(
          {
            version: 1,
            savedAt: new Date().toISOString(),
            items
          } satisfies MonitorHistoryFile,
          null,
          2
        )}\n`,
        "utf-8"
      );
    })
    .catch((error) => {
      console.warn("Monitor history save failed", error instanceof Error ? error.message : error);
    });
  return saveQueue;
}

function historyPath() {
  return path.resolve(runtimeConfig.monitorHistoryPath);
}

function historyKey(item: MonitorItem) {
  return item.id || `${item.source}:${item.gameId}:${item.sourceItemId}`;
}

function publishedTime(item: MonitorItem) {
  const value = new Date(item.publishedAt).getTime();
  return Number.isFinite(value) ? value : undefined;
}

function isMonitorItemLike(value: unknown): value is MonitorItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as MonitorItem;
  return Boolean(item.id && item.gameId && item.source && item.publishedAt);
}

function hasCurrentAnalysisVersion(item: MonitorItem) {
  return item.analysisVersion === analysisRulesVersion;
}
