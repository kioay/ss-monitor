import * as cheerio from "cheerio";
import { analyzeItem } from "../analyze";
import { runtimeConfig, textMatchesGame } from "../config";
import { fetchJson, fetchText, SourceError, sourceCookie } from "../http";
import { hoursBetween, md5, normalizeUrl, nowIso, stripHtml, uniq } from "../utils";
import type { ContentPart, GameConfig, MonitorItem, SourceHealth } from "../../src/shared";

interface BiliSearchItem {
  aid: number;
  bvid: string;
  title: string;
  description?: string;
  desc?: string;
  author: string;
  pic?: string;
  play?: number;
  review?: number;
  video_review?: number;
  favorites?: number;
  like?: number;
  tag?: string;
  pubdate: number;
  senddate?: number;
  duration?: string;
}

interface BiliSearchResponse {
  code: number;
  message: string;
  data?: {
    result?: BiliSearchItem[];
  };
}

interface BiliViewResponse {
  code: number;
  message: string;
  data?: {
    aid: number;
    bvid: string;
    title: string;
    desc: string;
    pubdate: number;
    pic?: string;
    owner?: { name?: string };
    cid?: number;
    pages?: Array<{ cid: number }>;
    stat?: {
      view?: number;
      reply?: number;
      danmaku?: number;
      favorite?: number;
      like?: number;
      share?: number;
    };
    subtitle?: {
      list?: Array<{ subtitle_url?: string; lan_doc?: string }>;
    };
  };
}

interface BiliReplyResponse {
  code: number;
  message: string;
  data?: {
    replies?: Array<{
      content?: { message?: string };
      replies?: Array<{ content?: { message?: string } }>;
    }>;
  };
}

interface WbiNavResponse {
  code: number;
  data?: {
    wbi_img?: {
      img_url?: string;
      sub_url?: string;
    };
  };
}

const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12,
  38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62,
  11, 36, 20, 34, 44, 52
];

let wbiKeyCache: { key: string; expiresAt: number } | undefined;
let anonymousCookieCache: { cookie: string; expiresAt: number } | undefined;
const anonymousCookieTtlMs = 6 * 60 * 60_000;
const bilibiliUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

interface CollectBilibiliOptions {
  relevanceMode?: "game" | "keyword";
  maxKeywords?: number;
  maxPages?: number;
  maxItems?: number;
  sourceLabel?: string;
}

