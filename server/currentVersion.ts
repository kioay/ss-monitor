import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import { runtimeConfig } from "./config";

interface CurrentVersionFocus {
  fetchedAt: string;
  sourceUpdatedAt?: string;
  title?: string;
  version?: string;
  versionPageId?: string;
  activity?: string;
  cycle?: string;
  terms: string[];
  weaponTerms: string[];
}

interface ConfluencePageResponse {
  id?: string;
  title?: string;
  version?: { when?: string };
  body?: { storage?: { value?: string } };
}

interface ConfluenceChildResponse {
  results?: ConfluencePageResponse[];
}

interface VersionRow {
  year: number;
  activity: string;
  version: string;
  cycle: string;
  versionDate: Date;
  terms: string[];
  weaponTerms: string[];
}

const refreshIntervalMs = 24 * 60 * 60 * 1000;
const confluenceBaseUrl = "http://confluence.wd.com";
const maxDescendantPages = 120;
const genericVersionTerms = new Set([
  "版本",
  "大版本",
  "小版本",
  "大活动",
  "活动",
  "提前",
  "准备",
  "内容",
  "需求",
  "需求表",
  "文档",
  "文档状态",
  "正式发布",
  "草稿",
  "修改中",
  "注销",
  "计划上线版本",
  "计划发布",
  "计划发布的版本日期",
  "美术交付截止时间",
  "武器基本信息",
  "武器名称",
  "武器类型",
  "武器",
  "皮肤",
  "武器皮肤",
  "配件",
  "原型枪",
  "主题风格",
  "永久",
  "非永久",
  "产出途径",
  "是否可续费",
  "是否加入推荐",
  "特殊说明",
  "需求描述",
  "标题"
]);
let focusCache: CurrentVersionFocus = emptyFocus();
let loadedCache = false;
let refreshInFlight: Promise<CurrentVersionFocus> | undefined;

export function getCurrentVersionFocus() {
  return focusCache;
}

export async function refreshCurrentVersionFocus(now = new Date()) {
  if (!loadedCache) await loadCachedFocus();
  if (!shouldRefresh(now)) return focusCache;
  if (!refreshInFlight) {
    refreshInFlight = fetchCurrentVersionFocus(now)
      .then(async (focus) => {
        focusCache = focus;
        await saveCachedFocus(focus);
        return focus;
      })
      .catch((error) => {
        console.warn("Current version focus refresh failed", error instanceof Error ? error.message : error);
        return focusCache;
      })
      .finally(() => {
        refreshInFlight = undefined;
      });
  }
  return refreshInFlight;
}

export function matchCurrentVersionTerms(content: string) {
  const focus = getCurrentVersionFocus();
  if (!focus.terms.length) return [];
  return focus.terms.filter((term) => content.includes(term));
}

