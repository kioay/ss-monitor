import * as cheerio from "cheerio";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { analyzeItem } from "../analyze";
import { runtimeConfig } from "../config";
import { SourceError } from "../http";
import { hoursBetween, nowIso, stripHtml, uniq } from "../utils";
import type { ContentPart, GameConfig, MonitorItem, SourceHealth } from "../../src/shared";

interface Forum4399Candidate {
  tid: string;
  tagId: string;
  title: string;
  author: string;
  url: string;
  category?: string;
  abstractText: string;
  thumbnail?: string;
  views?: number;
  replyCount?: number;
  heat?: number;
  latestAt?: Date;
}

interface Forum4399Post {
  text: string;
  author?: string;
  floor?: number;
  publishedAt?: Date;
}

interface Forum4399Credentials {
  account: string;
  password: string;
}

const forum4399Label = "4399论坛";
const loginFrameUrl =
  "https://ptlogin.4399.com/ptlogin/loginFrame.do?postLoginHandler=refreshParent&redirectUrl=&css=&appId=my&gameId=&layout=vertical&displayMode=embed&layoutSelfAdapting=true&externalLogin=qq&mainDivId=embed_login_div&autoLogin=true&includeFcmInfo=false&qrLogin=true&userNameLabel=&userNameTip=&welcomeTip=&showCaptcha=true&level=0&regLevel=4&loginLevel=60&bizId=&iframeId=embed_login_frame";
const forumBaseUrl = "https://my.4399.com";
const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

let sessionCache: { jar: CookieJar; expiresAt: number; source: "cookie" | "credentials" } | undefined;
let configuredCookieRejected = false;

export async function collectForum4399(game: GameConfig, cutoff: Date) {
  const started = Date.now();
  const fetchedAt = nowIso();
  const errors: string[] = [];
  let blocked = false;
  let staleDropped = 0;
  let keywordDropped = 0;
  const byTid = new Map<string, Forum4399Candidate>();
  const tagIds = normalizeForum4399Tags(game.forum4399Tags || []);
  const keywords = normalizeForum4399KeywordList(game.forum4399Keywords || []);

  if (!tagIds.length) {
    return {
      items: [],
      health: {
        source: "forum4399" as const,
        sourceLabel: forum4399Label,
        gameId: game.id,
        ok: true,
        fetchedAt,
        latencyMs: Date.now() - started,
        itemCount: 0,
        staleDropped: 0,
        message: "未配置 4399 论坛 tag，跳过该来源。"
      }
    };
  }

  for (const tagId of tagIds) {
    try {
      for (let page = 1; page <= runtimeConfig.maxForum4399ListPages; page += 1) {
        const candidates = await fetchForum4399ListPage(tagId, page);
        let pageHasWindowItems = false;
        for (const candidate of candidates) {
          if (candidate.latestAt && candidate.latestAt >= cutoff) pageHasWindowItems = true;
          if (!candidate.latestAt || candidate.latestAt < cutoff) {
            staleDropped += 1;
            continue;
          }
          if (!candidateMatchesKeywords(candidate, keywords)) {
            keywordDropped += 1;
            continue;
          }
          byTid.set(candidate.tid, candidate);
        }
        if (!candidates.length || !pageHasWindowItems) break;
      }
    } catch (error) {
      const sourceError = error as SourceError;
      blocked ||= Boolean(sourceError.blocked);
      errors.push(`${tagId}: ${sourceError.blocked ? sourceError.message : messageOf(sourceError)}`);
    }
  }

  const candidates = Array.from(byTid.values())
    .sort((a, b) => (b.latestAt?.getTime() || 0) - (a.latestAt?.getTime() || 0))
    .slice(0, runtimeConfig.maxForum4399ThreadsPerGame);
  const deepSet = makeDeepParseSet(candidates);

  const settled = await Promise.allSettled(
    candidates.map((candidate) => buildForum4399MonitorItem(game, candidate, deepSet.has(candidate.tid)))
  );
  const items: MonitorItem[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") items.push(result.value);
    else errors.push(messageOf(result.reason));
  }

  const health: SourceHealth = {
    source: "forum4399",
    sourceLabel: forum4399Label,
    gameId: game.id,
    ok: !blocked && (items.length > 0 || errors.length === 0),
    fetchedAt,
    latencyMs: Date.now() - started,
    itemCount: items.length,
    staleDropped,
    blocked,
    message:
      errors.length === 0
        ? `已读取 ${tagIds.length} 个 4399 论坛 tag，按最新回复时间过滤；深解析 ${deepSet.size} 个主题。`
        : `4399论坛采集受限：${errors.slice(0, 2).join("；")}${keywordDropped ? `；过滤 ${keywordDropped} 条未命中关键词主题` : ""}`
  };

  return { items, health };
}

