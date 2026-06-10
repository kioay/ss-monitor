import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { games, runtimeConfig } from "./config";
import { previewBettaFishImportedItems, probeBettaFishStatus } from "./collectors/bettafish";
import { loadMindSpiderDbConfig } from "./collectors/mindspiderDouyin";
import { getMonitorResponse } from "./monitor";
import type {
  BettaFishActionResponse,
  BettaFishCapability,
  BettaFishEndpointProbe,
  BettaFishGameMonitor,
  BettaFishImportPreview,
  BettaFishLabResponse,
  BettaFishLoginStateCandidate,
  BettaFishMindSpiderStatus,
  BettaFishOperation,
  BettaFishOperationSafety,
  BettaFishProbeStatus,
  BettaFishRuntimeStatus,
  BettaFishSentimentStatus
} from "../src/shared";

const labQuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(24 * 30).default(runtimeConfig.defaultWindowHours),
  sampleLimit: z.coerce.number().int().min(1).max(12).default(4),
  monitorLimit: z.coerce.number().int().min(20).max(160).default(80),
  forceMonitor: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true")
});

const actionSchema = z.object({
  action: z.string().min(1),
  query: z.string().max(1000).optional(),
  customTemplate: z.string().max(12_000).optional(),
  taskId: z.string().max(120).optional(),
  text: z.string().max(4000).optional(),
  confirmationPassword: z.string().max(120).optional(),
  platforms: z.array(z.string().max(24)).max(7).optional(),
  crawlerKeywords: z.array(z.string().max(120)).max(20).optional(),
  maxKeywords: z.coerce.number().int().min(1).max(50).optional(),
  maxNotes: z.coerce.number().int().min(1).max(50).optional()
});

const appNames = ["insight", "media", "query"] as const;
const runtimeConfirmationPassword = "wooduan";
const protectedRuntimeActions = new Set([
  "runtime.localStart",
  "runtime.localStop",
  "runtime.systemStart",
  "runtime.systemShutdown",
  "runtime.deploy"
]);
const crawlerPlatforms = ["xhs", "dy", "ks", "bili", "wb", "tieba", "zhihu"];
const mindSpiderTables = [
  "daily_news",
  "daily_topics",
  "topic_news_relation",
  "crawling_tasks",
  "xhs_note",
  "douyin_aweme",
  "kuaishou_video",
  "bilibili_video",
  "weibo_note",
  "tieba_note",
  "zhihu_content"
];

const readOnlyProbeTargets = [
  { id: "status", label: "总状态", path: "/api/status" },
  { id: "system-status", label: "系统状态", path: "/api/system/status" },
  { id: "config", label: "BettaFish 配置", path: "/api/config" },
  { id: "report-status", label: "ReportEngine 状态", path: "/api/report/status" },
  { id: "report-templates", label: "ReportEngine 模板", path: "/api/report/templates" },
  { id: "report-log", label: "ReportEngine 日志", path: "/api/report/log" },
  { id: "forum-log", label: "ForumEngine 日志", path: "/api/forum/log" },
  { id: "insight-output", label: "Insight Agent 输出", path: "/api/output/insight" },
  { id: "media-output", label: "Media Agent 输出", path: "/api/output/media" },
  { id: "query-output", label: "Query Agent 输出", path: "/api/output/query" }
];

let localBettaFishProcess: ChildProcessWithoutNullStreams | undefined;
let localBettaFishOutput: string[] = [];

function isLocalBettaFishProcessRunning() {
  return Boolean(
    localBettaFishProcess
      && !localBettaFishProcess.killed
      && localBettaFishProcess.exitCode === null
      && localBettaFishProcess.signalCode === null
  );
}

export async function getBettaFishLabResponse(rawQuery: unknown): Promise<BettaFishLabResponse> {
  const query = labQuerySchema.parse(rawQuery);
  const generatedAt = new Date();
  const cutoff = new Date(generatedAt.getTime() - query.windowHours * 3_600_000);

  const [gameMonitors, importPreviews, endpointProbes, nativeStatus, mindSpider, sentiment] = await Promise.all([
    collectGameMonitors(query),
    Promise.all(
      games.map(async (game) => {
        const preview = await previewBettaFishImportedItems(game, cutoff);
        return {
          gameId: game.id,
          gameName: game.name,
          fileCount: preview.fileCount,
          rowCount: preview.rowCount,
          matchedItems: preview.items.length,
          staleDropped: preview.staleDropped,
          errors: preview.errors.slice(0, 6),
          samples: preview.items.slice(0, query.sampleLimit)
        } satisfies BettaFishImportPreview;
      })
    ),
    probeBettaFishEndpoints(),
    probeBettaFishStatus().catch((error) => ({
      configured: Boolean(runtimeConfig.bettaFishBaseUrl),
      ok: false,
      message: messageOf(error)
    })),
    inspectMindSpiderStatus(),
    inspectSentimentStatus()
  ]);

  const runtime = makeRuntimeStatus();
  const operations = makeOperations(runtime, mindSpider, sentiment, endpointProbes);
  const capabilities = makeCapabilities(gameMonitors, importPreviews, endpointProbes, nativeStatus, runtime, mindSpider, sentiment);
  return {
    generatedAt: generatedAt.toISOString(),
    mode: "test-lab",
    windowHours: query.windowHours,
    freshnessCutoff: cutoff.toISOString(),
    importDir: runtimeConfig.bettaFishImportDir,
    baseUrlConfigured: Boolean(runtimeConfig.bettaFishBaseUrl),
    ...(runtimeConfig.bettaFishBaseUrl ? { baseUrl: runtimeConfig.bettaFishBaseUrl } : {}),
    runtime,
    mindSpider,
    sentiment,
    operations,
    gameMonitors,
    importPreviews,
    endpointProbes,
    capabilities,
    recommendations: makeRecommendations(gameMonitors, importPreviews, endpointProbes, capabilities, runtime, mindSpider, sentiment)
  };
}

async function collectGameMonitors(query: z.infer<typeof labQuerySchema>): Promise<BettaFishGameMonitor[]> {
  const results = await Promise.allSettled(
    games.map(async (game) => {
      const response = await getMonitorResponse({
        games: game.id,
        windowHours: String(query.windowHours),
        limit: String(query.monitorLimit),
        notify: "0",
        ...(query.forceMonitor ? { force: "1" } : {})
      });
      return {
        gameId: game.id,
        gameName: game.name,
        status: monitorStatus(response),
        message: monitorMessage(response),
        response
      } satisfies BettaFishGameMonitor;
    })
  );

  return results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const game = games[index];
    return {
      gameId: game.id,
      gameName: game.name,
      status: "error",
      message: messageOf(result.reason)
    };
  });
}

function monitorStatus(response: NonNullable<BettaFishGameMonitor["response"]>): BettaFishProbeStatus {
  if (!response.health.length) return response.stats.total ? "warning" : "error";
  if (response.health.every((entry) => !entry.ok)) return "error";
  if (response.stats.total === 0 || response.stats.highRisk > 0 || response.health.some((entry) => !entry.ok || entry.blocked)) return "warning";
  return "ok";
}

function monitorMessage(response: NonNullable<BettaFishGameMonitor["response"]>) {
  const sourceIssues = response.health.filter((entry) => !entry.ok || entry.blocked).length;
  const negativeRate = `${Math.round(response.stats.negativeRate * 100)}%`;
  const issueText = sourceIssues ? `，${sourceIssues} 个来源需检查` : "";
  return `监控完成：${response.stats.total} 条，${response.stats.highRisk} 高风险，负面占比 ${negativeRate}${issueText}`;
}

