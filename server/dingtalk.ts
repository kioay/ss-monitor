import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runtimeConfig } from "./config";
import type { GameId, MonitorItem, MonitorResponse, RiskLevel, Sentiment, SourceType } from "../src/shared";

interface DingTalkState {
  initialized: boolean;
  lastSentAt?: string;
  lastTestSentAt?: string;
  lastDailyReportDate?: string;
  seen: Record<string, string>;
}

interface DingTalkRobotConfig {
  gameId: GameId;
  shortName: "SS1" | "SS2";
  webhook: string;
  secret?: string;
  statePath: string;
}

interface DingTalkSendResult {
  ok: boolean;
  skipped?: string;
  sent?: number;
  existing?: number;
  mode?: "baseline" | "new" | "test" | "daily";
  retryAfterSeconds?: number;
}

const monitorUrl = "http://ss-monitor.qinoay.top/";
const stateRetentionMs = 30 * 24 * 3_600_000;
const notificationBatchMs = 15 * 60 * 1000;
const highHeatScoreThreshold = 800;
const highNegativeScoreThreshold = -0.45;
const routinePlayerTopics = new Set(["个人技术分享", "玩家求助咨询", "玩家行为争议", "玩家日常分享"]);
const pendingNotifications = new Map<GameId, MonitorResponse>();
let notificationQueue: Promise<unknown> = Promise.resolve();
let notificationBatchTimer: ReturnType<typeof setTimeout> | undefined;

export function queueDingTalkNotification(response: MonitorResponse, gameIds: GameId[]) {
  for (const gameId of gameIds) {
    pendingNotifications.set(gameId, response);
  }
  scheduleNotificationBatch();
}

function scheduleNotificationBatch() {
  if (notificationBatchTimer) return;
  const delayMs = msUntilNextNotificationBatch();
  notificationBatchTimer = setTimeout(flushNotificationBatch, delayMs);
}

function flushNotificationBatch() {
  notificationBatchTimer = undefined;
  const entries = Array.from(pendingNotifications.entries());
  pendingNotifications.clear();
  for (const [gameId, response] of entries) {
    notificationQueue = notificationQueue
      .then(() => sendDingTalkNotification(response, gameId))
      .catch((error) => {
        console.error(`DingTalk ${gameId} notification failed`, error);
      });
  }
}

function msUntilNextNotificationBatch(now = new Date()) {
  const next = new Date(now);
  const minutes = now.getMinutes();
  const nextMinute = Math.ceil((minutes + 1) / 15) * 15;
  next.setSeconds(0, 0);
  if (nextMinute >= 60) {
    next.setHours(next.getHours() + 1, 0, 0, 0);
  } else {
    next.setMinutes(nextMinute);
  }
  return Math.max(1_000, next.getTime() - now.getTime());
}

export async function sendDingTalkNotification(response: MonitorResponse, gameId: GameId): Promise<DingTalkSendResult> {
  const robots = getRobotConfigs(gameId);
  if (!robots.length) return { ok: true, skipped: `DingTalk ${gameId} is not configured` };
  const robot = robots[0];

  const allCurrentItems = gameItemsWithin72Hours(response, gameId);
  const currentItems = allCurrentItems.filter(isDingTalkRelevantItem);
  const state = await readState(robot);
  if (!state.initialized) {
    await sendMarkdownToRobots(robots, buildBaselineMarkdown(robot, currentItems, response));
    await writeState(robot, markSeen(state, allCurrentItems));
    return { ok: true, sent: 0, existing: currentItems.length, mode: "baseline" };
  }

  const newItems = currentItems.filter((item) => !state.seen[item.id]);
  if (!newItems.length) {
    await writeState(robot, pruneState(markSeen(state, allCurrentItems)));
    return { ok: true, skipped: `No new ${robot.shortName} sentiment items` };
  }

  await sendMarkdownToRobots(
    robots,
    buildNewItemsMarkdown(robot, newItems, currentItems, response)
  );
  await writeState(robot, markSeen(state, allCurrentItems));
  return { ok: true, sent: newItems.length, existing: currentItems.length - newItems.length, mode: "new" };
}