async function fetchForum4399ListPage(tagId: string, page: number) {
  const url =
    page <= 1
      ? `${forumBaseUrl}/forums/mtag-${encodeURIComponent(tagId)}`
      : `${forumBaseUrl}/forums/mtag-${encodeURIComponent(tagId)}-p-${page}`;
  const html = await fetchForum4399Text(url, { referer: `${forumBaseUrl}/forums/mtag-${encodeURIComponent(tagId)}` });
  return parseForum4399ListItems(html, tagId);
}

export function parseForum4399ListItems(html: string, tagId: string, now = new Date()): Forum4399Candidate[] {
  const $ = cheerio.load(html);
  const candidates: Forum4399Candidate[] = [];
  $("li")
    .has(".thread_link[href]")
    .each((_, element) => {
      const row = $(element);
      if (row.find(".totop").length) return;
      const titleLink = row.find(".thread_link[href]").first();
      const href = titleLink.attr("href") || "";
      const tid = href.match(/thread-(\d+)/)?.[1] || "";
      const title = stripHtml(titleLink.text());
      if (!tid || !title) return;

      const latestAt = parseForum4399Date(row.find("> .content .date").first().text(), now);
      const category = stripHtml(row.find(".type").first().text());
      const author = stripHtml(row.find(".listtitle .author a").first().attr("title") || row.find(".listtitle .author a").first().text());
      const abstractText = stripHtml(row.find("> .content .text").first().text());
      const thumbnail = normalizeForum4399Url(row.find("> .imglist img").first().attr("src") || "");
      const views = parseCompactNumber(row.find("> .lastline .view").last().text());
      const replyCount = parseCompactNumber(row.find("> .lastline .comment").last().text());
      const heat = parseCompactNumber(row.find("> .lastline .hot").last().text());

      candidates.push({
        tid,
        tagId,
        title,
        author: author || "未知用户",
        url: normalizeForum4399Url(href),
        category,
        abstractText,
        thumbnail: thumbnail || undefined,
        views,
        replyCount,
        heat,
        latestAt
      });
    });

  return candidates;
}

async function buildForum4399MonitorItem(game: GameConfig, candidate: Forum4399Candidate, deepParse: boolean): Promise<MonitorItem> {
  const collectedAt = new Date();
  const posts = deepParse ? await fetchForum4399ThreadPosts(candidate.url).catch(() => []) : [];
  const firstPostAt = posts.find((post) => post.floor === 1 && post.publishedAt)?.publishedAt;
  const latestPost = latestReplyPost(posts);
  const publishedAt = candidate.latestAt || latestPost?.publishedAt || firstPostAt || collectedAt;
  const contentParts: ContentPart[] = [
    { type: "title", text: candidate.title, count: 1 },
    ...(candidate.category ? [{ type: "tag" as const, text: candidate.category, count: 1 }] : []),
    ...(candidate.abstractText ? [{ type: "description" as const, text: candidate.abstractText, count: 1 }] : [])
  ];

  if (deepParse) {
    for (const post of posts.slice(0, 24)) {
      contentParts.push({
        type: "post",
        text: post.text,
        count: 1,
        publishedAt: post.publishedAt?.toISOString()
      });
    }
  }

  const metrics = {
    views: candidate.views,
    replies: candidate.replyCount,
    comments: candidate.replyCount,
    likes: candidate.heat
  };
  const analysis = analyzeItem({ title: candidate.title, gameId: game.id, contentParts, metrics });

  return {
    id: `forum4399:${candidate.tid}`,
    gameId: game.id,
    gameName: game.name,
    source: "forum4399",
    sourceLabel: forum4399Label,
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
    ...analysis,
    riskSignalSource: latestPost ? "new_reply" : "thread",
    riskSignalAt: latestPost?.publishedAt?.toISOString() || publishedAt.toISOString()
  };
}

