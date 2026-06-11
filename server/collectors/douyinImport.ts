import fs from "node:fs/promises";
import path from "node:path";
import { analyzeItem } from "../analyze";
import { runtimeConfig } from "../config";
import { douyinTextMatchesGame, inferDouyinGameId } from "../douyinGameRouting";
import { hoursBetween, md5, normalizeUrl, stripHtml, uniq } from "../utils";
import type { ContentPart, GameConfig, MonitorItem } from "../../src/shared";

export type ImportedRow = Record<string, unknown>;

export interface ImportParseResult {
  items: MonitorItem[];
  staleDropped: number;
  errors: string[];
  fileCount: number;
  rowCount: number;
}

const textPartTypes = new Set<ContentPart["type"]>([
  "title",
  "description",
  "tag",
  "comment",
  "danmaku",
  "subtitle",
  "post"
]);

export async function collectImportedDouyinItems(game: GameConfig, cutoff: Date): Promise<ImportParseResult> {
  const files = await listImportFiles(runtimeConfig.douyinImportDir);
  const allRows: Array<{ row: ImportedRow; label: string }> = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const rows = await readImportRows(file);
      allRows.push(...rows.map((row) => ({ row, label: path.basename(file) })));
    } catch (error) {
      errors.push(`${path.basename(file)}: ${messageOf(error)}`);
    }
  }

  const parsed = rowsToDouyinMonitorItems(game, cutoff, allRows, { sourceLabel: "Douyin import" });
  errors.push(...parsed.errors);

  return {
    ...parsed,
    items: parsed.items.slice(0, runtimeConfig.maxDouyinImportedItemsPerGame),
    errors,
    fileCount: files.length,
    rowCount: allRows.length
  };
}

export function rowsToDouyinMonitorItems(
  game: GameConfig,
  cutoff: Date,
  rows: Array<ImportedRow | { row: ImportedRow; label?: string }>,
  options: { sourceLabel?: string } = {}
): ImportParseResult {
  const items: MonitorItem[] = [];
  const errors: string[] = [];
  let staleDropped = 0;

  for (const [index, rowEntry] of rows.entries()) {
    const row = isLabeledRow(rowEntry) ? rowEntry.row : rowEntry;
    const label = isLabeledRow(rowEntry) ? rowEntry.label : undefined;
    try {
      const item = buildImportedDouyinItem(game, row, options.sourceLabel);
      if (!item) continue;
      if (new Date(item.publishedAt) < cutoff) {
        staleDropped += 1;
        continue;
      }
      items.push(item);
    } catch (error) {
      errors.push(`${label || "row"} ${index + 1}: ${messageOf(error)}`);
    }
  }

  return {
    items: dedupeItems(items).sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)),
    staleDropped,
    errors,
    fileCount: 0,
    rowCount: rows.length
  };
}

