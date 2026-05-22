import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runtimeConfig } from "./config";
import type { GameId, MonitorItem, MonitorResponse, RiskLevel, Sentiment, SourceType } from "../src/shared";

interface DingTalkState {
  initialized: boolean;
  lastSentAt?: string;
  lastTestSentAt?: string;
  lastHighRiskReminderSlot?: string;
  seen: Record<string, string>;
}

interface DingTalkRobotConfig {
  gameId: GameId;
  shortName: "SS1" | "SS2";
  webhook: string;
  secret: string;
  statePath: string;
}

interface DingTalkSendResult {
  ok: boolean;
  skipped?: string;
  sent?: number;
  existing?: number;
  mode?: "baseline" | "new" | "risk" | "test";
  retryAfterSeconds?: number;
}

const monitorUrl = "http://ss-monitor.qinoay.top/";
const stateRetentionMs = 30 * 24 * 3_600_000;
let notificationQueue: Promise<unknown> = Promise.resolve();

export function queueDingTalkNotification(response: MonitorResponse, gameIds: GameId[]) {
  for (const gameId of gameIds) {
    notificationQueue = notificationQueue
      .then(() => sendDingTalkNotification(response, gameId))
      .catch((error) => {
        console.error(`DingTalk ${gameId} notification failed`, error);
      });
  }
}

export async function sendDingTalkNotification(response: MonitorResponse, gameId: GameId): Promise<DingTalkSendResult> {
  const robot = getRobotConfig(gameId);
  if (!robot) return { ok: true, skipped: `DingTalk ${gameId} is not configured` };

  const currentItems = gameItemsWithin72Hours(response, gameId);
  const state = await readState(robot);
  if (!state.initialized) {
    await sendMarkdown(robot, buildBaselineMarkdown(robot, currentItems, response));
    await writeState(robot, markSeen(state, currentItems));
    return { ok: true, sent: 0, existing: currentItems.length, mode: "baseline" };
  }

  const newItems = currentItems.filter((item) => !state.seen[item.id]);
  const highRiskItems = currentItems.filter((item) => item.riskLevel === "high");
  const reminderSlot = highRiskReminderSlot(response.generatedAt);
  const shouldSendHighRiskReminder = Boolean(
    highRiskItems.length && reminderSlot && state.lastHighRiskReminderSlot !== reminderSlot
  );
  if (!newItems.length) {
    if (shouldSendHighRiskReminder && reminderSlot) {
      await sendMarkdown(robot, buildHighRiskReminderMarkdown(robot, highRiskItems, currentItems, response));
      await writeState(robot, pruneState(markSeen({ ...state, lastHighRiskReminderSlot: reminderSlot }, currentItems)));
      return { ok: true, sent: highRiskItems.length, existing: currentItems.length, mode: "risk" };
    }
    if (highRiskItems.length) {
      await writeState(robot, pruneState(markSeen(state, currentItems)));
      return { ok: true, skipped: `${robot.shortName} high risk reminder is outside scheduled slots or already sent` };
    }
    await writeState(robot, pruneState(markSeen(state, currentItems)));
    return { ok: true, skipped: `No new ${robot.shortName} sentiment items` };
  }

  await sendMarkdown(
    robot,
    buildNewItemsMarkdown(robot, newItems, currentItems, response, shouldSendHighRiskReminder ? highRiskItems : [])
  );
  await writeState(robot, markSeen(reminderSlot && shouldSendHighRiskReminder ? { ...state, lastHighRiskReminderSlot: reminderSlot } : state, currentItems));
  return { ok: true, sent: newItems.length, existing: currentItems.length - newItems.length, mode: "new" };
}

export async function sendDingTalkTest(
  response: MonitorResponse,
  gameId: GameId = "ss1",
  options: { force?: boolean } = {}
): Promise<DingTalkSendResult> {
  const robot = getRobotConfig(gameId);
  if (!robot) return { ok: false, skipped: `DingTalk ${gameId} is not configured` };
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
  const currentItems = gameItemsWithin72Hours(response, gameId);
  await sendMarkdown(robot, buildTestMarkdown(robot, currentItems, response));
  await writeState(robot, { ...state, lastTestSentAt: new Date().toISOString() });
  return { ok: true, sent: currentItems.length, mode: "test" };
}

