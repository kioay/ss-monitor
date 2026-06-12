import { spawn } from "node:child_process";
import path from "node:path";
import { runtimeConfig } from "./config";
import { compactText, md5, uniq } from "./utils";
import type { MonitorItem, RiskLevel, Sentiment } from "../src/shared";

interface BettaFishBridgeResult {
  ok?: boolean;
  message?: string;
  engine?: string;
  models?: string[];
  results?: BettaFishSemanticSignal[];
}

export interface BettaFishSemanticSignal {
  id: string;
  label: "positive" | "neutral" | "negative" | "unknown";
  score: number;
  confidence: number;
  positiveProbability?: number;
  votes?: Array<Record<string, unknown>>;
}

const protectedTopics = new Set([
  "个人技术分享",
  "玩家求助咨询",
  "玩家日常分享",
  "玩家行为争议",
  "账号/区服询问"
]);
const semanticCache = new Map<string, BettaFishSemanticSignal>();
let lastFailureAt = 0;

export async function refineItemsWithBettaFishSemantic(items: MonitorItem[]) {
  if (!runtimeConfig.bettaFishSemanticEnabled || !items.length) return items;
  if (!runtimeConfig.bettaFishSemanticCommand && !runtimeConfig.bettaFishRepoDir) return items;
  if (Date.now() - lastFailureAt < runtimeConfig.bettaFishSemanticFailureCooldownSeconds * 1000) return items;

  const candidates = items
    .map((item) => ({ item, text: semanticText(item), cacheKey: semanticCacheKey(item) }))
    .filter((entry) => entry.text.length >= 4)
    .slice(0, runtimeConfig.bettaFishSemanticMaxItems);

  const missing = candidates.filter((entry) => !semanticCache.has(entry.cacheKey));
  if (missing.length) {
    const fresh = await runBettaFishSemanticBridge(
      missing.map((entry) => ({ id: entry.cacheKey, text: entry.text }))
    );
    if (!fresh) return items;
    for (const signal of fresh) {
      semanticCache.set(signal.id, signal);
    }
    trimSemanticCache();
  }

  return items.map((item) => {
    const cacheKey = semanticCacheKey(item);
    const signal = semanticCache.get(cacheKey);
    return signal ? fuseBettaFishSignal(item, signal) : item;
  });
}

function semanticText(item: MonitorItem) {
  const content = [
    item.title,
    ...item.contentParts
      .filter((part) => part.type !== "tag")
      .map((part) => part.text)
      .filter(Boolean)
  ];
  return compactText(content, 1600);
}

function semanticCacheKey(item: MonitorItem) {
  return `${item.id}:${md5(semanticText(item))}`;
}