function buildImportedDouyinItem(game: GameConfig, row: ImportedRow, sourceLabel = "Douyin import"): MonitorItem | undefined {
  if (!belongsToGame(row, game)) return undefined;

  const url = normalizeDouyinImportUrl(stringValue(row, [
    "url",
    "link",
    "shareUrl",
    "share_url",
    "videoUrl",
    "video_url",
    "awemeUrl",
    "aweme_url",
    "noteUrl",
    "note_url"
  ]));
  const sourceItemId =
    stringValue(row, ["sourceItemId", "source_item_id", "awemeId", "aweme_id", "videoId", "video_id", "noteId", "note_id", "id"]) ||
    extractDouyinId(url) ||
    md5(`${url}|${stringValue(row, ["title", "caption", "desc", "description"])}`).slice(0, 16);
  if (!sourceItemId) return undefined;

  const title =
    stripHtml(stringValue(row, ["title", "caption", "desc", "description", "text", "content"])) ||
    "Douyin authorized import";
  const description = stripHtml(stringValue(row, ["description", "desc", "caption", "text", "content"]));
  const author = stripHtml(stringValue(row, ["author", "nickname", "user", "username", "creator"])) || "Authorized Douyin export";
  const publishedAt = parseDateValue(valueOf(row, ["publishedAt", "published_at", "createTime", "create_time", "createdAt", "created_at", "time", "date"])) || new Date();
  const collectedAt = parseDateValue(valueOf(row, ["collectedAt", "collected_at", "importedAt", "imported_at"])) || new Date();
  const tags = arrayValue(row, ["tags", "tag", "hashtags", "hashtag", "sourceKeyword", "source_keyword"]);
  const comments = arrayValue(row, ["comments", "comment", "topComments", "top_comments", "commentText", "comment_text"]);
  const danmaku = arrayValue(row, ["danmaku", "bulletComments", "bullet_comments"]);
  const subtitles = arrayValue(row, ["subtitles", "subtitle", "transcript"]);

  const contentParts: ContentPart[] = [{ type: "title", text: title, count: 1 }];
  if (description && description !== title) contentParts.push({ type: "description", text: description, count: 1 });
  if (tags.length) contentParts.push({ type: "tag", text: tags.join(" "), count: tags.length });
  for (const text of comments.slice(0, 80)) contentParts.push({ type: "comment", text, count: 1 });
  if (danmaku.length) contentParts.push({ type: "danmaku", text: danmaku.slice(0, 120).join(" / "), count: danmaku.length });
  if (subtitles.length) contentParts.push({ type: "subtitle", text: subtitles.slice(0, 120).join(" "), count: subtitles.length });
  contentParts.push(...customContentParts(row));

  const metrics = {
    views: numberValue(row, ["views", "view", "play", "plays", "playCount", "play_count"]),
    comments: numberValue(row, ["commentsCount", "comments_count", "commentCount", "comment_count", "replyCount", "reply_count"]),
    replies: numberValue(row, ["replyCount", "reply_count", "commentsCount", "comments_count", "commentCount", "comment_count"]),
    likes: numberValue(row, ["likes", "like", "likeCount", "like_count", "likedCount", "liked_count", "diggCount", "digg_count"]),
    shares: numberValue(row, ["shares", "share", "shareCount", "share_count"]),
    favorites: numberValue(row, ["favorites", "favorite", "collectCount", "collect_count", "collectedCount", "collected_count"])
  };
  const analysis = analyzeItem({ title, gameId: game.id, contentParts, metrics });

  return {
    id: `douyin:${sourceItemId}`,
    gameId: game.id,
    gameName: game.name,
    source: "douyin",
    sourceLabel,
    sourceItemId,
    title,
    author,
    url: url || `douyin-import://${sourceItemId}`,
    thumbnail: normalizeDouyinImportUrl(stringValue(row, ["thumbnail", "cover", "coverUrl", "cover_url", "avatar"])),
    publishedAt: publishedAt.toISOString(),
    collectedAt: collectedAt.toISOString(),
    freshnessHours: hoursBetween(collectedAt, publishedAt),
    metrics,
    contentParts,
    parsedContentCount: contentParts.reduce((sum, part) => sum + (part.count || 1), 0),
    ...analysis
  };
}

async function listImportFiles(root: string): Promise<string[]> {
  const resolved = path.resolve(root);
  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const files: string[][] = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(resolved, entry.name);
        if (entry.isDirectory()) return listImportFiles(fullPath);
        if (entry.isFile() && /\.(csv|json)$/i.test(entry.name)) return [fullPath];
        return [];
      })
    );
    return files.flat().sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readImportRows(file: string): Promise<ImportedRow[]> {
  const raw = await fs.readFile(file, "utf-8");
  if (/\.json$/i.test(file)) return parseJsonRows(raw);
  return parseCsvRows(raw);
}

function parseJsonRows(raw: string): ImportedRow[] {
  const parsed = JSON.parse(raw) as unknown;
  const rows = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.items) ? parsed.items : [parsed];
  return rows.filter(isRecord);
}

function parseCsvRows(raw: string): ImportedRow[] {
  const table = parseCsv(raw).filter((row) => row.some((cell) => cell.trim()));
  const [headers, ...rows] = table;
  if (!headers?.length) return [];
  return rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), row[index]?.trim() || ""]))
  );
}