export async function sendDingTalkTest(
  response: MonitorResponse,
  gameId: GameId = "ss1",
  options: { force?: boolean } = {}
): Promise<DingTalkSendResult> {
  const robots = getRobotConfigs(gameId);
  if (!robots.length) return { ok: false, skipped: `DingTalk ${gameId} is not configured` };
  const robot = robots[0];
  const state = await readState(robot);
  const cooldownMs = runtimeConfig.dingTalkTestCooldownSeconds * 1000;
  const lastTestTime = state.lastTestSentAt ? new Date(state.lastTestSentAt).getTime() : 0;
  const remainingMs = lastTestTime ? cooldownMs - (Date.now() - lastTestTime) : 0;
  if (!options.force && cooldownMs > 0 && remainingMs > 0) {
    return {
      ok: true,
      skipped: `${robot.shortName} DingTalk test cooldown is active`,
      mode: "test",
      retryAfterSeconds: Math.ceil(remainingMs / 1000)
    };
  }
  const currentItems = gameItemsWithin72Hours(response, gameId).filter(isDingTalkRelevantItem);
  await sendMarkdownToRobots(robots, buildTestMarkdown(robot, currentItems, response));
  await writeState(robot, { ...state, lastTestSentAt: new Date().toISOString() });
  return { ok: true, sent: currentItems.length, mode: "test" };
}

export async function sendDingTalkDailyReport(
  response: MonitorResponse,
  gameId: GameId,
  now = new Date()
): Promise<DingTalkSendResult> {
  const robots = getRobotConfigs(gameId);
  if (!robots.length) return { ok: true, skipped: `DingTalk ${gameId} is not configured` };
  const robot = robots[0];

  const reportDay = previousLocalDay(now);
  const reportDate = localDateKey(reportDay);
  const state = await readState(robot);
  if (state.lastDailyReportDate === reportDate) {
    return { ok: true, skipped: `${robot.shortName} daily report already sent for ${reportDate}`, mode: "daily" };
  }

  const items = gameItemsForLocalDay(response, gameId, reportDay);
  const ongoingHighRiskItems = gameItemsWithin72Hours(response, gameId).filter((item) => item.riskLevel === "high");
  await sendMarkdownToRobots(robots, buildDailyReportMarkdown(robot, items, ongoingHighRiskItems, reportDay, now));
  await writeState(robot, {
    ...state,
    initialized: true,
    lastDailyReportDate: reportDate
  });
  return { ok: true, sent: items.length, mode: "daily" };
}

function getRobotConfigs(gameId: GameId): DingTalkRobotConfig[] {
  const robots: DingTalkRobotConfig[] = [];
  if (gameId === "ss1" && runtimeConfig.dingTalkWebhook) {
    robots.push({
      gameId,
      shortName: "SS1",
      webhook: runtimeConfig.dingTalkWebhook,
      secret: runtimeConfig.dingTalkSecret || undefined,
      statePath: runtimeConfig.dingTalkStatePath
    });
    const extraWebhooks = parseConfigList(runtimeConfig.dingTalkSs1ExtraWebhooks);
    const extraSecrets = parseConfigList(runtimeConfig.dingTalkSs1ExtraSecrets);
    for (const [index, webhook] of extraWebhooks.entries()) {
      robots.push({
        gameId,
        shortName: "SS1",
        webhook,
        secret: extraSecrets[index] || undefined,
        statePath: runtimeConfig.dingTalkStatePath
      });
    }
  }
  if (gameId === "ss2" && runtimeConfig.dingTalkSs2Webhook) {
    robots.push({
      gameId,
      shortName: "SS2",
      webhook: runtimeConfig.dingTalkSs2Webhook,
      secret: runtimeConfig.dingTalkSs2Secret || undefined,
      statePath: runtimeConfig.dingTalkSs2StatePath
    });
    const extraWebhooks = parseConfigList(runtimeConfig.dingTalkSs2ExtraWebhooks);
    const extraSecrets = parseConfigList(runtimeConfig.dingTalkSs2ExtraSecrets);
    for (const [index, webhook] of extraWebhooks.entries()) {
      robots.push({
        gameId,
        shortName: "SS2",
        webhook,
        secret: extraSecrets[index] || undefined,
        statePath: runtimeConfig.dingTalkSs2StatePath
      });
    }
  }
  return robots;
}