async function runBettaFishSemanticBridge(items: Array<{ id: string; text: string }>) {
  const payload = JSON.stringify({
    repoDir: runtimeConfig.bettaFishRepoDir,
    items
  });
  const bridgeScript = path.resolve("scripts", "bettafish-semantic-bridge.py");
  const customCommand = runtimeConfig.bettaFishSemanticCommand.trim();

  const command = customCommand || runtimeConfig.bettaFishPython;
  const args = customCommand
    ? []
    : [
        bridgeScript,
        "--repo-dir",
        runtimeConfig.bettaFishRepoDir,
        "--models",
        runtimeConfig.bettaFishSemanticModels
      ];

  return new Promise<BettaFishSemanticSignal[] | undefined>((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    const child = spawn(command, args, {
      cwd: runtimeConfig.bettaFishRepoDir || process.cwd(),
      shell: Boolean(customCommand),
      windowsHide: true,
      env: { ...process.env }
    });
    const timer = setTimeout(() => {
      finished = true;
      child.kill();
      lastFailureAt = Date.now();
      console.warn("BettaFish semantic bridge timed out");
      resolve(undefined);
    }, runtimeConfig.bettaFishSemanticTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      lastFailureAt = Date.now();
      console.warn("BettaFish semantic bridge failed", error.message);
      resolve(undefined);
    });
    child.on("exit", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        lastFailureAt = Date.now();
        console.warn("BettaFish semantic bridge exited", code, compactText([stderr || stdout], 220));
        resolve(undefined);
        return;
      }
      const parsed = parseBridgeOutput(stdout);
      if (!parsed?.ok) {
        lastFailureAt = Date.now();
        console.warn("BettaFish semantic bridge returned no result", parsed?.message || compactText([stderr || stdout], 220));
        resolve(undefined);
        return;
      }
      resolve((parsed.results || []).filter(isUsableSignal));
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}

function parseBridgeOutput(stdout: string): BettaFishBridgeResult | undefined {
  try {
    return JSON.parse(stdout) as BettaFishBridgeResult;
  } catch {
    const line = stdout.trim().split(/\r?\n/).reverse().find((entry) => entry.trim().startsWith("{"));
    if (!line) return undefined;
    try {
      return JSON.parse(line) as BettaFishBridgeResult;
    } catch {
      return undefined;
    }
  }
}

function isUsableSignal(value: BettaFishSemanticSignal) {
  return Boolean(value?.id)
    && (value.label === "positive" || value.label === "neutral" || value.label === "negative")
    && Number.isFinite(value.score)
    && Number.isFinite(value.confidence)
    && value.confidence >= runtimeConfig.bettaFishSemanticMinConfidence;
}

export function fuseBettaFishSignal(item: MonitorItem, signal: BettaFishSemanticSignal): MonitorItem {
  if (isProtectedItem(item) || signal.label === "neutral") return item;

  const adjustedScore = blendScore(item.sentimentScore, signal.score, signal.confidence);
  const adjustedSentiment = chooseSentiment(item.sentiment, item.sentimentScore, signal, adjustedScore);
  const reasons = [...item.riskReasons];
  let riskLevel = item.riskLevel;

  if (signal.label === "negative" && signal.confidence >= runtimeConfig.bettaFishSemanticRiskConfidence) {
    if (hasAccountRentalLeadReason(item)) {
      reasons.push("BettaFish模型辅助确认负面");
    } else if ((item.riskLevel !== "low" || item.riskReasons.length >= 1) && !onlyWeakNegativeReasons(item)) {
      reasons.push("BettaFish模型辅助确认负面");
      riskLevel = elevateRiskOneStep(riskLevel);
    } else if (item.sentiment === "negative" && Math.abs(item.sentimentScore) > 0.28) {
      reasons.push("BettaFish模型辅助确认负面");
      riskLevel = "medium";
    }
  }

  if (signal.label === "positive" && signal.confidence >= 0.82 && item.riskLevel === "medium" && onlyWeakNegativeReasons(item)) {
    riskLevel = "low";
    reasons.push("BettaFish模型辅助降噪");
  }

  const uniqueReasons = uniq(reasons).slice(0, 5);
  return {
    ...item,
    sentiment: adjustedSentiment,
    sentimentScore: Number(adjustedScore.toFixed(3)),
    riskLevel,
    riskReasons: uniqueReasons,
    summary: appendSemanticSummary(item.summary, signal, adjustedSentiment)
  };
}

function isProtectedItem(item: MonitorItem) {
  return item.topics.some((topic) => protectedTopics.has(topic));
}

function blendScore(baseScore: number, bettaFishScore: number, confidence: number) {
  const weight = confidence >= 0.82 ? 0.32 : 0.22;
  return clampScore(baseScore * (1 - weight) + bettaFishScore * weight);
}

function chooseSentiment(base: Sentiment, baseScore: number, signal: BettaFishSemanticSignal, adjustedScore: number): Sentiment {
  if (base === "mixed") return Math.abs(adjustedScore) < 0.35 ? base : adjustedScore > 0 ? "positive" : "negative";
  if (signal.confidence < runtimeConfig.bettaFishSemanticOverrideConfidence) return base;
  if (Math.abs(baseScore) > 0.45 && Math.sign(baseScore) !== Math.sign(signal.score)) return base;
  if (adjustedScore > 0.2) return "positive";
  if (adjustedScore < -0.2) return "negative";
  return base === "positive" || base === "negative" ? "mixed" : "neutral";
}

function elevateRiskOneStep(level: RiskLevel): RiskLevel {
  if (level === "high") return "high";
  if (level === "medium") return "high";
  return "medium";
}

function onlyWeakNegativeReasons(item: MonitorItem) {
  return item.riskReasons.length > 0
    && item.riskReasons.every((reason) =>
      reason === "负面表达集中" ||
      reason === "评论区负反馈集中" ||
      reason === "互动量较高" ||
      reason.includes("BettaFish")
    );
}

function hasAccountRentalLeadReason(item: MonitorItem) {
  return item.riskReasons.includes("账号租赁/交易导流");
}

function appendSemanticSummary(summary: string, signal: BettaFishSemanticSignal, sentiment: Sentiment) {
  const label = signal.label === "positive" ? "正向" : signal.label === "negative" ? "负向" : "中性";
  if (summary.includes("BettaFish模型")) return summary;
  if (sentiment === "neutral" || signal.confidence < runtimeConfig.bettaFishSemanticRiskConfidence) return summary;
  return `${summary} BettaFish模型辅助判断为${label}，置信度${Math.round(signal.confidence * 100)}%。`;
}

function clampScore(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function trimSemanticCache() {
  const maxEntries = 1000;
  if (semanticCache.size <= maxEntries) return;
  const deleteCount = semanticCache.size - maxEntries;
  for (const key of Array.from(semanticCache.keys()).slice(0, deleteCount)) {
    semanticCache.delete(key);
  }
}