function parseCsv(raw: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function belongsToGame(row: ImportedRow, game: GameConfig) {
  const explicitGame = stringValue(row, ["gameId", "game_id", "game", "product", "project"]).toLowerCase();
  const text = [
    stringValue(row, ["title", "caption", "description", "desc", "text", "content"]),
    ...arrayValue(row, ["tags", "tag", "hashtags", "sourceKeyword", "source_keyword", "comments", "comment"])
  ].join(" ");
  if (explicitGame) {
    const explicitMatches = explicitGame === game.id || explicitGame === game.shortName.toLowerCase() || explicitGame === game.name.toLowerCase();
    const routedGameId = inferDouyinGameId(text);
    return explicitMatches && (!routedGameId || routedGameId === game.id);
  }
  return douyinTextMatchesGame(text, game);
}

function customContentParts(row: ImportedRow): ContentPart[] {
  const rawParts = valueOf(row, ["contentParts", "content_parts"]);
  if (!Array.isArray(rawParts)) return [];
  return rawParts.filter(isRecord).flatMap((part) => {
    const type = stringValue(part, ["type"]) as ContentPart["type"];
    const text = stripHtml(stringValue(part, ["text", "content", "value"]));
    if (!textPartTypes.has(type) || !text) return [];
    return [{ type, text, count: numberValue(part, ["count"]) }];
  });
}

function dedupeItems(items: MonitorItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.url.startsWith("http") ? item.url : item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeDouyinImportUrl(rawUrl: string) {
  if (!rawUrl) return "";
  const normalized = normalizeUrl(rawUrl);
  try {
    return new URL(normalized).toString();
  } catch {
    return "";
  }
}

function extractDouyinId(url: string) {
  if (!url) return "";
  try {
    return new URL(url).pathname.match(/\/(?:video|note)\/([^/?#]+)/)?.[1] || "";
  } catch {
    return "";
  }
}

function valueOf(row: ImportedRow, aliases: string[]) {
  const normalized = normalizedRow(row);
  for (const alias of aliases) {
    const value = normalized.get(normalizeKey(alias));
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function stringValue(row: ImportedRow, aliases: string[]) {
  const value = valueOf(row, aliases);
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(String).join(" ");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function numberValue(row: ImportedRow, aliases: string[]) {
  const raw = stringValue(row, aliases);
  if (!raw) return undefined;
  const text = raw.replace(/,/g, "").trim().toLowerCase();
  const matched = text.match(/([\d.]+)/);
  if (!matched) return undefined;
  const base = Number(matched[1]);
  if (!Number.isFinite(base)) return undefined;
  if (/[\u4e07w]/i.test(text)) return Math.round(base * 10_000);
  if (/k/.test(text)) return Math.round(base * 1_000);
  return Math.round(base);
}

function arrayValue(row: ImportedRow, aliases: string[]) {
  const value = valueOf(row, aliases);
  if (Array.isArray(value)) return uniq(value.map((item) => stripHtml(String(item))).filter(Boolean));
  if (value === undefined || value === null) return [];
  if (typeof value === "object") return [];
  const text = String(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return uniq(parsed.map((item) => stripHtml(String(item))).filter(Boolean));
  } catch {
    // Fall through to delimiter splitting.
  }
  return uniq(text.split(/\r?\n|[|;\uff1b]/).map((item) => stripHtml(item)).filter(Boolean));
}

function parseDateValue(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" || /^\d+$/.test(String(value).trim())) {
    const numeric = Number(value);
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(String(value).replace(/\//g, "-"));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizedRow(row: ImportedRow) {
  const normalized = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) normalized.set(normalizeKey(key), value);
  return normalized;
}

function normalizeKey(key: string) {
  return key.toLowerCase().replace(/[\s_-]/g, "");
}

function isRecord(value: unknown): value is ImportedRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLabeledRow(value: ImportedRow | { row: ImportedRow; label?: string }): value is { row: ImportedRow; label?: string } {
  return isRecord(value) && isRecord(value.row);
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
