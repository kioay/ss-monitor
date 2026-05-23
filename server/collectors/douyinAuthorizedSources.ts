import fs from "node:fs/promises";
import path from "node:path";
import { runtimeConfig } from "../config";
import { SourceError } from "../http";
import { rowsToDouyinMonitorItems, type ImportedRow, type ImportParseResult } from "./douyinImport";
import type { GameConfig } from "../../src/shared";

interface AuthorizedSourcesFile {
  sources?: AuthorizedJsonSource[];
}

interface AuthorizedJsonSource {
  id: string;
  label?: string;
  enabled?: boolean;
  url?: string;
  urlEnv?: string;
  method?: "GET" | "POST";
  tokenEnv?: string;
  tokenHeader?: string;
  tokenPrefix?: string;
  headers?: Record<string, string>;
  body?: unknown;
  rowsPath?: string;
  fieldMap?: Record<string, string>;
  staticFields?: Record<string, unknown>;
  timeoutMs?: number;
}

interface SourceFetchResult {
  rows: Array<{ row: ImportedRow; label: string }>;
  errors: string[];
  sourceCount: number;
}

export async function collectAuthorizedDouyinSourceItems(game: GameConfig, cutoff: Date): Promise<ImportParseResult> {
  const fetched = await fetchAuthorizedRows();
  const parsed = rowsToDouyinMonitorItems(
    game,
    cutoff,
    fetched.rows,
    { sourceLabel: "Douyin authorized API" }
  );
  return {
    ...parsed,
    errors: [...fetched.errors, ...parsed.errors],
    fileCount: fetched.sourceCount,
    rowCount: fetched.rows.length
  };
}

async function fetchAuthorizedRows(): Promise<SourceFetchResult> {
  const sources = await readSourcesConfig(runtimeConfig.douyinAuthorizedSourcesPath);
  const rows: Array<{ row: ImportedRow; label: string }> = [];
  const errors: string[] = [];
  let sourceCount = 0;

  for (const source of sources) {
    if (source.enabled === false) continue;
    sourceCount += 1;
    try {
      const sourceRows = await fetchSourceRows(source);
      rows.push(...sourceRows.map((row) => ({ row, label: source.label || source.id })));
    } catch (error) {
      errors.push(`${source.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { rows, errors, sourceCount };
}

async function readSourcesConfig(configPath: string) {
  try {
    const raw = await fs.readFile(path.resolve(configPath), "utf-8");
    const parsed = JSON.parse(raw) as AuthorizedSourcesFile | AuthorizedJsonSource[];
    const sources = Array.isArray(parsed) ? parsed : parsed.sources || [];
    return sources.filter(isValidSource);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function fetchSourceRows(source: AuthorizedJsonSource) {
  const url = source.url || valueFromEnv(source.urlEnv);
  if (!url) throw new SourceError("missing url or urlEnv");

  const token = valueFromEnv(source.tokenEnv);
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...source.headers
  };
  if (source.body !== undefined) headers["Content-Type"] ||= "application/json";
  if (source.tokenEnv && !token) throw new SourceError(`missing token env ${source.tokenEnv}`);
  if (token) headers[source.tokenHeader || "Authorization"] = `${source.tokenPrefix ?? "Bearer "}${token}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), source.timeoutMs || 15_000);
  try {
    const response = await fetch(url, {
      method: source.method || (source.body === undefined ? "GET" : "POST"),
      headers,
      body: source.body === undefined ? undefined : JSON.stringify(source.body),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new SourceError(`HTTP ${response.status}: ${text.slice(0, 120)}`);
    const json = JSON.parse(text) as unknown;
    const rawRows = arrayAtPath(json, source.rowsPath || "items");
    return rawRows.map((row) => mapRow(row, source));
  } finally {
    clearTimeout(timeout);
  }
}

function mapRow(raw: unknown, source: AuthorizedJsonSource): ImportedRow {
  const base = isRecord(raw) ? raw : { value: raw };
  const mapped: ImportedRow = { ...source.staticFields };
  if (!source.fieldMap) return { ...base, ...mapped };

  for (const [targetKey, sourcePath] of Object.entries(source.fieldMap)) {
    const value = valueAtPath(base, sourcePath);
    if (value !== undefined) mapped[targetKey] = value;
  }
  return mapped;
}

function arrayAtPath(root: unknown, pathExpression: string) {
  const value = valueAtPath(root, pathExpression);
  if (Array.isArray(value)) return value;
  if (value === undefined && Array.isArray(root)) return root;
  return [];
}

function valueAtPath(root: unknown, pathExpression: string) {
  if (!pathExpression || pathExpression === ".") return root;
  return pathExpression.split(".").reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && /^\d+$/.test(segment)) return current[Number(segment)];
    if (isRecord(current)) return current[segment];
    return undefined;
  }, root);
}

function valueFromEnv(name: string | undefined) {
  return name ? process.env[name] || "" : "";
}

function isValidSource(source: AuthorizedJsonSource) {
  return Boolean(source?.id && (source.url || source.urlEnv));
}

function isRecord(value: unknown): value is ImportedRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
