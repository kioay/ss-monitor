import { spawn } from "node:child_process";
import { z } from "zod";
import { games, gameById, runtimeConfig } from "./config";
import { readMonitorHistoryItems } from "./monitorHistory";
import { loadMindSpiderDbConfig, type MindSpiderDbConfig } from "./collectors/mindspiderDouyin";
import { rowsToDouyinMonitorItems, type ImportedRow } from "./collectors/douyinImport";
import { stripHtml, uniq } from "./utils";
import type {
  GameConfig,
  GameId,
  MonitorItem,
  RiskLevel,
  SearchMatchSnippet,
  SearchResponse,
  SearchResult,
  SearchResultOrigin,
  SearchSourceSummary,
  Sentiment,
  SourceType
} from "../src/shared";

const searchQuerySchema = z.object({
  q: z.string().max(200).default(""),
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
  windowHours: z.coerce.number().int().min(1).max(24 * 30).default(24 * 30),
  limit: z.coerce.number().int().min(1).max(300).default(120),
  source: z.enum(["all", "bilibili", "tieba", "douyin", "forum4399", "bettafish"]).default("all"),
  risk: z.enum(["all", "low", "medium", "high"]).default("all"),
  sentiment: z.enum(["all", "positive", "neutral", "negative", "mixed"]).default("all"),
  topic: z.string().max(100).default("all"),
  includeDb: z
    .string()
    .optional()
    .transform((value) => value !== "0" && value !== "false")
});

type SearchQuery = z.infer<typeof searchQuerySchema>;

interface SearchField {
  key: string;
  label: string;
  text: string;
  weight: number;
}

interface SearchOptions {
  terms: string[];
  now: Date;
  windowHours: number;
  gameIds: GameId[];
  source: "all" | SourceType;
  risk: "all" | RiskLevel;
  sentiment: "all" | Sentiment;
  topic: string;
  origin: SearchResultOrigin;
}

const fieldWeights = {
  title: 60,
  author: 32,
  keyword: 38,
  riskReason: 42,
  topic: 28,
  summary: 34,
  content: 24,
  comment: 22
};

export async function getSearchResponse(rawQuery: unknown): Promise<SearchResponse> {
  const query = searchQuerySchema.parse(rawQuery);
  const now = new Date();
  const selectedGames = selectedGameConfigs(query.games);
  const gameIds = selectedGames.map((game) => game.id);
  const terms = normalizeSearchTerms(query.q);
  const emptyResponse = emptySearchResponse(query, terms, now);
  if (!terms.length) return emptyResponse;

  const cutoff = new Date(now.getTime() - query.windowHours * 3_600_000);
  const errors: string[] = [];
  const historyItems = await readMonitorHistoryItems(gameIds, now, query.windowHours);
  const historyResults = searchMonitorItems(historyItems, {
    terms,
    now,
    windowHours: query.windowHours,
    gameIds,
    source: query.source,
    risk: query.risk,
    sentiment: query.sentiment,
    topic: query.topic,
    origin: "monitor-history"
  });

  let dbResults: SearchResult[] = [];
  let dbSummary: SearchSourceSummary = {
    origin: "mindspider-douyin-db",
    label: "MindSpider Douyin DB",
    checked: false,
    matched: 0,
    message: "未查询数据库"
  };

  if (query.includeDb !== false && runtimeConfig.mindSpiderDouyinEnabled && (query.source === "all" || query.source === "douyin")) {
    try {
      const dbSearch = await searchMindSpiderDouyinDb({ query, terms, selectedGames, cutoff, now });
      dbResults = dbSearch.results;
      dbSummary = {
        origin: "mindspider-douyin-db",
        label: "MindSpider Douyin DB",
        checked: dbSearch.checked,
        matched: dbResults.length,
        message: dbSearch.message
      };
    } catch (error) {
      errors.push(`MindSpider Douyin DB: ${messageOf(error)}`);
      dbSummary = {
        origin: "mindspider-douyin-db",
        label: "MindSpider Douyin DB",
        checked: true,
        matched: 0,
        message: "数据库检索失败"
      };
    }
  }

  const merged = mergeSearchResults([...historyResults, ...dbResults]);
  const items = merged.slice(0, query.limit);

  return {
    generatedAt: now.toISOString(),
    query: query.q.trim(),
    terms,
    windowHours: query.windowHours,
    limit: query.limit,
    totalMatched: merged.length,
    sources: [
      {
        origin: "monitor-history",
        label: "Monitor history",
        checked: true,
        matched: historyResults.length,
        message: `历史条目 ${historyResults.length}/${historyItems.length} 命中`
      },
      dbSummary
    ],
    items,
    errors
  };
}