async function fetchForum4399ThreadPosts(url: string) {
  const html = await fetchForum4399Text(url, { referer: `${forumBaseUrl}/forums/mtag-81899` });
  return parseForum4399ThreadPosts(html);
}

export function parseForum4399ThreadPosts(html: string, now = new Date()): Forum4399Post[] {
  const $ = cheerio.load(html);
  const posts: Forum4399Post[] = [];

  $(".single_post.j-single-post")
    .not(".j-send-floor")
    .each((_, element) => {
      const node = $(element);
      const text = stripHtml(node.find(".host_content.user_content, .main_content.user_content").first().text());
      if (text.length > 1) {
        const titleText = stripHtml(node.find(".post_title").first().text());
        posts.push({
          author: stripHtml(node.find(".post_author_name_text").first().text() || node.find(".post_author a").first().text()),
          text,
          floor: parseFloor(titleText),
          publishedAt: parseForum4399Date(titleText, now)
        });
      }

      node.find(".comment_li").each((__, commentElement) => {
        const commentText = cleanNestedCommentText(stripHtml($(commentElement).text()));
        if (commentText.length <= 1) return;
        posts.push({
          text: commentText,
          publishedAt: parseForum4399Date(commentText, now)
        });
      });
    });

  return uniqPosts(posts).slice(0, 80);
}