function getRobotConfig(gameId: GameId): DingTalkRobotConfig | undefined {
  if (gameId === "ss1" && runtimeConfig.dingTalkWebhook && runtimeConfig.dingTalkSecret) {
    return {
      gameId,
      shortName: "SS1",
      webhook: runtimeConfig.dingTalkWebhook,
      secret: runtimeConfig.dingTalkSecret,
      statePath: runtimeConfig.dingTalkStatePath
    };
  }
  if (gameId === "ss2" && runtimeConfig.dingTalkSs2Webhook && runtimeConfig.dingTalkSs2Secret) {
    return {
      gameId,
      shortName: "SS2",
      webhook: runtimeConfig.dingTalkSs2Webhook,
      secret: runtimeConfig.dingTalkSs2Secret,
      statePath: runtimeConfig.dingTalkSs2StatePath
    };
  }
  return undefined;
}

function gameItemsWithin72Hours(response: MonitorResponse, gameId: GameId) {
  const cutoff = Date.now() - 72 * 3_600_000;
  return response.items
    .filter((item) => item.gameId === gameId && new Date(item.publishedAt).getTime() >= cutoff)
    .sort(compareDingTalkItems);
}

function buildBaselineMarkdown(robot: DingTalkRobotConfig, items: MonitorItem[], response: MonitorResponse) {
  const title = `${robot.shortName}舆情基线 ${formatLocalTime(response.generatedAt)}`;
  const lines = [
    `## ${title}`,
    "",
    "> 钉钉机器人已启用。后续新增舆情会立即推送完整简报。",
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
  response: MonitorResponse,
  scheduledHighRiskItems: MonitorItem[] = []
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
    buildHighRiskSection(scheduledHighRiskItems),
    "",
    `[打开舆情平台](${monitorUrl})`
  ];
  return { title, text: lines.join("\n") };
}

function buildHighRiskReminderMarkdown(
  robot: DingTalkRobotConfig,
  highRiskItems: MonitorItem[],
  allItems: MonitorItem[],
  response: MonitorResponse
) {
  const title = `${robot.shortName}高风险持续预警 ${highRiskItems.length}条`;
  const lines = [
    `## ${title}`,
    "",
    `> 巡检时间：${formatLocalTime(response.generatedAt)} | 窗口：近72小时`,
    "",
    buildBriefTable(allItems),
    "",
    buildHighRiskSection(highRiskItems),
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

function buildDetailedTable(items: MonitorItem[]) {
  const sortedItems = [...items].sort(compareDingTalkItems);
  if (!items.length) return "暂无新增舆情。";
  return [
    "| 舆情 | 风险/情绪 | 简报 |",
    "| --- | --- | --- |",
    ...sortedItems
      .map((item) => [linkCell(item), `${riskName(item.riskLevel)} / ${sentimentName(item.sentiment)}`, shortDigest(item)].join(" | "))
      .map((row) => `| ${row} |`)
  ].join("\n");
}

function buildHighRiskSection(items: MonitorItem[], title = "高风险持续预警（定时推送）") {
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
  const riskDelta = riskRank(b.riskLevel) - riskRank(a.riskLevel);
  if (riskDelta) return riskDelta;
  return +new Date(b.publishedAt) - +new Date(a.publishedAt);
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

function signedWebhookUrl(robot: DingTalkRobotConfig) {
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
      lastHighRiskReminderSlot: state.lastHighRiskReminderSlot,
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

function highRiskReminderSlot(value: string) {
  const date = new Date(value);
  const hour = date.getHours();
  if (hour !== 10 && hour !== 16) return undefined;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}-${hour}`;
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
  return colorText("低风险", "#6f7d75");
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

function formatShortTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}
