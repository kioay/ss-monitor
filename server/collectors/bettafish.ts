import fs from "node:fs/promises";
import path from "node:path";
import { analyzeItem } from "../analyze";
import { gameTermsForMatching, runtimeConfig } from "../config";
import { hoursBetween, md5, normalizeUrl, nowIso, stripHtml, uniq } from "../utils";
import type { ContentPart, GameConfig, GameId, MonitorItem, SourceHealth } from "../../src/shared";

type ImportedRow = Record<string, unknown>;

export interface ImportParseResult {
  items: MonitorItem[];
  staleDropped: number;
  errors: string[];
  fileCount: number;
  rowCount: number;
}

export interface BettaFishStatus {
  configured: boolean;
  ok: boolean;
  message: string;
}

const sourceLabel = "BettaFish导入";
const textPartTypes = new Set<ContentPart["type"]>([
  "title",
  "description",
  "tag",
  "comment",
  "danmaku",
  "subtitle",
  "post"
]);

export async function collectBettaFish(game: GameConfig, cutoff: Date) {
  const started = Date.now();
  const fetchedAt = nowIso();
  const errors: string[] = [];
  let staleDropped = 0;

  const [imported, status] = await Promise.all([
    collectImportedBettaFishItems(game, cutoff).catch((error) => {
      errors.push(`import: ${messageOf(error)}`);
      return { items: [] as MonitorItem[], staleDropped: 0, errors: [], fileCount: 0, rowCount: 0 };
    }),
    fetchBettaFishStatus().catch((error) => ({
      configured: Boolean(runtimeConfig.bettaFishBaseUrl),
      ok: false,
      message: messageOf(error)
    }))
  ]);

  staleDropped += imported.staleDropped;
  errors.push(...imported.errors.slice(0, 8).map((error) => `import: ${error}`));

  const health: SourceHealth = {
    source: "bettafish",
    sourceLabel,
    gameId: game.id,
    ok: imported.items.length > 0 || (!status.configured && errors.length === 0) || (status.ok && errors.length === 0),
    fetchedAt,
    latencyMs: Date.now() - started,
    itemCount: imported.items.length,
    staleDropped,
    blocked: false,
    message: formatHealthMessage(imported, status, errors)
  };

  return { items: imported.items, health };
}

export function previewBettaFishImportedItems(game: GameConfig, cutoff: Date) {
  return collectImportedBettaFishItems(game, cutoff);
}

export function probeBettaFishStatus() {
  return fetchBettaFishStatus();
}

async function collectImportedBettaFishItems(game: GameConfig, cutoff: Date): Promise<ImportParseResult> {
  const files = await listImportFiles(runtimeConfig.bettaFishImportDir);
  const rows: Array<{ row: ImportedRow; label: string }> = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const fileRows = await readImportRows(file);
      rows.push(...fileRows.map((row) => ({ row, label: path.basename(file) })));
    } catch (error) {
      errors.push(`${path.basename(file)}: ${messageOf(error)}`);
    }
  }

  const parsed = rowsToBettaFishMonitorItems(game, cutoff, rows);
  errors.push(...parsed.errors);

  return {
    ...parsed,
    items: parsed.items.slice(0, runtimeConfig.maxBettaFishImportedItemsPerGame),
    errors,
    fileCount: files.length,
    rowCount: rows.length
  };
}

