import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { gameById, games, runtimeConfig } from "./config";
import type { GameId, MonitorItem, MonitorResponse, RiskLevel, Sentiment, SourceType } from "../src/shared";

interface DingTalkState {
  initialized: boolean;
  lastSentAt?: string;
  lastTestSentAt?: string;
  lastDailyReportDate?: string;
  lastDailyReportSentAt?: string;
  seen: Record<string, string>;
}

interface DingTalkRobotConfig {
  gameId: GameId;
  shortName: string;
  label: string;
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

const monitorUrl = runtimeConfig.dingTalkMonitorUrl;
const stateRetentionMs = 30 * 24 * 3_600_000;
const dailyFocusDeduplicationMs = 72 * 3_600_000;
const dailyReportHour = 9;
const dailyReportMinute = 30;
const highHeatScoreThreshold = 800;
const highNegativeScoreThreshold = -0.45;
const discussionContextReasons = new Set(["回游/环境询问语境"]);
const routinePlayerTopics = new Set(["个人技术分享", "玩家求助咨询", "玩家行为争议", "玩家日常分享"]);

export function queueDingTalkNotification(_response: MonitorResponse, _gameIds: GameId[]) {
  return;
}

export async function sendDingTalkNotification(_response: MonitorResponse, _gameId: GameId): Promise<DingTalkSendResult> {
  return { ok: true, skipped: "DingTalk new-item notifications are disabled; daily reports only" };
}

export async function sendDingTalkTest(
  response: MonitorResponse,
  gameId: GameId = games[0]?.id || "ss1",
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
  const sentAt = new Date();
  await writeState(robot, { ...state, lastTestSentAt: sentAt.toISOString() }, sentAt);
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

  const state = await readState(robot);
  const reportDate = localDateKey(now);
  if (hasDailyReportAlreadySent(state, reportDate)) {
    return { ok: true, skipped: `${robot.shortName} daily report already sent for ${reportDate}`, mode: "daily" };
  }

  const reportStart = dailyReportWindowStart(state, now);
  const items = gameItemsForTimeRange(response, gameId, reportStart, now);
  const focusSelection = selectDailyFocusItems(items, state, now);
  await sendMarkdownToRobots(robots, buildDailyReportMarkdown(robot, items, focusSelection, { start: reportStart, end: now }, now));
  await writeState(robot, {
    ...state,
    initialized: true,
    lastDailyReportDate: reportDate,
    lastDailyReportSentAt: now.toISOString(),
    seen: markSeenDailyFocusItems(state.seen, focusSelection.items, now)
  }, now);
  return { ok: true, sent: items.length, existing: focusSelection.suppressedCount, mode: "daily" };
}

function getRobotConfigs(gameId: GameId): DingTalkRobotConfig[] {
  const robots: DingTalkRobotConfig[] = [...getGenericRobotConfigs(gameId)];
  if (gameId === "ss1") {
    if (runtimeConfig.dingTalkWebhook) {
      robots.push({
        gameId,
        shortName: "SS1",
        label: "SS1-primary",
        webhook: runtimeConfig.dingTalkWebhook,
        secret: runtimeConfig.dingTalkSecret || undefined,
        statePath: runtimeConfig.dingTalkStatePath
      });
    }
    const extraWebhooks = parseConfigList(runtimeConfig.dingTalkSs1ExtraWebhooks);
    const extraSecrets = parseConfigList(runtimeConfig.dingTalkSs1ExtraSecrets);
    for (const [index, webhook] of extraWebhooks.entries()) {
      robots.push({
        gameId,
        shortName: "SS1",
        label: `SS1-extra-${index + 1}`,
        webhook,
        secret: extraSecrets[index] || undefined,
        statePath: runtimeConfig.dingTalkStatePath
      });
    }
  }
  if (gameId === "ss2") {
    if (runtimeConfig.dingTalkSs2Webhook) {
      robots.push({
        gameId,
        shortName: "SS2",
        label: "SS2-primary",
        webhook: runtimeConfig.dingTalkSs2Webhook,
        secret: runtimeConfig.dingTalkSs2Secret || undefined,
        statePath: runtimeConfig.dingTalkSs2StatePath
      });
    }
    const extraWebhooks = parseConfigList(runtimeConfig.dingTalkSs2ExtraWebhooks);
    const extraSecrets = parseConfigList(runtimeConfig.dingTalkSs2ExtraSecrets);
    for (const [index, webhook] of extraWebhooks.entries()) {
      robots.push({
        gameId,
        shortName: "SS2",
        label: `SS2-extra-${index + 1}`,
        webhook,
        secret: extraSecrets[index] || undefined,
        statePath: runtimeConfig.dingTalkSs2StatePath
      });
    }
  }
  return robots;
}

function getGenericRobotConfigs(gameId: GameId): DingTalkRobotConfig[] {
  const configured = parseDingTalkRobotsJson(runtimeConfig.dingTalkRobotsJson);
  return configured
    .filter((robot) => robot.gameId === gameId)
    .flatMap((robot, index) => {
      const webhook = valueFromEnvOrLiteral(robot.webhookEnv, robot.webhook);
      if (!webhook) return [];
      const game = gameById.get(gameId);
      const shortName = robot.shortName || game?.shortName || gameId;
      return [{
        gameId,
        shortName,
        label: robot.label || `${shortName}-robot-${index + 1}`,
        webhook,
        secret: valueFromEnvOrLiteral(robot.secretEnv, robot.secret) || undefined,
        statePath: robot.statePath || `data/dingtalk-${gameId}-state.json`
      }];
    });
}

function parseDingTalkRobotsJson(raw: string): Array<{
  gameId: string;
  shortName?: string;
  label?: string;
  webhook?: string;
  webhookEnv?: string;
  secret?: string;
  secretEnv?: string;
  statePath?: string;
}> {
  const text = raw.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [];
    return rows.filter(isRecord).flatMap((row) => {
      const gameId = stringField(row, "gameId") || stringField(row, "game_id");
      if (!gameId) return [];
      return [{
        gameId,
        shortName: stringField(row, "shortName") || stringField(row, "short_name"),
        label: stringField(row, "label"),
        webhook: stringField(row, "webhook"),
        webhookEnv: stringField(row, "webhookEnv") || stringField(row, "webhook_env"),
        secret: stringField(row, "secret"),
        secretEnv: stringField(row, "secretEnv") || stringField(row, "secret_env"),
        statePath: stringField(row, "statePath") || stringField(row, "state_path")
      }];
    });
  } catch (error) {
    console.warn("DINGTALK_ROBOTS_JSON is invalid", error instanceof Error ? error.message : error);
    return [];
  }
}

