import * as cheerio from "cheerio";
import { analyzeItem } from "../analyze";
import { runtimeConfig } from "../config";
import { fetchText, looksBlocked, SourceError, sourceCookie } from "../http";
import { hoursBetween, md5, normalizeUrl, nowIso, stripHtml } from "../utils";
import type { ContentPart, GameConfig, MonitorItem, RiskSignalSource, SourceHealth } from "../../src/shared";

interface TiebaThreadCandidate {
  tid: string;
  bar: string;
  title: string;
  author: string;
  url: string;
  thumbnail?: string;
  abstractText: string;
  replyCount?: number;
  createAt?: Date;
  latestAt?: Date;
}

interface TiebaMobileThread {
  id?: string | number;
  tid?: string | number;
  title?: string;
  author_name?: string;
  author?: {
    name?: string;
    name_show?: string;
  };
  reply_num?: string | number;
  view_num?: string | number;
  create_time?: string | number;
  last_time_int?: string | number;
  thread_share_link?: string;
  t_share_img?: string;
  abstract?: Array<{ text?: string }> | string;
  first_post_content?: Array<{ text?: string; type?: number }>;
  rich_abstract?: Array<{ text?: string; origin_src?: string; cdn_src?: string; big_cdn_src?: string }>;
  media?: Array<{ src_pic?: string; dynamic_pic?: string; big_pic?: string; origin_pic?: string }>;
}

interface TiebaFrsResponse {
  error_code?: number;
  error_msg?: string;
  thread_list?: TiebaMobileThread[];
}

interface TiebaPostResponse {
  error_code?: number;
  error_msg?: string;
  page?: {
    current_page?: number;
    total_page?: number;
    new_total_page?: number;
    page_size?: number;
    total_num?: number;
  };
  post_list?: Array<{
    content?: Array<{ text?: string; type?: number }>;
    floor?: number;
    id?: string | number;
    time?: string | number;
  }>;
}

interface TiebaThreadPost {
  id?: string;
  text: string;
  floor?: number;
  publishedAt?: Date;
}