export function searchMonitorItems(items: MonitorItem[], options: SearchOptions): SearchResult[] {
  const cutoffMs = options.now.getTime() - options.windowHours * 3_600_000;

  return items
    .flatMap((item) => {
      if (!options.gameIds.includes(item.gameId)) return [];
      if (options.source !== "all" && item.source !== options.source) return [];
      if (options.risk !== "all" && item.riskLevel !== options.risk) return [];
      if (options.sentiment !== "all" && item.sentiment !== options.sentiment) return [];
      if (options.topic !== "all" && !item.topics.includes(options.topic)) return [];

      const publishedMs = new Date(item.publishedAt).getTime();
      if (!Number.isFinite(publishedMs) || publishedMs < cutoffMs) return [];

      const result = scoreItem(item, options.terms, options.origin, options.now);
      return result ? [result] : [];
    })
    .sort(compareSearchResults);
}

function scoreItem(item: MonitorItem, terms: string[], origin: SearchResultOrigin, now: Date): SearchResult | undefined {
  const fields = searchableFields(item);
  const matchedFields = new Map<string, string>();
  const snippets: SearchMatchSnippet[] = [];
  let score = 0;

  for (const term of terms) {
    const termMatches = fields.filter((field) => normalizeText(field.text).includes(term));
    if (!termMatches.length) return undefined;

    const strongest = termMatches.reduce((best, field) => (field.weight > best.weight ? field : best), termMatches[0]);
    score += strongest.weight;

    for (const field of termMatches) {
      matchedFields.set(field.key, field.label);
      if (snippets.length < 3 && !snippets.some((snippet) => snippet.field === field.key && snippet.text === field.text)) {
        snippets.push({
          field: field.key,
          label: field.label,
          text: makeSnippet(field.text, term)
        });
      }
    }
  }

  score += riskBoost(item.riskLevel);
  score += recencyBoost(item, now);

  return {
    item,
    score: Math.round(score),
    matchedFields: uniq(Array.from(matchedFields.values())),
    snippets,
    origin
  };
}

function searchableFields(item: MonitorItem): SearchField[] {
  const fields: SearchField[] = [
    { key: "title", label: "标题", text: item.title, weight: fieldWeights.title },
    { key: "author", label: "作者", text: item.author, weight: fieldWeights.author },
    { key: "summary", label: "摘要", text: item.summary, weight: fieldWeights.summary },
    { key: "keyword", label: "关键词", text: item.keywords.join(" "), weight: fieldWeights.keyword },
    { key: "riskReason", label: "风险原因", text: item.riskReasons.join(" "), weight: fieldWeights.riskReason },
    { key: "topic", label: "主题", text: item.topics.join(" "), weight: fieldWeights.topic }
  ];

  for (const [index, part] of item.contentParts.entries()) {
    const isComment = part.type === "comment" || part.type === "danmaku" || part.type === "subtitle";
    fields.push({
      key: `${part.type}-${index}`,
      label: contentPartLabel(part.type),
      text: part.text,
      weight: isComment ? fieldWeights.comment : fieldWeights.content
    });
  }

  return fields.filter((field) => field.text.trim());
}