export async function runBettaFishLabAction(rawBody: unknown): Promise<BettaFishActionResponse> {
  const body = actionSchema.parse(rawBody);
  const action = body.action;

  if (!runtimeConfig.bettaFishLabActionsEnabled) {
    return actionResponse(action, false, "测试台研究操作已被配置关闭。设置 BETTAFISH_LAB_ACTIONS_ENABLED=true 后可执行启动、搜索、爬取、报告和部署研究操作。");
  }

  if (protectedRuntimeActions.has(action) && body.confirmationPassword !== runtimeConfirmationPassword) {
    return actionResponse(action, false, "二级密码错误或未输入，操作未执行。");
  }

  if (action.startsWith("agent.start.")) return proxyBettaFish(action, `/api/start/${appNameFromAction(action)}`, { method: "GET" });
  if (action.startsWith("agent.stop.")) return proxyBettaFish(action, `/api/stop/${appNameFromAction(action)}`, { method: "GET" });

  switch (action) {
    case "agent.search": {
      const agentGuard = await requireRunningAgent(action);
      if (agentGuard) return agentGuard;
      return proxyBettaFish(action, "/api/search", {
        method: "POST",
        body: { query: requireText(body.query, "请输入 Agent 搜索问题") },
        timeoutMs: 20_000
      });
    }
    case "forum.start":
      return proxyBettaFish(action, "/api/forum/start", { method: "GET" });
    case "forum.stop":
      return proxyBettaFish(action, "/api/forum/stop", { method: "GET" });
    case "forum.log":
      return proxyBettaFish(action, "/api/forum/log", { method: "GET" });
    case "report.generate": {
      const reportGuard = await requireReportEngineReady(action);
      if (reportGuard) return reportGuard;
      return proxyBettaFish(action, "/api/report/generate", {
        method: "POST",
        body: { query: body.query?.trim() || "生死狙击舆情测试报告", custom_template: body.customTemplate || "" },
        timeoutMs: 20_000,
        pickTaskId: true
      });
    }
    case "report.progress": {
      const reportGuard = await requireReportEngineReady(action);
      if (reportGuard) return reportGuard;
      return proxyBettaFish(action, `/api/report/progress/${encodeURIComponent(requireText(body.taskId, "请输入报告 taskId"))}`, { method: "GET" });
    }
    case "report.resultJson": {
      const reportGuard = await requireReportEngineReady(action);
      if (reportGuard) return reportGuard;
      return proxyBettaFish(action, `/api/report/result/${encodeURIComponent(requireText(body.taskId, "请输入报告 taskId"))}/json`, { method: "GET" });
    }
    case "report.cancel": {
      const reportGuard = await requireReportEngineReady(action);
      if (reportGuard) return reportGuard;
      return proxyBettaFish(action, `/api/report/cancel/${encodeURIComponent(requireText(body.taskId, "请输入报告 taskId"))}`, { method: "POST" });
    }
    case "mindspider.status":
      return runMindSpiderCommand(action, ["--status"], 90_000);
    case "mindspider.initDb":
      return runMindSpiderCommand(action, ["--init-db"], 120_000);
    case "mindspider.dbProbe":
      return runMindSpiderSchemaCommand(action, ["--tables", "--stats"], 90_000);
    case "mindspider.crawlTest":
      return runMindSpiderCommand(action, makeCrawlerTestArgs(body), 180_000);
    case "sentiment.analyze":
      return runSentimentAnalysis(action, requireText(body.text, "请输入要分析的文本"));
    case "runtime.systemStart":
      return proxyBettaFish(action, "/api/system/start", { method: "POST", timeoutMs: 60_000 });
    case "runtime.systemShutdown":
      return proxyBettaFish(action, "/api/system/shutdown", { method: "POST", timeoutMs: 20_000 });
    case "runtime.localStart":
      return startLocalBettaFish(action);
    case "runtime.localStop":
      return stopLocalBettaFish(action);
    case "runtime.deploy":
      return runDeployCommand(action);
    default:
      return actionResponse(action, false, `未知测试台研究操作: ${action}`);
  }
}

async function probeBettaFishEndpoints(): Promise<BettaFishEndpointProbe[]> {
  if (!runtimeConfig.bettaFishBaseUrl) {
    return readOnlyProbeTargets.map((target) => ({
      id: target.id,
      label: target.label,
      method: "GET" as const,
      path: target.path,
      status: "skipped" as const,
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
      message: "BETTAFISH_BASE_URL 未配置"
    }));
  }

  return Promise.all(readOnlyProbeTargets.map((target) => probeEndpoint(target)));
}

