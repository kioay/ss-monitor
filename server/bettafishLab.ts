import { z } from "zod";
import { games, runtimeConfig } from "./config";
import { previewBettaFishImportedItems, probeBettaFishStatus } from "./collectors/bettafish";
import type {
  BettaFishCapability,
  BettaFishEndpointProbe,
  BettaFishImportPreview,
  BettaFishLabResponse,
  BettaFishProbeStatus
} from "../src/shared";

const labQuerySchema = z.object({
  windowHours: z.coerce.number().int().min(1).max(24 * 30).default(runtimeConfig.defaultWindowHours),
  sampleLimit: z.coerce.number().int().min(1).max(12).default(4)
});

const readOnlyProbeTargets = [
  { id: "status", label: "总状态", path: "/api/status" },
  { id: "system-status", label: "系统状态", path: "/api/system/status" },
  { id: "report-templates", label: "ReportEngine 模板", path: "/api/report/templates" },
  { id: "report-log", label: "ReportEngine 日志", path: "/api/report/log" },
  { id: "forum-log", label: "ForumEngine 日志", path: "/api/forum/log" }
];

export async function getBettaFishLabResponse(rawQuery: unknown): Promise<BettaFishLabResponse> {
  const query = labQuerySchema.parse(rawQuery);
  const generatedAt = new Date();
  const cutoff = new Date(generatedAt.getTime() - query.windowHours * 3_600_000);

  const [importPreviews, endpointProbes, nativeStatus] = await Promise.all([
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
      message: error instanceof Error ? error.message : String(error)
    }))
  ]);

  const capabilities = makeCapabilities(importPreviews, endpointProbes, nativeStatus);
  return {
    generatedAt: generatedAt.toISOString(),
    mode: "read-only",
    windowHours: query.windowHours,
    freshnessCutoff: cutoff.toISOString(),
    importDir: runtimeConfig.bettaFishImportDir,
    baseUrlConfigured: Boolean(runtimeConfig.bettaFishBaseUrl),
    ...(runtimeConfig.bettaFishBaseUrl ? { baseUrl: runtimeConfig.bettaFishBaseUrl } : {}),
    importPreviews,
    endpointProbes,
    capabilities,
    recommendations: makeRecommendations(importPreviews, endpointProbes, capabilities)
  };
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
    return {
      id: target.id,
      label: target.label,
      method: "GET",
      path: target.path,
      target: url,
      status: response.ok ? "ok" : "error",
      latencyMs,
      checkedAt,
      message: response.ok ? summarizeEndpointPayload(target.id, text) : `HTTP ${response.status}: ${compactText(text || response.statusText, 140)}`
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
      message: error instanceof Error && error.name === "AbortError" ? "请求超时" : error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function makeCapabilities(
  importPreviews: BettaFishImportPreview[],
  endpointProbes: BettaFishEndpointProbe[],
  nativeStatus: { configured: boolean; ok: boolean; message: string }
): BettaFishCapability[] {
  const totalRows = Math.max(0, ...importPreviews.map((preview) => preview.rowCount));
  const totalItems = importPreviews.reduce((sum, preview) => sum + preview.matchedItems, 0);
  const statusProbe = endpointProbes.find((probe) => probe.id === "status");
  const systemProbe = endpointProbes.find((probe) => probe.id === "system-status");
  const reportProbe = bestProbe(endpointProbes, ["report-templates", "report-log"]);
  const forumProbe = endpointProbes.find((probe) => probe.id === "forum-log");
  const engineStatus = probeStatusFrom(nativeStatus.configured ? nativeStatus.ok : undefined);

  return [
    {
      id: "mindspider-import",
      name: "MindSpider 数据获取",
      goal: "扩大舆情获取范围",
      currentProjectUse: "主流程已接入导出文件",
      testCoverage: "只读扫描 JSON/CSV 导出目录并复用本平台解析器",
      status: totalItems > 0 ? "ok" : totalRows > 0 ? "warning" : "skipped",
      evidence: [
        `导入目录：${runtimeConfig.bettaFishImportDir}`,
        `读取 ${totalRows} 行，命中 ${totalItems} 条 SS1/SS2 舆情`,
        ...importPreviews.flatMap((preview) => preview.errors.slice(0, 1).map((error) => `${preview.gameName}: ${error}`))
      ],
      nextStep: "接入 BettaFish 数据库或授权导出任务时，继续保持只读同步，不在本项目里执行爬虫登录。"
    },
    {
      id: "semantic",
      name: "语义判定",
      goal: "提升情绪、风险、主题识别",
      currentProjectUse: "导入条目已进入现有规则分析器",
      testCoverage: "测试页展示导入样本的情绪、风险、主题和风险原因",
      status: totalItems > 0 ? "ok" : "warning",
      evidence: totalItems > 0 ? [`已有 ${totalItems} 条导入样本完成语义判定`] : ["等待 BettaFish 导出样本后才能做语义对照"],
      nextStep: "下一层可加可回退的 LLM/模型判定接口，并用人工标注样本集评估准确率。"
    },
    {
      id: "agents",
      name: "Query / Media / Insight Agent",
      goal: "补强跨来源检索与观点归纳",
      currentProjectUse: "未进入主监控链路",
      testCoverage: "只读探测 BettaFish 运行状态，不调用 /api/search",
      status: combineStatus(engineStatus, bestStatus(statusProbe, systemProbe)),
      evidence: uniqueStrings([
        nativeStatus.configured ? nativeStatus.message : "未配置 BettaFish Base URL",
        statusProbe?.message || "",
        systemProbe?.message || ""
      ].filter(Boolean)),
      nextStep: "确认运行稳定后，优先接入 Agent 输出文件或任务结果读取，再考虑主动发起查询。"
    },
    {
      id: "report",
      name: "ReportEngine 舆情报告",
      goal: "提升舆情分析和复盘能力",
      currentProjectUse: "未进入主监控链路",
      testCoverage: "只读探测模板和日志接口，不触发报告生成",
      status: reportProbe?.status || "skipped",
      evidence: reportProbe ? [reportProbe.message] : ["未执行 ReportEngine 探测"],
      nextStep: "下一步可做报告任务适配器：创建任务、轮询进度、读取 HTML/Markdown 结果，但默认不影响现有看板。"
    },
    {
      id: "forum",
      name: "ForumEngine 观点汇总",
      goal: "把多 Agent 讨论沉淀为可读结论",
      currentProjectUse: "未进入主监控链路",
      testCoverage: "只读探测论坛日志接口，不启动或停止 ForumEngine",
      status: forumProbe?.status || "skipped",
      evidence: forumProbe ? [forumProbe.message] : ["未执行 ForumEngine 探测"],
      nextStep: "先读取 ForumEngine 总结日志作为分析补充，再决定是否引入实时讨论流。"
    }
  ];
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

function probeStatusFrom(value: boolean | undefined): BettaFishProbeStatus {
  if (value === undefined) return "skipped";
  return value ? "ok" : "error";
}

function statusRank(status: BettaFishProbeStatus) {
  if (status === "ok") return 3;
  if (status === "warning") return 2;
  if (status === "error") return 1;
  return 0;
}

function makeRecommendations(
  importPreviews: BettaFishImportPreview[],
  endpointProbes: BettaFishEndpointProbe[],
  capabilities: BettaFishCapability[]
) {
  const recommendations: string[] = [];
  const totalItems = importPreviews.reduce((sum, preview) => sum + preview.matchedItems, 0);
  if (!runtimeConfig.bettaFishBaseUrl) recommendations.push("配置 BETTAFISH_BASE_URL 后，测试页可以探测 Agent、ReportEngine、ForumEngine 的只读状态。");
  if (totalItems === 0) recommendations.push("把 BettaFish/MindSpider 授权导出放入 BETTAFISH_IMPORT_DIR，先形成可复盘的导入样本集。");
  if (endpointProbes.some((probe) => probe.status === "error")) recommendations.push("有 BettaFish 只读端点不可达，先确认 BettaFish Flask 服务、ReportEngine Blueprint 和 ForumEngine 日志接口。");
  if (capabilities.find((capability) => capability.id === "semantic")?.status === "ok") {
    recommendations.push("用导入样本建立人工标注集，再接入可回退的 LLM/模型语义判定，避免直接替换现有规则。");
  }
  recommendations.push("报告生成、Agent 搜索和爬虫启动保持在测试页后续单独开关，确认后再进入主监控链路。");
  return recommendations;
}

function summarizeEndpointPayload(id: string, text: string) {
  const parsed = parseJson(text);
  if (isRecord(parsed)) {
    if (id === "status") return summarizeStatusJson(parsed);
    if (id === "system-status") return summarizeSystemJson(parsed);
    if (id === "report-templates") return summarizeReportTemplates(parsed);
    if (id === "report-log" || id === "forum-log") return summarizeLogPayload(parsed);
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
  const message = typeof json.message === "string" ? json.message : "";
  if (message) return compactText(message, 140);
  if (success !== undefined) return `system status: ${String(success)}`;
  return "系统状态接口可达";
}

function summarizeReportTemplates(json: Record<string, unknown>) {
  const templates = json.templates || json.data || json.results;
  if (Array.isArray(templates)) return `读取到 ${templates.length} 个报告模板`;
  if (typeof json.message === "string") return compactText(json.message, 140);
  return "ReportEngine 模板接口可达";
}

function summarizeLogPayload(json: Record<string, unknown>) {
  const logs = json.logs || json.lines || json.data || json.output;
  if (Array.isArray(logs)) return `读取到 ${logs.length} 行日志`;
  if (typeof logs === "string") return compactText(logs, 140);
  if (typeof json.message === "string") return compactText(json.message, 140);
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

function compactText(value: string, maxLength: number) {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}