async function searchMindSpiderDouyinDb(input: {
  query: SearchQuery;
  terms: string[];
  selectedGames: GameConfig[];
  cutoff: Date;
  now: Date;
}): Promise<{ checked: boolean; message: string; results: SearchResult[] }> {
  const dbConfig = await loadMindSpiderDbConfig();
  if (!dbConfig.configured) return { checked: false, message: "MindSpider DB 未配置", results: [] };

  const rows = await queryMindSpiderDouyinRows(dbConfig, input.terms, input.selectedGames, input.cutoff, input.query.limit);
  const routedItems = input.selectedGames.flatMap((game) =>
    rowsToDouyinMonitorItems(game, input.cutoff, rows, { sourceLabel: "MindSpider 抖音检索" }).items
  );
  const deduped = dedupeItems(routedItems);
  const results = searchMonitorItems(deduped, {
    terms: input.terms,
    now: input.now,
    windowHours: input.query.windowHours,
    gameIds: input.selectedGames.map((game) => game.id),
    source: "douyin",
    risk: input.query.risk,
    sentiment: input.query.sentiment,
    topic: input.query.topic,
    origin: "mindspider-douyin-db"
  });

  return {
    checked: true,
    message: `数据库候选 ${rows.length} 条，路由后命中 ${results.length} 条`,
    results
  };
}

async function queryMindSpiderDouyinRows(
  dbConfig: MindSpiderDbConfig,
  terms: string[],
  selectedGames: GameConfig[],
  cutoff: Date,
  limit: number
): Promise<ImportedRow[]> {
  if (dbConfig.dialect === "sqlite") return queryMindSpiderDouyinSqlite(dbConfig, terms, selectedGames, cutoff, limit);
  if (dbConfig.dialect === "postgresql") return queryMindSpiderDouyinPostgres(dbConfig, terms, selectedGames, cutoff, limit);
  return queryMindSpiderDouyinMysql(dbConfig, terms, selectedGames, cutoff, limit);
}

async function queryMindSpiderDouyinMysql(
  dbConfig: MindSpiderDbConfig,
  terms: string[],
  selectedGames: GameConfig[],
  cutoff: Date,
  limit: number
): Promise<ImportedRow[]> {
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    charset: dbConfig.charset
  });
  try {
    await conn.execute("SET SESSION group_concat_max_len = 16384");
    const sql = mysqlSearchSql(terms, selectedGames);
    const [rows] = await conn.execute(sql, mysqlSearchParams(terms, selectedGames, cutoff, limit));
    return Array.isArray(rows) ? rows as ImportedRow[] : [];
  } finally {
    await conn.end();
  }
}

async function queryMindSpiderDouyinPostgres(
  dbConfig: MindSpiderDbConfig,
  terms: string[],
  selectedGames: GameConfig[],
  cutoff: Date,
  limit: number
): Promise<ImportedRow[]> {
  const pg = await import("pg");
  const client = new pg.default.Client({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database
  });
  await client.connect();
  try {
    const payload = postgresSearchSql(terms, selectedGames);
    const result = await client.query(payload.sql, [...payload.params, Math.floor(cutoff.getTime() / 1000), limit]);
    return result.rows as ImportedRow[];
  } finally {
    await client.end();
  }
}

async function queryMindSpiderDouyinSqlite(
  dbConfig: MindSpiderDbConfig,
  terms: string[],
  selectedGames: GameConfig[],
  cutoff: Date,
  limit: number
): Promise<ImportedRow[]> {
  if (!dbConfig.sqlitePath) return [];
  const sql = sqliteSearchSql(terms, selectedGames, cutoff, limit);
  const output = await runSqlite(dbConfig.sqliteCommand || "sqlite3", ["-json", dbConfig.sqlitePath, sql], runtimeConfig.mindSpiderDbQueryTimeoutMs);
  const parsed = JSON.parse(output || "[]") as unknown;
  return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
}