function rowsToBettaFishMonitorItems(
  game: GameConfig,
  cutoff: Date,
  rows: Array<ImportedRow | { row: ImportedRow; label?: string }>
): ImportParseResult {
  const items: MonitorItem[] = [];
  const errors: string[] = [];
  let staleDropped = 0;

  for (const [index, entry] of rows.entries()) {
    const row = isLabeledRow(entry) ? entry.row : entry;
    const label = isLabeledRow(entry) ? entry.label : undefined;
    try {
      const item = buildBettaFishMonitorItem(game, row);
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
    items: dedupeItems(items).sort((left, right) => +new Date(right.publishedAt) - +new Date(left.publishedAt)),
    staleDropped,
    errors,
    fileCount: 0,
    rowCount: rows.length
  };
}

function buildBettaFishMonitorItem(game: GameConfig, row: ImportedRow): MonitorItem | undefined {
  if (!belongsToGame(row, game)) return undefined;

  const platform = normalizePlatform(
    stringValue(row, ["platform", "sourcePlatform", "source_platform", "source", "media", "table", "tableName"])
  ) || inferPlatform(row);
  const url = normalizeBettaFishUrl(stringValue(row, [
    "url",
    "link",
    "videoUrl",
    "video_url",
    "awemeUrl",
    "aweme_url",
    "noteUrl",
    "note_url",
    "contentUrl",
    "content_url",
    "questionUrl",
    "articleUrl"
  ]));
  const titleSource = stripHtml(stringValue(row, [
    "title",
    "topicName",
    "topic_name",
    "contentTitle",
    "content_title",
    "desc",
    "description",
    "contentText",
    "content_text",
    "content",
    "text"
  ]));
  const title = compactTitle(titleSource) || "BettaFish export item";
  const description = stripHtml(stringValue(row, [
    "description",
    "desc",
    "contentText",
    "content_text",
    "content",
    "text",
    "topicDescription",
    "topic_description",
    "extraInfo",
    "extra_info",
    "summary",
    "abstract"
  ]));
  const sourceItemId =
    stringValue(row, [
      "sourceItemId",
      "source_item_id",
      "awemeId",
      "aweme_id",
      "videoId",
      "video_id",
      "bvid",
      "noteId",
      "note_id",
      "contentId",
      "content_id",
      "newsId",
      "news_id",
      "topicId",
      "topic_id",
      "commentId",
      "comment_id",
      "id"
    ]) || md5(`${platform}|${url}|${title}|${description}`).slice(0, 16);
  const author =
    stripHtml(stringValue(row, ["author", "nickname", "userNickname", "user_nickname", "userName", "user_name", "user", "username"])) ||
    "BettaFish export";
  const publishedAt =
    parseDateValue(valueOf(row, [
      "publishedAt",
      "published_at",
      "createTime",
      "create_time",
      "createdTime",
      "created_time",
      "createdAt",
      "created_at",
      "publishTime",
      "publish_time",
      "pubTs",
      "pub_ts",
      "time",
      "crawlDate",
      "crawl_date",
      "extractDate",
      "extract_date",
      "addTs",
      "add_ts",
      "date"
    ])) || new Date();
  const collectedAt =
    parseDateValue(valueOf(row, ["collectedAt", "collected_at", "importedAt", "imported_at", "lastModifyTs", "last_modify_ts", "addTs", "add_ts"])) ||
    new Date();

  const tags = uniq([
    ...arrayValue(row, ["keywords", "sourceKeyword", "source_keyword", "tagList", "tag_list", "tags", "tag"]),
    stringValue(row, ["topicName", "topic_name"]),
    stringValue(row, ["tiebaName", "tieba_name"])
  ].map((value) => stripHtml(value)).filter(Boolean));
  const comments = arrayValue(row, [
    "comments",
    "comment",
    "topComments",
    "top_comments",
    "videoComment",
    "video_comment",
    "commentText",
    "comment_text"
  ]);
  const danmaku = arrayValue(row, ["danmaku", "videoDanmaku", "video_danmaku", "bulletComments", "bullet_comments"]);
  const subtitles = arrayValue(row, ["subtitles", "subtitle", "transcript"]);
  const contentParts: ContentPart[] = [{ type: "title", text: title, count: 1 }];
  if (description && description !== title) contentParts.push({ type: "description", text: description, count: 1 });
  if (tags.length) contentParts.push({ type: "tag", text: tags.join(" "), count: tags.length });
  for (const text of comments.slice(0, 80)) contentParts.push({ type: "comment", text, count: 1 });
  if (danmaku.length) contentParts.push({ type: "danmaku", text: danmaku.slice(0, 120).join(" / "), count: danmaku.length });
  if (subtitles.length) contentParts.push({ type: "subtitle", text: subtitles.slice(0, 120).join(" "), count: subtitles.length });
  contentParts.push(...customContentParts(row));

  const metrics = {
    views: numberValue(row, ["views", "view", "viewCount", "view_count", "viewdCount", "viewd_count", "videoPlayCount", "video_play_count", "playCount", "play_count"]),
    replies: numberValue(row, ["replies", "replyCount", "reply_count", "totalReplayNum", "total_replay_num", "commentsCount", "comments_count", "commentCount", "comment_count"]),
    comments: numberValue(row, ["comments", "commentsCount", "comments_count", "commentCount", "comment_count", "totalComments", "total_comments", "subCommentCount", "sub_comment_count"]),
    likes: numberValue(row, ["likes", "like", "likedCount", "liked_count", "likeCount", "like_count", "commentLikeCount", "comment_like_count", "voteupCount", "voteup_count"]),
    danmaku: numberValue(row, ["danmaku", "videoDanmaku", "video_danmaku", "danmakuCount", "danmaku_count"]),
    favorites: numberValue(row, ["favorites", "favorite", "favoriteCount", "favorite_count", "videoFavoriteCount", "video_favorite_count", "collectedCount", "collected_count"]),
    shares: numberValue(row, ["shares", "share", "shareCount", "share_count", "sharedCount", "shared_count"])
  };
  const analysis = analyzeItem({ title, gameId: game.id, contentParts, metrics });

  return {
    id: `bettafish:${platform}:${sourceItemId}`,
    gameId: game.id,
    gameName: game.name,
    source: "bettafish",
    sourceLabel,
    sourceItemId: `${platform}:${sourceItemId}`,
    title,
    author,
    url: url || `bettafish://${platform}/${encodeURIComponent(sourceItemId)}`,
    thumbnail: firstUrlInValue(valueOf(row, ["thumbnail", "cover", "coverUrl", "cover_url", "videoCoverUrl", "video_cover_url", "imageList", "image_list", "avatar"])),
    publishedAt: publishedAt.toISOString(),
    collectedAt: collectedAt.toISOString(),
    freshnessHours: hoursBetween(collectedAt, publishedAt),
    metrics,
    contentParts,
    parsedContentCount: contentParts.reduce((sum, part) => sum + (part.count || 1), 0),
    ...analysis
  };
}

async function fetchBettaFishStatus(): Promise<BettaFishStatus> {
  if (!runtimeConfig.bettaFishBaseUrl) {
    return { configured: false, ok: true, message: "BETTAFISH_BASE_URL is not configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${runtimeConfig.bettaFishBaseUrl}/api/status`, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) return { configured: true, ok: false, message: `HTTP ${response.status}: ${text.slice(0, 120)}` };
    return { configured: true, ok: true, message: summarizeStatusResponse(text) };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeStatusResponse(text: string) {
  try {
    const json = JSON.parse(text) as unknown;
    if (!isRecord(json)) return "BettaFish status endpoint is reachable";
    const components = Object.entries(json)
      .filter(([, value]) => isRecord(value) && typeof value.status === "string")
      .map(([name, value]) => `${name}:${String((value as ImportedRow).status)}`);
    return components.length ? `BettaFish reachable (${components.join(", ")})` : "BettaFish status endpoint is reachable";
  } catch {
    return "BettaFish status endpoint is reachable";
  }
}

function formatHealthMessage(imported: ImportParseResult, status: BettaFishStatus, errors: string[]) {
  const parts: string[] = [];
  if (imported.fileCount || imported.rowCount) {
    parts.push(`read ${imported.rowCount} rows from ${imported.fileCount} export file(s)`);
  } else {
    parts.push("no BettaFish export files found");
  }
  if (status.configured) parts.push(status.message);
  else parts.push("set BETTAFISH_IMPORT_DIR for exports or BETTAFISH_BASE_URL for external status");
  if (errors.length) parts.push(`issues: ${errors.slice(0, 2).join(" / ")}`);
  return parts.join("; ");
}

async function listImportFiles(root: string): Promise<string[]> {
  const resolved = path.resolve(root);
  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(resolved, entry.name);
        if (entry.isDirectory()) return listImportFiles(fullPath);
        if (entry.isFile() && /\.(csv|json)$/i.test(entry.name)) return [fullPath];
        return [];
      })
    );
    return nested.flat().sort();
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
  return flattenJsonRows(parsed);
}

function flattenJsonRows(value: unknown): ImportedRow[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["items", "rows", "data", "records", "results"]) {
    if (Array.isArray(value[key])) return value[key].filter(isRecord);
  }
  const tableRows = Object.entries(value).flatMap(([key, tableValue]) => {
    if (!Array.isArray(tableValue)) return [];
    return tableValue.filter(isRecord).map((row) => ({ sourcePlatform: key, table: key, ...row }));
  });
  return tableRows.length ? tableRows : [value];
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
  if (explicitGame) {
    return explicitGame === game.id || explicitGame === game.shortName.toLowerCase() || explicitGame === game.name.toLowerCase();
  }

  const text = [
    stringValue(row, ["title", "topicName", "topic_name", "caption", "description", "desc", "text", "content", "contentText", "content_text"]),
    ...arrayValue(row, ["keywords", "sourceKeyword", "source_keyword", "tags", "tag", "comments", "comment"])
  ].join(" ");
  return gameTerms(game).some((term) => term && text.includes(term));
}

