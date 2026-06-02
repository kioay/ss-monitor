import * as cheerio from "cheerio";
import { analyzeItem } from "../analyze";
import { runtimeConfig } from "../config";
import { fetchText, SourceError } from "../http";
import { hoursBetween, md5, normalizeUrl, nowIso, stripHtml, uniq } from "../utils";
import { collectAuthorizedDouyinSourceItems } from "./douyinAuthorizedSources";
import { collectImportedDouyinItems } from "./douyinImport";
import { collectMindSpiderDouyinItems } from "./mindspiderDouyin";
import type { ContentPart, GameConfig, MonitorItem, SourceHealth } from "../../src/shared";

interface DouyinCandidate {
  id: string;
  title: string;
  url: string;
  author: string;
  description: string;
  publishedAt?: Date;
}

const douyinLabel = "抖音视频";

export async function collectDouyin(game: GameConfig, cutoff: Date) {
  const started = Date.now();
  const fetchedAt = nowIso();
  const errors: string[] = [];
  let blocked = false;
  let staleDropped = 0;
  const byUrl = new Map<string, DouyinCandidate>();
  const mindSpider = await collectMindSpiderDouyinItems(game, cutoff).catch((error) => {
    errors.push(`MindSpider: ${error instanceof Error ? error.message : String(error)}`);
    return {
      items: [] as MonitorItem[],
      staleDropped: 0,
      errors: [] as string[],
      fileCount: 0,
      rowCount: 0,
      dbConfigured: false,
      dbRows: 0,
      exportFileCount: 0,
      exportRowCount: 0,
      sourceMessages: [] as string[]
    };
  });
  staleDropped += mindSpider.staleDropped;
  errors.push(...mindSpider.errors.slice(0, 8).map((error) => `MindSpider: ${error}`));
  const imported = await collectImportedDouyinItems(game, cutoff).catch((error) => {
    errors.push(`authorized import: ${error instanceof Error ? error.message : String(error)}`);
    return { items: [] as MonitorItem[], staleDropped: 0, errors: [] as string[], fileCount: 0, rowCount: 0 };
  });
  staleDropped += imported.staleDropped;
  errors.push(...imported.errors.slice(0, 8).map((error) => `authorized import: ${error}`));
  const authorized = await collectAuthorizedDouyinSourceItems(game, cutoff).catch((error) => {
    errors.push(`authorized API: ${error instanceof Error ? error.message : String(error)}`);
    return { items: [] as MonitorItem[], staleDropped: 0, errors: [] as string[], fileCount: 0, rowCount: 0 };
  });
  staleDropped += authorized.staleDropped;
  errors.push(...authorized.errors.slice(0, 8).map((error) => `authorized API: ${error}`));

  if (runtimeConfig.douyinPublicSearchEnabled) {
    for (const keyword of game.douyinKeywords) {
      try {
        const candidates = await searchSogouDouyin(keyword);
        for (const candidate of candidates) {
          if (!isRelevantDouyinResult(game.id, candidate)) continue;
          if (!candidate.publishedAt || candidate.publishedAt < cutoff) {
            staleDropped += 1;
            continue;
          }
          byUrl.set(candidate.url, candidate);
        }
      } catch (error) {
        const sourceError = error as SourceError;
        blocked ||= Boolean(sourceError.blocked);
        errors.push(`${keyword}: ${sourceError.message}`);
      }
    }
  }

  const candidates = Array.from(byUrl.values())
    .sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0))
    .slice(0, runtimeConfig.maxDouyinItemsPerGame);
  const searchItems = candidates.map((candidate) => buildDouyinMonitorItem(game, candidate));
  const items = mergeDouyinItems([...mindSpider.items, ...authorized.items, ...imported.items, ...searchItems]).slice(0, runtimeConfig.maxDouyinItemsPerGame);
  const expectedSourceCount = 2 + (runtimeConfig.douyinPublicSearchEnabled ? game.douyinKeywords.length : 0);
  const hasConfiguredSource =
    mindSpider.dbConfigured
    || mindSpider.exportFileCount > 0
    || imported.fileCount > 0
    || authorized.fileCount > 0
    || runtimeConfig.douyinPublicSearchEnabled;

  const health: SourceHealth = {
    source: "douyin",
    sourceLabel: douyinLabel,
    gameId: game.id,
    ok: items.length > 0 || (hasConfiguredSource && errors.length === 0),
    fetchedAt,
    latencyMs: Date.now() - started,
    itemCount: items.length,
    staleDropped,
    blocked: runtimeConfig.douyinPublicSearchEnabled ? blocked : false,
    message: formatDouyinHealthMessage({
      itemCount: items.length,
      mindSpider,
      imported,
      authorized,
      searchCount: searchItems.length,
      errors,
      blocked
    })
  };

  return { items, health };
}

