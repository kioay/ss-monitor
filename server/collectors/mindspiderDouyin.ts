import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { runtimeConfig } from "../config";
import { rowsToDouyinMonitorItems, type ImportParseResult, type ImportedRow } from "./douyinImport";
import type { GameConfig, MonitorItem } from "../../src/shared";

export interface MindSpiderDouyinResult extends ImportParseResult {
  dbConfigured: boolean;
  dbRows: number;
  exportFileCount: number;
  exportRowCount: number;
  sourceMessages: string[];
}

const defaultResult = (): MindSpiderDouyinResult => ({
  items: [],
  staleDropped: 0,
  errors: [],
  fileCount: 0,
  rowCount: 0,
  dbConfigured: false,
  dbRows: 0,
  exportFileCount: 0,
  exportRowCount: 0,
  sourceMessages: []
});

export async function collectMindSpiderDouyinItems(game: GameConfig, cutoff: Date): Promise<MindSpiderDouyinResult> {
  if (!runtimeConfig.mindSpiderDouyinEnabled) {
    return {
      ...defaultResult(),
      sourceMessages: ["MindSpider Douyin bridge disabled by MINDSPIDER_DOUYIN_ENABLED=false"]
    };
  }

  const [exportsResult, dbResult] = await Promise.all([
    collectMindSpiderExportItems(game, cutoff),
    collectMindSpiderDbItems(game, cutoff)
  ]);
  const items = mergeItems([...dbResult.items, ...exportsResult.items]).slice(0, runtimeConfig.maxDouyinItemsPerGame);
  const errors = [...dbResult.errors, ...exportsResult.errors];
  const sourceMessages = [
    ...dbResult.sourceMessages,
    ...exportsResult.sourceMessages
  ].filter(Boolean);

  return {
    items,
    staleDropped: dbResult.staleDropped + exportsResult.staleDropped,
    errors,
    fileCount: exportsResult.fileCount,
    rowCount: dbResult.rowCount + exportsResult.rowCount,
    dbConfigured: dbResult.dbConfigured,
    dbRows: dbResult.dbRows,
    exportFileCount: exportsResult.fileCount,
    exportRowCount: exportsResult.rowCount,
    sourceMessages
  };
}

async function collectMindSpiderExportItems(game: GameConfig, cutoff: Date): Promise<MindSpiderDouyinResult> {
  const roots = importRoots(runtimeConfig.mindSpiderDouyinImportDir);
  const files = uniqueStrings((await Promise.all(roots.map((root) => listImportFiles(root)))).flat());
  const rows: Array<{ row: ImportedRow; label: string }> = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const fileRows = await readImportRows(file);
      rows.push(...fileRows.map((row) => ({ row, label: path.basename(file) })));
    } catch (error) {
      errors.push(`MindSpider export ${path.basename(file)}: ${messageOf(error)}`);
    }
  }

  const parsed = rowsToDouyinMonitorItems(game, cutoff, rows, { sourceLabel: "MindSpider 实验爬虫" });
  return {
    ...defaultResult(),
    ...parsed,
    items: parsed.items,
    errors: [...errors, ...parsed.errors.map((error) => `MindSpider export ${error}`)],
    fileCount: files.length,
    rowCount: rows.length,
    exportFileCount: files.length,
    exportRowCount: rows.length,
    sourceMessages: files.length ? [`MindSpider exports: ${rows.length} rows from ${files.length} file(s)`] : []
  };
}

async function collectMindSpiderDbItems(game: GameConfig, cutoff: Date): Promise<MindSpiderDouyinResult> {
  const dbConfig = await loadMindSpiderDbConfig();
  if (!dbConfig.configured) {
    return {
      ...defaultResult(),
      sourceMessages: ["MindSpider DB not configured"]
    };
  }

  const query = buildMindSpiderDbProbeScript(game, cutoff, dbConfig);
  const result = await runNodeProbe(query);
  if (!result.ok) {
    return {
      ...defaultResult(),
      dbConfigured: true,
      errors: [`MindSpider DB: ${result.error || "query failed"}`],
      sourceMessages: ["MindSpider DB configured but query failed"]
    };
  }

  const parsed = rowsToDouyinMonitorItems(game, cutoff, result.rows, { sourceLabel: "MindSpider 实验爬虫" });
  return {
    ...defaultResult(),
    ...parsed,
    errors: parsed.errors.map((error) => `MindSpider DB ${error}`),
    dbConfigured: true,
    dbRows: result.rows.length,
    rowCount: result.rows.length,
    sourceMessages: [`MindSpider DB: ${result.rows.length} recent douyin row(s)`]
  };
}