function cleanNestedCommentText(text: string) {
  return text
    .replace(/\s*(回复\s*\|\s*举报|回复|举报)\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFloor(text: string) {
  if (/楼主/.test(text)) return 1;
  if (/沙发/.test(text)) return 2;
  if (/板凳/.test(text)) return 3;
  const match = text.match(/(\d+)\s*楼/);
  return match ? Number(match[1]) : undefined;
}

function latestReplyPost(posts: Forum4399Post[]) {
  return posts
    .filter((post) => post.floor !== 1 && post.publishedAt)
    .sort((left, right) => (right.publishedAt?.getTime() || 0) - (left.publishedAt?.getTime() || 0))[0];
}

function makeDeepParseSet(candidates: Forum4399Candidate[]) {
  const deepSet = new Set(candidates.slice(0, runtimeConfig.maxForum4399ThreadsToDeepParse).map((item) => item.tid));
  const maxDeep = Math.min(candidates.length, runtimeConfig.maxForum4399ThreadsToDeepParse + 8);
  for (const candidate of candidates) {
    if (deepSet.size >= maxDeep) break;
    if (needsPostContext(candidate)) deepSet.add(candidate.tid);
  }
  return deepSet;
}

function needsPostContext(candidate: Forum4399Candidate) {
  const text = `${candidate.title} ${candidate.abstractText}`;
  return /(外挂|外卦|开挂|挂|宏|脚本|自瞄|锁头|透视|氪|削弱|太贵|退款|骗氪|BUG|bug|卡顿|崩溃|闪退|封号|投诉|客服|策划|倒闭|没人玩|排不到)/.test(text);
}

function candidateMatchesKeywords(candidate: Forum4399Candidate, normalizedKeywords: string[]) {
  if (!normalizedKeywords.length) return true;
  return forum4399TextMatchesKeywords(`${candidate.title}\n${candidate.category || ""}\n${candidate.abstractText}`, normalizedKeywords);
}

export function forum4399TextMatchesKeywords(text: string, keywords: string[]) {
  const normalizedText = normalizeForum4399Keyword(text);
  if (!normalizedText) return false;
  return normalizeForum4399KeywordList(keywords).some((keyword) => normalizedText.includes(keyword));
}

function normalizeForum4399Tags(tags: string[]) {
  return uniq(tags.map((tag) => tag.trim()).filter((tag) => /^\d{1,12}$/.test(tag)));
}

function normalizeForum4399KeywordList(keywords: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const keyword of keywords) {
    const value = normalizeForum4399Keyword(keyword);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function normalizeForum4399Keyword(value: string) {
  return value.toLowerCase().replace(/[#_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function parseForum4399Date(raw: string, now = new Date()) {
  const text = stripHtml(raw).replace(/\s+/g, " ").trim();
  if (!text) return undefined;

  const full = text.match(/(20\d{2})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (full) {
    return new Date(
      Number(full[1]),
      Number(full[2]) - 1,
      Number(full[3]),
      Number(full[4]),
      Number(full[5]),
      Number(full[6] || 0)
    );
  }

  if (/刚刚|刚才/.test(text)) return new Date(now);

  const minutes = text.match(/(\d+)\s*分钟前/);
  if (minutes) return new Date(now.getTime() - Number(minutes[1]) * 60_000);

  const hours = text.match(/(\d+)\s*小时前/);
  if (hours) return new Date(now.getTime() - Number(hours[1]) * 3_600_000);

  const days = text.match(/(\d+)\s*天前/);
  if (days) return new Date(now.getTime() - Number(days[1]) * 86_400_000);

  const yesterday = text.match(/昨天\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (yesterday) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    date.setHours(Number(yesterday[1]), Number(yesterday[2]), Number(yesterday[3] || 0), 0);
    return date;
  }

  const monthDay = text.match(/(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (monthDay) {
    const date = new Date(now.getFullYear(), Number(monthDay[1]) - 1, Number(monthDay[2]), Number(monthDay[3] || 23), Number(monthDay[4] || 59));
    if (date > now) date.setFullYear(date.getFullYear() - 1);
    return date;
  }

  return undefined;
}

async function fetchForum4399Text(url: string, options: { referer?: string } = {}) {
  const session = await getForum4399Session();
  return fetchForum4399TextWithSession(url, options, session, true);
}

async function fetchForum4399TextWithSession(
  url: string,
  options: { referer?: string },
  session: { jar: CookieJar; expiresAt: number; source: "cookie" | "credentials" },
  retryOnAuthFailure: boolean
) {
  const response = await fetchWithJar(session.jar, url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
      Referer: options.referer || forumBaseUrl
    }
  });
  const text = await response.text();

  if (looksLikeAuthInvalidResponse(response, text)) {
    if (retryOnAuthFailure) {
      const refreshed = await refreshForum4399SessionAfterAuthFailure(session);
      return fetchForum4399TextWithSession(url, options, refreshed, false);
    }
    sessionCache = undefined;
    throw new SourceError("4399论坛登录态失效，自动重登后仍无法访问", true);
  }

  if (!response.ok) {
    if ((response.status === 401 || response.status === 403) && retryOnAuthFailure) {
      const refreshed = await refreshForum4399SessionAfterAuthFailure(session);
      return fetchForum4399TextWithSession(url, options, refreshed, false);
    }
    throw new SourceError(`4399论坛 HTTP ${response.status}: ${text.slice(0, 80)}`, response.status === 401 || response.status === 403);
  }
  return text;
}

async function refreshForum4399SessionAfterAuthFailure(session: { source: "cookie" | "credentials" }) {
  sessionCache = undefined;
  if (session.source === "cookie") configuredCookieRejected = true;
  return getForum4399Session({ forceRefresh: true, preferCredentials: true });
}

async function getForum4399Session(options: { forceRefresh?: boolean; preferCredentials?: boolean } = {}) {
  if (!options.forceRefresh && sessionCache && sessionCache.expiresAt > Date.now()) return sessionCache;

  if (!options.preferCredentials && !configuredCookieRejected && runtimeConfig.forum4399Cookie.trim()) {
    const jar = CookieJar.fromCookieHeader(runtimeConfig.forum4399Cookie);
    sessionCache = { jar, expiresAt: Date.now() + 30 * 60_000, source: "cookie" };
    return sessionCache;
  }

  const jar = await loginForum4399();
  sessionCache = { jar, expiresAt: Date.now() + 30 * 60_000, source: "credentials" };
  return sessionCache;
}

async function loginForum4399() {
  const credentials = await readForum4399Credentials();
  const jar = new CookieJar();

  await fetchWithJar(jar, loginFrameUrl, {
    headers: {
      "User-Agent": userAgent,
      Referer: `${forumBaseUrl}/account/login`
    }
  });

  const verifyResponse = await fetchWithJar(
    jar,
    `https://ptlogin.4399.com/ptlogin/verify.do?username=${encodeURIComponent(credentials.account)}&appId=my&t=${Date.now()}&inputWidth=iptw2`,
    {
      headers: {
        "User-Agent": userAgent,
        Referer: loginFrameUrl
      }
    }
  );
  const verifyText = (await verifyResponse.text()).trim();
  if (verifyText !== "0") {
    throw new SourceError("4399论坛登录需要验证码，请先手动登录后配置 FORUM_4399_COOKIE", true);
  }

  const params = new URLSearchParams({
    loginFrom: "uframe",
    postLoginHandler: "refreshParent",
    layoutSelfAdapting: "true",
    externalLogin: "qq",
    displayMode: "embed",
    layout: "vertical",
    bizId: "",
    appId: "my",
    gameId: "",
    css: "",
    redirectUrl: "",
    sessionId: "",
    mainDivId: "embed_login_div",
    includeFcmInfo: "false",
    level: "0",
    regLevel: "4",
    userNameLabel: "4399用户名",
    userNameTip: "请输入4399用户名",
    welcomeTip: "欢迎回到4399",
    sec: "1",
    password: encryptCryptoJsAes(credentials.password),
    iframeId: "embed_login_frame",
    username: credentials.account,
    autoLogin: "on"
  });

  await fetchWithJar(jar, "https://ptlogin.4399.com/ptlogin/login.do?v=1", {
    method: "POST",
    headers: {
      "User-Agent": userAgent,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://ptlogin.4399.com",
      Referer: loginFrameUrl
    },
    body: params
  });

  if (!jar.hasAny("Pauth", "Uauth", "Xauth")) {
    throw new SourceError("4399论坛登录失败：未获得有效认证 Cookie", true);
  }
  return jar;
}

async function readForum4399Credentials(): Promise<Forum4399Credentials> {
  const credentialFile = runtimeConfig.forum4399CredentialFile.trim();
  if (!credentialFile) {
    throw new SourceError("未配置 4399 论坛凭据文件 FORUM_4399_CREDENTIAL_FILE", true);
  }

  let raw = "";
  try {
    raw = await fs.readFile(credentialFile, "utf-8");
  } catch {
    throw new SourceError(`无法读取 4399 论坛凭据文件：${credentialFile}`, true);
  }

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const account = valueForCredentialLine(lines, [/账号/, /用户名/i, /user/i, /account/i]) || cleanCredentialValue(lines[0] || "");
  const password = valueForCredentialLine(lines, [/密码/, /password/i, /pass/i, /pwd/i]) || cleanCredentialValue(lines[1] || "");
  if (!account || !password) {
    throw new SourceError("4399 论坛凭据文件需要包含账号和密码两行", true);
  }
  return { account, password };
}

function valueForCredentialLine(lines: string[], patterns: RegExp[]) {
  for (const line of lines) {
    if (!patterns.some((pattern) => pattern.test(line))) continue;
    const value = cleanCredentialValue(line);
    if (value) return value;
  }
  return "";
}

function cleanCredentialValue(line: string) {
  return line.replace(/^.*?[:：=]\s*/, "").trim();
}

async function fetchWithJar(jar: CookieJar, url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const cookie = jar.header();
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(url, { redirect: "manual", ...init, headers });
  jar.addFromHeaders(response.headers);
  return response;
}

function encryptCryptoJsAes(value: string, passphrase = "lzYW5qaXVqa") {
  const salt = randomBytes(8);
  const { key, iv } = evpBytesToKey(passphrase, salt, 32, 16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from("Salted__"), salt, encrypted]).toString("base64");
}

function evpBytesToKey(password: string, salt: Buffer, keyLength: number, ivLength: number) {
  let derived = Buffer.alloc(0);
  let previous = Buffer.alloc(0);
  while (derived.length < keyLength + ivLength) {
    previous = createHash("md5").update(Buffer.concat([previous, Buffer.from(password), salt])).digest();
    derived = Buffer.concat([derived, previous]);
  }
  return {
    key: derived.subarray(0, keyLength),
    iv: derived.subarray(keyLength, keyLength + ivLength)
  };
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  static fromCookieHeader(cookieHeader: string) {
    const jar = new CookieJar();
    for (const part of cookieHeader.split(";")) {
      const index = part.indexOf("=");
      if (index <= 0) continue;
      jar.cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
    }
    return jar;
  }

  addFromHeaders(headers: Headers) {
    const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    const values = typeof getSetCookie === "function" ? getSetCookie.call(headers) : [];
    const raw = headers.get("set-cookie");
    const setCookies = values.length ? values : raw ? splitSetCookieHeader(raw) : [];
    for (const value of setCookies) {
      const firstPart = value.split(";")[0];
      const index = firstPart.indexOf("=");
      if (index <= 0) continue;
      this.cookies.set(firstPart.slice(0, index), firstPart.slice(index + 1));
    }
  }

  header() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
  }

  hasAny(...names: string[]) {
    return names.some((name) => this.cookies.has(name));
  }
}

function splitSetCookieHeader(value: string) {
  return value.split(/,(?=\s*[^;,\s]+=)/g).map((item) => item.trim()).filter(Boolean);
}

function looksLikeAuthInvalidResponse(response: Response, text: string) {
  return looksLikeLoginPage(text) || response.headers.get("location")?.includes("/account/login");
}

function looksLikeLoginPage(text: string) {
  const hasForumContent = /mod_postlist|post_list|thread_link|j-single-post/.test(text);
  if (hasForumContent) return false;
  return /my-account--login-index|id="login_form"|class="u_logform"|account\/login\?refer/.test(text);
}

function normalizeForum4399Url(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${forumBaseUrl}${trimmed}`;
  return trimmed.replace(/^http:\/\//, "https://");
}

function parseCompactNumber(raw: string) {
  const text = raw.replace(/\s+/g, "").trim();
  if (!text) return undefined;
  const heat = text.match(/热度\(([\d.]+)\)/);
  if (heat) return Number(heat[1]) || undefined;
  const tenThousand = text.match(/([\d.]+)万/);
  if (tenThousand) return Math.round(Number(tenThousand[1]) * 10_000) || undefined;
  const numeric = text.match(/[\d.]+/);
  return numeric ? Number(numeric[0]) || undefined : undefined;
}

function uniqPosts(posts: Forum4399Post[]) {
  const seen = new Set<string>();
  return posts.filter((post) => {
    const key = `${post.floor || ""}:${post.publishedAt?.toISOString() || ""}:${post.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
