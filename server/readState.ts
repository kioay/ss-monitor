import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Request } from "express";
import { runtimeConfig } from "./config";
import type { MonitorResponse, ReadMarker, ReadMarkResponse, SearchResponse } from "../src/shared";

interface ReadStateFile {
  version: 1;
  savedAt: string;
  items: Record<string, ReadMarker[]>;
}

const maxReadersPerItem = 50;
let stateLoaded = false;
let readState: ReadStateFile = { version: 1, savedAt: new Date(0).toISOString(), items: {} };
let saveQueue = Promise.resolve();

export async function markMonitorItemRead(itemId: string, userName: string, now = new Date()): Promise<ReadMarkResponse> {
  const normalizedItemId = normalizeItemId(itemId);
  if (!normalizedItemId) throw new Error("缺少舆情条目 id");

  await loadReadState();
  const viewerName = normalizeUserName(userName);
  const readAt = now.toISOString();
  const readBy = mergeReadMarker(readState.items[normalizedItemId] || [], { userName: viewerName, readAt });
  readState = {
    version: 1,
    savedAt: readAt,
    items: {
      ...readState.items,
      [normalizedItemId]: readBy
    }
  };
  await queueSaveReadState();
  return { itemId: normalizedItemId, viewerName, readAt, readBy };
}

export async function applyReadMarksToMonitorResponse(response: MonitorResponse): Promise<MonitorResponse> {
  await loadReadState();
  return applyReadMarksToMonitorResponseData(response, readState.items);
}

export async function applyReadMarksToSearchResponse(response: SearchResponse): Promise<SearchResponse> {
  await loadReadState();
  return {
    ...response,
    items: response.items.map((result) => ({
      ...result,
      item: applyReadMarksToRecord(result.item, readState.items)
    }))
  };
}

export function applyReadMarksToMonitorResponseData(
  response: MonitorResponse,
  readMarksByItem: Record<string, ReadMarker[]>
): MonitorResponse {
  return {
    ...response,
    alerts: response.alerts.map((alert) => applyReadMarksToRecord(alert, readMarksByItem)),
    items: response.items.map((item) => applyReadMarksToRecord(item, readMarksByItem))
  };
}

export function mergeReadMarker(readBy: ReadMarker[], marker: ReadMarker): ReadMarker[] {
  const nextUserName = normalizeUserName(marker.userName);
  const nextKey = userKey(nextUserName);
  const nextReadAt = normalizeIsoDate(marker.readAt) || new Date().toISOString();
  return [
    { userName: nextUserName, readAt: nextReadAt },
    ...readBy
      .filter(isReadMarkerLike)
      .filter((entry) => userKey(entry.userName) !== nextKey)
  ]
    .sort((left, right) => dateMs(right.readAt) - dateMs(left.readAt))
    .slice(0, maxReadersPerItem);
}

export function viewerNameFromRequest(request: Request) {
  const forwardedUser = [
    "x-forwarded-user",
    "x-authenticated-user",
    "x-remote-user",
    "remote-user"
  ]
    .map((header) => request.get(header) || "")
    .map(firstHeaderValue)
    .find(Boolean);
  if (forwardedUser) return normalizeUserName(forwardedUser);

  return normalizeUserName(
    process.env.USERNAME ||
    process.env.USER ||
    safeOsUserName() ||
    request.socket.remoteAddress ||
    "unknown-user"
  );
}

function applyReadMarksToRecord<T extends { id: string; readBy?: ReadMarker[] }>(
  value: T,
  readMarksByItem: Record<string, ReadMarker[]>
): T {
  const readBy = readMarksByItem[value.id] || [];
  return { ...value, readBy };
}

async function loadReadState() {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    const raw = await fs.readFile(readStatePath(), "utf-8");
    const parsed = JSON.parse(raw) as ReadStateFile;
    readState = normalizeReadState(parsed);
  } catch {
    readState = { version: 1, savedAt: new Date(0).toISOString(), items: {} };
  }
}

function queueSaveReadState() {
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(async () => {
      const target = readStatePath();
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(`${target}.tmp`, `${JSON.stringify(readState, null, 2)}\n`, "utf-8");
      await fs.rename(`${target}.tmp`, target);
    })
    .catch((error) => {
      console.warn("Monitor read-state save failed", error instanceof Error ? error.message : error);
    });
  return saveQueue;
}

function normalizeReadState(value: ReadStateFile): ReadStateFile {
  const items: Record<string, ReadMarker[]> = {};
  if (value?.items && typeof value.items === "object" && !Array.isArray(value.items)) {
    for (const [rawItemId, rawMarkers] of Object.entries(value.items)) {
      const itemId = normalizeItemId(rawItemId);
      if (!itemId || !Array.isArray(rawMarkers)) continue;
      const readBy = rawMarkers.filter(isReadMarkerLike).map((marker) => ({
        userName: normalizeUserName(marker.userName),
        readAt: normalizeIsoDate(marker.readAt) || new Date(0).toISOString()
      }));
      if (readBy.length) items[itemId] = readBy.sort((left, right) => dateMs(right.readAt) - dateMs(left.readAt)).slice(0, maxReadersPerItem);
    }
  }
  return {
    version: 1,
    savedAt: normalizeIsoDate(value?.savedAt) || new Date(0).toISOString(),
    items
  };
}

function readStatePath() {
  return path.resolve(runtimeConfig.monitorReadStatePath);
}

function normalizeItemId(value: string) {
  return String(value || "").trim().slice(0, 500);
}

function normalizeUserName(value: string) {
  const normalized = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return normalized || "unknown-user";
}

function userKey(value: string) {
  return normalizeUserName(value).toLocaleLowerCase();
}

function isReadMarkerLike(value: unknown): value is ReadMarker {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const marker = value as ReadMarker;
  return Boolean(normalizeUserName(marker.userName) && normalizeIsoDate(marker.readAt));
}

function normalizeIsoDate(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function dateMs(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function firstHeaderValue(value: string) {
  return value.split(",")[0]?.trim() || "";
}

function safeOsUserName() {
  try {
    return os.userInfo().username;
  } catch {
    return "";
  }
}