function mergeItems(items: MonitorItem[]) {
  const seen = new Set<string>();
  return items
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
    .filter((item) => {
      const key = item.url.startsWith("http") ? item.url : item.id;
      if (seen.has(key) || seen.has(item.id)) return false;
      seen.add(key);
      seen.add(item.id);
      return true;
    });
}

async function listImportFiles(root: string): Promise<string[]> {
  const resolved = path.resolve(root);
  try {
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(resolved, entry.name);
        if (entry.isDirectory()) return listImportFiles(fullPath);
        if (entry.isFile() && /\.(csv|json|jsonl)$/i.test(entry.name)) return [fullPath];
        return [];
      })
    );
    return nested.flat().sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function importRoots(value: string) {
  return uniqueStrings(value.split(/[;,\n]/).flatMap((part) => part.split(path.delimiter)).map((part) => part.trim()).filter(Boolean));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

async function readImportRows(file: string): Promise<ImportedRow[]> {
  const raw = stripBom(await fs.readFile(file, "utf-8"));
  if (/\.jsonl$/i.test(file)) return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as unknown).filter(isRecord);
  if (/\.json$/i.test(file)) return flattenJsonRows(JSON.parse(raw) as unknown);
  return parseCsvRows(raw);
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

function stripBom(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function parseCsvRows(raw: string): ImportedRow[] {
  const table = parseCsv(raw).filter((row) => row.some((cell) => cell.trim()));
  const [headers, ...rows] = table;
  if (!headers?.length) return [];
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header.trim(), row[index]?.trim() || ""])));
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
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") quoted = true;
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

export interface MindSpiderDbConfig {
  configured: boolean;
  dialect: "mysql" | "postgresql";
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  charset: string;
}

export async function loadMindSpiderDbConfig(): Promise<MindSpiderDbConfig> {
  const envFiles = [
    runtimeConfig.mindSpiderEnvFile,
    runtimeConfig.bettaFishRepoDir ? path.join(runtimeConfig.bettaFishRepoDir, "MindSpider", ".env") : "",
    runtimeConfig.bettaFishRepoDir ? path.join(runtimeConfig.bettaFishRepoDir, ".env") : ""
  ].filter(Boolean);
  const fileValues = Object.assign({}, ...await Promise.all(envFiles.map((file) => readEnvFile(file))));
  const value = (name: string, fallback = "") => process.env[name] || fileValues[name] || fallback;
  const host = value("MINDSPIDER_DB_HOST", value("DB_HOST"));
  const user = value("MINDSPIDER_DB_USER", value("DB_USER"));
  const password = value("MINDSPIDER_DB_PASSWORD", value("DB_PASSWORD"));
  const database = value("MINDSPIDER_DB_NAME", value("DB_NAME", "mindspider"));
  const port = Number(value("MINDSPIDER_DB_PORT", value("DB_PORT", "3306")));
  const dialect = value("MINDSPIDER_DB_DIALECT", value("DB_DIALECT", "mysql")).toLowerCase();
  const charset = value("MINDSPIDER_DB_CHARSET", value("DB_CHARSET", "utf8mb4"));
  const configured = Boolean(host && user && password && database && !/^your_/i.test(host) && !/^your_/i.test(user) && !/^your_/i.test(password));

  return {
    configured,
    dialect: dialect === "postgres" || dialect === "postgresql" ? "postgresql" : "mysql",
    host,
    port: Number.isFinite(port) ? port : 3306,
    user,
    password,
    database,
    charset
  };
}

async function readEnvFile(file: string) {
  try {
    const raw = await fs.readFile(path.resolve(file), "utf-8");
    const values: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      values[match[1]] = unquoteEnvValue(match[2].trim());
    }
    return values;
  } catch {
    return {};
  }
}

function unquoteEnvValue(value: string) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}

