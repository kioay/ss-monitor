import fs from "node:fs/promises";
import path from "node:path";
import type { ContentPart, GameId, MonitorItem, RiskLevel } from "../src/shared";
import type { BettaFishSemanticSignal } from "../server/bettafishSemantic";

type BacktestKind = "false_positive_guard" | "true_positive_catch" | "semantic_guard";

interface BacktestFile {
  version: number;
  description?: string;
  cases: BacktestCase[];
}

interface BacktestCase {
  id: string;
  kind: BacktestKind;
  gameId: GameId;
  title: string;
  contentParts: ContentPart[];
  metrics?: MonitorItem["metrics"];
  semanticSignal?: Omit<BettaFishSemanticSignal, "id">;
  expectedRiskLevel?: RiskLevel;
  minRiskLevel?: RiskLevel;
  maxRiskLevel?: RiskLevel;
  expectedSentiment?: MonitorItem["sentiment"];
  requiredRiskReasons?: string[];
  forbiddenRiskReasons?: string[];
  requiredTopics?: string[];
  forbiddenTopics?: string[];
}

interface BacktestResult {
  testCase: BacktestCase;
  item: MonitorItem;
  failures: string[];
}

const riskRank: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };
const casesPath = path.resolve("scripts", "fixtures", "risk-backtest-cases.json");
const focusPath = path.resolve("scripts", "fixtures", "risk-backtest-current-version-focus.json");

process.env.CURRENT_VERSION_FOCUS_CACHE_PATH = focusPath;
process.env.CONFLUENCE_TOKEN = "";

const [{ analyzeItem }, { fuseBettaFishSignal }, { refreshCurrentVersionFocus }] = await Promise.all([
  import("../server/analyze"),
  import("../server/bettafishSemantic"),
  import("../server/currentVersion")
]);

await refreshCurrentVersionFocus(new Date("2026-06-12T12:00:00.000+08:00"));

const backtest = JSON.parse(await fs.readFile(casesPath, "utf-8")) as BacktestFile;
const results = backtest.cases.map(runCase);
const failures = results.filter((result) => result.failures.length);
const byKind = countBy(backtest.cases, (testCase) => testCase.kind);
const byRisk = countBy(results, (result) => result.item.riskLevel);

if (failures.length) {
  console.error(`Risk backtest failed: ${failures.length}/${results.length} cases failed.`);
  for (const result of failures) {
    console.error(`\n[${result.testCase.id}] ${result.testCase.title}`);
    console.error(`  kind=${result.testCase.kind} risk=${result.item.riskLevel} sentiment=${result.item.sentiment} score=${result.item.sentimentScore}`);
    console.error(`  reasons=${result.item.riskReasons.join(" / ") || "(none)"}`);
    console.error(`  topics=${result.item.topics.join(" / ") || "(none)"}`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Risk backtest passed: ${results.length} cases.`);
  console.log(`  case mix: ${formatCounts(byKind)}`);
  console.log(`  predicted risk mix: ${formatCounts(byRisk)}`);
}

function runCase(testCase: BacktestCase): BacktestResult {
  const analysis = analyzeItem({
    title: testCase.title,
    gameId: testCase.gameId,
    contentParts: testCase.contentParts,
    metrics: testCase.metrics || {}
  });
  const item = testCase.semanticSignal
    ? fuseBettaFishSignal(makeItem(testCase, analysis), { id: `risk-backtest:${testCase.id}`, ...testCase.semanticSignal })
    : makeItem(testCase, analysis);
  const failures = validateCase(testCase, item);
  return { testCase, item, failures };
}

function validateCase(testCase: BacktestCase, item: MonitorItem) {
  const failures: string[] = [];
  if (testCase.expectedRiskLevel && item.riskLevel !== testCase.expectedRiskLevel) {
    failures.push(`expected risk ${testCase.expectedRiskLevel}, got ${item.riskLevel}`);
  }
  if (testCase.minRiskLevel && riskRank[item.riskLevel] < riskRank[testCase.minRiskLevel]) {
    failures.push(`expected at least ${testCase.minRiskLevel} risk, got ${item.riskLevel}`);
  }
  if (testCase.maxRiskLevel && riskRank[item.riskLevel] > riskRank[testCase.maxRiskLevel]) {
    failures.push(`expected at most ${testCase.maxRiskLevel} risk, got ${item.riskLevel}`);
  }
  if (testCase.expectedSentiment && item.sentiment !== testCase.expectedSentiment) {
    failures.push(`expected sentiment ${testCase.expectedSentiment}, got ${item.sentiment}`);
  }
  for (const reason of testCase.requiredRiskReasons || []) {
    if (!item.riskReasons.includes(reason)) failures.push(`missing required risk reason: ${reason}`);
  }
  for (const reason of testCase.forbiddenRiskReasons || []) {
    if (item.riskReasons.includes(reason)) failures.push(`forbidden risk reason present: ${reason}`);
  }
  for (const topic of testCase.requiredTopics || []) {
    if (!item.topics.includes(topic)) failures.push(`missing required topic: ${topic}`);
  }
  for (const topic of testCase.forbiddenTopics || []) {
    if (item.topics.includes(topic)) failures.push(`forbidden topic present: ${topic}`);
  }
  return failures;
}

function makeItem(testCase: BacktestCase, analysis: ReturnType<typeof analyzeItem>): MonitorItem {
  const now = new Date("2026-06-12T12:00:00.000Z").toISOString();
  return {
    id: `risk-backtest:${testCase.id}`,
    gameId: testCase.gameId,
    gameName: testCase.gameId === "ss1" ? "生死狙击1" : "生死狙击2",
    source: "bilibili",
    sourceLabel: "B站",
    sourceItemId: testCase.id,
    title: testCase.title,
    author: "risk-backtest",
    url: `https://example.invalid/risk-backtest/${encodeURIComponent(testCase.id)}`,
    publishedAt: now,
    collectedAt: now,
    freshnessHours: 0,
    metrics: testCase.metrics || {},
    contentParts: testCase.contentParts,
    parsedContentCount: testCase.contentParts.reduce((sum, part) => sum + (part.count || 1), 0),
    ...analysis
  };
}

function countBy<T>(values: T[], keyOf: (value: T) => string) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyOf(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function formatCounts(counts: Map<string, number>) {
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
}