async function probeEndpoint(target: { id: string; label: string; path: string }): Promise<BettaFishEndpointProbe> {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  const url = `${runtimeConfig.bettaFishBaseUrl}${target.path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json,text/plain;q=0.8,*/*;q=0.5" },
      signal: controller.signal
    });
    const text = await response.text();
    const latencyMs = Date.now() - started;
    const expectedNotReady = isExpectedNotReadyProbe(target.id, response.status, text);
    return {
      id: target.id,
      label: target.label,
      method: "GET",
      path: target.path,
      target: url,
      status: response.ok ? "ok" : expectedNotReady ? "warning" : "error",
      latencyMs,
      checkedAt,
      message: response.ok
        ? summarizeEndpointPayload(target.id, text)
        : expectedNotReady
          ? compactText(text || response.statusText, 140)
          : `HTTP ${response.status}: ${compactText(text || response.statusText, 140)}`
    };
  } catch (error) {
    return {
      id: target.id,
      label: target.label,
      method: "GET",
      path: target.path,
      target: url,
      status: "error",
      latencyMs: Date.now() - started,
      checkedAt,
      message: error instanceof Error && error.name === "AbortError" ? "请求超时" : messageOf(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isExpectedNotReadyProbe(id: string, status: number, text: string) {
  return id === "report-templates"
    && status === 500
    && text.includes("Report Engine")
    && (text.includes("未初始化") || text.includes("\\u672a\\u521d\\u59cb\\u5316"));
}

async function inspectMindSpiderStatus(): Promise<BettaFishMindSpiderStatus> {
  const repo = runtimeConfig.bettaFishRepoDir;
  const mindSpiderRoot = repo ? path.join(repo, "MindSpider") : "";
  const repoAvailable = Boolean(repo) && await pathExists(path.join(mindSpiderRoot, "main.py"));
  const loginStateCandidates = repoAvailable ? await inspectLoginStateCandidates(mindSpiderRoot) : [];
  const dbConfig = await loadMindSpiderDbConfig();
  return {
    repoAvailable,
    dbDirectConfigured: dbConfig.configured,
    dbDialect: dbConfig.dialect,
    ...(dbConfig.dialect === "sqlite" && dbConfig.sqlitePath ? { sqlitePath: dbConfig.sqlitePath } : {}),
    crawlerPlatforms,
    tables: mindSpiderTables,
    loginStateCandidates
  };
}

async function inspectLoginStateCandidates(mindSpiderRoot: string): Promise<BettaFishLoginStateCandidate[]> {
  const roots = [
    { label: "MediaCrawler store", path: path.join(mindSpiderRoot, "DeepSentimentCrawling", "MediaCrawler", "store") },
    { label: "MediaCrawler browser data", path: path.join(mindSpiderRoot, "DeepSentimentCrawling", "MediaCrawler", "browser_data") },
    { label: "MediaCrawler cache", path: path.join(mindSpiderRoot, "DeepSentimentCrawling", "MediaCrawler", "cache") },
    { label: "MediaCrawler data", path: path.join(mindSpiderRoot, "DeepSentimentCrawling", "MediaCrawler", "data") }
  ];
  return Promise.all(roots.map(async (candidate) => {
    const stats = await summarizePath(candidate.path);
    return { label: candidate.label, path: candidate.path, ...stats };
  }));
}

async function inspectSentimentStatus(): Promise<BettaFishSentimentStatus> {
  const repo = runtimeConfig.bettaFishRepoDir;
  const root = repo ? path.join(repo, "SentimentAnalysisModel") : "";
  const modelCandidates = root ? await findSentimentModelCandidates(root) : [];
  const bridgeScript = path.join(process.cwd(), "scripts", "bettafish-semantic-bridge.py");
  return {
    localModelsAvailable: modelCandidates.length > 0,
    commandConfigured: Boolean(runtimeConfig.bettaFishSentimentCommand),
    bridgeAvailable: Boolean(repo && modelCandidates.length > 0 && await pathExists(bridgeScript)),
    modelCandidates
  };
}

async function findSentimentModelCandidates(root: string) {
  if (!await pathExists(root)) return [];
  const candidates: BettaFishSentimentStatus["modelCandidates"] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length && candidates.length < 24) {
    const current = queue.shift();
    if (!current) break;
    const entries = await safeReadDir(current.dir);
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory() && current.depth < 2) queue.push({ dir: full, depth: current.depth + 1 });
      if (entry.isFile() && /^predict.*\.py$/i.test(entry.name)) {
        candidates.push({
          name: path.basename(current.dir),
          path: full,
          kind: "predict.py"
        });
      }
    }
  }
  return candidates;
}

function makeRuntimeStatus(): BettaFishRuntimeStatus {
  const python = inspectCommand(runtimeConfig.bettaFishPython, ["--version"]);
  return {
    actionsEnabled: runtimeConfig.bettaFishLabActionsEnabled,
    repoConfigured: Boolean(runtimeConfig.bettaFishRepoDir),
    repoAutoDetected: runtimeConfig.bettaFishRepoAutoDetected,
    ...(runtimeConfig.bettaFishRepoDir ? { repoDir: runtimeConfig.bettaFishRepoDir } : {}),
    python: runtimeConfig.bettaFishPython,
    pythonAvailable: python.ok,
    ...(python.version ? { pythonVersion: python.version } : {}),
    localProcessRunning: isLocalBettaFishProcessRunning(),
    baseUrlConfigured: Boolean(runtimeConfig.bettaFishBaseUrl),
    baseUrlAutoConfigured: runtimeConfig.bettaFishBaseUrlAutoConfigured,
    startCommandConfigured: Boolean(runtimeConfig.bettaFishStartCommand),
    startCommandAutoConfigured: runtimeConfig.bettaFishStartCommandAutoConfigured,
    deployCommandConfigured: Boolean(runtimeConfig.bettaFishDeployCommand),
    deployCommandAutoConfigured: runtimeConfig.bettaFishDeployCommandAutoConfigured,
    sentimentCommandConfigured: Boolean(runtimeConfig.bettaFishSentimentCommand)
  };
}

function makeOperations(
  runtime: BettaFishRuntimeStatus,
  mindSpider: BettaFishMindSpiderStatus,
  sentiment: BettaFishSentimentStatus,
  endpointProbes: BettaFishEndpointProbe[]
): BettaFishOperation[] {
  const baseUrlReason = runtime.baseUrlConfigured ? "" : "需要 BETTAFISH_BASE_URL";
  const repoReason = runtime.repoConfigured ? "" : "需要 BETTAFISH_REPO_DIR";
  const mindSpiderReason = mindSpider.repoAvailable ? "" : "需要可用的 MindSpider 目录";
  const pythonReason = runtime.pythonAvailable ? "" : `需要可用的 ${runtime.python}`;
  const startCommandReason = runtime.startCommandConfigured ? "" : "需要 BETTAFISH_START_COMMAND 或可识别的 BettaFish 仓库";
  const actionsReason = runtime.actionsEnabled ? "" : "研究操作开关未开启";
  const httpEnabled = runtime.actionsEnabled && runtime.baseUrlConfigured;
  const httpReadEnabled = runtime.actionsEnabled && runtime.baseUrlConfigured;
  const repoEnabled = runtime.actionsEnabled && runtime.repoConfigured && mindSpider.repoAvailable && runtime.pythonAvailable;
  const repoReadEnabled = runtime.actionsEnabled && runtime.repoConfigured && mindSpider.repoAvailable && runtime.pythonAvailable;
  const localStartEnabled = runtime.actionsEnabled && runtime.repoConfigured && runtime.pythonAvailable && runtime.startCommandConfigured;
  const deployEnabled = runtime.actionsEnabled && runtime.repoConfigured && runtime.deployCommandConfigured;
  const statusProbe = endpointProbes.find((probe) => probe.id === "status");
  const runningAgents = runningAgentNames(statusProbe?.message || "");
  const agentSearchEnabled = httpEnabled && runningAgents.length > 0;
  const agentSearchReason = runningAgents.length ? "" : "需要先启动至少一个 Agent";
  const reportReady = isReportEngineReadyFromProbes(endpointProbes);
  const reportReason = reportReady ? "" : reportEngineDisabledReason(endpointProbes);
  const reportEnabled = httpEnabled && reportReady;
  const sentimentRuntimeAvailable = sentiment.commandConfigured || (sentiment.bridgeAvailable && runtime.repoConfigured && runtime.pythonAvailable);
  const sentimentEnabled = runtime.actionsEnabled && sentimentRuntimeAvailable;
  const sentimentReason = sentimentRuntimeAvailable
    ? ""
    : "需要 BETTAFISH_SENTIMENT_COMMAND，或可用的 BettaFish 本地模型 bridge/Python";
  const operations: BettaFishOperation[] = [];

  for (const appName of appNames) {
    operations.push(operation(`agent.start.${appName}`, "agents", `启动 ${appName} Agent`, `调用 BettaFish /api/start/${appName}`, "research", httpEnabled, disabledReason(actionsReason, baseUrlReason), `/api/start/${appName}`));
    operations.push(operation(`agent.stop.${appName}`, "agents", `停止 ${appName} Agent`, `调用 BettaFish /api/stop/${appName}`, "research", httpEnabled, disabledReason(actionsReason, baseUrlReason), `/api/stop/${appName}`));
  }

  operations.push(
    operation("agent.search", "agents", "Agent 搜索/分析", "调用 BettaFish /api/search，让运行中的 Query/Media/Insight Agent 处理同一个问题；如果 BettaFish Streamlit 子应用未提供该接口，会返回 API 调用失败", "research", agentSearchEnabled, disabledReason(actionsReason, baseUrlReason, agentSearchReason), "/api/search"),
    operation("forum.start", "forum", "启动 ForumEngine", "调用 BettaFish /api/forum/start", "research", httpEnabled, disabledReason(actionsReason, baseUrlReason), "/api/forum/start"),
    operation("forum.stop", "forum", "停止 ForumEngine", "调用 BettaFish /api/forum/stop", "research", httpEnabled, disabledReason(actionsReason, baseUrlReason), "/api/forum/stop"),
    operation("forum.log", "forum", "读取 ForumEngine 日志", "调用 BettaFish /api/forum/log", "read", httpReadEnabled, disabledReason(actionsReason, baseUrlReason), "/api/forum/log"),
    operation("report.generate", "report", "生成报告", "调用 BettaFish /api/report/generate", "research", reportEnabled, disabledReason(actionsReason, baseUrlReason, reportReason), "/api/report/generate"),
    operation("report.progress", "report", "查询报告进度", "调用 BettaFish /api/report/progress/<taskId>", "read", reportEnabled, disabledReason(actionsReason, baseUrlReason, reportReason), "/api/report/progress/<taskId>"),
    operation("report.resultJson", "report", "读取报告结果", "调用 BettaFish /api/report/result/<taskId>/json", "read", reportEnabled, disabledReason(actionsReason, baseUrlReason, reportReason), "/api/report/result/<taskId>/json"),
    operation("report.cancel", "report", "取消报告任务", "调用 BettaFish /api/report/cancel/<taskId>", "research", reportEnabled, disabledReason(actionsReason, baseUrlReason, reportReason), "/api/report/cancel/<taskId>"),
    operation("mindspider.status", "mindspider", "MindSpider 状态", "执行 MindSpider/main.py --status", "read", repoReadEnabled, disabledReason(actionsReason, repoReason, mindSpiderReason, pythonReason), "MindSpider/main.py --status"),
    operation("mindspider.dbProbe", "mindspider", "数据库直连检查", "执行 MindSpider/schema/db_manager.py --tables --stats", "read", repoReadEnabled, disabledReason(actionsReason, repoReason, mindSpiderReason, pythonReason), "MindSpider/schema/db_manager.py --tables --stats"),
    operation("mindspider.initDb", "mindspider", "初始化数据库", "执行 MindSpider/main.py --init-db", "research", repoEnabled, disabledReason(actionsReason, repoReason, mindSpiderReason, pythonReason), "MindSpider/main.py --init-db"),
    operation("mindspider.crawlTest", "mindspider", "测试爬虫调度", "执行 MindSpider/main.py --deep-sentiment --test", "research", repoEnabled, disabledReason(actionsReason, repoReason, mindSpiderReason, pythonReason), "MindSpider/main.py --deep-sentiment --test"),
    operation("sentiment.analyze", "sentiment", "情感模型/LLM 分析", "执行 BETTAFISH_SENTIMENT_COMMAND，未配置时使用本仓库 BettaFish 本地模型 bridge；Agent LLM 搜索另由上方 Agent 搜索/分析按钮验证", "research", sentimentEnabled, disabledReason(actionsReason, sentimentReason), "sentiment"),
    operation("runtime.systemStart", "runtime", "启动完整 BettaFish 系统", "调用 BettaFish /api/system/start", "research", httpEnabled, disabledReason(actionsReason, baseUrlReason), "/api/system/start"),
    operation("runtime.systemShutdown", "runtime", "关闭 BettaFish 系统", "调用 BettaFish /api/system/shutdown", "research", httpEnabled, disabledReason(actionsReason, baseUrlReason), "/api/system/shutdown"),
    operation("runtime.localStart", "runtime", "本地启动 BettaFish", "用 BETTAFISH_REPO_DIR 与 BETTAFISH_START_COMMAND/python app.py 启动 BettaFish", "research", localStartEnabled, disabledReason(actionsReason, repoReason, pythonReason, startCommandReason), "local process"),
    operation("runtime.localStop", "runtime", "停止本地启动进程", "停止由本测试台启动的 BettaFish 子进程", "research", runtime.actionsEnabled && runtime.localProcessRunning, disabledReason(actionsReason, runtime.localProcessRunning ? "" : "没有由测试台启动的 BettaFish 本地进程"), "local process"),
    operation("runtime.deploy", "runtime", "执行部署命令", "执行 BETTAFISH_DEPLOY_COMMAND", "research", deployEnabled, disabledReason(actionsReason, repoReason, runtime.deployCommandConfigured ? "" : "需要 BETTAFISH_DEPLOY_COMMAND"), "deploy command")
  );

  return operations;
}

function operation(
  id: string,
  group: BettaFishOperation["group"],
  label: string,
  description: string,
  safety: BettaFishOperationSafety,
  enabled: boolean,
  disabledReason?: string,
  target?: string
): BettaFishOperation {
  return { id, group, label, description, safety, enabled, ...(disabledReason && !enabled ? { disabledReason } : {}), ...(target ? { target } : {}) };
}

function runningAgentNames(statusMessage: string) {
  const lower = statusMessage.toLowerCase();
  return appNames.filter((name) => {
    const match = lower.match(new RegExp(`${name}\\s*:\\s*([a-z_]+)`));
    return match?.[1] === "running";
  });
}

function isReportEngineReadyFromProbes(endpointProbes: BettaFishEndpointProbe[]) {
  const reportStatus = endpointProbes.find((probe) => probe.id === "report-status");
  if (!reportStatus || reportStatus.status !== "ok") return false;
  return !/initialized:false|engines_ready:false/i.test(reportStatus.message);
}

function reportEngineDisabledReason(endpointProbes: BettaFishEndpointProbe[]) {
  const reportStatus = endpointProbes.find((probe) => probe.id === "report-status");
  if (!reportStatus) return "ReportEngine 状态未确认";
  if (reportStatus.status !== "ok") return `ReportEngine 不可用：${reportStatus.message}`;
  if (/initialized:false|engines_ready:false/i.test(reportStatus.message)) return "ReportEngine 未初始化或缺少 LLM API key";
  return "";
}

function reportCapabilityStatus(reportProbe: BettaFishEndpointProbe | undefined, reportReady: boolean): BettaFishProbeStatus {
  if (!reportProbe) return "skipped";
  if (reportProbe.status === "error") return "error";
  return reportReady ? reportProbe.status : "warning";
}

function makeCapabilities(
  gameMonitors: BettaFishGameMonitor[],
  importPreviews: BettaFishImportPreview[],
  endpointProbes: BettaFishEndpointProbe[],
  nativeStatus: { configured: boolean; ok: boolean; message: string },
  runtime: BettaFishRuntimeStatus,
  mindSpider: BettaFishMindSpiderStatus,
  sentiment: BettaFishSentimentStatus
): BettaFishCapability[] {
  const totalRows = Math.max(0, ...importPreviews.map((preview) => preview.rowCount));
  const totalItems = importPreviews.reduce((sum, preview) => sum + preview.matchedItems, 0);
  const statusProbe = endpointProbes.find((probe) => probe.id === "status");
  const systemProbe = endpointProbes.find((probe) => probe.id === "system-status");
  const reportProbe = bestProbe(endpointProbes, ["report-status", "report-templates", "report-log"]);
  const reportReady = isReportEngineReadyFromProbes(endpointProbes);
  const reportReason = reportEngineDisabledReason(endpointProbes);
  const forumProbe = endpointProbes.find((probe) => probe.id === "forum-log");
  const agentProbe = bestProbe(endpointProbes, ["insight-output", "media-output", "query-output"]);
  const engineStatus = probeStatusFrom(nativeStatus.configured ? nativeStatus.ok : undefined);
  const llmAgentUsable = runtime.baseUrlConfigured && bestStatus(statusProbe, systemProbe, agentProbe) === "ok";
  const monitorStats = gameMonitors
    .map((monitor) => `${monitor.gameName}: ${monitor.response?.stats.total ?? 0} 条 / ${monitor.response?.stats.highRisk ?? 0} 高风险`)
    .join("；");

  return [
    {
      id: "game-monitoring",
      name: "生死1 / 生死2 舆情监测",
      goal: "在测试台独立复用采集、语义判定、风险分析和来源健康检查",
      currentProjectUse: "测试台已接入两个游戏的监控快照；不会发送钉钉通知，也不改变主看板筛选状态",
      testCoverage: "可查看 SS1/SS2 的总声量、高风险、负面占比、来源健康、主题、预警和最新条目",
      status: aggregateMonitorStatus(gameMonitors),
      evidence: uniqueStrings([monitorStats, ...gameMonitors.map((monitor) => monitor.message)].filter(Boolean)),
      nextStep: "用测试台监控结果校验 BettaFish 导入、现有来源和语义判定是否覆盖同一批重点舆情。"
    },
    {
      id: "agents",
      name: "Query / Media / Insight Agent",
      goal: "补强跨来源检索、媒体信息抽取与观点归纳",
      currentProjectUse: "测试台已接入 Agent 启停与 /api/search；主监控链路不自动调用",
      testCoverage: "可启动/停止三个 Agent，可向运行中的 Agent 发搜索问题，可读各 Agent 输出日志",
      status: combineStatus(engineStatus, bestStatus(statusProbe, systemProbe, agentProbe)),
      evidence: uniqueStrings([
        nativeStatus.configured ? nativeStatus.message : "未配置 BettaFish Base URL",
        statusProbe?.message || "",
        systemProbe?.message || "",
        agentProbe?.message || ""
      ].filter(Boolean)),
      nextStep: "用固定舆情问题集跑 Agent 搜索，和本平台现有采集结果做召回率对比。"
    },
    {
      id: "forum",
      name: "ForumEngine 多 Agent 讨论",
      goal: "把多个 Agent 的观点沉淀为可读讨论结论",
      currentProjectUse: "测试台已接入启动、停止和日志读取；主监控链路不自动启动论坛",
      testCoverage: "可调用 /api/forum/start、/api/forum/stop、/api/forum/log",
      status: forumProbe?.status || "skipped",
      evidence: forumProbe ? [forumProbe.message] : ["未执行 ForumEngine 探测"],
      nextStep: "先在测试台读取 ForumEngine parsed_messages，再抽取稳定的结论片段进入复盘报告。"
    },
    {
      id: "report",
      name: "ReportEngine 报告生成",
      goal: "提升舆情分析、复盘和沉淀能力",
      currentProjectUse: "测试台已接入报告生成、进度查询、结果读取与取消；主监控链路不自动生成报告",
      testCoverage: "可调用 /api/report/generate、progress、result/json、cancel，并读取模板和日志",
      status: reportCapabilityStatus(reportProbe, reportReady),
      evidence: uniqueStrings([reportProbe?.message || "", reportReady ? "" : reportReason || "ReportEngine 未就绪"].filter(Boolean)),
      nextStep: "把本平台 MonitorResponse 转成 ReportEngine 输入文件，形成固定格式每日/专项舆情报告。"
    },
    {
      id: "mindspider",
      name: "MindSpider 爬虫调度 / 登录态 / 数据库直连",
      goal: "扩大舆情获取范围并验证数据链路健康度",
      currentProjectUse: "主流程已接入导出文件；测试台新增 MindSpider CLI 状态、DB 直连检查、初始化和测试爬虫调度入口",
      testCoverage: "可执行 --status、schema/db_manager.py --tables --stats、--init-db、--deep-sentiment --test；展示登录态候选目录",
      status: mindSpider.repoAvailable ? (mindSpider.dbDirectConfigured || totalItems > 0 ? "ok" : "warning") : totalItems > 0 ? "warning" : "skipped",
      evidence: [
        `导入目录：${runtimeConfig.bettaFishImportDir}`,
        `读取 ${totalRows} 行，命中 ${totalItems} 条 SS1/SS2 舆情`,
        `Repo: ${mindSpider.repoAvailable ? "可用" : "未配置"}`,
        `Python: ${runtime.pythonAvailable ? runtime.pythonVersion || "可用" : `${runtime.python} 不可用`}`,
        `DB: ${mindSpider.dbDirectConfigured ? `已配置 ${mindSpider.dbDialect || "连接参数"}` : "未配置连接参数"}`
      ],
      nextStep: "用测试模式先跑少量平台和关键词，确认登录态、DB 表、任务状态再扩大调度范围。"
    },
    {
      id: "sentiment",
      name: "BettaFish 情感模型 / LLM 分析",
      goal: "提升情绪、风险与语义判定能力",
      currentProjectUse: "测试台优先使用配置好的情感命令；未配置时自动调用本仓库 bridge 运行 BettaFish 本地机器学习模型；Agent LLM 搜索由 Agent 卡片单独验证",
      testCoverage: "展示 SentimentAnalysisModel 候选模型；可通过 BETTAFISH_SENTIMENT_COMMAND 或内置 bridge 提交文本做模型分析",
      status: sentiment.commandConfigured || sentiment.bridgeAvailable ? "ok" : sentiment.localModelsAvailable || runtime.baseUrlConfigured ? "warning" : "skipped",
      evidence: [
        `模型候选：${sentiment.modelCandidates.length}`,
        `命令：${sentiment.commandConfigured ? "已配置" : "未配置"}`,
        `本地桥接：${sentiment.bridgeAvailable ? "可用" : "不可用"}`,
        `Agent 搜索：${llmAgentUsable ? "请在 Agent 卡片单独验证" : runtime.baseUrlConfigured ? "Base URL 已配置但搜索接口未确认" : "未配置"}`
      ],
      nextStep: "把情感模型输出与本平台 analyzeItem 输出并排评估，确认准确率后再进入主链路。"
    },
    {
      id: "runtime",
      name: "BettaFish 自动启动 / 控制 / 部署",
      goal: "把 BettaFish 作为外部系统可控地纳入测试流程",
      currentProjectUse: "测试台接入本地启动、系统启动/关闭和可配置部署命令；固定研究操作默认开启",
      testCoverage: "可执行固定研究操作：本地进程启动、/api/system/start、/api/system/shutdown、部署命令",
      status: runtime.actionsEnabled ? "ok" : "warning",
      evidence: [
        `研究操作：${runtime.actionsEnabled ? "已开启" : "未开启"}`,
        `Repo：${runtime.repoConfigured ? "已配置" : "未配置"}`,
        `Python：${runtime.pythonAvailable ? runtime.pythonVersion || "可用" : `${runtime.python} 不可用`}`,
        `部署命令：${runtime.deployCommandConfigured ? "已配置" : "未配置"}`
      ],
      nextStep: "生产环境建议只开放给内网或本机，并把部署命令限制为固定脚本。"
    }
  ];
}

async function proxyBettaFish(
  action: string,
  pathName: string,
  options: { method: "GET" | "POST"; body?: Record<string, unknown>; timeoutMs?: number; pickTaskId?: boolean }
): Promise<BettaFishActionResponse> {
  if (!runtimeConfig.bettaFishBaseUrl) return actionResponse(action, false, "BETTAFISH_BASE_URL 未配置");
  const target = `${runtimeConfig.bettaFishBaseUrl}${pathName}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15_000);
  try {
    const response = await fetch(target, {
      method: options.method,
      headers: options.method === "POST" ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal
    });
    const text = await response.text();
    const parsed = parseJson(text);
    const result = parsed ?? compactText(text, 2000);
    const normalized = normalizeBettaFishProxyResult(action, response.status, result, response.ok && inferSuccess(result));
    return {
      ok: normalized.ok,
      action,
      generatedAt: new Date().toISOString(),
      message: normalized.message,
      target,
      ...(options.pickTaskId && isRecord(result) && typeof result.task_id === "string" ? { taskId: result.task_id } : {}),
      result
    };
  } catch (error) {
    return actionResponse(action, false, error instanceof Error && error.name === "AbortError" ? "请求超时" : messageOf(error), { target });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBettaFishProxyResult(action: string, httpStatus: number, result: unknown, ok: boolean) {
  const resultMessageText = resultMessage(result);

  if (isAlreadyRunningResult(result)) {
    return {
      ok: true,
      message: "BettaFish 返回“应用已经在运行”，当前状态已满足启动要求"
    };
  }

  if (action === "agent.search" && !ok) {
    return {
      ok: false,
      message: resultMessageText
        ? `Agent 搜索接口未完成：${compactText(resultMessageText, 180)}`
        : "Agent 搜索接口未完成：BettaFish Streamlit Agent 当前未开放 JSON /api/search"
    };
  }

  if (action.startsWith("report.") && isReportNotInitializedResult(result)) {
    return {
      ok: false,
      message: "ReportEngine 未初始化或缺少 LLM API key，报告按钮已触发但后端拒绝执行"
    };
  }

  if (action === "report.progress" && ok && isSuspiciousReportProgress(result)) {
    return {
      ok: false,
      message: "BettaFish 返回任务已完成，但没有报告文件或结果地址；请确认 Task ID 来自真实生成任务"
    };
  }

  if (ok) return { ok: true, message: "BettaFish 研究操作执行完成" };

  return {
    ok: false,
    message: resultMessageText
      ? `BettaFish 研究操作返回异常：${compactText(resultMessageText, 180)}`
      : `BettaFish 研究操作返回异常: HTTP ${httpStatus}`
  };
}

function resultMessage(result: unknown): string {
  if (typeof result === "string") return result;
  if (!isRecord(result)) return "";
  const direct = ["message", "error", "detail", "reason"]
    .map((key) => result[key])
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (direct) return direct;
  if (isRecord(result.results)) {
    return Object.values(result.results)
      .map(resultMessage)
      .filter(Boolean)
      .join("；");
  }
  return "";
}

function isAlreadyRunningResult(result: unknown) {
  return /应用已经在运行|already running/i.test(resultMessage(result));
}

function isReportNotInitializedResult(result: unknown) {
  return /(Report\s*Engine|ReportEngine).*(未初始化|not initialized|API key|required)|LLM API key is required/i.test(resultMessage(result));
}

function isSuspiciousReportProgress(result: unknown) {
  if (!isRecord(result)) return false;
  const status = `${String(result.status || "")} ${String(result.state || "")} ${String(result.message || "")}`.toLowerCase();
  const completed = result.completed === true || status.includes("completed") || status.includes("完成");
  if (!completed) return false;
  return !hasReportArtifact(result);
}

function hasReportArtifact(result: unknown): boolean {
  if (typeof result === "string") return /\.(json|md|html|pdf|docx)\b|https?:\/\//i.test(result);
  if (!isRecord(result)) return false;
  return Object.entries(result).some(([key, value]) => {
    if (/path|url|file|filename|report|result/i.test(key) && typeof value === "string" && value.trim()) return true;
    if (Array.isArray(value)) return value.some(hasReportArtifact);
    return isRecord(value) && hasReportArtifact(value);
  });
}

async function requireRunningAgent(action: string): Promise<BettaFishActionResponse | undefined> {
  const status = await fetchBettaFishJson("/api/status", 5_000);
  if (!status.ok) {
    return actionResponse(action, false, `无法确认 Agent 状态：${status.message}`, probeActionExtra(status));
  }
  const runningAgents = runningAgentNamesFromStatusResult(status.result);
  if (!runningAgents.length) {
    return actionResponse(action, false, "需要先启动至少一个 Agent；当前 insight/media/query 都不是 running", probeActionExtra(status));
  }
  return undefined;
}

function runningAgentNamesFromStatusResult(result: unknown) {
  if (!isRecord(result)) return [];
  return appNames.filter((name) => {
    const appStatus = result[name];
    if (!isRecord(appStatus)) return false;
    const value = appStatus.status ?? appStatus.state ?? appStatus.running;
    return String(value).toLowerCase() === "running" || value === true;
  });
}

async function requireReportEngineReady(action: string): Promise<BettaFishActionResponse | undefined> {
  const readiness = await probeReportEngineReady();
  if (readiness.ok) return undefined;
  return actionResponse(action, false, readiness.message, probeActionExtra(readiness));
}

async function probeReportEngineReady() {
  const status = await fetchBettaFishJson("/api/report/status", 5_000);
  if (!status.ok) return { ...status, ok: false, message: `ReportEngine 状态不可用：${status.message}` };
  if (isRecord(status.result)) {
    const initialized = status.result.initialized;
    const enginesReady = status.result.engines_ready;
    if (initialized === false || enginesReady === false) {
      return {
        ...status,
        ok: false,
        message: "ReportEngine 未初始化或缺少 LLM API key；请先修复 BettaFish Report Engine 配置"
      };
    }
  }
  return status;
}

async function waitForBettaFishReady(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastProbe = await fetchBettaFishJson("/api/status", Math.min(2_000, timeoutMs));
  while (!lastProbe.ok && Date.now() < deadline && isLocalBettaFishProcessRunning()) {
    await sleep(750);
    lastProbe = await fetchBettaFishJson("/api/status", 2_000);
  }
  return lastProbe;
}

async function fetchBettaFishJson(pathName: string, timeoutMs: number) {
  if (!runtimeConfig.bettaFishBaseUrl) return { ok: false, message: "BETTAFISH_BASE_URL 未配置" };
  const target = `${runtimeConfig.bettaFishBaseUrl}${pathName}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, {
      headers: { Accept: "application/json,text/plain;q=0.8,*/*;q=0.5" },
      signal: controller.signal
    });
    const text = await response.text();
    const parsed = parseJson(text);
    const result = parsed ?? compactText(text, 2000);
    const message = response.ok
      ? (isRecord(parsed) && pathName === "/api/status" ? summarizeStatusJson(parsed) : compactText(text || response.statusText, 180))
      : `HTTP ${response.status}: ${compactText(text || response.statusText, 180)}`;
    return { ok: response.ok, message, target, result, httpStatus: response.status };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error && error.name === "AbortError" ? "请求超时" : messageOf(error),
      target
    };
  } finally {
    clearTimeout(timeout);
  }
}

function probeActionExtra(probe: { target?: string; result?: unknown }): Partial<BettaFishActionResponse> {
  return {
    ...(probe.target ? { target: probe.target } : {}),
    ...(probe.result !== undefined ? { result: probe.result } : {})
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startLocalBettaFish(action: string): Promise<BettaFishActionResponse> {
  if (!runtimeConfig.bettaFishRepoDir) return actionResponse(action, false, "BETTAFISH_REPO_DIR 未配置");
  if (isLocalBettaFishProcessRunning()) {
    const readiness = await waitForBettaFishReady(2_000);
    return actionResponse(
      action,
      readiness.ok,
      readiness.ok ? "BettaFish 本地进程已经由测试台启动，/api/status 可达" : `BettaFish 本地进程在运行，但 /api/status 暂不可达：${readiness.message}`,
      { output: localBettaFishOutput.slice(-20), ...probeActionExtra(readiness) }
    );
  }

  const existing = await waitForBettaFishReady(1_500);
  if (existing.ok) {
    return actionResponse(action, true, "BettaFish API 已经可达，未重复启动本地进程", probeActionExtra(existing));
  }

  const command = runtimeConfig.bettaFishStartCommand || `${quoteShell(runtimeConfig.bettaFishPython)} app.py`;
  localBettaFishOutput = [];
  localBettaFishProcess = spawn(command, {
    cwd: runtimeConfig.bettaFishRepoDir,
    shell: true,
    windowsHide: true,
    env: { ...process.env }
  });
  const child = localBettaFishProcess;
  const pushOutput = (chunk: Buffer) => {
    localBettaFishOutput.push(...chunk.toString("utf-8").split(/\r?\n/).filter(Boolean));
    localBettaFishOutput = localBettaFishOutput.slice(-200);
  };
  localBettaFishProcess.stdout.on("data", pushOutput);
  localBettaFishProcess.stderr.on("data", pushOutput);
  localBettaFishProcess.on("exit", (code) => {
    localBettaFishOutput.push(`BettaFish exited with code ${code ?? "unknown"}`);
    if (localBettaFishProcess === child) localBettaFishProcess = undefined;
  });

  const readiness = await waitForBettaFishReady(12_000);
  if (readiness.ok) {
    return actionResponse(action, true, "已启动 BettaFish 本地进程，/api/status 可达", {
      target: command,
      output: localBettaFishOutput.slice(-20),
      result: readiness.result
    });
  }

  const processRunning = isLocalBettaFishProcessRunning();
  return actionResponse(
    action,
    false,
    processRunning
      ? `BettaFish 进程已启动，但 /api/status 在等待时间内不可达：${readiness.message}`
      : "BettaFish 启动失败：进程已退出",
    {
      target: command,
      output: localBettaFishOutput.slice(-40),
      result: { statusProbe: readiness.message }
    }
  );
}

function stopLocalBettaFish(action: string): BettaFishActionResponse {
  const child = localBettaFishProcess;
  if (!child || !isLocalBettaFishProcessRunning()) {
    return actionResponse(action, true, "没有由测试台启动的 BettaFish 本地进程");
  }
  child.kill();
  localBettaFishProcess = undefined;
  return actionResponse(action, true, "已停止 BettaFish 本地进程", { output: localBettaFishOutput.slice(-20) });
}

async function runMindSpiderCommand(action: string, args: string[], timeoutMs: number) {
  const script = path.join(runtimeConfig.bettaFishRepoDir, "MindSpider", "main.py");
  const guard = await requireMindSpiderRuntime(action, script, path.join(runtimeConfig.bettaFishRepoDir, "MindSpider"));
  if (guard) return guard;
  return runProcess(action, runtimeConfig.bettaFishPython, [script, ...args], path.join(runtimeConfig.bettaFishRepoDir, "MindSpider"), timeoutMs);
}

async function runMindSpiderSchemaCommand(action: string, args: string[], timeoutMs: number) {
  const script = path.join(runtimeConfig.bettaFishRepoDir, "MindSpider", "schema", "db_manager.py");
  const guard = await requireMindSpiderRuntime(action, script, path.join(runtimeConfig.bettaFishRepoDir, "MindSpider", "schema"));
  if (guard) return guard;
  return runProcess(action, runtimeConfig.bettaFishPython, [script, ...args], path.join(runtimeConfig.bettaFishRepoDir, "MindSpider", "schema"), timeoutMs);
}

async function requireMindSpiderRuntime(action: string, script: string, cwd: string): Promise<BettaFishActionResponse | undefined> {
  if (!runtimeConfig.bettaFishRepoDir) return actionResponse(action, false, "需要 BETTAFISH_REPO_DIR");
  if (!await pathExists(path.join(runtimeConfig.bettaFishRepoDir, "MindSpider", "main.py"))) {
    return actionResponse(action, false, "需要可用的 MindSpider 目录", { target: path.join(runtimeConfig.bettaFishRepoDir, "MindSpider") });
  }
  if (!await pathExists(script) || !await pathExists(cwd)) {
    return actionResponse(action, false, "需要可用的 MindSpider 目录", { target: script });
  }
  const python = inspectCommand(runtimeConfig.bettaFishPython, ["--version"]);
  if (!python.ok) return actionResponse(action, false, `需要可用的 ${runtimeConfig.bettaFishPython}`, { target: runtimeConfig.bettaFishPython });
  return undefined;
}

async function runSentimentAnalysis(action: string, text: string) {
  if (runtimeConfig.bettaFishSentimentCommand) {
    return runProcess(action, runtimeConfig.bettaFishSentimentCommand, [], runtimeConfig.bettaFishRepoDir || process.cwd(), 90_000, {
      shell: true,
      input: text,
      env: { BETTAFISH_SENTIMENT_TEXT: text }
    });
  }

  const bridgeScript = path.join(process.cwd(), "scripts", "bettafish-semantic-bridge.py");
  if (runtimeConfig.bettaFishRepoDir && await pathExists(bridgeScript)) {
    const input = JSON.stringify({
      repoDir: runtimeConfig.bettaFishRepoDir,
      items: [{ id: "lab-sample", text }]
    });
    return runProcess(action, runtimeConfig.bettaFishPython, [
      bridgeScript,
      "--repo-dir",
      runtimeConfig.bettaFishRepoDir,
      "--models",
      runtimeConfig.bettaFishSemanticModels
    ], process.cwd(), 90_000, { input });
  }

  return actionResponse(
    action,
    false,
    "需要 BETTAFISH_SENTIMENT_COMMAND，或可用的 BettaFish 本地模型 bridge/Python",
    { result: { sampleText: text.slice(0, 120) } }
  );
}

function runDeployCommand(action: string) {
  if (!runtimeConfig.bettaFishDeployCommand) return actionResponse(action, false, "BETTAFISH_DEPLOY_COMMAND 未配置");
  return runProcess(action, runtimeConfig.bettaFishDeployCommand, [], runtimeConfig.bettaFishRepoDir || process.cwd(), 180_000, { shell: true });
}

function runProcess(
  action: string,
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  options: { shell?: boolean; input?: string; env?: Record<string, string> } = {}
): Promise<BettaFishActionResponse> {
  if (!runtimeConfig.bettaFishRepoDir && action.startsWith("mindspider.")) {
    return Promise.resolve(actionResponse(action, false, "BETTAFISH_REPO_DIR 未配置"));
  }
  return new Promise((resolve) => {
    const output: string[] = [];
    const child = spawn(command, args, {
      cwd,
      shell: options.shell || false,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", LANG: process.env.LANG || "C.UTF-8", LC_ALL: process.env.LC_ALL || "C.UTF-8", ...(options.env || {}) }
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve(actionResponse(action, false, "命令执行超时，已尝试停止", { output: output.slice(-80), target: commandLine(command, args) }));
    }, timeoutMs);
    const pushOutput = (chunk: Buffer) => output.push(...chunk.toString("utf-8").split(/\r?\n/).filter(Boolean));
    child.stdout.on("data", pushOutput);
    child.stderr.on("data", pushOutput);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(actionResponse(action, false, messageOf(error), { output: output.slice(-80), target: commandLine(command, args) }));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(actionResponse(action, code === 0, code === 0 ? "命令执行完成" : `命令退出码 ${code}`, { output: output.slice(-120), target: commandLine(command, args) }));
    });
    if (options.input && child.stdin.writable) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
  });
}

function makeCrawlerTestArgs(body: z.infer<typeof actionSchema>) {
  const args = ["--deep-sentiment", "--test", "--max-keywords", String(body.maxKeywords || 3), "--max-notes", String(body.maxNotes || 5)];
  const platforms = (body.platforms || ["dy"]).filter((platform) => crawlerPlatforms.includes(platform));
  const keywords = uniqueStrings(body.crawlerKeywords || [], 20);
  if (platforms.length) args.push("--platforms", ...platforms);
  if (keywords.length) args.push("--crawler-keywords-b64", Buffer.from(JSON.stringify(keywords), "utf8").toString("base64"));
  return args;
}

function appNameFromAction(action: string) {
  const appName = action.split(".")[2];
  if (!appNames.includes(appName as typeof appNames[number])) throw new Error(`未知 Agent: ${appName}`);
  return appName;
}

function requireText(value: string | undefined, message: string) {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function actionResponse(
  action: string,
  ok: boolean,
  message: string,
  extra: Partial<BettaFishActionResponse> = {}
): BettaFishActionResponse {
  return { ok, action, generatedAt: new Date().toISOString(), message, ...extra };
}

async function summarizePath(targetPath: string): Promise<Omit<BettaFishLoginStateCandidate, "label" | "path">> {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) return { exists: true, fileCount: 1, latestModifiedAt: stat.mtime.toISOString() };
    const files = await listFiles(targetPath, 2, 200);
    const latest = files.map((file) => file.mtimeMs).sort((a, b) => b - a)[0];
    return { exists: true, fileCount: files.length, ...(latest ? { latestModifiedAt: new Date(latest).toISOString() } : {}) };
  } catch {
    return { exists: false };
  }
}

async function listFiles(root: string, maxDepth: number, maxFiles: number) {
  const result: Array<{ path: string; mtimeMs: number }> = [];
  const walk = async (dir: string, depth: number) => {
    if (result.length >= maxFiles) return;
    const entries = await safeReadDir(dir);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < maxDepth) await walk(full, depth + 1);
      else if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => undefined);
        result.push({ path: full, mtimeMs: stat?.mtimeMs || 0 });
      }
      if (result.length >= maxFiles) break;
    }
  };
  await walk(root, 0);
  return result;
}

async function pathExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function safeReadDir(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function bestProbe(probes: BettaFishEndpointProbe[], ids: string[]) {
  const candidates = probes.filter((probe) => ids.includes(probe.id));
  return candidates.sort((left, right) => statusRank(right.status) - statusRank(left.status))[0];
}

function bestStatus(...probes: Array<BettaFishEndpointProbe | undefined>) {
  return probes
    .filter((probe): probe is BettaFishEndpointProbe => Boolean(probe))
    .map((probe) => probe.status)
    .sort((left, right) => statusRank(right) - statusRank(left))[0] || "skipped";
}

function combineStatus(left: BettaFishProbeStatus, right: BettaFishProbeStatus): BettaFishProbeStatus {
  return statusRank(left) >= statusRank(right) ? left : right;
}

function aggregateMonitorStatus(monitors: BettaFishGameMonitor[]): BettaFishProbeStatus {
  const statuses = monitors.map((monitor) => monitor.status);
  if (statuses.includes("error")) return "error";
  if (statuses.includes("warning")) return "warning";
  if (statuses.includes("ok")) return "ok";
  return "skipped";
}

function probeStatusFrom(value: boolean | undefined): BettaFishProbeStatus {
  if (value === undefined) return "skipped";
  return value ? "ok" : "error";
}

function inspectCommand(command: string, args: string[]) {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf-8",
      shell: false,
      windowsHide: true,
      timeout: 5_000
    });
    const output = compactText(`${result.stdout || ""} ${result.stderr || ""}`, 160);
    return {
      ok: result.status === 0,
      version: output || undefined
    };
  } catch {
    return { ok: false };
  }
}

function statusRank(status: BettaFishProbeStatus) {
  if (status === "ok") return 3;
  if (status === "warning") return 2;
  if (status === "error") return 1;
  return 0;
}

function makeRecommendations(
  gameMonitors: BettaFishGameMonitor[],
  importPreviews: BettaFishImportPreview[],
  endpointProbes: BettaFishEndpointProbe[],
  capabilities: BettaFishCapability[],
  runtime: BettaFishRuntimeStatus,
  mindSpider: BettaFishMindSpiderStatus,
  sentiment: BettaFishSentimentStatus
) {
  const recommendations: string[] = [];
  const totalItems = importPreviews.reduce((sum, preview) => sum + preview.matchedItems, 0);
  const monitorTotal = gameMonitors.reduce((sum, monitor) => sum + (monitor.response?.stats.total ?? 0), 0);
  if (monitorTotal === 0) recommendations.push("测试台 SS1/SS2 监控暂未拿到新鲜条目；先检查来源健康、采集缓存和关键词覆盖。");
  if (gameMonitors.some((monitor) => monitor.status === "error")) recommendations.push("有游戏监控快照生成失败，优先查看对应来源健康错误和服务日志。");
  if (!runtime.baseUrlConfigured) recommendations.push("配置 BETTAFISH_BASE_URL 后，测试台可代理 Query/Media/Insight、ForumEngine、ReportEngine 和系统控制接口。");
  if (!runtime.actionsEnabled) recommendations.push("研究操作被配置关闭；需要执行启动/搜索/爬取/报告/部署时设置 BETTAFISH_LAB_ACTIONS_ENABLED=true。");
  if (!mindSpider.repoAvailable) recommendations.push("配置 BETTAFISH_REPO_DIR 后，测试台可检查 MindSpider 登录态候选目录、数据库直连和测试爬虫调度。");
  if (!sentiment.commandConfigured && sentiment.localModelsAvailable && !sentiment.bridgeAvailable) recommendations.push("已发现 BettaFish 情感模型候选；配置 BETTAFISH_SENTIMENT_COMMAND 或部署本地 bridge 后可直接调用本地模型。");
  if (totalItems === 0) recommendations.push(`把 BettaFish 授权导出放入 BETTAFISH_IMPORT_DIR，或把 MindSpider 抖音实验导出放入 ${runtimeConfig.mindSpiderDouyinImportDir}，先形成可复盘的导入样本集。`);
  if (endpointProbes.some((probe) => probe.status === "error")) recommendations.push("有 BettaFish 只读端点不可达，先确认 BettaFish Flask 服务、ReportEngine Blueprint 和 ForumEngine 日志接口。");
  if (capabilities.find((capability) => capability.id === "sentiment")?.status === "ok") {
    recommendations.push("用同一批文本并排比较 BettaFish 语义输出与本平台 analyzeItem 输出，稳定后再进入主链路。");
  }
  recommendations.push("启动、爬取、部署等研究操作只留在测试台，主看板继续只读取导入结果和现有监控数据。");
  return recommendations;
}

function summarizeEndpointPayload(id: string, text: string) {
  const parsed = parseJson(text);
  if (isRecord(parsed)) {
    if (id === "status") return summarizeStatusJson(parsed);
    if (id === "system-status") return summarizeSystemJson(parsed);
    if (id === "report-status") return summarizeReportStatus(parsed);
    if (id === "report-templates") return summarizeReportTemplates(parsed);
    if (id === "report-log" || id === "forum-log" || id.endsWith("-output")) return summarizeLogPayload(parsed);
    if (id === "config") return "BettaFish 配置接口可达";
    return compactText(JSON.stringify(parsed), 140);
  }
  return text ? compactText(text, 140) : "接口可达";
}

function summarizeStatusJson(json: Record<string, unknown>) {
  const entries = Object.entries(json)
    .filter(([, value]) => isRecord(value))
    .map(([name, value]) => {
      const record = value as Record<string, unknown>;
      const status = record.status || record.state || record.running;
      return status === undefined ? "" : `${name}:${String(status)}`;
    })
    .filter(Boolean);
  return entries.length ? entries.join(" / ") : "BettaFish 状态接口可达";
}

function summarizeSystemJson(json: Record<string, unknown>) {
  const success = json.success ?? json.ok;
  const started = json.started;
  const starting = json.starting;
  const message = typeof json.message === "string" ? json.message : "";
  if (message) return compactText(message, 140);
  if (started !== undefined || starting !== undefined) return `started:${String(started)} / starting:${String(starting)}`;
  if (success !== undefined) return `system status: ${String(success)}`;
  return "系统状态接口可达";
}

function summarizeReportStatus(json: Record<string, unknown>) {
  return `initialized:${String(json.initialized)} / engines_ready:${String(json.engines_ready)} / current_task:${json.current_task ? "yes" : "no"}`;
}

function summarizeReportTemplates(json: Record<string, unknown>) {
  const templates = json.templates || json.data || json.results;
  if (Array.isArray(templates)) return `读取到 ${templates.length} 个报告模板`;
  if (typeof json.message === "string") return compactText(json.message, 140);
  if (typeof json.error === "string") return compactText(json.error, 140);
  return "ReportEngine 模板接口可达";
}

function summarizeLogPayload(json: Record<string, unknown>) {
  const logs = json.logs || json.lines || json.log_lines || json.data || json.output;
  if (Array.isArray(logs)) return `读取到 ${logs.length} 行日志`;
  if (typeof logs === "string") return compactText(logs, 140);
  if (typeof json.message === "string") return compactText(json.message, 140);
  if (typeof json.error === "string") return compactText(json.error, 140);
  return "日志接口可达";
}

function parseJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferSuccess(result: unknown) {
  if (!isRecord(result)) return true;
  if (isAlreadyRunningResult(result)) return true;
  const message = typeof result.message === "string" ? result.message : "";
  if (/(失败|异常|错误|failed|error|forbidden)/i.test(message)) return false;
  if (isRecord(result.results)) {
    const nested = Object.values(result.results).filter(isRecord);
    if (nested.some((item) => inferSuccess(item) === false)) return false;
  }
  if (typeof result.success === "boolean") return result.success;
  if (typeof result.ok === "boolean") return result.ok;
  return true;
}

function compactText(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function uniqueStrings(values: string[], limit = Number.POSITIVE_INFINITY) {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  return Array.from(new Set(normalized)).slice(0, limit);
}

function disabledReason(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join("；") || undefined;
}

function commandLine(command: string, args: string[]) {
  return [command, ...args].map(quoteShell).join(" ");
}

function quoteShell(value: string) {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