function formatDouyinHealthMessage({
  itemCount,
  mindSpider,
  imported,
  authorized,
  searchCount,
  errors,
  blocked
}: {
  itemCount: number;
  mindSpider: Awaited<ReturnType<typeof collectMindSpiderDouyinItems>>;
  imported: Awaited<ReturnType<typeof collectImportedDouyinItems>>;
  authorized: Awaited<ReturnType<typeof collectAuthorizedDouyinSourceItems>>;
  searchCount: number;
  errors: string[];
  blocked: boolean;
}) {
  const parts: string[] = [
    `MindSpider ${mindSpider.items.length}/${mindSpider.rowCount} 条`,
    `授权 API ${authorized.items.length}/${authorized.rowCount} 条`,
    `授权导入 ${imported.items.length}/${imported.rowCount} 条`
  ];
  if (runtimeConfig.douyinPublicSearchEnabled) {
    parts.push(`公开搜索 ${searchCount} 条${blocked ? "，受限" : ""}`);
  } else {
    parts.push("公开搜索已关闭");
  }
  if (!mindSpider.dbConfigured && mindSpider.exportFileCount === 0) {
    parts.push("等待 MindSpider DB 配置或实验导出文件");
  }
  if (itemCount === 0 && !runtimeConfig.douyinPublicSearchEnabled) {
    parts.push("抖音主链路当前只接受实验/授权来源");
  }
  if (errors.length) parts.push(`问题：${errors.slice(0, 2).join("；")}`);
  return parts.join("；");
}

function mergeDouyinItems(items: MonitorItem[]) {
  const seen = new Set<string>();
  return items
    .sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt))
    .filter((item) => {
      const urlKey = item.url.startsWith("http") ? item.url : "";
      const key = urlKey || item.id;
      if (seen.has(key) || seen.has(item.id)) return false;
      seen.add(key);
      seen.add(item.id);
      return true;
    });
}

async function searchSogouDouyin(keyword: string) {
  const query = `site:www.douyin.com ${keyword} 抖音`;
  const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}&ie=utf8`;
  const html = await fetchText(url, {
    referer: "https://www.sogou.com/",
    timeoutMs: 15_000
  });
  if (looksSearchBlocked(html)) throw new SourceError("搜狗搜索结果触发安全验证", true);

  const $ = cheerio.load(html);
  const candidates: DouyinCandidate[] = [];
  $(".vrwrap").each((_, element) => {
    const node = $(element);
    const url = normalizeDouyinUrl(node.find("[data-url*='douyin.com']").first().attr("data-url") || "");
    if (!url || !isPublicDouyinContentUrl(url)) return;

    const title = stripHtml(node.find("h3").first().text());
    const description = stripHtml(node.find(".space-txt, [id^='cacheresult_summary']").first().text());
    const dateText = stripHtml(node.find(".cite-date").first().text()) || findDateText(node.text());
    const publishedAt = parseSearchDate(dateText);
    const id = extractDouyinId(url) || md5(url).slice(0, 16);
    candidates.push({
      id,
      title: title || description.slice(0, 48) || "抖音公开视频",
      url,
      author: "抖音公开搜索",
      description,
      publishedAt
    });
  });

  return uniqBy(candidates, (candidate) => candidate.url);
}

function buildDouyinMonitorItem(game: GameConfig, candidate: DouyinCandidate): MonitorItem {
  const collectedAt = new Date();
  const publishedAt = candidate.publishedAt || collectedAt;
  const contentParts: ContentPart[] = [
    { type: "title", text: candidate.title, count: 1 },
    ...(candidate.description ? [{ type: "description" as const, text: candidate.description, count: 1 }] : [])
  ];
  const analysis = analyzeItem({ title: candidate.title, gameId: game.id, contentParts, metrics: {} });

  return {
    id: `douyin:${candidate.id}`,
    gameId: game.id,
    gameName: game.name,
    source: "douyin",
    sourceLabel: douyinLabel,
    sourceItemId: candidate.id,
    title: candidate.title,
    author: candidate.author,
    url: candidate.url,
    publishedAt: publishedAt.toISOString(),
    collectedAt: collectedAt.toISOString(),
    freshnessHours: hoursBetween(collectedAt, publishedAt),
    metrics: {},
    contentParts,
    parsedContentCount: contentParts.reduce((sum, part) => sum + (part.count || 1), 0),
    ...analysis
  };
}

function normalizeDouyinUrl(rawUrl: string) {
  const url = normalizeUrl(rawUrl.replace(/&amp;/g, "&"));
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith("douyin.com")) return "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isPublicDouyinContentUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith("douyin.com") && /^\/(?:video|note)\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

function extractDouyinId(url: string) {
  return new URL(url).pathname.match(/\/(?:video|note)\/([^/?#]+)/)?.[1] || "";
}

function parseSearchDate(raw: string) {
  const text = raw.trim();
  if (!text) return undefined;
  const full = text.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (full) return new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]), 12);

  const monthDay = text.match(/(\d{1,2})[-/.月](\d{1,2})/);
  if (monthDay) {
    const now = new Date();
    const date = new Date(now.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]), 12);
    if (date > now) date.setFullYear(date.getFullYear() - 1);
    return date;
  }
  return undefined;
}

function findDateText(text: string) {
  return text.match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/)?.[0] || "";
}

function isRelevantDouyinResult(gameId: GameConfig["id"], candidate: DouyinCandidate) {
  const text = `${candidate.title} ${candidate.description}`;
  if (gameId === "ss2") return /生死狙击2/.test(text);
  return /生死狙击|4399生死狙击|生死狙击1/.test(text) && !/生死狙击2|热油/.test(text);
}

function looksSearchBlocked(html: string) {
  return /安全验证|请输入验证码|captcha|异常流量|访问过于频繁/.test(html);
}

function uniqBy<T>(items: T[], keyOf: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