function mysqlSearchSql(terms: string[], selectedGames: GameConfig[]) {
  const gameTerms = gameTermsFor(selectedGames);
  const gameWhere = gameTerms.length
    ? "(" + gameTerms.map(() => "CONCAT_WS(' ', aweme.title, aweme.`desc`, aweme.source_keyword) LIKE ?").join(" OR ") + ")"
    : "1=1";
  return `
SELECT
  aweme.aweme_id AS sourceItemId,
  aweme.title,
  aweme.\`desc\` AS description,
  aweme.nickname AS author,
  aweme.aweme_url AS url,
  aweme.cover_url AS thumbnail,
  aweme.create_time AS publishedAt,
  aweme.add_ts AS collectedAt,
  aweme.source_keyword AS source_keyword,
  aweme.source_keyword AS tags,
  aweme.liked_count AS likes,
  aweme.comment_count AS commentsCount,
  aweme.share_count AS shares,
  aweme.collected_count AS favorites,
  GROUP_CONCAT(comment_row.content SEPARATOR '\n') AS comments
FROM ${quoteMysqlIdent(runtimeConfig.mindSpiderDouyinTable)} aweme
LEFT JOIN ${quoteMysqlIdent(runtimeConfig.mindSpiderDouyinCommentsTable)} comment_row ON comment_row.aweme_id = aweme.aweme_id
WHERE (aweme.create_time IS NULL OR aweme.create_time >= ?)
  AND ${gameWhere}
  AND ${termsLikeWhereMysql(terms)}
GROUP BY aweme.aweme_id, aweme.title, aweme.\`desc\`, aweme.nickname, aweme.aweme_url, aweme.cover_url, aweme.create_time, aweme.add_ts, aweme.source_keyword, aweme.liked_count, aweme.comment_count, aweme.share_count, aweme.collected_count
ORDER BY COALESCE(aweme.create_time, aweme.add_ts, 0) DESC
LIMIT ?`;
}

function mysqlSearchParams(terms: string[], selectedGames: GameConfig[], cutoff: Date, limit: number) {
  const params: Array<string | number> = [Math.floor(cutoff.getTime() / 1000)];
  params.push(...gameTermsFor(selectedGames).map((term) => `%${term}%`));
  for (const term of terms) params.push(`%${term}%`, `%${term}%`);
  params.push(Math.min(500, Math.max(limit * 4, 120)));
  return params;
}

function termsLikeWhereMysql(terms: string[]) {
  return terms
    .map(() =>
      [
        "(CONCAT_WS(' ', aweme.title, aweme.`desc`, aweme.source_keyword, aweme.nickname) LIKE ?",
        `OR EXISTS (SELECT 1 FROM ${quoteMysqlIdent(runtimeConfig.mindSpiderDouyinCommentsTable)} c WHERE c.aweme_id = aweme.aweme_id AND c.content LIKE ?))`
      ].join(" ")
    )
    .join(" AND ") || "1=1";
}

function postgresSearchSql(terms: string[], selectedGames: GameConfig[]) {
  let index = 1;
  const params: string[] = [];
  const gameConditions = gameTermsFor(selectedGames).map((term) => {
    params.push(`%${term}%`);
    return `CONCAT_WS(' ', aweme.title, aweme."desc", aweme.source_keyword) ILIKE $${index++}`;
  });
  const termConditions = terms.map((term) => {
    params.push(`%${term}%`, `%${term}%`);
    const awemeParam = index++;
    const commentParam = index++;
    return `(CONCAT_WS(' ', aweme.title, aweme."desc", aweme.source_keyword, aweme.nickname) ILIKE $${awemeParam} OR EXISTS (SELECT 1 FROM ${quotePgIdent(runtimeConfig.mindSpiderDouyinCommentsTable)} c WHERE c.aweme_id = aweme.aweme_id AND c.content ILIKE $${commentParam}))`;
  });
  const cutoffParam = index++;
  const limitParam = index++;
  const sql = `
SELECT
  aweme.aweme_id AS "sourceItemId",
  aweme.title,
  aweme."desc" AS description,
  aweme.nickname AS author,
  aweme.aweme_url AS url,
  aweme.cover_url AS thumbnail,
  aweme.create_time AS "publishedAt",
  aweme.add_ts AS "collectedAt",
  aweme.source_keyword,
  aweme.source_keyword AS tags,
  aweme.liked_count AS likes,
  aweme.comment_count AS "commentsCount",
  aweme.share_count AS shares,
  aweme.collected_count AS favorites,
  STRING_AGG(comment_row.content, '\n') AS comments
FROM ${quotePgIdent(runtimeConfig.mindSpiderDouyinTable)} aweme
LEFT JOIN ${quotePgIdent(runtimeConfig.mindSpiderDouyinCommentsTable)} comment_row ON comment_row.aweme_id = aweme.aweme_id
WHERE (aweme.create_time IS NULL OR aweme.create_time >= $${cutoffParam})
  AND (${gameConditions.length ? gameConditions.join(" OR ") : "1=1"})
  AND ${termConditions.join(" AND ")}
GROUP BY aweme.aweme_id, aweme.title, aweme."desc", aweme.nickname, aweme.aweme_url, aweme.cover_url, aweme.create_time, aweme.add_ts, aweme.source_keyword, aweme.liked_count, aweme.comment_count, aweme.share_count, aweme.collected_count
ORDER BY COALESCE(aweme.create_time, aweme.add_ts, 0) DESC
LIMIT $${limitParam}`;
  return { sql, params };
}

