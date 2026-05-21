import * as cheerio from "cheerio";
import { analyzeItem } from "../analyze";
import { runtimeConfig } from "../config";
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

export async function collectBilibili(game: GameConfig, cutoff: Date) {
  const started = Date.now();
  const fetchedAt = nowIso();
  const errors: string[] = [];
  let blocked = false;
  let staleDropped = 0;
  const byBvid = new Map<string, BiliSearchItem>();

  for (const keyword of game.bilibiliKeywords) {
    try {
      const result = await searchVideos(keyword);
      for (const item of result) {
        if (!item.bvid || !isRelevantVideo(game.id, item)) continue;
        const publishedAt = new Date(item.pubdate * 1000);
        if (Number.isNaN(publishedAt.getTime()) || publishedAt < cutoff) {
          staleDropped += 1;
          continue;
        }
        const existing = byBvid.get(item.bvid);
        if (!existing || item.pubdate > existing.pubdate) byBvid.set(item.bvid, item);
      }
    } catch (error) {
      const sourceError = error as SourceError;
      blocked ||= Boolean(sourceError.blocked);
      errors.push(`${keyword}: ${sourceError.blocked ? "触发 B 站风控，可配置 BILIBILI_COOKIE 后重试" : sourceError.message}`);
    }
  }

  const candidates = Array.from(byBvid.values())
    .sort((a, b) => b.pubdate - a.pubdate)
    .slice(0, runtimeConfig.maxVideosPerGame);

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
    sourceLabel: "B站视频",
    gameId: game.id,
    ok: items.length > 0 || errors.length < game.bilibiliKeywords.length,
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

async function searchVideos(keyword: string) {
  const url = await signedWbiUrl("https://api.bilibili.com/x/web-interface/wbi/search/type", {
    search_type: "video",
    keyword,
    order: "pubdate",
    page: 1
  });
  const data = await fetchJson<BiliSearchResponse>(url, {
    referer: "https://search.bilibili.com/",
    cookie: sourceCookie("bilibili")
  });

  if (data.code !== 0) {
    throw new SourceError(`B站搜索失败：${data.message || data.code}`);
  }
  return data.data?.result || [];
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
  const analysis = analyzeItem({ title, contentParts, metrics });

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

async function signedWbiUrl(baseUrl: string, params: Record<string, string | number>) {
  const key = await getWbiKey();
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

async function getWbiKey() {
  if (wbiKeyCache && wbiKeyCache.expiresAt > Date.now()) return wbiKeyCache.key;

  const nav = await fetchJson<WbiNavResponse>("https://api.bilibili.com/x/web-interface/nav", {
    referer: "https://www.bilibili.com/",
    cookie: sourceCookie("bilibili")
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

function isRelevantVideo(gameId: GameConfig["id"], item: BiliSearchItem) {
  const title = stripHtml(item.title);
  const description = stripHtml(item.description || item.desc || "");
  const tags = item.tag || "";
  const author = item.author || "";
  const text = `${title} ${description} ${tags} ${author}`;
  if (gameId === "ss2") {
    if (/生死狙击2/.test(`${title} ${description} ${author}`)) return true;
    return /生死狙击2/.test(tags) && /(FPS|fps|射击|枪战|变异|狙击|热油|教程|攻略|端游|塔菲|甩狙|瞬狙)/.test(text);
  }
  if (/生死狙击2|热油/.test(text)) return false;
  return /生死狙击|4399生死狙击|生死狙击1|生死狙击页游/.test(text);
}
