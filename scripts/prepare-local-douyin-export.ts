import fs from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

interface Args {
  mediaCrawlerDir: string;
  out: string;
  days: number;
  maxItemsPerGame: number;
  includeThumbnail: boolean;
}

const SS_BASE = "\u751f\u6b7b\u72d9\u51fb";
const SS2 = `${SS_BASE}2`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jsonDir = path.join(args.mediaCrawlerDir, "data", "douyin", "json");
  const files = await listJsonFiles(jsonDir);
  const cutoff = Date.now() - args.days * 24 * 60 * 60 * 1000;
  const contents = await readRows(files.filter((file) => /_contents_\d{4}-\d{2}-\d{2}\.json$/i.test(file) && fileDateMillis(file) >= cutoff));
  const comments = await readRows(files.filter((file) => /_comments_\d{4}-\d{2}-\d{2}\.json$/i.test(file) && fileDateMillis(file) >= cutoff));
  const commentsByAweme = groupComments(comments);
  const items = buildExportRows(contents, commentsByAweme, args);

  await fs.mkdir(path.dirname(args.out), { recursive: true });
  await fs.writeFile(args.out, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "local-bettafish-mediacrawler-cdp",
    items
  }, null, 2)}\n`, "utf-8");

  process.stdout.write(`Prepared ${items.length} Douyin row(s) at ${args.out}\n`);
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.add(key);
      continue;
    }
    values.set(key, next);
    index += 1;
  }

  const mediaCrawlerDir = values.get("media-crawler-dir") || process.env.BETTAFISH_MEDIA_CRAWLER_DIR || defaultMediaCrawlerDir();
  const out = values.get("out") || process.env.LOCAL_DOUYIN_EXPORT_PATH || path.join(process.cwd(), "data", "mindspider-douyin-imports", "local-cdp", "latest.json");
  return {
    mediaCrawlerDir: path.resolve(mediaCrawlerDir),
    out: path.resolve(out),
    days: positiveNumber(values.get("days"), 7),
    maxItemsPerGame: positiveNumber(values.get("max-items-per-game"), 80),
    includeThumbnail: flags.has("include-thumbnail") || /^(1|true|yes)$/i.test(process.env.LOCAL_DOUYIN_INCLUDE_THUMBNAIL || "")
  };
}

function defaultMediaCrawlerDir() {
  const candidates = [
    path.resolve(process.cwd(), "..", "BettaFish", "MindSpider", "DeepSentimentCrawling", "MediaCrawler"),
    path.resolve(process.cwd(), "..", "..", "BettaFish", "MindSpider", "DeepSentimentCrawling", "MediaCrawler"),
    path.resolve(process.env.USERPROFILE || "", "Documents", "BettaFish", "MindSpider", "DeepSentimentCrawling", "MediaCrawler")
  ];
  return candidates[0];
}

function positiveNumber(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function listJsonFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) return listJsonFiles(fullPath);
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) return [fullPath];
      return [];
    }));
    return nested.flat().sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readRows(files: string[]) {
  const rows: JsonRecord[] = [];
  for (const file of files) {
    const parsed = JSON.parse(stripBom(await fs.readFile(file, "utf-8"))) as unknown;
    if (Array.isArray(parsed)) rows.push(...parsed.filter(isRecord));
    else if (isRecord(parsed)) rows.push(parsed);
  }
  return rows;
}

function stripBom(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function fileDateMillis(file: string) {
  const match = path.basename(file).match(/_(\d{4}-\d{2}-\d{2})\.json$/);
  if (!match) return 0;
  const date = new Date(`${match[1]}T23:59:59+08:00`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function groupComments(rows: JsonRecord[]) {
  const grouped = new Map<string, JsonRecord[]>();
  for (const row of rows) {
    const awemeId = stringValue(row.aweme_id);
    if (!awemeId) continue;
    const list = grouped.get(awemeId) || [];
    list.push(row);
    grouped.set(awemeId, list);
  }

  for (const [key, value] of grouped) {
    grouped.set(key, value.sort((a, b) => numericValue(b.like_count) - numericValue(a.like_count)));
  }
  return grouped;
}

function buildExportRows(contents: JsonRecord[], commentsByAweme: Map<string, JsonRecord[]>, args: Args) {
  const latestByAweme = new Map<string, JsonRecord>();
  for (const row of contents) {
    const awemeId = stringValue(row.aweme_id);
    if (!awemeId) continue;
    const previous = latestByAweme.get(awemeId);
    if (!previous || numericValue(row.last_modify_ts) >= numericValue(previous.last_modify_ts)) latestByAweme.set(awemeId, row);
  }

  const perGame = new Map<string, number>();
  const rows = Array.from(latestByAweme.values())
    .sort((a, b) => numericValue(b.create_time) - numericValue(a.create_time))
    .flatMap((row) => {
      const gameId = inferGameId(row);
      if (!gameId) return [];
      const count = perGame.get(gameId) || 0;
      if (count >= args.maxItemsPerGame) return [];
      perGame.set(gameId, count + 1);

      const awemeId = stringValue(row.aweme_id);
      const exportRow: JsonRecord = {
        gameId,
        sourcePlatform: "douyin_aweme",
        aweme_id: awemeId,
        title: stringValue(row.title) || stringValue(row.desc),
        desc: stringValue(row.desc) || stringValue(row.title),
        aweme_url: stringValue(row.aweme_url) || `https://www.douyin.com/video/${awemeId}`,
        nickname: stringValue(row.nickname),
        create_time: normalizeTime(row.create_time),
        collectedAt: normalizeTime(row.last_modify_ts) || new Date().toISOString(),
        liked_count: numberOrUndefined(row.liked_count),
        comment_count: numberOrUndefined(row.comment_count),
        share_count: numberOrUndefined(row.share_count),
        collected_count: numberOrUndefined(row.collected_count),
        source_keyword: stringValue(row.source_keyword),
        comments: (commentsByAweme.get(awemeId) || []).map((comment) => stringValue(comment.content)).filter(Boolean).slice(0, 80)
      };
      if (args.includeThumbnail) exportRow.cover_url = stringValue(row.cover_url);
      return [exportRow];
    });

  return rows;
}

function inferGameId(row: JsonRecord) {
  const text = [
    row.source_keyword,
    row.title,
    row.desc
  ].map(stringValue).join(" ");
  if (text.includes(SS2) || /\bSS2\b/i.test(text)) return "ss2";
  if (text.includes(SS_BASE) || /\bSS1\b/i.test(text) || text.includes("4399")) return "ss1";
  return "";
}

function normalizeTime(value: unknown) {
  const numeric = numericValue(value);
  if (!numeric) return undefined;
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function numberOrUndefined(value: unknown) {
  const numeric = numericValue(value);
  return numeric || undefined;
}

function numericValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = stringValue(value).replace(/,/g, "");
  const matched = text.match(/-?\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : 0;
}

function stringValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean).join(" ");
  if (typeof value === "object") return "";
  return String(value).trim();
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