function sqliteSearchSql(terms: string[], selectedGames: GameConfig[], cutoff: Date, limit: number) {
  const gameConditions = gameTermsFor(selectedGames)
    .map((term) => `COALESCE(aweme.title, '') || ' ' || COALESCE(aweme.desc, '') || ' ' || COALESCE(aweme.source_keyword, '') LIKE ${quoteSql(`%${term}%`)}`)
    .join(" OR ") || "1=1";
  const termConditions = terms
    .map((term) => `(COALESCE(aweme.title, '') || ' ' || COALESCE(aweme.desc, '') || ' ' || COALESCE(aweme.source_keyword, '') || ' ' || COALESCE(aweme.nickname, '') LIKE ${quoteSql(`%${term}%`)} OR EXISTS (SELECT 1 FROM ${quoteSqliteIdent(runtimeConfig.mindSpiderDouyinCommentsTable)} c WHERE c.aweme_id = aweme.aweme_id AND c.content LIKE ${quoteSql(`%${term}%`)}))`)
    .join(" AND ");
  return `
SELECT
  aweme.aweme_id AS sourceItemId,
  aweme.title AS title,
  aweme.desc AS description,
  aweme.nickname AS author,
  aweme.aweme_url AS url,
  aweme.cover_url AS thumbnail,
  aweme.create_time AS publishedAt,
  aweme.add_ts AS collectedAt,
  aweme.source_keyword AS source_keyword,
  aweme.source_keyword AS tags,
  aweme.liked_count AS likes,
  aweme.comment_count AS commentsCount,
  aweme.share_count AS shares,
  aweme.collected_count AS favorites,
  GROUP_CONCAT(comment_row.content, '\n') AS comments
FROM ${quoteSqliteIdent(runtimeConfig.mindSpiderDouyinTable)} aweme
LEFT JOIN ${quoteSqliteIdent(runtimeConfig.mindSpiderDouyinCommentsTable)} comment_row ON comment_row.aweme_id = aweme.aweme_id
WHERE (aweme.create_time IS NULL OR aweme.create_time >= ${Math.floor(cutoff.getTime() / 1000)})
  AND (${gameConditions})
  AND ${termConditions}
GROUP BY aweme.aweme_id
ORDER BY COALESCE(aweme.create_time, aweme.add_ts, 0) DESC
LIMIT ${Math.min(500, Math.max(limit * 4, 120))};`;
}

function runSqlite(command: string, args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("sqlite search timeout"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf-8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf-8"); });
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `sqlite3 exited with code ${code}`));
    });
  });
}