function valueFromEnvOrLiteral(envName: string | undefined, literal: string | undefined) {
  if (envName) return process.env[envName] || "";
  return literal || "";
}

function stringField(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function gameItemsForTimeRange(response: MonitorResponse, gameId: GameId, start: Date, end: Date) {
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
  if (isContextualDiscussion(item)) return false;
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

function isContextualDiscussion(item: MonitorItem) {
  return item.riskReasons.some((reason) => discussionContextReasons.has(reason)) || item.topics.some((topic) => routinePlayerTopics.has(topic));
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
  focusSelection: DailyFocusSelection,
  reportWindow: { start: Date; end: Date },
  sentAt: Date
) {
  const reportRange = formatReportWindow(reportWindow.start, reportWindow.end);
  const title = `${robot.shortName}舆情日报 ${reportRange}`;
  const lines = [
    `## ${title}`,
    "",
    `> 发送时间：${formatLocalTime(sentAt.toISOString())} | 统计范围：${reportRange}`,
    "",
    buildDailySummaryTable(items),
    "",
    buildDailySourceTable(items),
    "",
    "### 重点关注",
    "",
    buildDailyFocusTable(focusSelection.items, focusSelection.suppressedCount),
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

function buildDailySummaryTable(items: MonitorItem[]) {
  const sentimentCounts = countBy(items, (item) => sentimentName(item.sentiment));
  const highRisk = items.filter((item) => item.riskLevel === "high").length;
  const mediumRisk = items.filter((item) => item.riskLevel === "medium").length;
  const negative = items.filter((item) => item.sentiment === "negative").length;
  const negativeRate = items.length ? `${Math.round((negative / items.length) * 100)}%` : "0%";
  return [
    "| 指标 | 本期概况 |",
    "| --- | --- |",
    `| 总量 | ${items.length}条 |`,
    `| 高风险 | ${highRisk}条 |`,
    `| 中风险 | ${mediumRisk}条 |`,
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

function buildDailyFocusTable(items: MonitorItem[], suppressedCount = 0) {
  if (!items.length) {
    return suppressedCount
      ? `本期 ${suppressedCount} 条重点舆情已在近 72 小时内推送，本次不重复列出。`
      : "本期无高风险、高热度或明显负面舆情。";
  }
  const table = [
    "| 舆情 | 触发/情绪 | 简报 |",
    "| --- | --- | --- |",
    ...items
      .map((item) => [linkCell(item), `${pushReasonName(item)} / ${sentimentName(item.sentiment)}`, shortDigest(item)].join(" | "))
      .map((row) => `| ${row} |`)
  ].join("\n");
  return suppressedCount ? `${table}\n\n> 已剔除近 72 小时内推送过的 ${suppressedCount} 条重点舆情。` : table;
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
    throw new Error(`DingTalk ${robot.label} send failed: ${response.status} ${JSON.stringify(payload)}`);
  }
}

async function sendMarkdownToRobots(robots: DingTalkRobotConfig[], markdown: { title: string; text: string }) {
  const results = await Promise.allSettled(robots.map((robot) => sendMarkdown(robot, markdown)));
  const failures = results
    .map((result, index) => ({ result, robot: robots[index] }))
    .filter((entry): entry is { result: PromiseRejectedResult; robot: DingTalkRobotConfig } => entry.result.status === "rejected");
  if (failures.length) {
    const details = failures.map(({ robot, result }) => `${robot.label}: ${errorMessage(result.reason)}`).join(" | ");
    if (failures.length === robots.length) {
      throw new Error(`DingTalk ${robots[0]?.shortName || "robot"} send failed ${failures.length}/${robots.length}: ${details}`);
    }
    console.warn(`DingTalk ${robots[0]?.shortName || "robot"} partial send failed ${failures.length}/${robots.length}: ${details}`);
  }
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
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
      lastDailyReportSentAt: state.lastDailyReportSentAt,
      seen: state.seen || {}
    };
  } catch {
    return { initialized: false, seen: {} };
  }
}

async function writeState(robot: DingTalkRobotConfig, state: DingTalkState, writtenAt = new Date()) {
  const target = statePath(robot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(pruneState({ ...state, lastSentAt: writtenAt.toISOString() }, writtenAt), null, 2));
}

function statePath(robot: DingTalkRobotConfig) {
  return path.resolve(robot.statePath);
}

function hasDailyReportAlreadySent(state: DingTalkState, reportDate: string) {
  if (state.lastDailyReportDate === reportDate) return true;
  if (state.lastDailyReportSentAt) return false;
  return legacyDailyReportSentDateKey(state.lastDailyReportDate) === reportDate;
}

function dailyReportWindowStart(state: DingTalkState, reportEnd: Date) {
  const explicitSentAt = validDateBefore(state.lastDailyReportSentAt, reportEnd);
  if (explicitSentAt) return weekendFloorForMondayReport(explicitSentAt, reportEnd);

  const legacySentAt = legacyDailyReportSentAt(state.lastDailyReportDate);
  if (legacySentAt && legacySentAt < reportEnd) return weekendFloorForMondayReport(legacySentAt, reportEnd);

  return weekendFloorForMondayReport(previousScheduledReportBoundary(reportEnd), reportEnd);
}

function weekendFloorForMondayReport(start: Date, reportEnd: Date) {
  if (reportEnd.getDay() !== 1) return start;
  const weekendStart = new Date(reportEnd);
  weekendStart.setDate(weekendStart.getDate() - 2);
  weekendStart.setHours(0, 0, 0, 0);
  return start > weekendStart ? weekendStart : start;
}

function isDailyFocusItem(item: MonitorItem) {
  if (isRoutinePlayerContent(item)) return false;
  return item.riskLevel !== "low" || Boolean(dingTalkPushReason(item));
}

interface DailyFocusSelection {
  items: MonitorItem[];
  suppressedCount: number;
}

function selectDailyFocusItems(items: MonitorItem[], state: DingTalkState, now: Date): DailyFocusSelection {
  const candidates = items.filter(isDailyFocusItem).sort(compareDingTalkItems);
  const unseen = candidates.filter((item) => !hasRecentlySeenDailyFocusItem(state, item, now));
  return {
    items: unseen.slice(0, 8),
    suppressedCount: candidates.length - unseen.length
  };
}

function hasRecentlySeenDailyFocusItem(state: DingTalkState, item: MonitorItem, now: Date) {
  return dailyFocusSeenKeys(item).some((key) => {
    const recordedAt = seenRecordedAt(state.seen[key]);
    return Boolean(recordedAt && now.getTime() - recordedAt.getTime() < dailyFocusDeduplicationMs);
  });
}

function markSeenDailyFocusItems(seen: DingTalkState["seen"], items: MonitorItem[], sentAt: Date) {
  const next = { ...seen };
  for (const item of items) {
    const value = [sentAt.toISOString(), item.publishedAt, item.riskLevel].join("|");
    for (const key of dailyFocusSeenKeys(item)) next[key] = value;
  }
  return next;
}

function dailyFocusSeenKey(item: MonitorItem) {
  return `${item.gameId}:${item.id}`;
}

function dailyFocusSeenKeys(item: MonitorItem) {
  const keys = [dailyFocusSeenKey(item)];
  const sourceItemId = item.sourceItemId.trim();
  if (sourceItemId) keys.push(`${item.gameId}:${item.source}:${sourceItemId}`);
  const urlKey = normalizeSeenUrl(item.url);
  if (urlKey) keys.push(`${item.gameId}:${item.source}:url:${urlKey}`);
  const titleKey = titleSeenFingerprint(item);
  if (titleKey) keys.push(`${item.gameId}:${item.source}:title:${titleKey}`);
  return Array.from(new Set(keys));
}

function normalizeSeenUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      parsed.protocol = "https:";
      parsed.username = "";
      parsed.password = "";
      parsed.hash = "";
      parsed.search = "";
      parsed.hostname = parsed.hostname.toLowerCase();
      parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return trimmed.replace(/\s+/g, "");
  }
  return trimmed.replace(/\s+/g, "");
}

function titleSeenFingerprint(item: MonitorItem) {
  const title = normalizeSeenText(item.title);
  if (title.length < 8) return "";
  const author = normalizeSeenText(item.author);
  return crypto.createHash("md5").update(`${author}|${title}`).digest("hex").slice(0, 16);
}

function normalizeSeenText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function pruneState(state: DingTalkState, now = new Date()): DingTalkState {
  const cutoff = now.getTime() - stateRetentionMs;
  const seen = Object.fromEntries(Object.entries(state.seen).filter(([, value]) => {
    const recordedAt = seenRecordedAt(value);
    return recordedAt ? recordedAt.getTime() >= cutoff : false;
  }));
  return { ...state, seen };
}

function seenRecordedAt(value: string | undefined) {
  if (!value) return undefined;
  const timestamp = value.split("|", 1)[0];
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) ? new Date(time) : undefined;
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
  if (source === "bettafish") return "BettaFish";
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

function formatReportWindow(start: Date, end: Date) {
  return `${formatLocalTime(start.toISOString())}-${formatLocalTime(end.toISOString())}`;
}

function localDateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function legacyDailyReportSentDateKey(reportDate: string | undefined) {
  const sentAt = legacyDailyReportSentAt(reportDate);
  return sentAt ? localDateKey(sentAt) : "";
}

function legacyDailyReportSentAt(reportDate: string | undefined) {
  const reportDay = localDateFromKey(reportDate);
  if (!reportDay) return undefined;
  const sentAt = new Date(reportDay);
  sentAt.setDate(sentAt.getDate() + 1);
  sentAt.setHours(dailyReportHour, dailyReportMinute, 0, 0);
  return sentAt;
}

function validDateBefore(value: string | undefined, end: Date) {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time) || time >= end.getTime()) return undefined;
  return new Date(time);
}

function previousScheduledReportBoundary(value: Date) {
  const boundary = new Date(value);
  boundary.setHours(dailyReportHour, dailyReportMinute, 0, 0);
  if (boundary >= value) boundary.setDate(boundary.getDate() - 1);
  while (!isWorkday(boundary)) boundary.setDate(boundary.getDate() - 1);
  return boundary;
}

function isWorkday(value: Date) {
  const day = value.getDay();
  return day >= 1 && day <= 5;
}

function localDateFromKey(value: string | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  return new Date(year, month - 1, day);
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