export async function collectBilibili(game: GameConfig, cutoff: Date, options: CollectBilibiliOptions = {}) {
  const started = Date.now();
  const fetchedAt = nowIso();
  const errors: string[] = [];
  let blocked = false;
  let staleDropped = 0;
  const byBvid = new Map<string, BiliSearchItem>();
  const keywords = game.bilibiliKeywords.slice(0, options.maxKeywords || game.bilibiliKeywords.length);
  const maxPages = options.maxPages || runtimeConfig.maxBilibiliSearchPages;
  const maxItems = options.maxItems || runtimeConfig.maxVideosPerGame;
  const relevanceMode = options.relevanceMode || "game";

  for (const keyword of keywords) {
    try {
      for (let page = 1; page <= maxPages; page += 1) {
        const result = await searchVideos(keyword, page);
        let pageHasWindowItems = false;
        for (const item of result) {
          const publishedAt = new Date(item.pubdate * 1000);
          if (!Number.isNaN(publishedAt.getTime()) && publishedAt >= cutoff) pageHasWindowItems = true;
          if (!item.bvid || !isRelevantVideo(game, item, relevanceMode)) continue;
          if (Number.isNaN(publishedAt.getTime()) || publishedAt < cutoff) {
            staleDropped += 1;
            continue;
          }
          const existing = byBvid.get(item.bvid);
          if (!existing || item.pubdate > existing.pubdate) byBvid.set(item.bvid, item);
        }
        if (!result.length || !pageHasWindowItems) break;
      }
    } catch (error) {
      const sourceError = error as SourceError;
      blocked ||= Boolean(sourceError.blocked);
      errors.push(`${keyword}: ${sourceError.blocked ? "触发 B 站风控，可配置 BILIBILI_COOKIE 后重试" : sourceError.message}`);
    }
  }

  const candidates = Array.from(byBvid.values())
    .sort((a, b) => b.pubdate - a.pubdate)
    .slice(0, maxItems);

  const deepSet = makeDeepParseSet(candidates);
  const settled = await Promise.allSettled(
    candidates.map((item) => buildBiliMonitorItem(game, item, deepSet.has(item.bvid)))
  );

  const items: MonitorItem[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      items.push(result.value);
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  const health: SourceHealth = {
    source: "bilibili",
    sourceLabel: options.sourceLabel || "B站视频",
    gameId: game.id,
    ok: items.length > 0 || errors.length < keywords.length,
    fetchedAt,
    latencyMs: Date.now() - started,
    itemCount: items.length,
    staleDropped,
    blocked,
    message:
      errors.length === 0
        ? "按发布时间排序获取，并解析了视频详情、简介、评论、弹幕和可用字幕。"
        : `部分采集受限：${errors.slice(0, 2).join("；")}`
  };

  return { items, health };
}

async function searchVideos(keyword: string, page: number) {
  try {
    return await searchVideosWithCookie(keyword, page, bilibiliCookie());
  } catch (error) {
    const sourceError = error as SourceError;
    if (!sourceError.blocked || sourceCookie("bilibili")) throw error;
    const cookie = await refreshAnonymousBilibiliCookie(keyword);
    return searchVideosWithCookie(keyword, page, cookie);
  }
}

async function searchVideosWithCookie(keyword: string, page: number, cookie: string) {
  const url = await signedWbiUrl("https://api.bilibili.com/x/web-interface/wbi/search/type", {
    search_type: "video",
    keyword,
    order: "pubdate",
    page
  }, cookie);
  const data = await fetchJson<BiliSearchResponse>(url, {
    referer: "https://search.bilibili.com/",
    cookie
  });

  if (data.code !== 0) {
    throw new SourceError(`B站搜索失败：${data.message || data.code}`);
  }
  return data.data?.result || [];
}

function bilibiliCookie() {
  const configuredCookie = sourceCookie("bilibili");
  if (configuredCookie) return configuredCookie;
  if (anonymousCookieCache && anonymousCookieCache.expiresAt > Date.now()) return anonymousCookieCache.cookie;
  return "";
}

async function refreshAnonymousBilibiliCookie(keyword: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": bilibiliUserAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
        Referer: "https://www.bilibili.com/"
      }
    });
    const text = await response.text();
    if (!response.ok || looksBilibiliBlocked(text)) {
      throw new SourceError(`B站匿名会话获取失败：HTTP ${response.status}`, true);
    }
    const cookie = cookieHeaderFromSetCookie(response.headers);
    if (!cookie) throw new SourceError("B站匿名会话未返回 cookie", true);
    anonymousCookieCache = { cookie, expiresAt: Date.now() + anonymousCookieTtlMs };
    return cookie;
  } finally {
    clearTimeout(timeout);
  }
}

function cookieHeaderFromSetCookie(headers: Headers) {
  const headerValues =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : splitSetCookieHeader(headers.get("set-cookie") || "");
  return headerValues
    .map((value) => value.split(";")[0]?.trim())
    .filter((value) => /^(buvid3|b_nut|buvid4|SESSDATA|bili_jct)=/.test(value || ""))
    .join("; ");
}

function splitSetCookieHeader(value: string) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,]+=)/).map((item) => item.trim()).filter(Boolean);
}

function looksBilibiliBlocked(text: string) {
  return text.includes("错误号: 412") || text.includes("security control policy");
}

async function buildBiliMonitorItem(game: GameConfig, searchItem: BiliSearchItem, deepParse: boolean): Promise<MonitorItem> {
  const collectedAt = new Date();
  const detail = deepParse ? await fetchVideoDetail(searchItem.bvid).catch(() => undefined) : undefined;
  const data = detail?.data;
  const aid = data?.aid || searchItem.aid;
  const cid = data?.cid || data?.pages?.[0]?.cid;
  const title = stripHtml(data?.title || searchItem.title);
  const description = stripHtml(data?.desc || searchItem.description || searchItem.desc || "");
  const tags = splitTags(searchItem.tag || "");

  const contentParts: ContentPart[] = [
    { type: "title", text: title, count: 1 },
    ...(description ? [{ type: "description" as const, text: description, count: 1 }] : []),
    ...(tags.length ? [{ type: "tag" as const, text: tags.join("、"), count: tags.length }] : [])
  ];

  if (deepParse) {
    const [comments, danmaku, subtitles] = await Promise.all([
      fetchComments(aid).catch(() => []),
      cid ? fetchDanmaku(cid, searchItem.bvid).catch(() => []) : Promise.resolve([]),
      fetchSubtitles(data?.subtitle?.list || [], searchItem.bvid).catch(() => [])
    ]);

    for (const message of comments.slice(0, 35)) contentParts.push({ type: "comment", text: message, count: 1 });
    if (danmaku.length) {
      contentParts.push({ type: "danmaku", text: danmaku.slice(0, 80).join(" / "), count: danmaku.length });
    }
    if (subtitles.length) {
      contentParts.push({ type: "subtitle", text: subtitles.slice(0, 80).join(" "), count: subtitles.length });
    }
  }

  const publishedAt = new Date((data?.pubdate || searchItem.pubdate) * 1000);
  const metrics = {
    views: data?.stat?.view ?? searchItem.play,
    replies: data?.stat?.reply ?? searchItem.review,
    comments: data?.stat?.reply ?? searchItem.review,
    likes: data?.stat?.like ?? searchItem.like,
    danmaku: data?.stat?.danmaku ?? searchItem.video_review,
    favorites: data?.stat?.favorite ?? searchItem.favorites,
    shares: data?.stat?.share
  };
  const analysis = analyzeItem({ title, gameId: game.id, contentParts, metrics });

  return {
    id: `bilibili:${searchItem.bvid}`,
    gameId: game.id,
    gameName: game.name,
    source: "bilibili",
    sourceLabel: "B站视频",
    sourceItemId: searchItem.bvid,
    title,
    author: data?.owner?.name || searchItem.author || "未知作者",
    url: `https://www.bilibili.com/video/${searchItem.bvid}/`,
    thumbnail: normalizeUrl(data?.pic || searchItem.pic || ""),
    publishedAt: publishedAt.toISOString(),
    collectedAt: collectedAt.toISOString(),
    freshnessHours: hoursBetween(collectedAt, publishedAt),
    metrics,
    contentParts,
    parsedContentCount: contentParts.reduce((sum, part) => sum + (part.count || 1), 0),
    ...analysis
  };
}