async function fetchCurrentVersionFocus(now: Date): Promise<CurrentVersionFocus> {
  if (!runtimeConfig.confluenceToken) {
    return { ...focusCache, fetchedAt: new Date().toISOString() };
  }

  const url = `${confluenceBaseUrl}/rest/api/content/${runtimeConfig.confluencePageId}?expand=body.storage,version,title`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${runtimeConfig.confluenceToken}`
    }
  });
  if (!response.ok) throw new Error(`Confluence HTTP ${response.status}`);
  const page = await response.json() as ConfluencePageResponse;
  const html = page.body?.storage?.value || "";
  const row = selectCurrentVersionRow(parseVersionRows(html), now);
  const versionPage = row ? await findVersionPage(runtimeConfig.confluencePageId, row) : undefined;
  const childFocus = versionPage ? await fetchDescendantFocus(versionPage) : { terms: [], weaponTerms: [] };
  const planTerms = row?.terms || [];
  const weaponTerms = uniqTerms([...(row?.weaponTerms || []), ...childFocus.weaponTerms]);
  return {
    fetchedAt: new Date().toISOString(),
    sourceUpdatedAt: page.version?.when,
    title: page.title,
    version: row?.version,
    versionPageId: versionPage?.id,
    activity: row?.activity,
    cycle: row?.cycle,
    terms: uniqTerms([...weaponTerms, ...planTerms, ...childFocus.terms]).slice(0, 300),
    weaponTerms: weaponTerms.slice(0, 120)
  };
}

async function findVersionPage(parentPageId: string, row: VersionRow) {
  const children = await fetchChildPages(parentPageId, false);
  const versionKey = row.version.match(/\d{2}-\d{2}版本/)?.[0] || "";
  const compactVersionKey = versionKey.replace(/^0/, "");
  return children.find((page) => page.title?.includes(versionKey) || page.title?.includes(compactVersionKey));
}

async function fetchDescendantFocus(root: ConfluencePageResponse) {
  const allPages: Array<{ page: ConfluencePageResponse; path: string[] }> = [];
  const queue: Array<{ page: ConfluencePageResponse; path: string[] }> = [{ page: root, path: [root.title || ""] }];
  while (queue.length && allPages.length < maxDescendantPages) {
    const current = queue.shift();
    if (!current?.page.id) continue;
    const children = await fetchChildPages(current.page.id, true);
    for (const child of children) {
      const pathParts = [...current.path, child.title || ""];
      const entry = { page: child, path: pathParts };
      allPages.push(entry);
      queue.push(entry);
      if (allPages.length >= maxDescendantPages) break;
    }
  }

  const terms = new Set<string>();
  const weaponTerms = new Set<string>();
  for (const entry of allPages) {
    const title = entry.page.title || "";
    const html = entry.page.body?.storage?.value || "";
    const text = pageText(html);
    const isWeapon = isWeaponPage(entry.path);
    for (const term of extractTitleTerms(title)) {
      addTerm(terms, term);
      if (isWeapon || isWeaponTerm(term)) addTerm(weaponTerms, term);
    }
    if (isWeapon) {
      for (const term of extractWeaponTerms(title, text)) {
        addTerm(terms, term);
        addTerm(weaponTerms, term);
      }
    }
  }
  return { terms: [...terms], weaponTerms: [...weaponTerms] };
}

async function fetchChildPages(pageId: string, withBody: boolean) {
  const expand = withBody ? "body.storage,version,title" : "version,title";
  const url = `${confluenceBaseUrl}/rest/api/content/${pageId}/child/page?limit=100&expand=${encodeURIComponent(expand)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${runtimeConfig.confluenceToken}`
    }
  });
  if (!response.ok) throw new Error(`Confluence child HTTP ${response.status}`);
  const payload = await response.json() as ConfluenceChildResponse;
  return payload.results || [];
}

function parseVersionRows(html: string): VersionRow[] {
  const $ = cheerio.load(html);
  const rows: VersionRow[] = [];
  let currentYear = new Date().getFullYear();
  let currentActivity = "";

  $("tr").each((_, tr) => {
    const cells = $(tr)
      .find("th,td")
      .map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);
    if (!cells.length || cells.includes("版本")) return;

    let cursor = 0;
    const yearMatch = cells[cursor]?.match(/(20\d{2})年/);
    if (yearMatch) {
      currentYear = Number(yearMatch[1]);
      cursor += 1;
    }

    if (!cells[cursor]) return;
    if (!/^\d{2}-\d{2}版本/.test(cells[cursor])) {
      currentActivity = cleanPlanText(cells[cursor]);
      cursor += 1;
    }

    const version = cells[cursor] || "";
    const cycle = cells[cursor + 2] || cells[cursor + 1] || "";
    const versionDate = parseVersionDate(version, currentYear);
    if (!versionDate) return;
    const { terms, weaponTerms } = extractVersionTerms([currentActivity, version]);
    rows.push({ year: currentYear, activity: currentActivity, version, cycle, versionDate, terms, weaponTerms });
  });
  return rows;
}

function selectCurrentVersionRow(rows: VersionRow[], now: Date) {
  if (!rows.length) return undefined;
  const currentOrPast = rows
    .filter((row) => row.versionDate.getTime() <= now.getTime())
    .sort((a, b) => b.versionDate.getTime() - a.versionDate.getTime());
  if (currentOrPast[0]) return currentOrPast[0];
  return [...rows].sort((a, b) => a.versionDate.getTime() - b.versionDate.getTime())[0];
}

function parseVersionDate(version: string, year: number) {
  const match = version.match(/(\d{2})-(\d{2})版本/);
  if (!match) return undefined;
  return new Date(year, Number(match[1]) - 1, Number(match[2]), 0, 0, 0, 0);
}

function extractVersionTerms(parts: string[]) {
  const text = cleanPlanText(parts.join(" "));
  const terms = new Set<string>();
  const weaponTerms = new Set<string>();
  for (const token of text.match(/\d{2}-\d{2}版本|[\u4e00-\u9fa5][\u4e00-\u9fa50-9]{1,12}|[A-Za-z][A-Za-z0-9+\-.]{1,}/g) || []) {
    addTerm(terms, token);
    if (isWeaponTerm(token)) addTerm(weaponTerms, token);
  }
  for (const bracket of text.match(/[（(][^）)]+[）)]/g) || []) {
    for (const token of bracket.replace(/[（）()]/g, "").split(/[、,，\s]+/)) {
      addTerm(terms, token);
      if (isWeaponTerm(token)) addTerm(weaponTerms, token);
    }
  }
  return { terms: [...terms], weaponTerms: [...weaponTerms] };
}

function extractTitleTerms(title: string) {
  const cleaned = cleanTitle(title);
  const terms = new Set<string>();
  addTerm(terms, cleaned);
  for (const token of cleaned.split(/[（()）【】\[\]、,，\s]+/)) {
    addTerm(terms, token);
  }
  for (const token of cleaned.match(/[\u4e00-\u9fa5][\u4e00-\u9fa50-9A-Za-z+\-·•]{1,16}|[A-Za-z][A-Za-z0-9+\-.]{1,}/g) || []) {
    addTerm(terms, token);
  }
  return [...terms];
}

function extractWeaponTerms(title: string, text: string) {
  const terms = new Set<string>();
  for (const term of extractTitleTerms(title)) {
    if (isWeaponTerm(term) || /^[\u4e00-\u9fa5A-Za-z0-9+·•-]{2,16}$/.test(term)) addTerm(terms, term);
  }
  for (const field of extractWeaponFieldTerms(text)) addTerm(terms, field);
  return [...terms].filter((term) => !genericVersionTerms.has(term)).slice(0, 80);
}

function extractWeaponFieldTerms(text: string) {
  const terms = new Set<string>();
  const patterns = [
    /武器名称([^\d\s]{2,18}?)(?:\d|武器ID|武器CodeName|皮肤CodeName)/g,
    /(?:武器CodeName|皮肤CodeName)\s*([A-Za-z][A-Za-z0-9_]{2,40})/g,
    /当武器为[:：]\s*([A-Za-z0-9_、,，\s-]{2,120})/g
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      for (const term of match[1].split(/[、,，\s]+/)) addTerm(terms, term);
    }
  }
  return [...terms];
}

function addTerm(target: Set<string>, value: string) {
  const term = value.trim();
  if (term.length < 2 || term.length > 24 || /^\d+(?:\.\d+)?$/.test(term) || genericVersionTerms.has(term)) return;
  if (/^(?:\d+d|已完成|预计\d+月|WooduanJIRA|SSJJ)/i.test(term)) return;
  if (/[_/\\]|svn|JIRA|NaN|^[^\p{L}\p{N}]/u.test(term)) return;
  target.add(term);
}

function cleanPlanText(text: string) {
  return text
    .replace(/\d{1,2}\.\d{1,2}\s*[~～-]\s*\d{1,2}\.\d{1,2}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWeaponTerm(term: string) {
  return /(枪|武器|刀|剑|弓|镰|炮|雷|弹|皮肤|配件|机枪|近战|战术|强化石|M4|AK|AWM|SCAR|AR15|M249|USP|AUG|MP5|P90|RPK|MG3)/i.test(term);
}

function isWeaponPage(pathParts: string[]) {
  return pathParts.some((part) => /(武器|皮肤|配件|枪|近战|战术|强化石|机枪|弩|弓|刀|剑|镰|雷|弹)/i.test(part));
}

function cleanTitle(title: string) {
  return title
    .replace(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/, "")
    .replace(/^\d{1,2}月\d{1,2}日[&和]\d{1,2}月\d{1,2}日版本/, "")
    .replace(/^\d{6,8}/, "")
    .replace(/[（(]WP分支[）)]/gi, "")
    .replace(/[（(]无磨损度[）)]/g, "")
    .replace(/[（(]资源名[:：][^）)]+[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pageText(html: string) {
  return cheerio.load(html).text().replace(/\s+/g, " ").trim();
}

function uniqTerms(terms: string[]) {
  return [...new Set(terms.filter(Boolean))];
}

function shouldRefresh(now: Date) {
  if (!focusCache.fetchedAt) return true;
  return now.getTime() - new Date(focusCache.fetchedAt).getTime() >= refreshIntervalMs;
}

async function loadCachedFocus() {
  loadedCache = true;
  try {
    const raw = await fs.readFile(cachePath(), "utf-8");
    const cached = JSON.parse(raw) as CurrentVersionFocus;
    focusCache = { ...emptyFocus(), ...cached, terms: cached.terms || [], weaponTerms: cached.weaponTerms || [] };
  } catch {
    focusCache = emptyFocus();
  }
}

async function saveCachedFocus(focus: CurrentVersionFocus) {
  const target = cachePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(focus, null, 2));
}

function cachePath() {
  return path.resolve(runtimeConfig.currentVersionFocusCachePath);
}

function emptyFocus(): CurrentVersionFocus {
  return {
    fetchedAt: "",
    terms: [],
    weaponTerms: []
  };
}