function gameTerms(game: GameConfig) {
  const ssTerms =
    game.id === "ss2"
      ? ["\u751f\u6b7b\u72d9\u51fb2", "SS2", "ss2"]
      : game.id === "ss1"
        ? ["\u751f\u6b7b\u72d9\u51fb", "\u751f\u6b7b\u72d9\u51fb1", "4399\u751f\u6b7b\u72d9\u51fb", "SS1", "ss1"]
        : [];
  return uniq([...gameTermsForMatching(game), ...ssTerms]);
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
    if (seen.has(key) || seen.has(item.id)) return false;
    seen.add(key);
    seen.add(item.id);
    return true;
  });
}

function normalizePlatform(raw: string) {
  const value = raw.toLowerCase();
  if (/douyin|aweme|\bdy\b|\u6296\u97f3/.test(value)) return "douyin";
  if (/bilibili|bili|b\u7ad9/.test(value)) return "bilibili";
  if (/tieba|\u8d34\u5427/.test(value)) return "tieba";
  if (/xhs|xiaohongshu|\u5c0f\u7ea2\u4e66/.test(value)) return "xhs";
  if (/weibo|\u5fae\u535a/.test(value)) return "weibo";
  if (/zhihu|\u77e5\u4e4e/.test(value)) return "zhihu";
  if (/kuaishou|\bks\b|\u5feb\u624b/.test(value)) return "kuaishou";
  return value.replace(/[^a-z0-9_-]/g, "").slice(0, 24);
}