async function fetchVideoDetail(bvid: string) {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const data = await fetchJson<BiliViewResponse>(url, {
    referer: `https://www.bilibili.com/video/${bvid}/`,
    cookie: sourceCookie("bilibili")
  });
  if (data.code !== 0 || !data.data) {
    throw new SourceError(`B站视频详情失败：${data.message || data.code}`);
  }
  return data;
}

async function fetchComments(aid: number) {
  try {
    return await fetchWbiComments(aid);
  } catch {
    return fetchLegacyComments(aid);
  }
}

async function fetchWbiComments(aid: number) {
  const url = await signedWbiUrl("https://api.bilibili.com/x/v2/reply/wbi/main", {
    type: 1,
    oid: aid,
    mode: 3,
    next: 0,
    ps: 20
  });
  const data = await fetchJson<BiliReplyResponse>(url, {
    referer: `https://www.bilibili.com/video/av${aid}/`,
    cookie: sourceCookie("bilibili")
  });
  return flattenReplies(data);
}

async function fetchLegacyComments(aid: number) {
  const url = `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=2&pn=1&ps=20`;
  const data = await fetchJson<BiliReplyResponse>(url, {
    referer: `https://www.bilibili.com/video/av${aid}/`,
    cookie: sourceCookie("bilibili")
  });
  return flattenReplies(data);
}

function flattenReplies(data: BiliReplyResponse) {
  const comments: string[] = [];
  for (const reply of data.data?.replies || []) {
    const message = stripHtml(reply.content?.message || "");
    if (message) comments.push(message);
    for (const child of reply.replies?.slice(0, 2) || []) {
      const childMessage = stripHtml(child.content?.message || "");
      if (childMessage) comments.push(childMessage);
    }
  }
  return comments;
}

async function fetchDanmaku(cid: number, bvid: string) {
  const xml = await fetchText(`https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`, {
    referer: `https://www.bilibili.com/video/${bvid}/`,
    cookie: sourceCookie("bilibili")
  });
  const $ = cheerio.load(xml, { xmlMode: true });
  const values: string[] = [];
  $("d").each((_, element) => {
    const text = stripHtml($(element).text());
    if (text && text.length > 1) values.push(text);
  });
  return uniq(values).slice(0, 160);
}

async function fetchSubtitles(list: Array<{ subtitle_url?: string }>, bvid: string) {
  const subtitles: string[] = [];
  for (const item of list.slice(0, 2)) {
    if (!item.subtitle_url) continue;
    const url = normalizeUrl(item.subtitle_url);
    const data = await fetchJson<{ body?: Array<{ content?: string }> }>(url, {
      referer: `https://www.bilibili.com/video/${bvid}/`,
      cookie: sourceCookie("bilibili")
    });
    for (const line of data.body || []) {
      const text = stripHtml(line.content || "");
      if (text) subtitles.push(text);
    }
  }
  return subtitles;
}