export async function collectTieba(game: GameConfig, cutoff: Date) {
  const started = Date.now();
  const fetchedAt = nowIso();
  const errors: string[] = [];
  let blocked = false;
  let staleDropped = 0;
  let keywordDropped = 0;
  const byTid = new Map<string, TiebaThreadCandidate>();
  const defaultTiebaKeywords = normalizeTiebaKeywordList(game.tiebaKeywords || []);
  const scopedTiebaKeywords = makeTiebaBarKeywordMap(game.tiebaBarKeywords);
  let filteredBarCount = 0;

  for (const bar of game.tiebaBars) {
    const tiebaKeywords = scopedTiebaKeywords.get(tiebaBarScopeKey(bar)) ?? defaultTiebaKeywords;
    if (tiebaKeywords.length) filteredBarCount += 1;
    const minListPages = Math.min(runtimeConfig.maxTiebaListPages, runtimeConfig.minTiebaListPages);
    try {
      for (let page = 1; page <= runtimeConfig.maxTiebaListPages; page += 1) {
        const candidates = (await fetchBarThreads(bar, page)).map((candidate) => ({ ...candidate, bar }));
        let pageHasWindowItems = false;
        for (const candidate of candidates) {
          if (candidate.latestAt && candidate.latestAt >= cutoff) pageHasWindowItems = true;
          if (!candidate.latestAt || candidate.latestAt < cutoff) {
            staleDropped += 1;
            continue;
          }
          if (!candidateMatchesTiebaKeywords(candidate, tiebaKeywords)) {
            keywordDropped += 1;
            continue;
          }
          byTid.set(candidate.tid, candidate);
        }
        if (!candidates.length) break;
        if (!pageHasWindowItems && page >= minListPages) break;
      }
    } catch (error) {
      const sourceError = error as SourceError;
      blocked ||= Boolean(sourceError.blocked);
      errors.push(`${bar}吧: ${sourceError.blocked ? "触发百度安全验证，可配置 BAIDU_COOKIE 后重试" : sourceError.message}`);
    }
  }

  const candidates = Array.from(byTid.values())
    .sort((a, b) => (b.latestAt?.getTime() || 0) - (a.latestAt?.getTime() || 0))
    .slice(0, runtimeConfig.maxTiebaThreadsPerBar);
  const deepSet = makeDeepParseSet(candidates);

  const settled = await Promise.allSettled(candidates.map((candidate) => buildTiebaMonitorItem(game, candidate, deepSet.has(candidate.tid))));
  const items: MonitorItem[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      items.push(result.value);
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  const health: SourceHealth = {
    source: "tieba",
    sourceLabel: "百度贴吧",
    gameId: game.id,
    ok: !blocked && errors.length === 0,
    fetchedAt,
    latencyMs: Date.now() - started,
    itemCount: items.length,
    staleDropped,
    blocked,
    message:
      errors.length === 0
        ? filteredBarCount
          ? `已读取 ${game.tiebaBars.length} 个贴吧来源，其中 ${filteredBarCount} 个来源按贴吧匹配词过滤，排除 ${keywordDropped} 条不相关主题。`
          : "已读取对应吧最新主题，并按最新回复时间过滤。"
        : `贴吧采集受限：${errors.slice(0, 2).join("；")}`
  };

  return { items, health };
}

async function fetchBarThreads(bar: string, page: number): Promise<TiebaThreadCandidate[]> {
  try {
    return await fetchMobileBarThreads(bar, page);
  } catch (mobileError) {
    try {
      return await fetchWebBarThreads(bar, page);
    } catch (webError) {
      if (webError instanceof SourceError && webError.blocked) throw webError;
      throw mobileError instanceof Error ? mobileError : webError;
    }
  }
}

async function fetchMobileBarThreads(bar: string, page: number): Promise<TiebaThreadCandidate[]> {
  const data = await fetchTiebaMobileJson<TiebaFrsResponse>(
    "/c/f/frs/page",
    {
      kw: bar,
      pn: String(page),
      rn: String(runtimeConfig.tiebaThreadsPerPage),
      sort_type: "1",
      st_type: "tb_forumlist",
      with_group: "1"
    }
  );

  if (Number(data.error_code || 0) !== 0) {
    throw new SourceError(`贴吧移动端列表失败：${data.error_msg || data.error_code || "未知错误"}`);
  }

  return (data.thread_list || [])
    .map<TiebaThreadCandidate | undefined>((thread) => {
      const tid = String(thread.tid || thread.id || "");
      const title = stripHtml(thread.title || "");
      if (!tid || !title) return undefined;
      const createAt = parseTimestamp(thread.create_time);
      const replyAt = parseTimestamp(thread.last_time_int);
      const latestAt = latestDate(createAt, replyAt);
      const abstractText = mobileText(thread.first_post_content) || mobileText(thread.abstract) || mobileText(thread.rich_abstract);

      const thumbnail = firstMobileImage(thread);
      return {
        tid,
        bar: "",
        title,
        author: stripHtml(thread.author?.name_show || thread.author?.name || thread.author_name || "未知用户"),
        url: normalizeUrl(thread.thread_share_link || `https://tieba.baidu.com/p/${tid}`),
        thumbnail: thumbnail ? normalizeUrl(thumbnail) : undefined,
        abstractText,
        replyCount: Number(thread.reply_num) || undefined,
        createAt,
        latestAt
      };
    })
    .filter((thread): thread is TiebaThreadCandidate => Boolean(thread));
}

async function fetchWebBarThreads(bar: string, page: number): Promise<TiebaThreadCandidate[]> {
  const url = `https://tieba.baidu.com/f?kw=${encodeURIComponent(bar)}&ie=utf-8&pn=${Math.max(0, page - 1) * runtimeConfig.tiebaThreadsPerPage}`;
  const html = await fetchText(url, {
    referer: "https://tieba.baidu.com/",
    cookie: sourceCookie("baidu")
  });
  if (looksBlocked(html)) throw new SourceError("触发百度安全验证，可配置 BAIDU_COOKIE 后重试", true);

  const $ = cheerio.load(html);
  const candidates: TiebaThreadCandidate[] = [];
  const now = new Date();

  $(".j_thread_list, li[data-field], .thread_item_box").each((_, element) => {
    const node = $(element);
    const data = parseDataField(node.attr("data-field") || "");
    const tid = String(data.id || data.tid || node.attr("data-tid") || "");
    const titleLink = node.find("a.j_th_tit, .threadlist_title a, a[href*='/p/']").first();
    const title = stripHtml(titleLink.attr("title") || titleLink.text());
    if (!tid || !title) return;

    const latestAt =
      parseTimestamp(data.last_time_int || data.last_time || data.reply_time || data.create_time) ||
      parseTiebaDate(stripHtml(node.find(".threadlist_reply_date").last().text()), now);
    const abstractText = stripHtml(node.find(".threadlist_abs, .threadlist_text").first().text());
    const author =
      stripHtml(String(data.author_name || "")) ||
      stripHtml(node.find(".frs-author-name, .tb_icon_author").first().attr("title") || node.find(".frs-author-name, .tb_icon_author").first().text()) ||
      "未知用户";
    const replyCount = Number(data.reply_num || stripHtml(node.find(".threadlist_rep_num").first().text())) || undefined;
    const href = titleLink.attr("href") || `/p/${tid}`;

    candidates.push({
      tid,
      bar: "",
      title,
      author,
      url: normalizeUrl(href),
      abstractText,
      replyCount,
      createAt: parseTimestamp(data.create_time),
      latestAt
    });
  });

  return candidates;
}

function candidateMatchesTiebaKeywords(candidate: TiebaThreadCandidate, normalizedKeywords: string[]) {
  if (!normalizedKeywords.length) return true;
  return tiebaTextMatchesKeywords(`${candidate.title}\n${candidate.abstractText}`, normalizedKeywords);
}

export function tiebaTextMatchesKeywords(text: string, keywords: string[]) {
  const normalizedText = normalizeTiebaKeyword(text);
  if (!normalizedText) return false;
  return normalizeTiebaKeywordList(keywords).some((keyword) => normalizedText.includes(keyword));
}

function normalizeTiebaKeywordList(keywords: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const keyword of keywords) {
    const value = normalizeTiebaKeyword(keyword);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function normalizeTiebaKeyword(value: string) {
  return value.toLowerCase().replace(/[#_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function makeTiebaBarKeywordMap(scopedKeywords: Record<string, string[]> | undefined) {
  const mapped = new Map<string, string[]>();
  for (const [bar, keywords] of Object.entries(scopedKeywords || {})) {
    const key = tiebaBarScopeKey(bar);
    if (!key) continue;
    mapped.set(key, normalizeTiebaKeywordList(keywords));
  }
  return mapped;
}

function tiebaBarScopeKey(bar: string) {
  return normalizeTiebaKeyword(bar);
}

async function buildTiebaMonitorItem(game: GameConfig, candidate: TiebaThreadCandidate, deepParse: boolean): Promise<MonitorItem> {
  const collectedAt = new Date();
  const contentParts: ContentPart[] = [
    { type: "title", text: candidate.title, count: 1 },
    ...(candidate.abstractText ? [{ type: "description" as const, text: candidate.abstractText, count: 1 }] : [])
  ];

  const posts = deepParse ? await fetchThreadPosts(candidate).catch(() => []) : [];
  if (deepParse) {
    for (const post of posts.slice(0, 15)) {
      contentParts.push({
        type: "post",
        text: post.text,
        count: 1,
        publishedAt: post.publishedAt?.toISOString()
      });
    }
  }

  const publishedAt = candidate.latestAt || collectedAt;
  const metrics = {
    replies: candidate.replyCount,
    comments: candidate.replyCount
  };
  const baseAnalysis = analyzeItem({ title: candidate.title, gameId: game.id, contentParts, metrics });
  const riskSignal = resolveTiebaRiskSignal(game, candidate, posts, baseAnalysis);

  return {
    id: `tieba:${candidate.tid}`,
    gameId: game.id,
    gameName: game.name,
    source: "tieba",
    sourceLabel: "百度贴吧",
    sourceItemId: candidate.tid,
    title: candidate.title,
    author: candidate.author,
    url: candidate.url,
    thumbnail: candidate.thumbnail,
    publishedAt: publishedAt.toISOString(),
    collectedAt: collectedAt.toISOString(),
    freshnessHours: hoursBetween(collectedAt, publishedAt),
    metrics,
    contentParts,
    parsedContentCount: contentParts.reduce((sum, part) => sum + (part.count || 1), 0),
    ...riskSignal.analysis,
    riskSignalSource: riskSignal.source,
    riskSignalAt: riskSignal.at?.toISOString()
  };
}

function resolveTiebaRiskSignal(
  game: GameConfig,
  candidate: TiebaThreadCandidate,
  posts: TiebaThreadPost[],
  baseAnalysis: ReturnType<typeof analyzeItem>
): {
  analysis: ReturnType<typeof analyzeItem>;
  source: RiskSignalSource;
  at?: Date;
} {
  if (!isReplyRefreshedThread(candidate)) {
    return {
      analysis: baseAnalysis,
      source: "thread",
      at: candidate.createAt || candidate.latestAt
    };
  }

  const latestReply = latestReplyPost(posts);
  if (!latestReply) {
    return {
      analysis: baseAnalysis,
      source: "stale_thread",
      at: candidate.createAt || candidate.latestAt
    };
  }

  const latestReplyAnalysis = analyzeItem({
    title: latestReply.text.slice(0, 48),
    gameId: game.id,
    contentParts: [{ type: "post", text: latestReply.text, count: 1, publishedAt: latestReply.publishedAt?.toISOString() }],
    metrics: { replies: 1, comments: 1 }
  });

  if (latestReplyAnalysis.riskLevel === "low") {
    return {
      analysis: baseAnalysis,
      source: "stale_thread",
      at: candidate.createAt || candidate.latestAt
    };
  }

  return {
    analysis: {
      ...baseAnalysis,
      riskLevel: latestReplyAnalysis.riskLevel,
      riskReasons: ["新回复带来风险", ...latestReplyAnalysis.riskReasons].slice(0, 4)
    },
    source: "new_reply",
    at: latestReply.publishedAt || candidate.latestAt
  };
}

function isReplyRefreshedThread(candidate: TiebaThreadCandidate) {
  if (!candidate.createAt || !candidate.latestAt) return false;
  return candidate.latestAt.getTime() - candidate.createAt.getTime() > 5 * 60_000;
}

function latestReplyPost(posts: TiebaThreadPost[]) {
  return posts
    .filter((post) => post.text && post.floor !== 1 && post.publishedAt)
    .sort((left, right) => (right.publishedAt?.getTime() || 0) - (left.publishedAt?.getTime() || 0))[0];
}

function makeDeepParseSet(candidates: TiebaThreadCandidate[]) {
  const deepSet = new Set(candidates.slice(0, runtimeConfig.maxTiebaThreadsToDeepParse).map((candidate) => candidate.tid));
  const maxDeep = Math.min(candidates.length, runtimeConfig.maxTiebaThreadsToDeepParse + 8);
  for (const candidate of candidates) {
    if (deepSet.size >= maxDeep) break;
    if (needsPostContext(candidate)) deepSet.add(candidate.tid);
  }
  return deepSet;
}

function needsPostContext(candidate: TiebaThreadCandidate) {
  const text = `${candidate.title} ${candidate.abstractText}`;
  return /(外挂|外卦|开挂|封号|作弊|科技|辅助|内存宏|鼠标宏|压枪宏|脚本|自瞄|锁头|透视|穿墙|无后座|无后坐|DMA|驱动|过检测|免封|QQ群|群号|加群|进群|售卖|卡密|代理|举报|水军|诈骗|退款|投诉)/.test(text);
}

async function fetchThreadPosts(candidate: TiebaThreadCandidate) {
  try {
    return await fetchMobileThreadPosts(candidate.tid);
  } catch {
    return fetchWebThreadPosts(candidate.url);
  }
}

async function fetchMobileThreadPosts(tid: string) {
  const firstPage = await fetchTiebaMobilePostPage(tid, 1);
  const totalPage = Math.max(1, Number(firstPage.page?.new_total_page || firstPage.page?.total_page || 1));
  if (totalPage <= 1) return postsFromMobileResponse(firstPage);

  const latestPage = await fetchTiebaMobilePostPage(tid, totalPage);
  return uniqPosts([...postsFromMobileResponse(firstPage), ...postsFromMobileResponse(latestPage)]);
}

async function fetchTiebaMobilePostPage(tid: string, page: number) {
  const data = await fetchTiebaMobileJson<TiebaPostResponse>(
    "/c/f/pb/page",
    {
      kz: tid,
      pn: String(page),
      rn: "20"
    }
  );
  if (Number(data.error_code || 0) !== 0) {
    throw new SourceError(`贴吧移动端帖子失败：${data.error_msg || data.error_code || "未知错误"}`);
  }
  return data;
}

function postsFromMobileResponse(data: TiebaPostResponse): TiebaThreadPost[] {
  return (data.post_list || [])
    .map((post) => ({
      id: post.id === undefined ? undefined : String(post.id),
      text: mobileText(post.content),
      floor: typeof post.floor === "number" ? post.floor : Number(post.floor) || undefined,
      publishedAt: parseTimestamp(post.time)
    }))
    .filter((post) => post.text.length > 2);
}

async function fetchWebThreadPosts(url: string) {
  const html = await fetchText(url, {
    referer: "https://tieba.baidu.com/",
    cookie: sourceCookie("baidu")
  });
  if (looksBlocked(html)) throw new SourceError("帖子详情触发百度安全验证", true);

  const $ = cheerio.load(html);
  const posts: TiebaThreadPost[] = [];
  $(".d_post_content, .p_content, .l_post .content").each((_, element) => {
    const text = stripHtml($(element).text());
    if (text.length > 2) posts.push({ text });
  });
  return uniqPosts(posts).slice(0, 30);
}

function uniqPosts(posts: TiebaThreadPost[]) {
  const seen = new Set<string>();
  return posts.filter((post) => {
    const key = post.id || `${post.floor || ""}:${post.publishedAt?.toISOString() || ""}:${post.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchTiebaMobileJson<T>(path: string, params: Record<string, string>) {
  const url = `https://c.tieba.baidu.com${path}?${signedMobileParams(params)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "bdtb for Android 12.63.1.0",
      Accept: "application/json",
      ...(sourceCookie("baidu") ? { Cookie: sourceCookie("baidu") } : {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new SourceError(`贴吧移动端 HTTP ${response.status}: ${text.slice(0, 80)}`);
  if (looksBlocked(text)) throw new SourceError("触发百度安全验证，可配置 BAIDU_COOKIE 后重试", true);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new SourceError(`贴吧移动端返回内容不是 JSON: ${(error as Error).message}`);
  }
}

function signedMobileParams(params: Record<string, string>) {
  const signed = {
    _client_id: `wappc_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    _client_type: "2",
    _client_version: "12.63.1.0",
    _phone_imei: "000000000000000",
    from: "1008621y",
    ...params
  };
  const signSource =
    Object.keys(signed)
      .sort()
      .map((key) => `${key}=${signed[key as keyof typeof signed]}`)
      .join("") + "tiebaclient!!!";
  return new URLSearchParams({
    ...signed,
    sign: md5(signSource).toUpperCase()
  }).toString();
}

function mobileText(value: TiebaMobileThread["abstract"] | TiebaMobileThread["first_post_content"] | TiebaMobileThread["rich_abstract"]) {
  if (!value) return "";
  if (typeof value === "string") return stripHtml(value);
  return stripHtml(value.map((part) => part.text || "").join(" "));
}

function firstMobileImage(thread: TiebaMobileThread) {
  return (
    thread.t_share_img ||
    thread.media?.find((item) => item.src_pic || item.dynamic_pic || item.big_pic || item.origin_pic)?.src_pic ||
    thread.media?.find((item) => item.dynamic_pic)?.dynamic_pic ||
    thread.media?.find((item) => item.big_pic)?.big_pic ||
    thread.media?.find((item) => item.origin_pic)?.origin_pic ||
    thread.rich_abstract?.find((item) => item.origin_src || item.cdn_src || item.big_cdn_src)?.origin_src ||
    thread.rich_abstract?.find((item) => item.cdn_src)?.cdn_src ||
    ""
  );
}

function latestDate(...dates: Array<Date | undefined>) {
  const validDates = dates.filter((date): date is Date => Boolean(date));
  if (!validDates.length) return undefined;
  return new Date(Math.max(...validDates.map((date) => date.getTime())));
}

function parseDataField(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw.replace(/&quot;/g, '"'));
  } catch {
    return {};
  }
}

function parseTimestamp(value: unknown) {
  const numeric = Number(value);
  if (!numeric) return undefined;
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseTiebaDate(raw: string, now: Date) {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (/刚刚/.test(text)) return new Date(now);

  const minutes = text.match(/(\d+)\s*分钟前/);
  if (minutes) return new Date(now.getTime() - Number(minutes[1]) * 60_000);

  const hours = text.match(/(\d+)\s*小时前/);
  if (hours) return new Date(now.getTime() - Number(hours[1]) * 3_600_000);

  const yesterday = text.match(/昨天\s*(\d{1,2}):(\d{2})?/);
  if (yesterday) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    date.setHours(Number(yesterday[1]), Number(yesterday[2] || 0), 0, 0);
    return date;
  }

  const timeOnly = text.match(/^(\d{1,2}):(\d{2})$/);
  if (timeOnly) {
    const date = new Date(now);
    date.setHours(Number(timeOnly[1]), Number(timeOnly[2]), 0, 0);
    if (date > now) date.setDate(date.getDate() - 1);
    return date;
  }

  const monthDay = text.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (monthDay) {
    const date = new Date(now.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]), Number(monthDay[3] || 23), Number(monthDay[4] || 59));
    if (date > now) date.setFullYear(date.getFullYear() - 1);
    return date;
  }

  const full = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (full) {
    return new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]), Number(full[4] || 0), Number(full[5] || 0));
  }

  return undefined;
}