function buildMindSpiderDbProbeScript(game: GameConfig, cutoff: Date, dbConfig: MindSpiderDbConfig) {
  const payload = {
    dbConfig,
    table: runtimeConfig.mindSpiderDouyinTable,
    commentsTable: runtimeConfig.mindSpiderDouyinCommentsTable,
    cutoffIso: cutoff.toISOString(),
    limit: runtimeConfig.mindSpiderDbLimit,
    timeoutMs: runtimeConfig.mindSpiderDbQueryTimeoutMs,
    terms: [game.id, game.name, game.shortName, ...game.douyinKeywords].filter(Boolean)
  };

  return `
const payload = ${JSON.stringify(payload)};
const mysql = payload.dbConfig.dialect === "mysql" ? await import("mysql2/promise").catch(() => undefined) : undefined;
const pg = payload.dbConfig.dialect === "postgresql" ? await import("pg").catch(() => undefined) : undefined;
const cutoffSeconds = Math.floor(new Date(payload.cutoffIso).getTime() / 1000);
const cutoffMillis = new Date(payload.cutoffIso).getTime();
const likeTerms = payload.terms.map((term) => String(term || "").trim()).filter(Boolean);
const select = [
  "aweme.id",
  "aweme.aweme_id AS sourceItemId",
  "aweme.title",
  "aweme.desc AS description",
  "aweme.nickname AS author",
  "aweme.aweme_url AS url",
  "aweme.cover_url AS thumbnail",
  "aweme.create_time AS publishedAt",
  "aweme.add_ts AS collectedAt",
  "aweme.source_keyword AS tags",
  "aweme.liked_count AS likes",
  "aweme.comment_count AS commentsCount",
  "aweme.share_count AS shares",
  "aweme.collected_count AS favorites"
].join(", ");
const where = ["(aweme.create_time IS NULL OR aweme.create_time >= ?)"];
const params = [cutoffSeconds];
if (likeTerms.length) {
  where.push("(" + likeTerms.map(() => "CONCAT_WS(' ', aweme.title, aweme.desc, aweme.source_keyword) LIKE ?").join(" OR ") + ")");
  params.push(...likeTerms.map((term) => "%" + term + "%"));
}
const mysqlSql = "SELECT " + select + ", GROUP_CONCAT(comment.content SEPARATOR '\\\\n') AS comments FROM " + payload.table + " aweme LEFT JOIN " + payload.commentsTable + " comment ON comment.aweme_id = aweme.aweme_id WHERE " + where.join(" AND ") + " GROUP BY aweme.id ORDER BY COALESCE(aweme.create_time, aweme.add_ts, 0) DESC LIMIT ?";
const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("MindSpider DB query timeout")), payload.timeoutMs));
async function queryMysql() {
  if (!mysql) throw new Error("mysql2 package is not installed");
  const conn = await mysql.createConnection({
    host: payload.dbConfig.host,
    port: payload.dbConfig.port,
    user: payload.dbConfig.user,
    password: payload.dbConfig.password,
    database: payload.dbConfig.database,
    charset: payload.dbConfig.charset
  });
  try {
    const [rows] = await conn.execute(mysqlSql, [...params, payload.limit]);
    return rows;
  } finally {
    await conn.end();
  }
}
async function queryPostgres() {
  if (!pg) throw new Error("pg package is not installed");
  const { Client } = pg;
  const conn = new Client({
    host: payload.dbConfig.host,
    port: payload.dbConfig.port,
    user: payload.dbConfig.user,
    password: payload.dbConfig.password,
    database: payload.dbConfig.database
  });
  await conn.connect();
  try {
    let pgSqlIndex = 1;
    const sql = "SELECT " + select.replace(/GROUP_CONCAT\\(comment.content SEPARATOR '\\\\n'\\)/, "STRING_AGG(comment.content, '\\\\n')") + ", STRING_AGG(comment.content, '\\\\n') AS comments FROM " + payload.table + " aweme LEFT JOIN " + payload.commentsTable + " comment ON comment.aweme_id = aweme.aweme_id WHERE " + where.join(" AND ").replace(/\\?/g, () => "$" + (pgSqlIndex++)) + " GROUP BY aweme.id ORDER BY COALESCE(aweme.create_time, aweme.add_ts, 0) DESC LIMIT $" + (pgSqlIndex++);
    const result = await conn.query(sql, [...params, payload.limit]);
    return result.rows;
  } finally {
    await conn.end();
  }
}
try {
  const rows = await Promise.race([payload.dbConfig.dialect === "postgresql" ? queryPostgres() : queryMysql(), timeout]);
  const normalized = rows.map((row) => ({ gameId: "", ...row, publishedAt: normalizeTime(row.publishedAt), collectedAt: normalizeTime(row.collectedAt), platform: "douyin" }));
  process.stdout.write(JSON.stringify({ ok: true, rows: normalized }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
}
function normalizeTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return value;
  return new Date(numeric > 10000000000 ? numeric : numeric * 1000).toISOString();
}
`;
}

interface ProbeResult {
  ok: boolean;
  rows: ImportedRow[];
  error?: string;
}

function runNodeProbe(script: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, rows: [], error: "MindSpider DB query timeout" });
    }, runtimeConfig.mindSpiderDbQueryTimeoutMs + 2_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, rows: [], error: messageOf(error) });
    });
    child.on("exit", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout || "{}") as ProbeResult;
        resolve({ ok: Boolean(parsed.ok), rows: Array.isArray(parsed.rows) ? parsed.rows.filter(isRecord) : [], error: parsed.error });
      } catch {
        resolve({ ok: false, rows: [], error: stderr || stdout || "invalid MindSpider DB probe output" });
      }
    });
  });
}

function isRecord(value: unknown): value is ImportedRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