function inferPlatform(row: ImportedRow) {
  if (valueOf(row, ["awemeId", "aweme_id", "awemeUrl", "aweme_url"])) return "douyin";
  if (valueOf(row, ["videoId", "video_id", "bvid", "videoUrl", "video_url", "videoDanmaku", "video_danmaku"])) return "bilibili";
  if (valueOf(row, ["tiebaId", "tieba_id", "tiebaName", "tieba_name"])) return "tieba";
  if (valueOf(row, ["noteId", "note_id", "xsecToken", "xsec_token"])) return "xhs";
  if (valueOf(row, ["contentId", "content_id", "questionId", "question_id"])) return "zhihu";
  return "export";
}

function normalizeBettaFishUrl(rawUrl: string) {
  if (!rawUrl) return "";
  const normalized = normalizeUrl(rawUrl);
  try {
    return new URL(normalized).toString();
  } catch {
    return "";
  }
}

function firstUrlInValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const url: string = firstUrlInValue(item);
      if (url) return url;
    }
    return "";
  }
  if (isRecord(value)) {
    for (const key of ["url", "src", "image", "cover"]) {
      const url: string = firstUrlInValue(value[key]);
      if (url) return url;
    }
    return "";
  }
  const text = String(value).trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as unknown;
    const parsedUrl: string = firstUrlInValue(parsed);
    if (parsedUrl) return parsedUrl;
  } catch {
    // Fall through to regex extraction.
  }
  const match = text.match(/https?:\/\/[^\s"',\]}]+/);
  return match ? normalizeBettaFishUrl(match[0]) : normalizeBettaFishUrl(text);
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
  const text = String(value).trim();
  if (/^\d{8}$/.test(text)) {
    const date = new Date(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8)), 12);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === "number" || /^\d+$/.test(text)) {
    const numeric = Number(value);
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const date = new Date(text.replace(/\//g, "-"));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function compactTitle(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 96 ? `${text.slice(0, 95)}...` : text;
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