async function signedWbiUrl(baseUrl: string, params: Record<string, string | number>, cookie = bilibiliCookie()) {
  const key = await getWbiKey(cookie);
  const signedParams: Record<string, string | number> = {
    ...params,
    wts: Math.round(Date.now() / 1000)
  };
  const query = Object.keys(signedParams)
    .sort()
    .map((keyName) => {
      const value = String(signedParams[keyName]).replace(/[!'()*]/g, "");
      return `${encodeURIComponent(keyName)}=${encodeURIComponent(value)}`;
    })
    .join("&");
  const wRid = md5(query + key);
  return `${baseUrl}?${query}&w_rid=${wRid}`;
}

async function getWbiKey(cookie = bilibiliCookie()) {
  if (wbiKeyCache && wbiKeyCache.expiresAt > Date.now()) return wbiKeyCache.key;

  const nav = await fetchJson<WbiNavResponse>("https://api.bilibili.com/x/web-interface/nav", {
    referer: "https://www.bilibili.com/",
    cookie
  });
  const imgKey = fileStem(nav.data?.wbi_img?.img_url || "");
  const subKey = fileStem(nav.data?.wbi_img?.sub_url || "");
  if (!imgKey || !subKey) throw new SourceError("无法获取 B 站 WBI key");
  const raw = (imgKey + subKey).split("");
  const mixed = mixinKeyEncTab.map((index) => raw[index]).join("").slice(0, 32);
  wbiKeyCache = { key: mixed, expiresAt: Date.now() + 60 * 60 * 1000 };
  return mixed;
}

function fileStem(url: string) {
  const match = url.match(/\/([^/?#]+)\.(?:png|jpg|webp)/);
  return match?.[1] || "";
}

function splitTags(tagText: string) {
  return uniq(
    tagText
      .split(/[,，\s]+/)
      .map((tag) => stripHtml(tag))
      .filter(Boolean)
  ).slice(0, 12);
}

function makeDeepParseSet(candidates: BiliSearchItem[]) {
  const deepSet = new Set(candidates.slice(0, runtimeConfig.maxVideosToDeepParsePerGame).map((item) => item.bvid));
  const maxDeep = Math.min(candidates.length, runtimeConfig.maxVideosToDeepParsePerGame + 6);
  for (const item of candidates) {
    if (deepSet.size >= maxDeep) break;
    if (needsAudienceContext(item)) deepSet.add(item.bvid);
  }
  return deepSet;
}

function needsAudienceContext(item: BiliSearchItem) {
  const text = `${stripHtml(item.title)} ${stripHtml(item.description || item.desc || "")} ${item.tag || ""}`;
  return /(难受|骂|外挂|外卦|开挂|封号|作弊|科技|辅助|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|穿墙|无后座|无后坐|DMA|驱动|过检测|免封|QQ群|群号|加群|进群|售卖|卡密|代理|破游戏|BUG|bug|卡顿|崩溃|氪|削弱|匹配|单排|四排|五排|巅王|战队车|技术|操作|身法|教学|教程|击杀|高光|视角)/.test(text);
}

function isRelevantVideo(game: GameConfig, item: BiliSearchItem, mode: "game" | "keyword" = "game") {
  const title = stripHtml(item.title);
  const description = stripHtml(item.description || item.desc || "");
  const tags = item.tag || "";
  const author = item.author || "";
  const primaryText = `${title} ${description} ${author}`;
  const text = `${primaryText} ${tags}`;
  if (mode === "keyword") return textMatchesGame(primaryText, game) || textMatchesGame(tags, game);
  if (isCompetingShooter(primaryText) && !mentionsTargetGame(primaryText, game)) return false;
  if (game.id === "ss2") {
    if (/生死狙击2/.test(primaryText)) return true;
    return /生死狙击2/.test(tags) && hasGameContext(primaryText);
  }
  if (game.id === "ss1") {
    if (/生死狙击2|热油/.test(text)) return false;
    if (/生死狙击|4399生死狙击|生死狙击1|生死狙击页游/.test(primaryText)) return true;
    return /生死狙击|4399生死狙击|生死狙击1|生死狙击页游/.test(tags) && hasGameContext(primaryText);
  }
  return textMatchesGame(primaryText, game) || textMatchesGame(tags, game);
}

function mentionsTargetGame(text: string, game: GameConfig) {
  if (game.id === "ss2") return /生死狙击2/.test(text);
  if (game.id === "ss1") return /生死狙击|4399生死狙击|生死狙击1|生死狙击页游/.test(text) && !/生死狙击2|热油/.test(text);
  return textMatchesGame(text, game);
}

function isCompetingShooter(text: string) {
  return /\bCF\b|穿越火线|CrossFire|无畏契约|瓦罗兰特|Valorant|CS2|反恐精英|和平精英|三角洲行动|逆战/.test(text);
}

function hasGameContext(text: string) {
  return /刷关|关卡|冒险|变异|狙击|甩狙|瞬狙|身法|枪法|枪战|武器|皮肤|军费|匹配|排位|PVP|PVE|pvp|pve|塔菲|热油|页游|4399|沙漠奇兵|天梯|战术|英雄级|典藏/.test(text);
}
