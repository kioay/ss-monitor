import * as cheerio from "cheerio";
import { analyzeItem } from "../analyze";
import { runtimeConfig } from "../config";
import { fetchText, SourceError } from "../http";
import { hoursBetween, md5, normalizeUrl, nowIso, stripHtml, uniq } from "../utils";
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

  const candidates = Array.from(byUrl.values())
    .sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0))
    .slice(0, runtimeConfig.maxDouyinItemsPerGame);
  const items = candidates.map((candidate) => buildDouyinMonitorItem(game, candidate));

  const health: SourceHealth = {
    source: "douyin",
    sourceLabel: douyinLabel,
    gameId: game.id,
    ok: items.length > 0 || errors.length < game.douyinKeywords.length,
    fetchedAt,
    latencyMs: Date.now() - started,
    itemCount: items.length,
    staleDropped,
    blocked,
    message:
      errors.length === 0
        ? "通过公开搜索结果发现抖音公开视频/图文，并按搜索结果时间过滤；不使用抖音官方接口。"
        : `抖音公开搜索采集受限：${errors.slice(0, 2).join("；")}`
  };

  return { items, health };
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
  const analysis = analyzeItem({ title: candidate.title, contentParts, metrics: {} });

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