function mergeSearchResults(results: SearchResult[]) {
  const byKey = new Map<string, SearchResult>();
  for (const result of results) {
    const key = result.item.url.startsWith("http") ? result.item.url : result.item.id;
    const existing = byKey.get(key);
    if (!existing || result.score > existing.score) {
      byKey.set(key, existing ? mergeResultMetadata(result, existing) : result);
    } else {
      byKey.set(key, mergeResultMetadata(existing, result));
    }
  }
  return Array.from(byKey.values()).sort(compareSearchResults);
}

function mergeResultMetadata(primary: SearchResult, secondary: SearchResult): SearchResult {
  return {
    ...primary,
    matchedFields: uniq([...primary.matchedFields, ...secondary.matchedFields]),
    snippets: [...primary.snippets, ...secondary.snippets].slice(0, 3),
    origin: primary.origin === "mindspider-douyin-db" ? primary.origin : secondary.origin
  };
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

function compareSearchResults(left: SearchResult, right: SearchResult) {
  return right.score - left.score || +new Date(right.item.publishedAt) - +new Date(left.item.publishedAt);
}

function normalizeSearchTerms(query: string) {
  const normalized = normalizeText(query);
  if (!normalized) return [];
  return uniq(normalized.split(/[\s,，、;；|]+/).map((term) => term.trim()).filter(Boolean)).slice(0, 8);
}

function normalizeText(value: string) {
  return stripHtml(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function makeSnippet(text: string, term: string) {
  const clean = stripHtml(text).replace(/\s+/g, " ").trim();
  const normalized = clean.toLowerCase();
  const index = normalized.indexOf(term);
  if (index < 0) return clean.slice(0, 120);
  const start = Math.max(0, index - 42);
  const end = Math.min(clean.length, index + term.length + 58);
  return `${start > 0 ? "..." : ""}${clean.slice(start, end)}${end < clean.length ? "..." : ""}`;
}

function recencyBoost(item: MonitorItem, now: Date) {
  const ageHours = Math.max(0, (now.getTime() - new Date(item.publishedAt).getTime()) / 3_600_000);
  if (!Number.isFinite(ageHours)) return 0;
  if (ageHours <= 24) return 16;
  if (ageHours <= 72) return 10;
  if (ageHours <= 168) return 5;
  return 0;
}

function riskBoost(risk: RiskLevel) {
  if (risk === "high") return 14;
  if (risk === "medium") return 7;
  return 0;
}

function selectedGameConfigs(ids: string[]) {
  const selected = ids.map((id) => gameById.get(id as GameId)).filter((game): game is GameConfig => Boolean(game));
  return selected.length ? selected : games;
}

function gameTermsFor(selectedGames: GameConfig[]) {
  return uniq(selectedGames.flatMap((game) => [game.id, game.name, game.shortName, ...game.douyinKeywords]).filter(Boolean));
}

function contentPartLabel(type: string) {
  switch (type) {
    case "comment": return "评论";
    case "danmaku": return "弹幕";
    case "subtitle": return "字幕";
    case "description": return "描述";
    case "tag": return "标签";
    case "post": return "正文";
    default: return "正文";
  }
}

function emptySearchResponse(query: SearchQuery, terms: string[], now: Date): SearchResponse {
  return {
    generatedAt: now.toISOString(),
    query: query.q.trim(),
    terms,
    windowHours: query.windowHours,
    limit: query.limit,
    totalMatched: 0,
    sources: [
      { origin: "monitor-history", label: "Monitor history", checked: false, matched: 0, message: "等待输入关键词" },
      { origin: "mindspider-douyin-db", label: "MindSpider Douyin DB", checked: false, matched: 0, message: "等待输入关键词" }
    ],
    items: [],
    errors: []
  };
}

function quoteMysqlIdent(value: string) {
  return "`" + String(value || "").replace(/`/g, "``") + "`";
}

function quotePgIdent(value: string) {
  return '"' + String(value || "").replace(/"/g, '""') + '"';
}

function quoteSqliteIdent(value: string) {
  return '"' + String(value || "").replace(/"/g, '""') + '"';
}

function quoteSql(value: string) {
  return "'" + String(value || "").replace(/'/g, "''") + "'";
}

function isRecord(value: unknown): value is ImportedRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