function parseConfigList(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function gameItemsWithin72Hours(response: MonitorResponse, gameId: GameId) {
  const cutoff = Date.now() - 72 * 3_600_000;
  return response.items
    .filter((item) => item.gameId === gameId && new Date(item.publishedAt).getTime() >= cutoff)
    .sort(compareDingTalkItems);
}

function gameItemsForLocalDay(response: MonitorResponse, gameId: GameId, day: Date) {
  const start = startOfLocalDay(day);
  const end = new Date(start.getTime() + 86_400_000);
  return response.items
    .filter((item) => item.gameId === gameId)
    .filter((item) => {
      const publishedAt = new Date(item.publishedAt);
      return publishedAt >= start && publishedAt < end;
    })
    .sort(compareDingTalkItems);
}

function isDingTalkRelevantItem(item: MonitorItem) {
  if (isRoutinePlayerContent(item)) return false;
  return Boolean(dingTalkPushReason(item));
}

function dingTalkPushReason(item: MonitorItem) {
  if (item.riskLevel === "high") return "高风险";
  if (isHighNegativeItem(item)) return "高负面";
  if (isHighHeatItem(item)) return "高热度";
  return "";
}

function isHighNegativeItem(item: MonitorItem) {
  return item.sentiment === "negative" && item.sentimentScore <= highNegativeScoreThreshold;
}

function isHighHeatItem(item: MonitorItem) {
  return engagementScore(item) >= highHeatScoreThreshold;
}

function engagementScore(item: MonitorItem) {
  return (
    (item.metrics.views || 0) * 0.002 +
    (item.metrics.replies || 0) * 2 +
    (item.metrics.comments || 0) * 2 +
    (item.metrics.danmaku || 0) * 1.2 +
    (item.metrics.likes || 0) * 0.2 +
    (item.metrics.shares || 0) * 0.4
  );
}

function isRoutinePlayerContent(item: MonitorItem) {
  return item.riskLevel === "low" && !item.riskReasons.length && item.topics.some((topic) => routinePlayerTopics.has(topic));
}

function buildBaselineMarkdown(robot: DingTalkRobotConfig, items: MonitorItem[], response: MonitorResponse) {
  const title = `${robot.shortName}舆情基线 ${formatLocalTime(response.generatedAt)}`;
  const lines = [
    `## ${title}`,
    "",
    "> 钉钉机器人已启用。后续仅推送高风险、高热度或高负面新增舆情；普通玩家分享、求助、技巧内容仅保留在平台。",
    "",
    buildBriefTable(items),
    "",
    buildHighRiskSection(items),
    "",
    `[打开舆情平台](${monitorUrl})`
  ];
  return { title, text: lines.join("\n") };
}

function buildNewItemsMarkdown(
  robot: DingTalkRobotConfig,
  newItems: MonitorItem[],
  allItems: MonitorItem[],
  response: MonitorResponse
) {
  const title = `${robot.shortName}新增舆情 ${newItems.length}条`;
  const lines = [
    `## ${title}`,
    "",
    `> 采集时间：${formatLocalTime(response.generatedAt)} | 窗口：近72小时`,
    "",
    buildBriefTable(allItems),
    "",
    "### 新增舆情完整简报",
    "",
    buildDetailedTable(newItems),
    "",
    `[打开舆情平台](${monitorUrl})`
  ];
  return { title, text: lines.join("\n") };
}

function buildTestMarkdown(robot: DingTalkRobotConfig, items: MonitorItem[], response: MonitorResponse) {
  const title = `${robot.shortName}舆情机器人测试`;
  const lines = [
    `## ${title}`,
    "",
    `> 测试时间：${formatLocalTime(new Date().toISOString())} | 数据生成：${formatLocalTime(response.generatedAt)}`,
    "",
    buildBriefTable(items),
    "",
    buildHighRiskSection(items, "高风险预警"),
    "",
    `[打开舆情平台](${monitorUrl})`
  ];
  return { title, text: lines.join("\n") };
}

function buildDailyReportMarkdown(
  robot: DingTalkRobotConfig,
  items: MonitorItem[],
  ongoingHighRiskItems: MonitorItem[],
  reportDay: Date,
  sentAt: Date
) {
  const reportDate = formatLocalDate(reportDay);
  const title = `${robot.shortName}昨日舆情日报 ${reportDate}`;
  const focusItems = items.filter(isDailyFocusItem).sort(compareDingTalkItems).slice(0, 8);
  const lines = [
    `## ${title}`,
    "",
    `> 发送时间：${formatLocalTime(sentAt.toISOString())} | 统计范围：${reportDate} 00:00-24:00`,
    "",
    buildDailySummaryTable(items, ongoingHighRiskItems.length),
    "",
    buildDailySourceTable(items),
    "",
    "### 重点关注",
    "",
    buildDailyFocusTable(focusItems),
    "",
    "### 高风险持续汇总（近72小时）",
    "",
    buildDailyHighRiskTable(ongoingHighRiskItems),
    "",
    `[打开舆情平台](${monitorUrl})`
  ];
  return { title, text: lines.join("\n") };
}

function buildBriefTable(items: MonitorItem[]) {
  const sentimentCounts = countBy(items, (item) => sentimentName(item.sentiment));
  const highRisk = items.filter((item) => item.riskLevel === "high").length;
  return [
    "| 指标 | 内容 |",
    "| --- | --- |",
    `| 高风险 | ${highRisk}条 |`,
    `| 情绪 | ${joinCounts(sentimentCounts)} |`
  ].join("\n");
}

function buildDailySummaryTable(items: MonitorItem[], ongoingHighRiskCount = 0) {
  const sentimentCounts = countBy(items, (item) => sentimentName(item.sentiment));
  const highRisk = items.filter((item) => item.riskLevel === "high").length;
  const negative = items.filter((item) => item.sentiment === "negative").length;
  const negativeRate = items.length ? `${Math.round((negative / items.length) * 100)}%` : "0%";
  return [
    "| 指标 | 昨日概况 |",
    "| --- | --- |",
    `| 总量 | ${items.length}条 |`,
    `| 高风险 | ${highRisk}条 |`,
    `| 近72小时高风险存量 | ${ongoingHighRiskCount}条 |`,
    `| 负面率 | ${negativeRate} |`,
    `| 情绪 | ${joinCounts(sentimentCounts)} |`
  ].join("\n");
}

function buildDailySourceTable(items: MonitorItem[]) {
  const sourceCounts = countBy(items, (item) => sourceName(item.source));
  const topicSummary = topTopics(items) || "暂无";
  return [
    "| 维度 | 概况 |",
    "| --- | --- |",
    `| 来源 | ${joinCounts(sourceCounts)} |`,
    `| 话题 | ${topicSummary} |`
  ].join("\n");
}

function buildDailyFocusTable(items: MonitorItem[]) {
  if (!items.length) return "昨日无高风险、高热度或明显负面舆情。";
  return [
    "| 舆情 | 触发/情绪 | 简报 |",
    "| --- | --- | --- |",
    ...items
      .map((item) => [linkCell(item), `${pushReasonName(item)} / ${sentimentName(item.sentiment)}`, shortDigest(item)].join(" | "))
      .map((row) => `| ${row} |`)
  ].join("\n");
}

function buildDailyHighRiskTable(items: MonitorItem[]) {
  if (!items.length) return "近72小时暂无高风险舆情存量。";
  const visibleItems = items.slice(0, 8);
  const moreText = items.length > visibleItems.length ? `\n\n> 仅展示风险排序前 ${visibleItems.length} 条，剩余 ${items.length - visibleItems.length} 条可在平台查看。` : "";
  return [
    "| 时间 | 来源 | 舆情 | 简报 |",
    "| --- | --- | --- | --- |",
    ...visibleItems.map(
      (item) => `| ${formatShortTime(item.publishedAt)} | ${sourceName(item.source)} | ${linkCell(item)} | ${shortDigest(item)} |`
    )
  ].join("\n") + moreText;
}

function buildDetailedTable(items: MonitorItem[]) {
  const sortedItems = [...items].sort(compareDingTalkItems);
  if (!items.length) return "暂无新增舆情。";
  return [
    "| 舆情 | 触发/情绪 | 简报 |",
    "| --- | --- | --- |",
    ...sortedItems
      .map((item) => [linkCell(item), `${pushReasonName(item)} / ${sentimentName(item.sentiment)}`, shortDigest(item)].join(" | "))
      .map((row) => `| ${row} |`)
  ].join("\n");
}

function buildHighRiskSection(items: MonitorItem[], title = "高风险舆情") {
  const highRiskItems = items.filter((item) => item.riskLevel === "high").sort(compareDingTalkItems);
  if (!highRiskItems.length) return "";
  return [
    `### ${title}`,
    "",
    "| 时间 | 来源 | 舆情 | 简报 |",
    "| --- | --- | --- | --- |",
    ...highRiskItems.map(
      (item) => `| ${formatShortTime(item.publishedAt)} | ${sourceName(item.source)} | ${linkCell(item)} | ${shortDigest(item)} |`
    )
  ].join("\n");
}

function buildExistingTable(items: MonitorItem[]) {
  const sortedItems = items.filter((item) => item.riskLevel !== "low").sort(compareDingTalkItems);
  if (!sortedItems.length) return "暂无中高风险舆情。";
  return [
    "| 时间 | 来源 | 舆情 | 风险 |",
    "| --- | --- | --- | --- |",
    ...sortedItems.map(
      (item) => `| ${formatShortTime(item.publishedAt)} | ${sourceName(item.source)} | ${linkCell(item)} | ${riskName(item.riskLevel)} |`
    )
  ].join("\n");
}

function compareDingTalkItems(a: MonitorItem, b: MonitorItem) {
  const reasonDelta = pushReasonRank(b) - pushReasonRank(a);
  if (reasonDelta) return reasonDelta;
  const riskDelta = riskRank(b.riskLevel) - riskRank(a.riskLevel);
  if (riskDelta) return riskDelta;
  const heatDelta = engagementScore(b) - engagementScore(a);
  if (Math.abs(heatDelta) >= 1) return heatDelta;
  return +new Date(b.publishedAt) - +new Date(a.publishedAt);
}

function pushReasonRank(item: MonitorItem) {
  const reason = dingTalkPushReason(item);
  if (reason === "高风险") return 3;
  if (reason === "高负面") return 2;
  if (reason === "高热度") return 1;
  return 0;
}

function riskRank(risk: RiskLevel) {
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

async function sendMarkdown(robot: DingTalkRobotConfig, markdown: { title: string; text: string }) {
  const response = await fetch(signedWebhookUrl(robot), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown,
      at: { isAtAll: false }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errcode !== 0) {
    throw new Error(`DingTalk ${robot.shortName} send failed: ${response.status} ${JSON.stringify(payload)}`);
  }
}

async function sendMarkdownToRobots(robots: DingTalkRobotConfig[], markdown: { title: string; text: string }) {
  await Promise.all(robots.map((robot) => sendMarkdown(robot, markdown)));
}

function signedWebhookUrl(robot: DingTalkRobotConfig) {
  if (!robot.secret) return robot.webhook;
  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${robot.secret}`;
  const sign = crypto.createHmac("sha256", robot.secret).update(stringToSign).digest("base64");
  const url = new URL(robot.webhook);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  return url.toString();
}

async function readState(robot: DingTalkRobotConfig): Promise<DingTalkState> {
  try {
    const raw = await fs.readFile(statePath(robot), "utf-8");
    const state = JSON.parse(raw) as DingTalkState;
    return {
      initialized: Boolean(state.initialized),
      lastSentAt: state.lastSentAt,
      lastTestSentAt: state.lastTestSentAt,
      lastDailyReportDate: state.lastDailyReportDate,
      seen: state.seen || {}
    };
  } catch {
    return { initialized: false, seen: {} };
  }
}

async function writeState(robot: DingTalkRobotConfig, state: DingTalkState) {
  const target = statePath(robot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(pruneState({ ...state, lastSentAt: new Date().toISOString() }), null, 2));
}

function statePath(robot: DingTalkRobotConfig) {
  return path.resolve(robot.statePath);
}

function isDailyFocusItem(item: MonitorItem) {
  if (isRoutinePlayerContent(item)) return false;
  return item.riskLevel !== "low" || Boolean(dingTalkPushReason(item));
}

function markSeen(state: DingTalkState, items: MonitorItem[]): DingTalkState {
  const seen = { ...state.seen };
  for (const item of items) seen[item.id] = item.publishedAt;
  return { ...state, initialized: true, seen };
}

function pruneState(state: DingTalkState): DingTalkState {
  const cutoff = Date.now() - stateRetentionMs;
  const seen = Object.fromEntries(Object.entries(state.seen).filter(([, value]) => new Date(value).getTime() >= cutoff));
  return { ...state, seen };
}

function countBy(items: MonitorItem[], getKey: (item: MonitorItem) => string) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(getKey(item), (counts.get(getKey(item)) || 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

function joinCounts(counts: Array<[string, number]>) {
  return counts.length ? counts.map(([key, count]) => `${key} ${count}`).join(" / ") : "暂无";
}

function topTopics(items: MonitorItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const topic of item.topics) counts.set(topic, (counts.get(topic) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic, count]) => `${safeCell(topic)} ${count}`)
    .join(" / ");
}

function linkCell(item: MonitorItem) {
  return `[${safeCell(compact([item.title], 34))}](${item.url})`;
}

function shortDigest(item: MonitorItem) {
  const signal = item.riskReasons[0] || item.summary || item.keywords[0] || "";
  return compact([signal], 34);
}

function compact(parts: string[], maxLength: number) {
  const text = parts.filter(Boolean).join("；").replace(/\s+/g, " ").trim();
  return safeCell(text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text);
}

function safeCell(value: string) {
  return value.replace(/\|/g, "｜").replace(/\r?\n/g, " ").trim() || "-";
}

function sourceName(source: SourceType) {
  if (source === "bilibili") return "B站";
  if (source === "tieba") return "贴吧";
  return "抖音";
}

function riskName(risk: RiskLevel) {
  if (risk === "high") return colorText("高风险", "#d93025");
  if (risk === "medium") return colorText("中风险", "#b26a00");
  return colorText("普通", "#6f7d75");
}

function pushReasonName(item: MonitorItem) {
  const reason = dingTalkPushReason(item);
  if (reason === "高风险") return colorText("高风险", "#d93025");
  if (reason === "高负面") return colorText("高负面", "#d93025");
  if (reason === "高热度") return colorText("高热度", "#b26a00");
  return riskName(item.riskLevel);
}

function sentimentName(sentiment: Sentiment) {
  if (sentiment === "negative") return colorText("负面", "#d93025");
  if (sentiment === "positive") return colorText("正面", "#14845f");
  if (sentiment === "mixed") return colorText("混合", "#b26a00");
  return colorText("中性", "#6f7d75");
}

function colorText(text: string, color: string) {
  return `<font color="${color}">${text}</font>`;
}

function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function formatLocalDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function previousLocalDay(value: Date) {
  const day = startOfLocalDay(value);
  day.setDate(day.getDate() - 1);
  return day;
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function formatShortTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}
