import React from "react";
import ReactDOM from "react-dom/client";
import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  Eye,
  ExternalLink,
  FileText,
  Filter,
  Info,
  MousePointer2,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Tags,
  TestTube2,
  Video,
  Waves,
  X
} from "lucide-react";
import { currentAnalysisVersion } from "./shared";
import type {
  BettaFishActionResponse,
  BettaFishCapability,
  BettaFishGameMonitor,
  BettaFishLabResponse,
  BettaFishOperation,
  BettaFishPanelCapability,
  BettaFishProbeStatus,
  DouyinCrawlStatus,
  GameConfig,
  GameId,
  KeywordEffectiveness,
  AlertItem,
  MonitorItem,
  MonitorResponse,
  RiskLevel,
  SearchResponse,
  SearchResult,
  Sentiment,
  SourceType,
  TrendPoint
} from "./shared";
import { topicBarWidthPercent } from "./topicBars";
import "./styles.css";

const api = {
  config: "/api/config",
  monitor: "/api/monitor",
  search: "/api/search",
  douyinStatus: "/api/douyin/status",
  douyinRemoteLogin: "/api/douyin/remote-login",
  bettafishLab: "/api/bettafish/lab",
  bettafishLabAction: "/api/bettafish/lab/action"
};
const clientCacheMaxAgeMs = 4 * 3_600_000;
const searchWindowHours = 24 * 30;
const feedInitialLimit = 60;
const feedBatchSize = 60;

type TrendSeries = "negative" | "neutral" | "positive" | "total";
type TrendSeriesVisibility = Record<TrendSeries, boolean>;
type TrendLineSample = { point: TrendPoint; x: number; value: number };
type TrendLineCoordinate = TrendLineSample & { y: number };
type PendingRuntimeConfirmation = {
  operation: BettaFishOperation;
  payload: Record<string, unknown>;
};

const defaultTrendSeriesVisibility: TrendSeriesVisibility = {
  negative: true,
  neutral: true,
  positive: true,
  total: false
};

const trendSeriesOrder: TrendSeries[] = ["negative", "neutral", "positive", "total"];
const trendLineTop = 7;
const trendLineHeight = 19;
const trendLineMinY = 5;
const trendLineMaxY = 30;
const trendLineClipHeight = 32;
const defaultWindowHours = 72;
const windowHourOptions = [24, 72, 168, 336];
const sourceFilterValues = ["all", "bilibili", "tieba", "douyin", "bettafish"] as const;
const riskFilterValues = ["all", "high", "medium", "low"] as const;
const sentimentFilterValues = ["all", "negative", "mixed", "neutral", "positive"] as const;

type SourceFilter = "all" | SourceType;
type RiskFilter = "all" | RiskLevel;
type SentimentFilter = "all" | Sentiment;
type TiebaScopeTextMap = Record<string, string>;
type InitialUiState = {
  games: GameId[];
  windowHours: number;
  hasWindowHours: boolean;
  source: SourceFilter;
  risk: RiskFilter;
  sentiment: SentimentFilter;
  topic: string;
  query: string;
  extraKeywords: string;
  hasTiebaScopeOverride: boolean;
  tiebaBars: string;
  tiebaKeywords: string;
  tiebaBarsByGame: TiebaScopeTextMap;
  tiebaKeywordsByGame: TiebaScopeTextMap;
  trendOpen: boolean;
  trendSeries: TrendSeriesVisibility;
};

function readInitialUiState(): InitialUiState {
  if (typeof window === "undefined") return makeDefaultUiState();

  const params = new URLSearchParams(window.location.search);
  const rawWindowHours = Number(params.get("window"));
  const hasWindowHours = windowHourOptions.includes(rawWindowHours);
  const games = (params.get("games") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const tiebaBarsByGame = readTiebaScopeTextMap(params, "tiebaBars");
  const tiebaKeywordsByGame = readTiebaScopeTextMap(params, "tiebaKeywords");
  const hasTiebaScopeOverride =
    params.has("tiebaBars")
    || params.has("tiebaKeywords")
    || Object.keys(tiebaBarsByGame).length > 0
    || Object.keys(tiebaKeywordsByGame).length > 0;

  return {
    games,
    windowHours: hasWindowHours ? rawWindowHours : defaultWindowHours,
    hasWindowHours,
    source: readParamUnion(params, "source", sourceFilterValues, "all"),
    risk: readParamUnion(params, "risk", riskFilterValues, "all"),
    sentiment: readParamUnion(params, "sentiment", sentimentFilterValues, "all"),
    topic: params.get("topic") || "all",
    query: params.get("q") || "",
    extraKeywords: normalizeSupplementalKeywordText(params.get("extraKeywords") || ""),
    hasTiebaScopeOverride,
    tiebaBars: normalizeSupplementalKeywordText(params.get("tiebaBars") || ""),
    tiebaKeywords: normalizeSupplementalKeywordText(params.get("tiebaKeywords") || ""),
    tiebaBarsByGame,
    tiebaKeywordsByGame,
    trendOpen: params.get("trend") === "open",
    trendSeries: readTrendSeriesParam(params.get("series"))
  };
}

function readTiebaScopeTextMap(params: URLSearchParams, keyPrefix: "tiebaBars" | "tiebaKeywords"): TiebaScopeTextMap {
  const scope: TiebaScopeTextMap = {};
  const prefix = `${keyPrefix}.`;
  params.forEach((value, key) => {
    if (!key.startsWith(prefix)) return;
    const gameId = key.slice(prefix.length).trim();
    const normalized = normalizeSupplementalKeywordText(value);
    if (gameId && normalized) scope[gameId] = normalized;
  });
  return scope;
}

function makeDefaultUiState(): InitialUiState {
  return {
    games: [],
    windowHours: defaultWindowHours,
    hasWindowHours: false,
    source: "all",
    risk: "all",
    sentiment: "all",
    topic: "all",
    query: "",
    extraKeywords: "",
    hasTiebaScopeOverride: false,
    tiebaBars: "",
    tiebaKeywords: "",
    tiebaBarsByGame: {},
    tiebaKeywordsByGame: {},
    trendOpen: false,
    trendSeries: defaultTrendSeriesVisibility
  };
}

function readParamUnion<T extends readonly string[]>(
  params: URLSearchParams,
  key: string,
  allowedValues: T,
  fallback: T[number]
): T[number] {
  const value = params.get(key);
  return value && allowedValues.includes(value) ? value : fallback;
}

function readTrendSeriesParam(value: string | null): TrendSeriesVisibility {
  if (!value) return defaultTrendSeriesVisibility;
  const activeSeries = new Set(value.split(",").filter((series): series is TrendSeries => trendSeriesOrder.includes(series as TrendSeries)));
  if (!activeSeries.size) return defaultTrendSeriesVisibility;
  return Object.fromEntries(trendSeriesOrder.map((series) => [series, activeSeries.has(series)])) as TrendSeriesVisibility;
}

type LabTerm = {
  term: string;
  meaning: string;
  role: string;
};

const bettaFishGlossaryGroups: Array<{ title: string; terms: LabTerm[] }> = [
  {
    title: "看板指标",
    terms: [
      {
        term: "监控项目",
        meaning: "由服务器配置的一个或多个游戏、产品或社区对象。",
        role: "测试台按项目拆开看数据，避免不同项目的舆情和关键词互相污染。"
      },
      {
        term: "测试窗口",
        meaning: "当前只统计近 24 小时、72 小时、7 天或 14 天内的数据。",
        role: "用同一个时间口径比较采集、导入、风险和情绪结果。"
      },
      {
        term: "监控条目",
        meaning: "测试台复用正式看板采到的全部舆情条目。",
        role: "判断当前样本量是否足够支撑后续分析。"
      },
      {
        term: "导入命中",
        meaning: "BettaFish导入或 MindSpider 导出里匹配到当前监控项目关键词的条目数。",
        role: "验证外部导出是否真的能进入本平台监控链路。"
      },
      {
        term: "只读端点",
        meaning: "只检查 BettaFish 状态、日志、模板等 GET 接口。",
        role: "确认外部服务可达，同时不触发搜索、爬虫或报告生成。"
      },
      {
        term: "能力就绪",
        meaning: "测试台覆盖的 BettaFish 集成能力中，当前可用的数量。",
        role: "快速判断哪些能力已经能测试，哪些还缺配置。"
      },
      {
        term: "来源健康",
        meaning: "B站、贴吧、抖音、BettaFish导入等来源的采集结果和异常状态。",
        role: "定位数据少、阻塞、过期或接口失败的问题。"
      },
      {
        term: "主题分布",
        meaning: "系统从条目里识别出的主要话题及数量。",
        role: "帮助判断舆情集中在外挂、匹配、版本、活动等哪类问题。"
      },
      {
        term: "风险预警",
        meaning: "被判为中高风险、需要优先关注的条目。",
        role: "把可能需要人工复盘或运营跟进的内容提前拎出来。"
      }
    ]
  },
  {
    title: "BettaFish 组件",
    terms: [
      {
        term: "BettaFish URL",
        meaning: "BettaFish Flask/API 服务的访问地址。",
        role: "测试台通过它代理 Agent、论坛、报告和系统控制接口。"
      },
      {
        term: "Repo",
        meaning: "本机 BettaFish 代码仓库路径。",
        role: "本地启动、MindSpider 命令和模型文件检查都依赖这个位置。"
      },
      {
        term: "Query Agent",
        meaning: "负责理解分析问题并组织检索的 Agent。",
        role: "适合验证“问一个舆情问题，BettaFish 能否给出可读答案”。"
      },
      {
        term: "Media Agent",
        meaning: "负责处理媒体内容、来源材料和平台信息的 Agent。",
        role: "用来补充帖子、视频、评论之外的媒体侧信息。"
      },
      {
        term: "Insight Agent",
        meaning: "负责归纳观点、提炼结论的 Agent。",
        role: "把分散舆情整理成可复盘的观察和建议。"
      },
      {
        term: "ForumEngine",
        meaning: "BettaFish 的多 Agent 讨论引擎。",
        role: "让多个 Agent 讨论同一问题，并通过日志观察讨论是否稳定产出。"
      },
      {
        term: "ReportEngine",
        meaning: "BettaFish 的报告生成服务。",
        role: "用于测试专项报告、进度查询、结果读取和取消任务。"
      },
      {
        term: "MindSpider",
        meaning: "BettaFish 侧的爬虫和深度舆情采集模块。",
        role: "测试登录态、数据库、少量关键词采集，再决定是否扩大调度。"
      },
      {
        term: "情感模型 / LLM",
        meaning: "BettaFish 本地情感模型或通过 Agent 调起的大模型判定。",
        role: "作为本平台语义分析的辅助信号，不能单独制造高风险结论。"
      }
    ]
  },
  {
    title: "操作与状态",
    terms: [
      {
        term: "研究操作",
        meaning: "会启动服务、搜索、爬取、生成报告或执行固定命令的测试动作。",
        role: "默认只留在测试台使用，避免影响正式监控和钉钉日报。"
      },
      {
        term: "read",
        meaning: "只读操作，只请求状态、日志或结果。",
        role: "适合先排查连通性，通常不会改变外部系统状态。"
      },
      {
        term: "research",
        meaning: "研究性操作，可能启动进程、发起搜索、调度爬虫或生成报告。",
        role: "用于验证能力，但点击前要确认配置和测试范围。"
      },
      {
        term: "Task ID",
        meaning: "ReportEngine 生成报告后返回的任务编号。",
        role: "后续查询进度、读取结果或取消任务都靠它定位同一份报告。"
      },
      {
        term: "本地进程",
        meaning: "由测试台在本机启动的 BettaFish 子进程。",
        role: "区分“测试台启动的进程”和你手动启动的外部服务。"
      },
      {
        term: "部署命令",
        meaning: "配置好的固定 BettaFish 更新/部署脚本。",
        role: "让测试台只能执行白名单命令，不在页面里拼接任意 shell。"
      },
      {
        term: "可用 / 待完善 / 异常 / 未配置",
        meaning: "测试台对能力、接口、配置的四类状态。",
        role: "可用代表当前检查通过；待完善代表部分可用；异常代表失败；未配置代表缺少前置配置。"
      },
      {
        term: "高风险 / 中风险 / 低风险",
        meaning: "本平台结合情绪、主题、互动和保护语境后的风险等级。",
        role: "指导人工复盘优先级，而不是只看 BettaFish 单一情感输出。"
      },
      {
        term: "负面占比",
        meaning: "负面条目数占总条目的比例。",
        role: "衡量当前窗口内情绪压力，但需要和样本量、主题一起判断。"
      }
    ]
  }
];

const capabilityRoleNotes: Record<string, string> = {
  "game-monitoring": "把测试台口径和正式看板口径对齐",
  agents: "验证外部 Agent 是否能补充检索和归纳",
  forum: "观察多 Agent 讨论是否能沉淀稳定结论",
  report: "测试报告生成链路和任务生命周期",
  mindspider: "检查外部采集、登录态和数据库链路",
  sentiment: "并排评估 BettaFish 语义输出和本平台判定",
  runtime: "控制外部系统启动、停止和固定部署动作"
};

const runtimeActionExplanations: Array<{ id: string; label: string; effect: string; target: string }> = [
  {
    id: "runtime.localStart",
    label: "本地启动 BettaFish",
    effect: "在测试台服务器上按 BETTAFISH_START_COMMAND 拉起 BettaFish Flask/API 进程。",
    target: "本地进程"
  },
  {
    id: "runtime.localStop",
    label: "停止本地启动进程",
    effect: "只停止由测试台自己启动并记录的 BettaFish 本地子进程。",
    target: "本地进程"
  },
  {
    id: "runtime.systemStart",
    label: "启动完整 BettaFish 系统",
    effect: "调用 BettaFish /api/system/start，启动三个 Agent、ForumEngine 和 ReportEngine。",
    target: "/api/system/start"
  },
  {
    id: "runtime.systemShutdown",
    label: "关闭 BettaFish 系统",
    effect: "调用 BettaFish /api/system/shutdown，关闭 BettaFish 当前系统组件。",
    target: "/api/system/shutdown"
  },
  {
    id: "runtime.deploy",
    label: "执行部署命令",
    effect: "在配置的 BettaFish 仓库目录执行 BETTAFISH_DEPLOY_COMMAND。",
    target: "部署命令"
  }
];

type InteractionMode = "display" | "interactive" | "link";

function monitorCacheKey(
  gameIds: GameId[],
  windowHours: number,
  extraKeywords = "",
  tiebaBars = "",
  tiebaKeywords = "",
  tiebaScopeOverrideActive = Boolean(normalizeSupplementalKeywordText(tiebaBars) || normalizeSupplementalKeywordText(tiebaKeywords))
) {
  const keywordScope = normalizeSupplementalKeywordText(extraKeywords) || "base";
  const barScope = normalizeSupplementalKeywordText(tiebaBars);
  const tiebaKeywordScope = normalizeSupplementalKeywordText(tiebaKeywords);
  return `ss-monitor:${[...gameIds].sort().join(",")}:${windowHours}:${keywordScope}:tb=${tiebaScopeOverrideActive ? barScope || "base" : "config"}:tk=${tiebaScopeOverrideActive ? tiebaKeywordScope || "base" : "config"}`;
}

function normalizeSupplementalKeywordText(value: string) {
  return splitSupplementalKeywords(value).join(",");
}

function splitSupplementalKeywords(value: string) {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of value.split(/[\s,;|\uFF0C\u3001\uFF1B]+/)) {
    const keyword = raw.trim();
    const normalized = keyword.toLowerCase();
    if (!keyword || seen.has(normalized)) continue;
    seen.add(normalized);
    keywords.push(keyword.slice(0, 40));
    if (keywords.length >= 20) break;
  }
  return keywords;
}

function normalizeScopeTextMap(scope: TiebaScopeTextMap) {
  const normalized: TiebaScopeTextMap = {};
  for (const [gameId, value] of Object.entries(scope)) {
    const text = normalizeSupplementalKeywordText(value);
    if (gameId && text) normalized[gameId] = text;
  }
  return normalized;
}

function scopeTextMapHasValues(scope: TiebaScopeTextMap) {
  return Object.values(scope).some((value) => normalizeSupplementalKeywordText(value));
}

function activeTiebaScopeMapForGames(
  games: GameConfig[],
  scopedOverride: TiebaScopeTextMap,
  legacyOverride: string,
  overrideActive: boolean
) {
  const gameIds = new Set(games.map((game) => game.id));
  const normalized = Object.fromEntries(
    Object.entries(normalizeScopeTextMap(scopedOverride)).filter(([gameId]) => gameIds.has(gameId))
  );
  if (Object.keys(normalized).length) return normalized;
  const legacy = normalizeSupplementalKeywordText(legacyOverride);
  if (!overrideActive || !legacy) return {};
  return Object.fromEntries(games.map((game) => [game.id, legacy]));
}

function scopeTextMapCacheKey(scope: TiebaScopeTextMap) {
  const normalized = normalizeScopeTextMap(scope);
  const entries = Object.entries(normalized)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([gameId, value]) => `${gameId}:${value}`);
  return entries.join("|");
}

function appendTiebaScopeParams(params: URLSearchParams, barsByGame: TiebaScopeTextMap, keywordsByGame: TiebaScopeTextMap) {
  for (const [gameId, value] of Object.entries(normalizeScopeTextMap(barsByGame))) {
    params.set(`tiebaBars.${gameId}`, value);
  }
  for (const [gameId, value] of Object.entries(normalizeScopeTextMap(keywordsByGame))) {
    params.set(`tiebaKeywords.${gameId}`, value);
  }
}

function mergeScopeInputText(current: string, additions: string[]) {
  return normalizeSupplementalKeywordText(`${current},${additions.join(",")}`);
}

function removeScopeInputValue(current: string, value: string) {
  const normalizedValue = value.trim().toLowerCase();
  return normalizeSupplementalKeywordText(
    splitSupplementalKeywords(current)
      .filter((item) => item.toLowerCase() !== normalizedValue)
      .join(",")
  );
}

function readCachedMonitor(key: string) {
  try {
    const raw = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
    if (!raw) return undefined;
    const payload = JSON.parse(raw) as { cachedAt: number; data: MonitorResponse };
    if (!payload?.cachedAt || Date.now() - payload.cachedAt > clientCacheMaxAgeMs) return undefined;
    if (payload.data?.riskBacktest?.status !== "passed") return undefined;
    if (payload.data?.analysisVersion !== currentAnalysisVersion) return undefined;
    return payload.data;
  } catch {
    return undefined;
  }
}

function writeCachedMonitor(key: string, data: MonitorResponse) {
  try {
    const payload = JSON.stringify({ cachedAt: Date.now(), data });
    window.localStorage.setItem(key, payload);
    window.sessionStorage.setItem(key, payload);
  } catch {
    // Session storage is only a speed hint; the live request remains authoritative.
  }
}

function clearCachedMonitor(key: string) {
  try {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  } catch {
    // Cache cleanup should never block a manual view switch.
  }
}

function scrollToSearchResults() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.getElementById("latest-feed")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function App() {
  const initialUiStateRef = React.useRef<InitialUiState | undefined>(undefined);
  if (!initialUiStateRef.current) initialUiStateRef.current = readInitialUiState();
  const initialUiState = initialUiStateRef.current;
  const [config, setConfig] = React.useState<{
    games: GameConfig[];
    defaultWindowHours: number;
    updatePolicy: MonitorResponse["updatePolicy"];
  }>();
  const [selectedGames, setSelectedGames] = React.useState<GameId[]>(initialUiState.games);
  const [windowHours, setWindowHours] = React.useState(initialUiState.windowHours);
  const [source, setSource] = React.useState<SourceFilter>(initialUiState.source);
  const [risk, setRisk] = React.useState<RiskFilter>(initialUiState.risk);
  const [sentiment, setSentiment] = React.useState<SentimentFilter>(initialUiState.sentiment);
  const [topic, setTopic] = React.useState(initialUiState.topic);
  const [query, setQuery] = React.useState(initialUiState.query);
  const [extraKeywords, setExtraKeywords] = React.useState(initialUiState.extraKeywords);
  const [tiebaScopeOverrideActive, setTiebaScopeOverrideActive] = React.useState(initialUiState.hasTiebaScopeOverride);
  const [legacyTiebaBarsOverride, setLegacyTiebaBarsOverride] = React.useState(initialUiState.tiebaBars);
  const [legacyTiebaKeywordsOverride, setLegacyTiebaKeywordsOverride] = React.useState(initialUiState.tiebaKeywords);
  const [tiebaBarsByGameOverride, setTiebaBarsByGameOverride] = React.useState<TiebaScopeTextMap>(initialUiState.tiebaBarsByGame);
  const [tiebaKeywordsByGameOverride, setTiebaKeywordsByGameOverride] = React.useState<TiebaScopeTextMap>(initialUiState.tiebaKeywordsByGame);
  const [keywordInput, setKeywordInput] = React.useState("");
  const [scopeBarsInputByGame, setScopeBarsInputByGame] = React.useState<TiebaScopeTextMap>({});
  const [scopeKeywordsInputByGame, setScopeKeywordsInputByGame] = React.useState<TiebaScopeTextMap>({});
  const [scopeBarDraftByGame, setScopeBarDraftByGame] = React.useState<TiebaScopeTextMap>({});
  const [scopeKeywordDraftByGame, setScopeKeywordDraftByGame] = React.useState<TiebaScopeTextMap>({});
  const [searchData, setSearchData] = React.useState<SearchResponse>();
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [searchError, setSearchError] = React.useState("");
  const [data, setData] = React.useState<MonitorResponse>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [douyinStatus, setDouyinStatus] = React.useState<DouyinCrawlStatus>();
  const [visibleItemLimit, setVisibleItemLimit] = React.useState(feedInitialLimit);
  const [trendOpen, setTrendOpen] = React.useState(initialUiState.trendOpen);
  const [trendSeries, setTrendSeries] = React.useState<TrendSeriesVisibility>(initialUiState.trendSeries);
  const [selectedAlertId, setSelectedAlertId] = React.useState("");
  const [isControlFloating, setControlFloating] = React.useState(false);
  const [keywordPanelOpen, setKeywordPanelOpen] = React.useState(false);
  const controlSentinelRef = React.useRef<HTMLDivElement>(null);
  const latestRequestRef = React.useRef(0);
  const latestSearchRequestRef = React.useRef(0);
  const latestAutoScrolledSearchRef = React.useRef("");

  React.useEffect(() => {
    fetch(api.config)
      .then((response) => response.json())
      .then((payload) => {
        setConfig(payload);
        if (!initialUiState.hasWindowHours) setWindowHours(payload.defaultWindowHours || defaultWindowHours);
        const configuredIds = (payload.games || []).map((game: GameConfig) => game.id);
        setSelectedGames((current) => {
          const retained = current.filter((id) => configuredIds.includes(id));
          return retained.length ? retained : configuredIds;
        });
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const configuredGameIds = React.useMemo(() => {
    const configuredGames = config?.games || [];
    return configuredGames.map((game) => game.id);
  }, [config?.games]);
  const selectedGameConfigs = React.useMemo(() => {
    const configuredGames = config?.games || [];
    if (!configuredGames.length) return [];
    const selectedIds = new Set(selectedGames.length ? selectedGames : configuredGames.map((game) => game.id));
    return configuredGames.filter((game) => selectedIds.has(game.id));
  }, [config?.games, selectedGames]);
  const activeTiebaBarsByGame = React.useMemo(
    () => activeTiebaScopeMapForGames(selectedGameConfigs, tiebaBarsByGameOverride, legacyTiebaBarsOverride, tiebaScopeOverrideActive),
    [legacyTiebaBarsOverride, selectedGameConfigs, tiebaBarsByGameOverride, tiebaScopeOverrideActive]
  );
  const activeTiebaKeywordsByGame = React.useMemo(
    () => activeTiebaScopeMapForGames(selectedGameConfigs, tiebaKeywordsByGameOverride, legacyTiebaKeywordsOverride, tiebaScopeOverrideActive),
    [legacyTiebaKeywordsOverride, selectedGameConfigs, tiebaKeywordsByGameOverride, tiebaScopeOverrideActive]
  );
  const activeTiebaBarsOverride = React.useMemo(() => scopeTextMapCacheKey(activeTiebaBarsByGame), [activeTiebaBarsByGame]);
  const activeTiebaKeywordsOverride = React.useMemo(() => scopeTextMapCacheKey(activeTiebaKeywordsByGame), [activeTiebaKeywordsByGame]);

  const loadDouyinStatus = React.useCallback(async (force = false) => {
    try {
      const response = await fetch(`${api.douyinStatus}${force ? "?force=1" : ""}`);
      if (!response.ok) throw new Error(`API ${response.status}`);
      setDouyinStatus((await response.json()) as DouyinCrawlStatus);
    } catch (reason) {
      setDouyinStatus({
        generatedAt: new Date().toISOString(),
        status: "warning",
        ok: false,
        loginOk: true,
        crawlOk: false,
        message: "抖音采集状态暂时不可读",
        issues: [{
          type: "crawl",
          severity: "warning",
          message: "抖音采集状态暂时不可读",
          detail: reason instanceof Error ? reason.message : String(reason)
        }],
        remoteLogin: {
          ready: false,
          url: api.douyinRemoteLogin,
          setupCommand: "sudo bash /opt/ss-monitor/current/scripts/setup-douyin-remote-login.sh",
          message: "运行 release 自带脚本生成可用 noVNC 入口",
          missing: ["抖音状态 API"]
        },
        service: { available: false },
        scheduler: { exists: false },
        loginProfile: {
          checked: false,
          profileDir: "",
          exists: false,
          cookieDbCount: 0,
          hasSessionCookie: false
        }
      });
    }
  }, []);

  const load = React.useCallback(
    async (force = false) => {
      const requestId = latestRequestRef.current + 1;
      latestRequestRef.current = requestId;
      const normalizedExtraKeywords = normalizeSupplementalKeywordText(extraKeywords);
      const normalizedTiebaBars = activeTiebaBarsOverride;
      const normalizedTiebaKeywords = activeTiebaKeywordsOverride;
      const cacheKey = monitorCacheKey(selectedGames, windowHours, normalizedExtraKeywords, normalizedTiebaBars, normalizedTiebaKeywords, tiebaScopeOverrideActive);
      const cachedPayload = force ? undefined : readCachedMonitor(cacheKey);
      if (cachedPayload) setData(cachedPayload);
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          games: selectedGames.join(","),
          windowHours: String(windowHours),
          limit: "1000",
          notify: "0",
          ...(normalizedExtraKeywords ? { extraKeywords: normalizedExtraKeywords } : {}),
          ...(force ? { force: "1" } : {})
        });
        if (tiebaScopeOverrideActive) appendTiebaScopeParams(params, activeTiebaBarsByGame, activeTiebaKeywordsByGame);
        const response = await fetch(`${api.monitor}?${params.toString()}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { message?: string };
          throw new Error(payload.message || `API ${response.status}`);
        }
        const payload = (await response.json()) as MonitorResponse;
        if (latestRequestRef.current !== requestId) return;
        setData(payload);
        writeCachedMonitor(cacheKey, payload);
        void loadDouyinStatus(force);
      } catch (reason) {
        if (latestRequestRef.current !== requestId) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        if (message.includes("风险回测失败")) setData(undefined);
      } finally {
        if (latestRequestRef.current === requestId) setLoading(false);
      }
    },
    [
      activeTiebaBarsByGame,
      activeTiebaBarsOverride,
      activeTiebaKeywordsByGame,
      activeTiebaKeywordsOverride,
      extraKeywords,
      loadDouyinStatus,
      selectedGames,
      tiebaScopeOverrideActive,
      windowHours
    ]
  );

  React.useEffect(() => {
    void loadDouyinStatus();
    const timer = window.setInterval(() => {
      void loadDouyinStatus();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadDouyinStatus]);

  React.useEffect(() => {
    load(false);
  }, [load]);

  React.useEffect(() => {
    const keyword = query.trim();
    const requestId = latestSearchRequestRef.current + 1;
    latestSearchRequestRef.current = requestId;

    if (!keyword) {
      setSearchData(undefined);
      setSearchError("");
      setSearchLoading(false);
      latestAutoScrolledSearchRef.current = "";
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError("");
      try {
        const params = new URLSearchParams({
          q: keyword,
          games: selectedGames.join(","),
          windowHours: String(searchWindowHours),
          limit: "120",
          source,
          risk,
          sentiment,
          topic
        });
        const response = await fetch(`${api.search}?${params.toString()}`);
        if (!response.ok) throw new Error(`API ${response.status}`);
        const payload = (await response.json()) as SearchResponse;
        if (latestSearchRequestRef.current !== requestId) return;
        setSearchData(payload);
        const scrollKey = params.toString();
        if (latestAutoScrolledSearchRef.current !== scrollKey) {
          latestAutoScrolledSearchRef.current = scrollKey;
          scrollToSearchResults();
        }
      } catch (reason) {
        if (latestSearchRequestRef.current !== requestId) return;
        setSearchError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (latestSearchRequestRef.current === requestId) setSearchLoading(false);
      }
    }, 320);

    return () => window.clearTimeout(timer);
  }, [query, risk, selectedGames, sentiment, source, topic]);

  React.useEffect(() => {
    if (!data?.updatePolicy.nextUpdateAt) return;
    const delayMs = Math.max(1000, new Date(data.updatePolicy.nextUpdateAt).getTime() - Date.now() + 1000);
    const timer = window.setTimeout(() => load(false), delayMs);
    return () => window.clearTimeout(timer);
  }, [data?.updatePolicy.nextUpdateAt, load]);

  React.useEffect(() => {
    const params = new URLSearchParams();
    if (selectedGames.length) params.set("games", selectedGames.join(","));
    params.set("window", String(windowHours));
    if (source !== "all") params.set("source", source);
    if (risk !== "all") params.set("risk", risk);
    if (sentiment !== "all") params.set("sentiment", sentiment);
    if (topic !== "all") params.set("topic", topic);
    if (query.trim()) params.set("q", query.trim());
    if (extraKeywords) params.set("extraKeywords", extraKeywords);
    if (tiebaScopeOverrideActive) {
      appendTiebaScopeParams(params, activeTiebaBarsByGame, activeTiebaKeywordsByGame);
    }
    if (trendOpen) params.set("trend", "open");

    const activeTrendSeries = trendSeriesOrder.filter((series) => trendSeries[series]);
    const defaultActiveTrendSeries = trendSeriesOrder.filter((series) => defaultTrendSeriesVisibility[series]);
    if (activeTrendSeries.join(",") !== defaultActiveTrendSeries.join(",")) {
      params.set("series", activeTrendSeries.join(","));
    }

    const queryString = params.toString();
    const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`;
    if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [
    activeTiebaBarsByGame,
    activeTiebaKeywordsByGame,
    extraKeywords,
    query,
    risk,
    selectedGames,
    sentiment,
    source,
    tiebaScopeOverrideActive,
    topic,
    trendOpen,
    trendSeries,
    windowHours
  ]);

  React.useEffect(() => {
    const target = controlSentinelRef.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setControlFloating(!entry.isIntersecting), {
      rootMargin: "-1px 0px 0px 0px",
      threshold: 0
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!keywordPanelOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setKeywordPanelOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [keywordPanelOpen]);

  const toggleTrendSeries = React.useCallback((series: TrendSeries) => {
    setTrendSeries((current) => {
      const activeCount = Object.values(current).filter(Boolean).length;
      if (current[series] && activeCount === 1) return current;
      return { ...current, [series]: !current[series] };
    });
  }, []);

  const resetFeedFilters = React.useCallback(() => {
    setSource("all");
    setRisk("all");
    setSentiment("all");
    setTopic("all");
    setQuery("");
  }, []);

  const addExtraKeywords = React.useCallback(
    (event?: React.FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const additions = splitSupplementalKeywords(keywordInput);
      if (!additions.length) return;
      const normalized = normalizeSupplementalKeywordText(`${extraKeywords},${additions.join(",")}`);
      setKeywordInput("");
      if (normalized === extraKeywords) return;
      clearCachedMonitor(monitorCacheKey(selectedGames, windowHours, normalized, activeTiebaBarsOverride, activeTiebaKeywordsOverride, tiebaScopeOverrideActive));
      if (extraKeywords) {
        clearCachedMonitor(monitorCacheKey(selectedGames, windowHours, extraKeywords, activeTiebaBarsOverride, activeTiebaKeywordsOverride, tiebaScopeOverrideActive));
      }
      setExtraKeywords(normalized);
    },
    [activeTiebaBarsOverride, activeTiebaKeywordsOverride, extraKeywords, keywordInput, selectedGames, tiebaScopeOverrideActive, windowHours]
  );

  const clearExtraKeywords = React.useCallback(() => {
    if (!extraKeywords) return;
    clearCachedMonitor(monitorCacheKey(selectedGames, windowHours, extraKeywords, activeTiebaBarsOverride, activeTiebaKeywordsOverride, tiebaScopeOverrideActive));
    clearCachedMonitor(monitorCacheKey(selectedGames, windowHours, "", activeTiebaBarsOverride, activeTiebaKeywordsOverride, tiebaScopeOverrideActive));
    setExtraKeywords("");
  }, [activeTiebaBarsOverride, activeTiebaKeywordsOverride, extraKeywords, selectedGames, tiebaScopeOverrideActive, windowHours]);

  const removeExtraKeyword = React.useCallback(
    (keyword: string) => {
      const normalizedKeyword = keyword.toLowerCase();
      const remaining = splitSupplementalKeywords(extraKeywords).filter((item) => item.toLowerCase() !== normalizedKeyword);
      const normalized = normalizeSupplementalKeywordText(remaining.join(","));
      if (normalized === extraKeywords) return;
      clearCachedMonitor(monitorCacheKey(selectedGames, windowHours, extraKeywords, activeTiebaBarsOverride, activeTiebaKeywordsOverride, tiebaScopeOverrideActive));
      clearCachedMonitor(monitorCacheKey(selectedGames, windowHours, normalized, activeTiebaBarsOverride, activeTiebaKeywordsOverride, tiebaScopeOverrideActive));
      setExtraKeywords(normalized);
    },
    [activeTiebaBarsOverride, activeTiebaKeywordsOverride, extraKeywords, selectedGames, tiebaScopeOverrideActive, windowHours]
  );

  const addScopeBars = React.useCallback((gameId: string) => {
    const additions = splitSupplementalKeywords(scopeBarDraftByGame[gameId] || "");
    if (!additions.length) return;
    setScopeBarsInputByGame((current) => ({
      ...current,
      [gameId]: mergeScopeInputText(current[gameId] || "", additions)
    }));
    setScopeBarDraftByGame((current) => ({ ...current, [gameId]: "" }));
  }, [scopeBarDraftByGame]);

  const addScopeKeywords = React.useCallback((gameId: string) => {
    const additions = splitSupplementalKeywords(scopeKeywordDraftByGame[gameId] || "");
    if (!additions.length) return;
    setScopeKeywordsInputByGame((current) => ({
      ...current,
      [gameId]: mergeScopeInputText(current[gameId] || "", additions)
    }));
    setScopeKeywordDraftByGame((current) => ({ ...current, [gameId]: "" }));
  }, [scopeKeywordDraftByGame]);

  const removeScopeKeyword = React.useCallback((gameId: string, value: string) => {
    setScopeKeywordsInputByGame((current) => ({
      ...current,
      [gameId]: removeScopeInputValue(current[gameId] || "", value)
    }));
  }, []);

  const filteredItems = React.useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return (data?.items || []).filter((item) => {
      if (source !== "all" && item.source !== source) return false;
      if (risk !== "all" && item.riskLevel !== risk) return false;
      if (sentiment !== "all" && item.sentiment !== sentiment) return false;
      if (topic !== "all" && !item.topics.includes(topic)) return false;
      if (!keyword) return true;
      return `${item.title} ${item.summary} ${item.author} ${item.keywords.join(" ")} ${item.riskReasons.join(" ")}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [data?.items, query, risk, sentiment, source, topic]);
  const searchActive = query.trim().length > 0;
  const monitorJudgementPending = loading && !searchActive;
  const visibleRiskBacktest: MonitorResponse["riskBacktest"] | undefined = monitorJudgementPending
    ? { status: "running", message: "回测中" }
    : data?.riskBacktest;
  const searchResults = searchData?.items || [];
  const feedItemsTotal = monitorJudgementPending ? 0 : searchActive ? searchResults.length : filteredItems.length;
  const visibleFeedCount = Math.min(visibleItemLimit, feedItemsTotal);
  const visibleSearchResults = searchActive ? searchResults.slice(0, visibleItemLimit) : [];
  const visibleFilteredItems = searchActive || monitorJudgementPending ? [] : filteredItems.slice(0, visibleItemLimit);
  const selectedAlert = React.useMemo(
    () => (monitorJudgementPending ? undefined : (data?.alerts || []).find((alert) => alert.id === selectedAlertId)),
    [data?.alerts, monitorJudgementPending, selectedAlertId]
  );
  const selectedAlertItem = React.useMemo(
    () => (selectedAlert ? (data?.items || []).find((item) => item.id === selectedAlert.id) : undefined),
    [data?.items, selectedAlert]
  );

  React.useEffect(() => {
    setVisibleItemLimit(feedInitialLimit);
  }, [activeTiebaBarsOverride, activeTiebaKeywordsOverride, data?.generatedAt, extraKeywords, query, risk, searchActive, searchData?.generatedAt, sentiment, source, topic]);

  React.useEffect(() => {
    if (selectedAlertId && data?.alerts && !data.alerts.some((alert) => alert.id === selectedAlertId)) {
      setSelectedAlertId("");
    }
  }, [data?.alerts, selectedAlertId]);

  const visiblePolicy = data?.updatePolicy || config?.updatePolicy;
  const monitorTitle = React.useMemo(() => makeMonitorTitle(config?.games || []), [config?.games]);
  React.useEffect(() => {
    document.title = monitorTitle;
  }, [monitorTitle]);
  const gameOptions = React.useMemo(() => {
    const configuredGames = config?.games || [];
    if (configuredGames.length <= 1) {
      return configuredGames.map((game) => ({ key: game.id, label: game.shortName, ids: [game.id] }));
    }
    return [
      { key: "all", label: "全部", ids: configuredGameIds },
      ...configuredGames.map((game) => ({ key: game.id, label: game.shortName, ids: [game.id] }))
    ];
  }, [config?.games, configuredGameIds]);
  const activeExtraKeywords = React.useMemo(() => splitSupplementalKeywords(extraKeywords), [extraKeywords]);
  const defaultKeywordGroups = React.useMemo(() => defaultKeywordGroupsForGames(selectedGameConfigs), [selectedGameConfigs]);
  const keywordEffectivenessByKeyword = React.useMemo(
    () => new Map((data?.keywordEffectiveness || []).map((entry) => [entry.keyword.toLowerCase(), entry])),
    [data?.keywordEffectiveness]
  );
  const tiebaScopeSummary = React.useMemo(
    () => makeTiebaScopeSummary(selectedGameConfigs, tiebaScopeOverrideActive, activeTiebaBarsByGame),
    [activeTiebaBarsByGame, selectedGameConfigs, tiebaScopeOverrideActive]
  );
  const keywordEntryActive = activeExtraKeywords.length > 0 || tiebaScopeSummary.overridden;
  const keywordEntryBadgeCount = activeExtraKeywords.length + (tiebaScopeSummary.overridden ? 1 : 0);
  const canApplyScope = selectedGameConfigs.length > 0;
  const removeScopeBar = React.useCallback(
    (game: GameConfig, value: string) => {
      if (scopeValueInList(value, game.tiebaBars || [])) return;
      setScopeBarsInputByGame((current) => ({
        ...current,
        [game.id]: removeScopeInputValue(current[game.id] || "", value)
      }));
    },
    []
  );
  const topicOptions = React.useMemo(() => makeTopicOptions(data?.items || []), [data?.items]);
  const maxTopicCount = React.useMemo(
    () => Math.max(0, ...(data?.topicStats || []).map((topic) => topic.count)),
    [data?.topicStats]
  );
  const selectGames = React.useCallback(
    (gameIds: GameId[]) => {
      const sameSelection = sameGameSelection(selectedGames, gameIds);
      resetFeedFilters();
      clearCachedMonitor(monitorCacheKey(gameIds, windowHours, extraKeywords, activeTiebaBarsOverride, activeTiebaKeywordsOverride, tiebaScopeOverrideActive));
      if (sameSelection) {
        void load(true);
        return;
      }
      setSelectedGames(gameIds);
    },
    [activeTiebaBarsOverride, activeTiebaKeywordsOverride, extraKeywords, load, resetFeedFilters, selectedGames, tiebaScopeOverrideActive, windowHours]
  );
  const selectWindowHours = React.useCallback(
    (hours: number) => {
      if (windowHours === hours) return;
      resetFeedFilters();
      setWindowHours(hours);
    },
    [resetFeedFilters, windowHours]
  );
  const jumpToFeed = React.useCallback(
    (filters?: { source?: "all" | SourceType; risk?: "all" | RiskLevel; sentiment?: "all" | Sentiment }) => {
      setSource(filters?.source ?? "all");
      setRisk(filters?.risk ?? "all");
      setSentiment(filters?.sentiment ?? "all");
      setTopic("all");
      setQuery("");
      scrollToSearchResults();
    },
    []
  );
  const selectTopicFromDistribution = React.useCallback((topicName: string) => {
    setSource("all");
    setRisk("all");
    setSentiment("all");
    setTopic(topicName);
    setQuery("");
    scrollToSearchResults();
  }, []);
  const jumpToAlerts = React.useCallback(() => {
    setRisk("high");
    setSource("all");
    setSentiment("all");
    setTopic("all");
    setQuery("");
    window.requestAnimationFrame(() => document.getElementById("risk-alerts")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  const openKeywordPanel = React.useCallback(() => {
    setScopeBarsInputByGame(Object.fromEntries(selectedGameConfigs.map((game) => {
      const editableBars = mergeScopeValues(game.tiebaBars || [], splitSupplementalKeywords(activeTiebaBarsByGame[game.id] || ""));
      return [game.id, editableBars.join(",")];
    })));
    setScopeKeywordsInputByGame(Object.fromEntries(selectedGameConfigs.map((game) => [game.id, activeTiebaKeywordsByGame[game.id] || ""])));
    setScopeBarDraftByGame({});
    setScopeKeywordDraftByGame({});
    setKeywordPanelOpen(true);
  }, [activeTiebaBarsByGame, activeTiebaKeywordsByGame, selectedGameConfigs]);

  const applyScopePanel = React.useCallback(
    (event?: React.FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const nextBarsByGame: TiebaScopeTextMap = {};
      const nextKeywordsByGame: TiebaScopeTextMap = {};
      const nextEditorBarsByGame: TiebaScopeTextMap = {};
      for (const game of selectedGameConfigs) {
        const configuredBarsForGame = game.tiebaBars || [];
        const nextBarValues = mergeScopeValues(configuredBarsForGame, splitSupplementalKeywords(scopeBarsInputByGame[game.id] || ""));
        const supplementalBars = nextBarValues.filter((bar) => !scopeValueInList(bar, configuredBarsForGame));
        const nextKeywords = normalizeSupplementalKeywordText(scopeKeywordsInputByGame[game.id] || "");
        nextEditorBarsByGame[game.id] = nextBarValues.join(",");
        if (supplementalBars.length) nextBarsByGame[game.id] = normalizeSupplementalKeywordText(supplementalBars.join(","));
        if (supplementalBars.length && nextKeywords) nextKeywordsByGame[game.id] = nextKeywords;
      }
      const nextOverrideBars = scopeTextMapCacheKey(nextBarsByGame);
      const nextOverrideKeywords = scopeTextMapCacheKey(nextKeywordsByGame);
      const nextOverrideActive = scopeTextMapHasValues(nextBarsByGame) || scopeTextMapHasValues(nextKeywordsByGame);
      clearCachedMonitor(monitorCacheKey(selectedGames, windowHours, extraKeywords, activeTiebaBarsOverride, activeTiebaKeywordsOverride, tiebaScopeOverrideActive));
      clearCachedMonitor(monitorCacheKey(selectedGames, windowHours, extraKeywords, nextOverrideBars, nextOverrideKeywords, nextOverrideActive));
      resetFeedFilters();
      setTiebaScopeOverrideActive(nextOverrideActive);
      setTiebaBarsByGameOverride(nextBarsByGame);
      setTiebaKeywordsByGameOverride(nextKeywordsByGame);
      setLegacyTiebaBarsOverride("");
      setLegacyTiebaKeywordsOverride("");
      setScopeBarsInputByGame(nextEditorBarsByGame);
      setScopeKeywordsInputByGame(nextKeywordsByGame);
      setScopeBarDraftByGame({});
      setScopeKeywordDraftByGame({});
    },
    [
      activeTiebaBarsOverride,
      activeTiebaKeywordsOverride,
      extraKeywords,
      resetFeedFilters,
      scopeBarsInputByGame,
      scopeKeywordsInputByGame,
      selectedGameConfigs,
      selectedGames,
      tiebaScopeOverrideActive,
      windowHours
    ]
  );

  const restoreConfiguredScope = React.useCallback(() => {
    clearCachedMonitor(monitorCacheKey(selectedGames, windowHours, extraKeywords, activeTiebaBarsOverride, activeTiebaKeywordsOverride, tiebaScopeOverrideActive));
    clearCachedMonitor(monitorCacheKey(selectedGames, windowHours, extraKeywords, "", "", false));
    setTiebaScopeOverrideActive(false);
    setTiebaBarsByGameOverride({});
    setTiebaKeywordsByGameOverride({});
    setLegacyTiebaBarsOverride("");
    setLegacyTiebaKeywordsOverride("");
    setScopeBarsInputByGame(Object.fromEntries(selectedGameConfigs.map((game) => [game.id, (game.tiebaBars || []).join(",")])));
    setScopeKeywordsInputByGame(Object.fromEntries(selectedGameConfigs.map((game) => [game.id, ""])));
    setScopeBarDraftByGame({});
    setScopeKeywordDraftByGame({});
  }, [activeTiebaBarsOverride, activeTiebaKeywordsOverride, extraKeywords, selectedGameConfigs, selectedGames, tiebaScopeOverrideActive, windowHours]);

  return (
    <>
    <a className="skip-link" href="#main-content">跳到主体内容</a>
    <main className="app-shell" id="main-content">
      <section className="topbar">
        <div>
          <p className="eyebrow">Live Monitor</p>
          <h1>{monitorTitle}</h1>
        </div>
        <div className="top-actions">
          <RuntimeStatusTray
            timestampText={monitorJudgementPending ? "回测中" : data ? formatDateTime(data.generatedAt) : "等待采集"}
            riskBacktest={visibleRiskBacktest}
            updatePolicy={visiblePolicy}
            douyinStatus={douyinStatus}
            bettafishCapabilities={data?.bettafishCapabilities || []}
          />
          <button className="icon-button primary" type="button" onClick={() => load(true)} disabled={loading} title="强制刷新" aria-label="强制刷新舆情看板">
            <RefreshCw size={18} className={loading ? "spin" : ""} aria-hidden="true" />
          </button>
        </div>
      </section>

      <div className="control-sentinel" ref={controlSentinelRef} aria-hidden="true" />
      <section className={`control-band ${isControlFloating ? "is-floating" : ""}`}>
        <div className={`segmented ${gameOptions.length === 1 ? "single" : ""}`}>
          {gameOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              className={sameGameSelection(selectedGames, option.ids) ? "active" : ""}
              aria-pressed={sameGameSelection(selectedGames, option.ids)}
              onClick={() => selectGames(option.ids)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>窗口</span>
          <select name="monitor-window" value={windowHours} onChange={(event) => selectWindowHours(Number(event.target.value))}>
            <option value={24}>24 小时</option>
            <option value={72}>72 小时</option>
            <option value={168}>7 天</option>
            <option value={336}>14 天</option>
          </select>
        </label>
        <label className="field search-field">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">搜索舆情条目</span>
          <input
            name="monitor-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题、作者、关键词，例如 外挂…"
            autoComplete="off"
          />
        </label>
        <div className="keyword-entry">
          <button
            className={`keyword-entry-button ${keywordEntryActive ? "active" : ""}`}
            type="button"
            onClick={openKeywordPanel}
            aria-haspopup="dialog"
            aria-controls="keyword-panel"
            aria-expanded={keywordPanelOpen}
            title="管理关键词和贴吧采集范围"
          >
            <Tags size={16} aria-hidden="true" />
            <span>关键词 / 范围</span>
            {keywordEntryBadgeCount ? <b>{keywordEntryBadgeCount}</b> : null}
          </button>
        </div>
      </section>

      {keywordPanelOpen ? (
        <div className="keyword-panel-backdrop" role="presentation" onMouseDown={() => setKeywordPanelOpen(false)}>
          <section
            id="keyword-panel"
            className="keyword-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="keyword-panel-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="keyword-panel-head">
              <div>
                <h2 id="keyword-panel-title">要找什么，去哪里找</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setKeywordPanelOpen(false)} title="关闭" aria-label="关闭关键词与贴吧范围">
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="keyword-panel-body">
              <KeywordScopeGuide />
              <DefaultKeywordOverview groups={defaultKeywordGroups} />
              <form className="keyword-panel-add" onSubmit={addExtraKeywords}>
                <label className="field">
                  <Tags size={16} aria-hidden="true" />
                  <span>1 补充全平台关注词</span>
                  <input
                    name="supplemental-keywords"
                    value={keywordInput}
                    onChange={(event) => setKeywordInput(event.target.value)}
                    autoComplete="off"
                    autoFocus
                  />
                </label>
                <button className="keyword-add-button" type="submit">
                  <Plus size={16} aria-hidden="true" />
                  加入关注
                </button>
              </form>
              {activeExtraKeywords.length ? (
                <div className="keyword-panel-list">
                  {activeExtraKeywords.map((keyword) => {
                    const effectiveness = keywordEffectivenessByKeyword.get(keyword.toLowerCase());
                    return (
                      <div className={`keyword-row ${effectiveness?.status || "pending"}`} key={keyword}>
                        <div className="keyword-row-name">
                          <strong>{keyword}</strong>
                          <span>{keywordEffectivenessLabel(effectiveness)}</span>
                        </div>
                        <div className="keyword-row-meta">
                          <span>{keywordEffectivenessSourceText(effectiveness)}</span>
                          <span>{keywordRiskSummary(effectiveness)}</span>
                        </div>
                        <button type="button" onClick={() => removeExtraKeyword(keyword)} title={`移除 ${keyword}`} aria-label={`移除 ${keyword}`}>
                          <X size={15} aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="keyword-empty-divider" aria-hidden="true" />
              )}
              {activeExtraKeywords.length ? (
                <div className="keyword-panel-actions">
                  <button type="button" onClick={clearExtraKeywords}>清空全部</button>
                </div>
              ) : null}

              <section className="keyword-scope-section" aria-label="贴吧采集范围">
                <div className="keyword-section-head">
                  <div>
                    <p className="eyebrow">贴吧专属范围</p>
                    <h3>贴吧只去这些吧里找</h3>
                    <p>这里仅影响贴吧采集；B站、抖音等来源仍使用全平台关注词。</p>
                  </div>
                </div>
                <ScopeRail
                  games={selectedGameConfigs}
                  tiebaScopeOverrideActive={tiebaScopeOverrideActive}
                  tiebaBarsByGame={activeTiebaBarsByGame}
                  tiebaKeywordsByGame={activeTiebaKeywordsByGame}
                />
                <form className="scope-panel-form" onSubmit={applyScopePanel}>
                  {selectedGameConfigs.map((game) => {
                    const configuredBarsForGame = game.tiebaBars || [];
                    const editorBars = splitSupplementalKeywords(scopeBarsInputByGame[game.id] || configuredBarsForGame.join(","));
                    const editorKeywords = splitSupplementalKeywords(scopeKeywordsInputByGame[game.id] || "");
                    return (
                      <section className="scope-game-editor" key={game.id}>
                        <div className="scope-game-editor-head">
                          <strong>{game.shortName || game.name}</strong>
                          <span>默认吧全量读取；补充来源按本看板默认关键词过滤。</span>
                        </div>
                        <div className="scope-game-editor-grid">
                          <ScopeEditorField
                            icon="source"
                            title="贴吧来源"
                            description="只填贴吧名；默认来源不可删除，新增来源只对当前看板生效。"
                            values={editorBars}
                            emptyLabel="未选择贴吧来源"
                            draft={scopeBarDraftByGame[game.id] || ""}
                            placeholder=""
                            addLabel="添加来源"
                            lockedValues={configuredBarsForGame}
                            onDraftChange={(value) => setScopeBarDraftByGame((current) => ({ ...current, [game.id]: value }))}
                            onAdd={() => addScopeBars(game.id)}
                            onRemove={(value) => removeScopeBar(game, value)}
                          />
                          <ScopeEditorField
                            icon="keyword"
                            title="补充来源匹配词"
                            description="只用于当前看板新增的贴吧来源；会和本看板全平台默认关键词一起过滤补充来源。"
                            values={editorKeywords}
                            emptyLabel="无补充来源匹配词"
                            draft={scopeKeywordDraftByGame[game.id] || ""}
                            placeholder=""
                            addLabel="添加词"
                            onDraftChange={(value) => setScopeKeywordDraftByGame((current) => ({ ...current, [game.id]: value }))}
                            onAdd={() => addScopeKeywords(game.id)}
                            onRemove={(value) => removeScopeKeyword(game.id, value)}
                          />
                        </div>
                      </section>
                    );
                  })}
                  <div className="scope-panel-actions">
                    <button className="keyword-add-button" type="submit" disabled={!canApplyScope}>
                      <Database size={16} aria-hidden="true" />
                      应用采集范围
                    </button>
                    {tiebaScopeSummary.overridden ? (
                      <button className="scope-restore-button" type="button" onClick={restoreConfiguredScope}>恢复配置</button>
                    ) : null}
                  </div>
                </form>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {error || searchError ? <div className="error-strip" role="alert" aria-live="polite">{error || searchError}</div> : null}

      <section className="metrics-grid">
        <Metric label="总声量" value={monitorJudgementPending ? "回测中" : data?.stats.total ?? 0} tone="green" hint={monitorJudgementPending ? "回测完成后显示" : "跳到全部条目"} onClick={monitorJudgementPending ? undefined : () => jumpToFeed()} />
        <Metric label="高风险" value={monitorJudgementPending ? "回测中" : data?.stats.highRisk ?? 0} tone="red" hint={monitorJudgementPending ? "回测完成后显示" : "跳到高风险预警"} onClick={monitorJudgementPending ? undefined : jumpToAlerts} />
        <Metric
          label="负面占比"
          value={monitorJudgementPending ? "回测中" : `${Math.round((data?.stats.negativeRate ?? 0) * 100)}%`}
          tone="gold"
          hint={monitorJudgementPending ? "回测完成后显示" : "筛选负面条目"}
          onClick={monitorJudgementPending ? undefined : () => jumpToFeed({ sentiment: "negative" })}
        />
        <Metric
          label="B站 / 贴吧 / 抖音"
          tone="blue"
          hint={monitorJudgementPending ? "回测完成后显示" : "分别跳到来源条目"}
          value={
            monitorJudgementPending ? "回测中" : <span className="split-metric">
              <button type="button" aria-label="筛选 B站条目" onClick={() => jumpToFeed({ source: "bilibili" })}>{data?.stats.bilibili ?? 0}</button>
              <i>/</i>
              <button type="button" aria-label="筛选贴吧条目" onClick={() => jumpToFeed({ source: "tieba" })}>{data?.stats.tieba ?? 0}</button>
              <i>/</i>
              <button type="button" aria-label="筛选抖音条目" onClick={() => jumpToFeed({ source: "douyin" })}>{data?.stats.douyin ?? 0}</button>
            </span>
          }
        />
      </section>

      <section className={`workspace-grid ${trendOpen ? "trend-open" : "trend-collapsed"}`}>
        <details className="chart-area trend-details" open={trendOpen} onToggle={(event) => setTrendOpen(event.currentTarget.open)}>
          <summary className="chart-collapse-summary">
            <div className="section-title">
              <Waves size={18} aria-hidden="true" />
              <h2>声量趋势</h2>
            </div>
            <span>{trendOpen ? "已展开 · 点击收起" : "默认收起 · 点击展开"}</span>
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          {trendOpen ? (
            <div className="trend-details-body">
              <div className="trend-chart-panel">
                <div className="chart-legend" aria-label="声量趋势筛选">
                  <TrendLegendButton series="negative" label="负面" active={trendSeries.negative} onToggle={toggleTrendSeries} />
                  <TrendLegendButton series="neutral" label="中性" active={trendSeries.neutral} onToggle={toggleTrendSeries} />
                  <TrendLegendButton series="positive" label="正面" active={trendSeries.positive} onToggle={toggleTrendSeries} />
                  <TrendLegendButton series="total" label="总声量折线" active={trendSeries.total} onToggle={toggleTrendSeries} />
                  <small>柱子=情绪构成 · 折线=平滑趋势</small>
                </div>
                <TrendChart data={data?.trends || []} visibleSeries={trendSeries} />
              </div>
              <div className="topic-area trend-topic-area">
                <div className="section-title">
                  <Filter size={18} aria-hidden="true" />
                  <h2>主题分布</h2>
                </div>
                <div className="topic-list">
                  {(data?.topicStats || []).map((entry) => (
                    <div className={`topic-row ${topic === entry.topic ? "active" : ""}`} key={entry.topic}>
                      <button
                        type="button"
                        className="topic-button"
                        aria-pressed={topic === entry.topic}
                        title={`筛选主题：${entry.topic}`}
                        onClick={() => selectTopicFromDistribution(entry.topic)}
                      >
                        {entry.topic}
                      </button>
                      <div className="topic-bar">
                        <i style={{ width: `${topicBarWidthPercent(entry.count, maxTopicCount)}%` }} />
                      </div>
                      <b>{entry.count}</b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </details>
      </section>

      <section className="alert-band" id="risk-alerts">
        <div className="section-title">
          <ShieldAlert size={18} aria-hidden="true" />
          <h2>风险预警</h2>
        </div>
        <div className="alert-list">
          {monitorJudgementPending ? (
            <p className="empty">回测中</p>
          ) : (data?.alerts || []).length ? (
            data?.alerts.map((alert) => (
              <RiskAlertCard
                alert={alert}
                active={selectedAlertId === alert.id}
                onShowDetails={() => setSelectedAlertId((current) => (current === alert.id ? "" : alert.id))}
                key={alert.id}
              />
            ))
          ) : (
            <p className="empty">暂无中高风险条目</p>
          )}
        </div>
        {selectedAlert ? (
          <RiskAlertDetail alert={selectedAlert} item={selectedAlertItem} onClose={() => setSelectedAlertId("")} />
        ) : null}
      </section>

      <section className="feed-toolbar" id="latest-feed">
        <div>
          <h2>{searchActive ? "搜索结果" : "最新条目"}</h2>
          <p>
            {searchActive
              ? searchData
                ? `近 30 天命中 ${searchData.totalMatched} 条 · 当前显示 ${visibleFeedCount}/${feedItemsTotal} 条 · ${searchData.sources.map((entry) => entry.message).join(" / ")}`
                : searchLoading
                  ? "检索中…"
                  : "等待检索"
              : data
                ? monitorJudgementPending
                  ? "回测中"
                  : `仅显示 ${formatDateTime(data.freshnessCutoff)} 之后的信息 · 当前显示 ${visibleFeedCount}/${feedItemsTotal} 条`
                : "等待数据"}
          </p>
        </div>
        <div className="filters">
          <select name="source-filter" aria-label="筛选来源" value={source} onChange={(event) => setSource(event.target.value as SourceFilter)}>
            <option value="all">全部来源</option>
            <option value="bilibili">B站</option>
            <option value="tieba">贴吧</option>
            <option value="douyin">抖音</option>
            <option value="bettafish">BettaFish</option>
          </select>
          <select name="risk-filter" aria-label="筛选风险" value={risk} onChange={(event) => setRisk(event.target.value as RiskFilter)}>
            <option value="all">全部风险</option>
            <option value="high">高风险</option>
            <option value="medium">中风险</option>
            <option value="low">低风险</option>
          </select>
          <select name="sentiment-filter" aria-label="筛选情绪" value={sentiment} onChange={(event) => setSentiment(event.target.value as SentimentFilter)}>
            <option value="all">全部情绪</option>
            <option value="negative">负面</option>
            <option value="mixed">混合</option>
            <option value="neutral">中性</option>
            <option value="positive">正面</option>
          </select>
          <select name="topic-filter" aria-label="筛选主题" value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="all">全部主题</option>
            {topicOptions.map((option) => (
              <option value={option.topic} key={option.topic}>{`${option.topic} ${option.count}`}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="feed-list">
        {monitorJudgementPending ? <p className="empty">回测中</p> : null}
        {searchActive && searchLoading ? <p className="empty">检索中…</p> : null}
        {!monitorJudgementPending && searchActive
          ? visibleSearchResults.map((result, index) => (
              <MonitorCard item={result.item} searchResult={result} highlightQuery={query} key={`${result.origin}-${result.item.id}-${index}`} />
            ))
          : null}
        {!monitorJudgementPending && !searchActive
          ? visibleFilteredItems.map((item) => (
              <MonitorCard item={item} key={item.id} />
            ))
          : null}
        {feedItemsTotal > visibleFeedCount ? (
          <button className="load-more-button" type="button" onClick={() => setVisibleItemLimit((limit) => limit + feedBatchSize)}>
            加载更多 {Math.min(feedBatchSize, feedItemsTotal - visibleFeedCount)} 条
          </button>
        ) : null}
        {!searchActive && !loading && data && filteredItems.length === 0 ? <p className="empty">当前筛选下没有新鲜条目</p> : null}
        {searchActive && !searchLoading && searchData && searchResults.length === 0 ? <p className="empty">未找到匹配条目</p> : null}
      </section>
    </main>
    </>
  );
}

function BettaFishLabPage({ windowHours }: { windowHours: number }) {
  const [data, setData] = React.useState<BettaFishLabResponse>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [actionLoading, setActionLoading] = React.useState("");
  const [actionResult, setActionResult] = React.useState<BettaFishActionResponse>();

  const loadLab = React.useCallback(async (forceMonitor = false) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        windowHours: String(windowHours),
        sampleLimit: "4",
        monitorLimit: "80",
        ...(forceMonitor ? { forceMonitor: "1" } : {})
      });
      const response = await fetch(`${api.bettafishLab}?${params.toString()}`);
      if (!response.ok) throw new Error(`API ${response.status}`);
      setData((await response.json()) as BettaFishLabResponse);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [windowHours]);

  const runAction = React.useCallback(
    async (payload: Record<string, unknown>) => {
      const action = String(payload.action || "");
      setActionLoading(action);
      setError("");
      try {
        const response = await fetch(api.bettafishLabAction, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const result = (await response.json()) as BettaFishActionResponse;
        setActionResult(result);
        if (!response.ok || !result.ok) setError(result.message || `Action ${response.status}`);
        await loadLab();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setActionLoading("");
      }
    },
    [loadLab]
  );

  React.useEffect(() => {
    loadLab(false);
  }, [loadLab]);

  const totalRows = data ? Math.max(0, ...data.importPreviews.map((preview) => preview.rowCount)) : 0;
  const totalItems = data?.importPreviews.reduce((sum, preview) => sum + preview.matchedItems, 0) ?? 0;
  const totalMonitorItems = data?.gameMonitors.reduce((sum, monitor) => sum + (monitor.response?.stats.total ?? 0), 0) ?? 0;
  const totalMonitorAlerts = data?.gameMonitors.reduce((sum, monitor) => sum + (monitor.response?.stats.highRisk ?? 0), 0) ?? 0;
  const reachableEndpoints = data?.endpointProbes.filter((probe) => probe.status === "ok").length ?? 0;
  const readyCapabilities = data?.capabilities.filter((capability) => capability.status === "ok").length ?? 0;

  return (
    <div className="lab-page">
      <section className="lab-head">
        <div>
          <p className="eyebrow">BettaFish Lab</p>
          <h2>BettaFish 测试台</h2>
          <p>
            {data
              ? `隔离测试模式 · ${data.baseUrlConfigured ? data.baseUrl : "未配置 BettaFish Base URL"} · 监控 ${totalMonitorItems} 条 · 导入目录 ${data.importDir}`
              : "准备读取 BettaFish 测试状态，并解释指标、组件和操作的用途"}
          </p>
        </div>
        <div className="lab-actions">
          {data ? <StatusPill status={data.baseUrlConfigured ? "ok" : "skipped"} label={data.baseUrlConfigured ? "外部服务已配置" : "仅导入预览"} /> : null}
          <InteractionBadge mode="interactive" label="可刷新" />
          <button
            className="icon-button primary"
            type="button"
            onClick={() => loadLab(true)}
            disabled={loading}
            title="刷新测试台和舆情监控"
            aria-label="刷新测试台和舆情监控"
          >
            <RefreshCw size={18} className={loading ? "spin" : ""} aria-hidden="true" />
          </button>
        </div>
      </section>

      {error ? <div className="error-strip" role="alert" aria-live="polite">{error}</div> : null}

      <BettaFishGlossaryPanel />

      <CollapsibleDisplaySection
        title="展示概览"
        icon={<Info size={18} aria-hidden="true" />}
        note="这些数字只说明当前测试状态，不会触发任何操作。默认收起，展开后查看监控条目、导入命中、端点和测试窗口。"
        className="lab-overview"
        badges={<InteractionBadge mode="display" label="展示概览" />}
      >
        <div className="metrics-grid lab-metrics">
          <Metric label="监控条目" value={totalMonitorItems} tone="green" hint={`${totalMonitorAlerts} 条高风险 · 复用主看板采集`} />
          <Metric label="导入命中" value={totalItems} tone="green" hint={`${totalRows} 行外部导出里匹配项目关键词`} />
          <Metric label="只读端点" value={`${reachableEndpoints}/${data?.endpointProbes.length ?? 0}`} tone="blue" hint="只检查状态，不触发搜索/爬虫/报告" />
          <Metric label="能力就绪" value={`${readyCapabilities}/${data?.capabilities.length ?? 0}`} tone="gold" hint="已可测试的 BettaFish 能力" />
          <Metric label="测试窗口" value={`${data?.windowHours ?? windowHours}h`} tone="red" hint={data ? `只统计 ${formatDateTime(data.freshnessCutoff)} 之后` : "沿用看板窗口"} />
        </div>
      </CollapsibleDisplaySection>

      {!data && loading ? <p className="empty">读取 BettaFish 测试状态…</p> : null}

      {data ? (
        <>
          <LabGameMonitorSection monitors={data.gameMonitors} loading={loading} onRefresh={() => loadLab(true)} />

          <LabActionPanel data={data} loadingAction={actionLoading} actionResult={actionResult} onAction={runAction} />

          <CollapsibleDisplaySection
            title="能力说明与测试覆盖"
            icon={<Plug size={18} aria-hidden="true" />}
            note="每张卡片说明一个 BettaFish 能力：它是什么、当前在本平台怎么用、测试台能覆盖哪些检查，以及下一步该验证什么。"
            className="lab-section"
          >
            <div className="capability-grid">
              {data.capabilities.map((capability) => (
                <CapabilityCard capability={capability} key={capability.id} />
              ))}
            </div>
          </CollapsibleDisplaySection>

          <CollapsibleDisplaySection
            title="导入解析测试"
            icon={<Database size={18} aria-hidden="true" />}
            note="这里只读取授权导出和轻量 JSON 文本，验证外部数据能否被解析、匹配项目关键词并进入统一风险分析。"
            className="lab-section"
          >
            <div className="import-grid">
              {data.importPreviews.map((preview) => (
                <div className="import-preview display-card" key={preview.gameId}>
                  <div className="import-preview-head">
                    <div>
                      <strong>{preview.gameName}</strong>
                      <span>{preview.fileCount} 文件 · {preview.rowCount} 行 · 旧 {preview.staleDropped}</span>
                    </div>
                    <StatusPill status={preview.matchedItems ? "ok" : preview.rowCount ? "warning" : "skipped"} label={`${preview.matchedItems} 命中`} />
                  </div>
                  {preview.errors.length ? (
                    <div className="lab-warning-list">
                      {preview.errors.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="lab-sample-list">
                    {preview.samples.length ? (
                      preview.samples.map((item) => <LabItemRow item={item} key={item.id} />)
                    ) : (
                      <p className="empty compact">暂无可展示样本</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleDisplaySection>

          <CollapsibleDisplaySection
            title="只读端点探测"
            icon={<FileText size={18} aria-hidden="true" />}
            note="只读端点用于检查 BettaFish 是否在线、日志或模板是否可读，不会启动 Agent、爬虫或报告任务；有外链图标的行可以打开端点查看原始响应。"
            className="lab-section"
            badges={
              <>
                <InteractionBadge mode="display" label="展示为主" />
                <InteractionBadge mode="link" label="外链可打开" />
              </>
            }
          >
            <div className="endpoint-list">
              {data.endpointProbes.map((probe) => (
                <div className="endpoint-row display-card" key={probe.id}>
                  <div>
                    <strong>{probe.label}</strong>
                    <span>{probe.method} {probe.path}</span>
                  </div>
                  <p>{probe.message}</p>
                  <div className="endpoint-side">
                    <StatusPill status={probe.status} />
                    <span>{probe.latencyMs} ms</span>
                    {probe.target ? (
                      <a href={probe.target} target="_blank" rel="noreferrer" title="打开 BettaFish 端点">
                        <ExternalLink size={16} aria-hidden="true" />
                        <span>可打开</span>
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleDisplaySection>

          <CollapsibleDisplaySection
            title="接入建议"
            icon={<ShieldAlert size={18} aria-hidden="true" />}
            note="这里汇总测试台根据当前配置、端点和导入状态给出的下一步建议。"
            className="lab-section recommendations"
          >
            <div className="recommendation-list">
              {data.recommendations.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </CollapsibleDisplaySection>
        </>
      ) : null}
    </div>
  );
}

function BettaFishGlossaryPanel() {
  return (
    <CollapsibleDisplaySection
      title="术语说明"
      icon={<Info size={18} aria-hidden="true" />}
      note="先看这里再操作：测试台把 BettaFish 当作外部研究系统，每个名词都标清含义和在当前流程里的作用。"
      className="lab-glossary"
    >
      <div className="glossary-grid">
        {bettaFishGlossaryGroups.map((group) => (
          <article className="glossary-group display-card" key={group.title}>
            <h3>{group.title}</h3>
            <dl>
              {group.terms.map((item) => (
                <div key={item.term}>
                  <dt>{item.term}</dt>
                  <dd><b>含义</b>{item.meaning}</dd>
                  <dd><b>作用</b>{item.role}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </CollapsibleDisplaySection>
  );
}

function CollapsibleDisplaySection({
  title,
  icon,
  note,
  className = "",
  badges,
  children
}: {
  title: string;
  icon: React.ReactNode;
  note: string;
  className?: string;
  badges?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className={`display-collapse display-zone ${className}`}>
      <summary className="display-collapse-summary">
        <div className="display-collapse-copy">
          <div className="section-title display-collapse-title">
            {icon}
            <h2>{title}</h2>
            {badges || <InteractionBadge mode="display" label="展示信息" />}
          </div>
          <p className="section-note display-collapse-note">{note}</p>
        </div>
        <span className="display-collapse-control">
          <ChevronDown size={15} />
          <span className="when-closed">展开查看</span>
          <span className="when-open">收起</span>
        </span>
      </summary>
      <div className="display-collapse-body">{children}</div>
    </details>
  );
}

function InlineDisplayCollapse({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <details className="inline-display-collapse display-zone">
      <summary className="inline-display-summary">
        <div className="lab-zone-heading display-heading">
          <InteractionBadge mode="display" label={label} />
          <span>{note}</span>
        </div>
        <span className="display-collapse-control">
          <ChevronDown size={15} />
          <span className="when-closed">展开查看</span>
          <span className="when-open">收起</span>
        </span>
      </summary>
      <div className="display-collapse-body">{children}</div>
    </details>
  );
}

function InteractionBadge({ mode, label }: { mode: InteractionMode; label?: string }) {
  const Icon = mode === "display" ? Eye : mode === "link" ? ExternalLink : MousePointer2;
  const text = label || (mode === "display" ? "展示信息" : mode === "link" ? "可打开" : "可操作");
  return (
    <span className={`interaction-badge ${mode}`}>
      <Icon size={13} aria-hidden="true" />
      {text}
    </span>
  );
}

function LabGameMonitorSection({
  monitors,
  loading,
  onRefresh
}: {
  monitors: BettaFishGameMonitor[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="lab-section game-monitor-section interactive-zone">
      <div className="section-title monitor-section-title">
        <div>
          <Waves size={18} aria-hidden="true" />
          <h2>生死1 / 生死2 舆情监测</h2>
          <InteractionBadge mode="interactive" label="可刷新" />
        </div>
        <button className="lab-action-button manual compact-button" type="button" onClick={onRefresh} disabled={loading} title="刷新两个游戏的测试台监控快照">
          <RefreshCw size={13} className={loading ? "spin" : ""} aria-hidden="true" />
          <span>{loading ? "刷新中…" : "刷新监控"}</span>
        </button>
      </div>
      <p className="section-note">“刷新监控”会重新拉取两个游戏的测试快照；下方统计主要用于查看结果，风险预警和最新条目可打开原帖，不发送通知。</p>
      <div className="game-monitor-grid">
        {monitors.map((monitor) => (
          <LabGameMonitorCard monitor={monitor} key={monitor.gameId} />
        ))}
      </div>
    </section>
  );
}

function LabGameMonitorCard({ monitor }: { monitor: BettaFishGameMonitor }) {
  const response = monitor.response;
  const stats = response?.stats;
  const sourceIssues = response?.health.filter((entry) => !entry.ok || entry.blocked) ?? [];
  const latestItems = response?.items.slice(0, 5) ?? [];
  const alerts = response?.alerts.slice(0, 3) ?? [];
  const topics = response?.topicStats.slice(0, 6) ?? [];

  return (
    <article className={`game-monitor-card ${monitor.status}`}>
      <div className="game-monitor-head">
        <div>
          <h3>{monitor.gameName}</h3>
          <span>{monitor.message}</span>
        </div>
        <StatusPill status={monitor.status} />
      </div>

      {response && stats ? (
        <>
          <div className="game-monitor-summary">
            <GameMonitorStat label="总声量" value={stats.total} note="窗口内全部条目" />
            <GameMonitorStat label="高风险" value={stats.highRisk} note="优先复盘对象" />
            <GameMonitorStat label="负面占比" value={formatPercent(stats.negativeRate)} note="负面/总声量" />
            <GameMonitorStat label="BettaFish导入" value={stats.bettafish} note="授权导出条目" />
          </div>

          <div className="game-monitor-subgrid">
            <div className="game-monitor-block">
              <h4>来源健康</h4>
              <div className="source-health-list compact">
                {response.health.map((health) => (
                  <div className="source-health-row" key={`${monitor.gameId}-${health.source}-${health.gameId || "all"}`}>
                    <span>{health.sourceLabel}</span>
                    <b>{health.itemCount} 条</b>
                    <StatusPill status={health.ok && !health.blocked ? "ok" : "warning"} label={health.ok && !health.blocked ? "正常" : "需检查"} />
                  </div>
                ))}
              </div>
              {sourceIssues.length ? <p className="monitor-note">{sourceIssues.map((entry) => entry.message).join(" / ")}</p> : null}
            </div>

            <div className="game-monitor-block">
              <h4>主题分布</h4>
              <div className="topic-chip-row">
                {topics.length ? (
                  topics.map((topic) => (
                    <span key={topic.topic}>{topic.topic} {topic.count}</span>
                  ))
                ) : (
                  <span>暂无主题</span>
                )}
              </div>
            </div>
          </div>

          <div className="game-monitor-block">
            <h4>风险预警</h4>
            <div className="lab-alert-list">
              {alerts.length ? (
                alerts.map((alert) => (
                  <a className={`lab-alert-row ${alert.riskLevel}`} href={alert.url} target="_blank" rel="noreferrer" key={alert.id}>
                    <span>{riskText(alert.riskLevel)}</span>
                    <strong>{alert.title}</strong>
                    <small>{formatAgo(alert.publishedAt)}</small>
                  </a>
                ))
              ) : (
                <p className="empty compact">暂无中高风险预警</p>
              )}
            </div>
          </div>

          <div className="game-monitor-block">
            <h4>最新条目</h4>
            <div className="lab-sample-list">
              {latestItems.length ? latestItems.map((item) => <LabItemRow item={item} key={item.id} />) : <p className="empty compact">暂无新鲜条目</p>}
            </div>
          </div>
        </>
      ) : (
        <p className="empty compact">{monitor.message}</p>
      )}
    </article>
  );
}

function GameMonitorStat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="game-monitor-stat" title={note}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function LabActionPanel({
  data,
  loadingAction,
  actionResult,
  onAction
}: {
  data: BettaFishLabResponse;
  loadingAction: string;
  actionResult?: BettaFishActionResponse;
  onAction: (payload: Record<string, unknown>) => void;
}) {
  const [agentQuery, setAgentQuery] = React.useState("当前项目最近玩家最主要的不满点是什么？");
  const [reportQuery, setReportQuery] = React.useState("当前项目近 72 小时舆情复盘");
  const [reportTaskId, setReportTaskId] = React.useState("");
  const [sentimentText, setSentimentText] = React.useState("这次更新匹配体验变差了，外挂也有点多，希望官方尽快处理。");
  const [platformsText, setPlatformsText] = React.useState("dy");
  const [crawlerKeywordsText, setCrawlerKeywordsText] = React.useState("");
  const [maxKeywords, setMaxKeywords] = React.useState(3);
  const [maxNotes, setMaxNotes] = React.useState(5);
  const [runtimeConfirmation, setRuntimeConfirmation] = React.useState<PendingRuntimeConfirmation>();
  const [runtimePassword, setRuntimePassword] = React.useState("");
  const [runtimePasswordError, setRuntimePasswordError] = React.useState("");
  const operations = React.useMemo(() => new Map(data.operations.map((operation) => [operation.id, operation])), [data.operations]);
  const op = React.useCallback((id: string) => operations.get(id), [operations]);
  const isBusy = Boolean(loadingAction);
  const repoValue = data.runtime.repoConfigured ? (data.runtime.repoAutoDetected ? "自动发现" : "已配置") : "未配置";
  const baseUrlValue = data.runtime.baseUrlConfigured ? (data.runtime.baseUrlAutoConfigured ? "默认 5000" : "已配置") : "未配置";
  const deployValue = data.runtime.deployCommandConfigured ? (data.runtime.deployCommandAutoConfigured ? "默认 git pull" : "已配置") : "未配置";
  const pythonValue = data.runtime.pythonAvailable ? data.runtime.pythonVersion || "可用" : "不可用";
  const mindSpiderDbValue = data.mindSpider.dbDirectConfigured
    ? data.mindSpider.dbDialect === "sqlite"
      ? "SQLite 已接入"
      : `${data.mindSpider.dbDialect || "DB"} 已配置`
    : "未配置";

  React.useEffect(() => {
    if (actionResult?.taskId) setReportTaskId(actionResult.taskId);
  }, [actionResult?.taskId]);

  React.useEffect(() => {
    const names = data.gameMonitors.map((monitor) => monitor.gameName).filter(Boolean);
    const primaryName = names[0] || "当前项目";
    const keywords = names.join(", ");
    setAgentQuery((current) => current === "当前项目最近玩家最主要的不满点是什么？" ? `${primaryName}最近玩家最主要的不满点是什么？` : current);
    setReportQuery((current) => current === "当前项目近 72 小时舆情复盘" ? `${primaryName}近 72 小时舆情复盘` : current);
    setCrawlerKeywordsText((current) => current || keywords);
  }, [data.gameMonitors]);

  const run = (payload: Record<string, unknown>) => onAction(payload);
  const requestRuntimeConfirmation = (action: string) => {
    const operation = op(action);
    if (!operation) return;
    setRuntimeConfirmation({ operation, payload: { action } });
    setRuntimePassword("");
    setRuntimePasswordError("");
  };
  const closeRuntimeConfirmation = () => {
    setRuntimeConfirmation(undefined);
    setRuntimePassword("");
    setRuntimePasswordError("");
  };
  const confirmRuntimeAction = () => {
    if (!runtimeConfirmation) return;
    if (!runtimePassword.trim()) {
      setRuntimePasswordError("请输入二级密码。");
      return;
    }
    onAction({ ...runtimeConfirmation.payload, confirmationPassword: runtimePassword });
    closeRuntimeConfirmation();
  };
  const crawlerPlatforms = platformsText.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
  const crawlerKeywords = Array.from(new Set(crawlerKeywordsText.split(/[,，、;\s]+/).map((item) => item.trim()).filter(Boolean))).slice(0, 20);
  const agentOperationIds = ["agent.start.insight", "agent.stop.insight", "agent.start.media", "agent.stop.media", "agent.start.query", "agent.stop.query", "agent.search"];
  const forumOperationIds = ["forum.start", "forum.stop", "forum.log"];
  const reportOperationIds = ["report.generate", "report.progress", "report.resultJson", "report.cancel"];
  const mindSpiderOperationIds = ["mindspider.status", "mindspider.dbProbe", "mindspider.initDb", "mindspider.crawlTest"];
  const sentimentOperationIds = ["sentiment.analyze"];
  const runtimeOperationIds = ["runtime.localStart", "runtime.localStop", "runtime.systemStart", "runtime.systemShutdown", "runtime.deploy"];
  const opsById = (ids: string[]) => ids.map(op);
  const statusProbeMessage = data.endpointProbes.find((probe) => probe.id === "status")?.message || "";
  const runningAgents = runningAgentNamesFromStatus(statusProbeMessage);
  const agentSearchReady = runningAgents.length > 0;
  const agentActionResult = actionResult && (actionResult.action === "agent.search" || actionResult.action.startsWith("agent.")) ? actionResult : undefined;

  return (
    <section className="lab-section action-console interactive-zone">
      <div className="section-title">
        <TestTube2 size={18} />
        <h2>研究操作测试台</h2>
        <OperationAvailabilityBadge operations={data.operations} />
      </div>
      <p className="section-note">这里的按钮用于验证 BettaFish 能力，不会进入正式监控链路；不可用按钮会直接显示缺少的配置，带 research 的可用操作可能启动服务、搜索、爬取或生成报告。</p>

      <InlineDisplayCollapse label="前置状态" note="这些状态只说明操作是否具备条件，不是可点击控件。">
        <div className="lab-status-strip">
          <StatusFact label="研究操作" value={data.runtime.actionsEnabled ? "已开启" : "未开启"} tone={data.runtime.actionsEnabled ? "ok" : "warning"} note="是否允许测试台执行启动、搜索、爬取和报告动作" />
          <StatusFact label="BettaFish URL" value={baseUrlValue} tone={data.runtime.baseUrlConfigured ? "ok" : "skipped"} note="外部 BettaFish Flask/API 服务地址" />
          <StatusFact label="Repo" value={repoValue} tone={data.runtime.repoConfigured ? "ok" : "skipped"} note="本机 BettaFish 仓库路径，本地命令依赖它" />
          <StatusFact label="Python" value={pythonValue} tone={data.runtime.pythonAvailable ? "ok" : "error"} note="执行 BettaFish 与 MindSpider 脚本的解释器" />
          <StatusFact label="MindSpider DB" value={mindSpiderDbValue} tone={data.mindSpider.dbDirectConfigured ? "ok" : "warning"} note="爬虫数据库直连状态，用来确认数据表可读" />
          <StatusFact label="部署命令" value={deployValue} tone={data.runtime.deployCommandConfigured ? "ok" : "skipped"} note="预先配置的固定部署脚本，不从页面拼命令" />
          <StatusFact label="本地进程" value={data.runtime.localProcessRunning ? "运行中" : "未运行"} tone={data.runtime.localProcessRunning ? "ok" : "skipped"} note="由测试台启动的 BettaFish 子进程状态" />
        </div>
      </InlineDisplayCollapse>

      <div className="action-grid">
        <div className={`action-panel interactive-card ${operationPanelClass(opsById(agentOperationIds))}`}>
          <ActionPanelTitle title="Query / Media / Insight Agent" operations={opsById(agentOperationIds)} />
          <p className="action-panel-note">启动三个 Agent 后，可以把同一个舆情问题交给 BettaFish 检索、抽取和归纳。</p>
          <div className={`agent-search-state ${agentSearchReady ? "ready" : "blocked"}`}>
            <StatusPill status={agentSearchReady ? "ok" : "warning"} label={agentSearchReady ? `运行中：${runningAgents.join(" / ")}` : "尚未启动 Agent"} />
            <span>{agentSearchReady ? "搜索按钮会调用 BettaFish /api/search；若返回 API 调用失败，说明该 Streamlit Agent 未开放 JSON 搜索接口。" : "先点上方启动 insight、media 或 query Agent，状态变为 running 后再搜索。"}</span>
          </div>
          <div className="mini-button-grid">
            {(["insight", "media", "query"] as const).map((name) => (
              <React.Fragment key={name}>
                <ActionButton operation={op(`agent.start.${name}`)} busy={loadingAction === `agent.start.${name}`} disabled={isBusy} onClick={() => run({ action: `agent.start.${name}` })} />
                <ActionButton operation={op(`agent.stop.${name}`)} busy={loadingAction === `agent.stop.${name}`} disabled={isBusy} onClick={() => run({ action: `agent.stop.${name}` })} />
              </React.Fragment>
            ))}
          </div>
          <label className="lab-input">
            <span>Agent 问题</span>
            <small>发送给 /api/search，用来验证 Agent 对真实舆情问题的回答质量。</small>
            <textarea name="agent-query" value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} rows={3} autoComplete="off" />
          </label>
          <ActionButton operation={op("agent.search")} busy={loadingAction === "agent.search"} disabled={isBusy} onClick={() => run({ action: "agent.search", query: agentQuery })} />
          {agentActionResult ? <ActionResultView result={agentActionResult} /> : null}
        </div>

        <div className={`action-panel interactive-card ${operationPanelClass(opsById(forumOperationIds))}`}>
          <ActionPanelTitle title="ForumEngine" operations={opsById(forumOperationIds)} />
          <p className="action-panel-note">控制多 Agent 讨论引擎，并读取日志确认讨论是否产出稳定结论。</p>
          <div className="mini-button-grid three">
            <ActionButton operation={op("forum.start")} busy={loadingAction === "forum.start"} disabled={isBusy} onClick={() => run({ action: "forum.start" })} />
            <ActionButton operation={op("forum.stop")} busy={loadingAction === "forum.stop"} disabled={isBusy} onClick={() => run({ action: "forum.stop" })} />
            <ActionButton operation={op("forum.log")} busy={loadingAction === "forum.log"} disabled={isBusy} onClick={() => run({ action: "forum.log" })} />
          </div>
          <div className="candidate-list">
            {data.mindSpider.loginStateCandidates.map((candidate) => (
              <span key={candidate.path}>{candidate.label}: {candidate.exists ? `${candidate.fileCount || 0} 文件` : "未发现"}</span>
            ))}
          </div>
        </div>

        <div className={`action-panel interactive-card ${operationPanelClass(opsById(reportOperationIds))}`}>
          <ActionPanelTitle title="ReportEngine" operations={opsById(reportOperationIds)} />
          <p className="action-panel-note">生成专项舆情报告，并用 Task ID 跟踪进度、读取结果或取消任务。</p>
          <label className="lab-input">
            <span>报告主题</span>
            <small>报告生成时传给 BettaFish 的主题或分析问题。</small>
            <input name="report-query" value={reportQuery} onChange={(event) => setReportQuery(event.target.value)} autoComplete="off" />
          </label>
          <ActionButton operation={op("report.generate")} busy={loadingAction === "report.generate"} disabled={isBusy} onClick={() => run({ action: "report.generate", query: reportQuery })} />
          <label className="lab-input">
            <span>Task ID</span>
            <small>生成报告后返回的任务编号，用于查询同一份报告。</small>
            <input
              name="report-task-id"
              value={reportTaskId}
              onChange={(event) => setReportTaskId(event.target.value)}
              placeholder="例如 report_20260612…"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="mini-button-grid three">
            <ActionButton operation={op("report.progress")} busy={loadingAction === "report.progress"} disabled={isBusy} onClick={() => run({ action: "report.progress", taskId: reportTaskId })} />
            <ActionButton operation={op("report.resultJson")} busy={loadingAction === "report.resultJson"} disabled={isBusy} onClick={() => run({ action: "report.resultJson", taskId: reportTaskId })} />
            <ActionButton operation={op("report.cancel")} busy={loadingAction === "report.cancel"} disabled={isBusy} onClick={() => run({ action: "report.cancel", taskId: reportTaskId })} />
          </div>
        </div>

        <div className={`action-panel interactive-card ${operationPanelClass(opsById(mindSpiderOperationIds))}`}>
          <ActionPanelTitle title="MindSpider" operations={opsById(mindSpiderOperationIds)} />
          <p className="action-panel-note">检查 BettaFish 采集模块的 CLI、数据库、登录态和少量测试爬虫调度。</p>
          <div className="mini-button-grid">
            <ActionButton operation={op("mindspider.status")} busy={loadingAction === "mindspider.status"} disabled={isBusy} onClick={() => run({ action: "mindspider.status" })} />
            <ActionButton operation={op("mindspider.dbProbe")} busy={loadingAction === "mindspider.dbProbe"} disabled={isBusy} onClick={() => run({ action: "mindspider.dbProbe" })} />
            <ActionButton operation={op("mindspider.initDb")} busy={loadingAction === "mindspider.initDb"} disabled={isBusy} onClick={() => run({ action: "mindspider.initDb" })} />
          </div>
          <div className="candidate-list">
            <span>DB：{mindSpiderDbValue}</span>
            {data.mindSpider.sqlitePath ? <span>SQLite：{data.mindSpider.sqlitePath}</span> : null}
            {data.mindSpider.loginStateCandidates.map((candidate) => (
              <span key={candidate.path}>{candidate.label}: {candidate.exists ? `${candidate.fileCount || 0} 文件` : "未发现"}</span>
            ))}
          </div>
          <div className="lab-inline-fields">
            <label className="lab-input">
              <span>平台</span>
              <small>传给测试爬虫的平台缩写，例如 dy。</small>
              <input name="crawler-platforms" value={platformsText} onChange={(event) => setPlatformsText(event.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <label className="lab-input">
              <span>关键词</span>
              <small>本次最多取多少个关键词。</small>
              <input name="crawler-max-keywords" type="number" inputMode="numeric" min={1} max={50} value={maxKeywords} onChange={(event) => setMaxKeywords(Number(event.target.value))} autoComplete="off" />
            </label>
            <label className="lab-input">
              <span>条数</span>
              <small>每个测试任务最多抓取多少条。</small>
              <input name="crawler-max-notes" type="number" inputMode="numeric" min={1} max={50} value={maxNotes} onChange={(event) => setMaxNotes(Number(event.target.value))} autoComplete="off" />
            </label>
          </div>
          <label className="lab-input">
            <span>爬虫关键词</span>
            <small>留空则使用当天话题数据；填写后本次调度优先使用这些关键词。</small>
            <textarea
              name="crawler-keywords"
              value={crawlerKeywordsText}
              onChange={(event) => setCrawlerKeywordsText(event.target.value)}
              rows={2}
              placeholder="例如 失控进化, 项目关键词…"
              autoComplete="off"
            />
          </label>
          <ActionButton
            operation={op("mindspider.crawlTest")}
            busy={loadingAction === "mindspider.crawlTest"}
            disabled={isBusy}
            onClick={() => run({ action: "mindspider.crawlTest", platforms: crawlerPlatforms, maxKeywords, maxNotes, crawlerKeywords })}
          />
        </div>

        <div className={`action-panel interactive-card ${operationPanelClass(opsById(sentimentOperationIds))}`}>
          <ActionPanelTitle title="情感模型 / LLM" operations={opsById(sentimentOperationIds)} />
          <p className="action-panel-note">把一段文本交给 BettaFish 情感模型或 LLM，和本平台判定结果做并排校验。</p>
          <div className="candidate-list">
            <span>模型候选：{data.sentiment.modelCandidates.length}</span>
            <span>命令：{data.sentiment.commandConfigured ? "已配置" : "未配置"}</span>
            <span>本地桥接：{data.sentiment.bridgeAvailable ? "可用" : "不可用"}</span>
          </div>
          <label className="lab-input">
            <span>待分析文本</span>
            <small>用于测试情绪、风险和语义判断的一段样本文本。</small>
            <textarea name="sentiment-sample" value={sentimentText} onChange={(event) => setSentimentText(event.target.value)} rows={4} autoComplete="off" />
          </label>
          <ActionButton operation={op("sentiment.analyze")} busy={loadingAction === "sentiment.analyze"} disabled={isBusy} onClick={() => run({ action: "sentiment.analyze", text: sentimentText })} />
        </div>

        <div className={`action-panel interactive-card ${operationPanelClass(opsById(runtimeOperationIds))}`}>
          <ActionPanelTitle title="自动启动 / 控制 / 部署" operations={opsById(runtimeOperationIds)} />
          <p className="action-panel-note">验证外部 BettaFish 服务能否由测试台启动、关闭或执行固定部署命令。</p>
          <RuntimeActionGuide operations={opsById(runtimeOperationIds)} />
          <div className="mini-button-grid">
            <ActionButton operation={op("runtime.localStart")} busy={loadingAction === "runtime.localStart"} disabled={isBusy} onClick={() => requestRuntimeConfirmation("runtime.localStart")} />
            <ActionButton operation={op("runtime.localStop")} busy={loadingAction === "runtime.localStop"} disabled={isBusy} onClick={() => requestRuntimeConfirmation("runtime.localStop")} />
            <ActionButton operation={op("runtime.systemStart")} busy={loadingAction === "runtime.systemStart"} disabled={isBusy} onClick={() => requestRuntimeConfirmation("runtime.systemStart")} />
            <ActionButton operation={op("runtime.systemShutdown")} busy={loadingAction === "runtime.systemShutdown"} disabled={isBusy} onClick={() => requestRuntimeConfirmation("runtime.systemShutdown")} />
          </div>
          <ActionButton operation={op("runtime.deploy")} busy={loadingAction === "runtime.deploy"} disabled={isBusy} onClick={() => requestRuntimeConfirmation("runtime.deploy")} />
        </div>
      </div>

      {runtimeConfirmation ? (
        <RuntimeConfirmationDialog
          operation={runtimeConfirmation.operation}
          password={runtimePassword}
          error={runtimePasswordError}
          onPasswordChange={(value) => {
            setRuntimePassword(value);
            setRuntimePasswordError("");
          }}
          onCancel={closeRuntimeConfirmation}
          onConfirm={confirmRuntimeAction}
        />
      ) : null}

      {actionResult && !agentActionResult ? <ActionResultView result={actionResult} /> : null}
    </section>
  );
}

function RuntimeActionGuide({ operations }: { operations: Array<BettaFishOperation | undefined> }) {
  const operationsById = new Map(
    operations
      .filter((operation): operation is BettaFishOperation => Boolean(operation))
      .map((operation) => [operation.id, operation])
  );
  return (
    <div className="runtime-action-guide" aria-label="自动启动、控制、部署按钮说明">
      {runtimeActionExplanations.map((item) => {
        const operation = operationsById.get(item.id);
        return (
          <div className="runtime-action-guide-row" key={item.id}>
            <div>
              <strong>{operation?.label || item.label}</strong>
              <span>{item.effect}</span>
            </div>
            <small>{operation?.enabled ? "需二级确认" : operation?.disabledReason || "当前不可用"} · {item.target}</small>
          </div>
        );
      })}
    </div>
  );
}

function runningAgentNamesFromStatus(statusMessage: string) {
  const lower = statusMessage.toLowerCase();
  return (["insight", "media", "query"] as const).filter((name) => {
    const match = lower.match(new RegExp(`${name}\\s*:\\s*([a-z_]+)`));
    return match?.[1] === "running";
  });
}

function RuntimeConfirmationDialog({
  operation,
  password,
  error,
  onPasswordChange,
  onCancel,
  onConfirm
}: {
  operation: BettaFishOperation;
  password: string;
  error: string;
  onPasswordChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const explanation = runtimeActionExplanations.find((item) => item.id === operation.id);
  return (
    <div className="runtime-confirmation-backdrop" role="presentation">
      <form
        className="runtime-confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="runtime-confirmation-title"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <div className="runtime-confirmation-head">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <h3 id="runtime-confirmation-title">二级密码确认</h3>
            <p>{operation.label}</p>
          </div>
        </div>
        <p className="runtime-confirmation-copy">{explanation?.effect || operation.description}</p>
        <label className="lab-input">
          <span>二级密码</span>
          <small>该操作会改变 BettaFish 运行状态或执行部署命令。</small>
          <input
            name="runtime-confirmation-password"
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            autoComplete="current-password"
            autoFocus
          />
        </label>
        {error ? <p className="runtime-confirmation-error" role="alert" aria-live="polite">{error}</p> : null}
        <div className="runtime-confirmation-actions">
          <button className="runtime-confirmation-secondary" type="button" onClick={onCancel}>取消</button>
          <button className="runtime-confirmation-primary" type="submit">确认执行</button>
        </div>
      </form>
    </div>
  );
}

function ActionButton({
  operation,
  busy,
  disabled,
  onClick
}: {
  operation?: BettaFishOperation;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  if (!operation) return null;
  const isDisabled = disabled || !operation.enabled;
  const reason = !operation.enabled ? operation.disabledReason || "当前配置不可用" : disabled ? "等待当前操作完成" : "";
  const Icon = isDisabled ? AlertTriangle : busy ? RefreshCw : MousePointer2;
  return (
    <button className={`lab-action-button ${operation.safety}`} type="button" disabled={isDisabled} onClick={onClick} title={operation.disabledReason || operation.description}>
      <Icon size={13} className={busy ? "spin" : ""} aria-hidden="true" />
      <span className="action-button-copy">
        <span>{busy ? "执行中…" : operation.label}</span>
        {reason ? <small>{reason}</small> : null}
      </span>
    </button>
  );
}

function ActionPanelTitle({ title, operations }: { title: string; operations: Array<BettaFishOperation | undefined> }) {
  return (
    <div className="action-panel-head">
      <h3>{title}</h3>
      <OperationAvailabilityBadge operations={operations} />
    </div>
  );
}

function OperationAvailabilityBadge({ operations }: { operations: Array<BettaFishOperation | undefined> }) {
  const available = operations.filter((operation) => operation?.enabled).length;
  const total = operations.filter(Boolean).length;
  const label = available ? `可操作 ${available}/${total}` : `需配置 ${total}`;
  return <InteractionBadge mode={available ? "interactive" : "display"} label={label} />;
}

function operationPanelClass(operations: Array<BettaFishOperation | undefined>) {
  return operations.some((operation) => operation?.enabled) ? "has-actions" : "no-actions";
}

function StatusFact({ label, value, tone, note }: { label: string; value: string; tone: BettaFishProbeStatus; note?: string }) {
  return (
    <div className="status-fact" title={note}>
      <div>
        <span>{label}</span>
        {note ? <small>{note}</small> : null}
      </div>
      <StatusPill status={tone} label={value} />
    </div>
  );
}

function ActionResultView({ result }: { result: BettaFishActionResponse }) {
  const body = result.output?.length ? result.output.join("\n") : JSON.stringify(result.result ?? result, null, 2);
  return (
    <div className={`action-result ${result.ok ? "ok" : "error"}`}>
      <div>
        <strong>{result.action}</strong>
        <span>{result.message}</span>
      </div>
      {result.taskId ? <p>Task ID: {result.taskId}</p> : null}
      {result.target ? <p>{result.target}</p> : null}
      <pre>{body}</pre>
    </div>
  );
}

function CapabilityCard({ capability }: { capability: BettaFishCapability }) {
  return (
    <article className={`capability-card display-card ${capability.status}`}>
      <div className="capability-head">
        <div>
          <strong>{capability.name}</strong>
          <small>{capabilityRoleNotes[capability.id] || "BettaFish 测试能力"}</small>
        </div>
        <StatusPill status={capability.status} />
      </div>
      <p>{capability.goal}</p>
      <dl>
        <div>
          <dt>当前接入</dt>
          <dd>{capability.currentProjectUse}</dd>
        </div>
        <div>
          <dt>测试覆盖</dt>
          <dd>{capability.testCoverage}</dd>
        </div>
        <div>
          <dt>下一步</dt>
          <dd>{capability.nextStep}</dd>
        </div>
      </dl>
      <div className="capability-evidence">
        {capability.evidence.slice(0, 3).map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </article>
  );
}

function LabItemRow({ item }: { item: MonitorItem }) {
  return (
    <a className={`lab-item-row ${item.riskLevel}`} href={item.url} target="_blank" rel="noreferrer">
      <div>
        <strong>{item.title}</strong>
        <span>{item.sourceItemId} · {formatAgo(item.publishedAt)} · {item.parsedContentCount} 段解析</span>
      </div>
      <div className="lab-item-tags">
        <span className={`risk-pill ${item.riskLevel}`}>{riskText(item.riskLevel)}</span>
        <span className={`sentiment-pill ${item.sentiment}`}>{sentimentText(item.sentiment)}</span>
        {item.topics.slice(0, 2).map((topic) => (
          <span key={topic}>{topic}</span>
        ))}
        <span className="link-chip"><ExternalLink size={12} aria-hidden="true" />可打开</span>
      </div>
    </a>
  );
}

function StatusPill({ status, label }: { status: BettaFishProbeStatus; label?: string }) {
  return <span className={`status-pill ${status}`}>{label || statusText(status)}</span>;
}

function Metric({
  label,
  value,
  tone,
  hint,
  onClick
}: {
  label: string;
  value: React.ReactNode;
  tone: string;
  hint?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <small>{hint}</small> : null}
    </>
  );
  if (!onClick) {
    return <div className={`metric ${tone}`}>{content}</div>;
  }
  return (
    <button className={`metric ${tone}`} type="button" onClick={onClick}>
      {content}
    </button>
  );
}

function RuntimeStatusTray({
  timestampText,
  riskBacktest,
  updatePolicy,
  douyinStatus,
  bettafishCapabilities
}: {
  timestampText: string;
  riskBacktest?: MonitorResponse["riskBacktest"];
  updatePolicy?: MonitorResponse["updatePolicy"];
  douyinStatus?: DouyinCrawlStatus;
  bettafishCapabilities: BettaFishPanelCapability[];
}) {
  const douyinIssue = douyinStatus && !douyinStatus.ok ? douyinStatus.issues.find((issue) => issue.type === "login") || douyinStatus.issues[0] : undefined;
  const summaryParts = [
    timestampText,
    riskBacktestSummary(riskBacktest),
    updatePolicy?.label || "",
    bettafishCapabilities.length ? `BettaFish ${bettafishCapabilities.length}项` : "",
    douyinIssue ? (douyinIssue.type === "login" ? "抖音需登录" : "抖音需检查") : ""
  ].filter(Boolean);
  const summaryText = summaryParts.join(" · ");

  return (
    <details className={`runtime-status-tray ${douyinIssue ? "has-warning" : ""}`}>
      <summary className="runtime-status-trigger" title={summaryText}>
        <Clock3 size={14} aria-hidden="true" />
        <span>{summaryText || "运行状态"}</span>
        <small>{douyinIssue ? "需处理" : "详情"}</small>
        <ChevronDown size={14} aria-hidden="true" />
      </summary>
      <div className="runtime-status-panel">
        <div className="runtime-status-row">
          <span className="runtime-status-label">
            <Clock3 size={14} aria-hidden="true" />
            生成时间
          </span>
          <strong>{timestampText}</strong>
        </div>
        <div className="runtime-status-row">
          <span className="runtime-status-label">
            <TestTube2 size={14} aria-hidden="true" />
            风险回测
          </span>
          <RiskBacktestBadge status={riskBacktest} />
        </div>
        {updatePolicy ? (
          <div className="runtime-status-row">
            <span className="runtime-status-label">
              <Clock3 size={14} aria-hidden="true" />
              更新策略
            </span>
            <UpdatePolicyBadge policy={updatePolicy} />
          </div>
        ) : null}
        <div className="runtime-status-row runtime-status-row-wide">
          <span className="runtime-status-label">
            <Plug size={14} aria-hidden="true" />
            BettaFish
          </span>
          <BettaFishCapabilityList capabilities={bettafishCapabilities} />
        </div>
        {douyinIssue ? (
          <div className="runtime-status-row runtime-status-row-wide warning">
            <span className="runtime-status-label">
              <AlertTriangle size={14} aria-hidden="true" />
              抖音状态
            </span>
            <DouyinStatusNotice status={douyinStatus} />
          </div>
        ) : null}
      </div>
    </details>
  );
}

function BettaFishCapabilityList({ capabilities }: { capabilities: BettaFishPanelCapability[] }) {
  if (!capabilities.length) return <span className="runtime-status-muted">本次无生效证据</span>;

  return (
    <div className="bettafish-effect-block">
      <p className="bettafish-effect-note">仅显示本次监控响应中已有证据的能力</p>
      <div className="bettafish-effect-list">
        {capabilities.map((capability) => (
          <article className={`bettafish-effect-card ${capability.id}`} key={capability.id} title={capability.description}>
            <div>
              <strong>{capability.label}</strong>
              <span>{capability.value}</span>
            </div>
            <div className="bettafish-effect-evidence">
              {capability.evidence.slice(0, 2).map((entry) => (
                <small key={entry}>{entry}</small>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function riskBacktestSummary(status?: MonitorResponse["riskBacktest"]) {
  if (!status) return "";
  if (status.status === "running") return "回测中";
  if (status.status === "passed") return "回测通过";
  if (status.status === "failed") return "回测失败";
  return "待回测";
}

function riskBacktestTone(status?: MonitorResponse["riskBacktest"]) {
  if (status?.status === "passed") return "passed";
  if (status?.status === "failed") return "failed";
  if (status?.status === "running") return "running";
  return "idle";
}

function riskBacktestLabel(status?: MonitorResponse["riskBacktest"]) {
  return riskBacktestSummary(status) || "待回测";
}

function riskBacktestTitle(status?: MonitorResponse["riskBacktest"]) {
  if (!status) return "";
  return [
    status.message,
    status.caseCount ? `${status.caseCount} 个样本` : "",
    status.durationMs ? `${status.durationMs} ms` : "",
    status.details || ""
  ].filter(Boolean).join(" · ");
}

function riskBacktestCaseText(status?: MonitorResponse["riskBacktest"]) {
  return status?.caseCount ? `${status.caseCount} 样本` : "";
}

function RiskBacktestBadge({ status }: { status?: MonitorResponse["riskBacktest"] }) {
  const tone = riskBacktestTone(status);
  const title = riskBacktestTitle(status);
  const caseText = riskBacktestCaseText(status);
  return (
    <span className={`risk-backtest-badge ${tone}`} title={title}>
      {status?.status === "passed" ? <CheckCircle2 size={14} aria-hidden="true" /> : <TestTube2 size={14} aria-hidden="true" />}
      <b>{riskBacktestLabel(status)}</b>
      {caseText ? <small>{caseText}</small> : null}
    </span>
  );
}

function UpdatePolicyBadge({ policy }: { policy: MonitorResponse["updatePolicy"] }) {
  return (
    <span className={`update-policy ${policy.mode}`}>
      <b>{policy.label}</b>
      <small>
        夜间 {formatHour(policy.nightStartHour)}-{formatHour(policy.nightEndHour)} · 下次 {formatDateTime(policy.nextUpdateAt)}
      </small>
    </span>
  );
}

function DouyinStatusNotice({ status }: { status?: DouyinCrawlStatus }) {
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  if (!status || status.ok) return null;
  const loginIssue = status.issues.find((issue) => issue.type === "login");
  const primaryIssue = loginIssue || status.issues[0];
  if (!primaryIssue) return null;
  const remoteLogin = status.remoteLogin;
  const remoteLoginReady = remoteLogin?.ready ?? Boolean(loginIssue);
  const setupCommand = remoteLogin && !remoteLogin.ready ? remoteLogin.setupCommand : "";
  const noticeMessage = remoteLogin && !remoteLogin.ready ? remoteLogin.message : primaryIssue.message;
  const noticeTitle = [
    primaryIssue.detail || primaryIssue.message,
    remoteLogin && !remoteLogin.ready && remoteLogin.missing.length ? `缺少：${remoteLogin.missing.join("、")}` : "",
    setupCommand
  ].filter(Boolean).join("\n");
  const copySetupCommand = async () => {
    if (!setupCommand) return;
    try {
      await navigator.clipboard.writeText(setupCommand);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  };
  const copyLabel = copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制命令";

  return (
    <div className={`douyin-status-notice ${primaryIssue.severity}`} role="status" title={noticeTitle}>
      <AlertTriangle size={16} aria-hidden="true" />
      <div>
        <strong>{loginIssue ? "抖音登录需处理" : "抖音采集异常"}</strong>
        <small>{noticeMessage}</small>
      </div>
      {remoteLoginReady ? (
        <a href={api.douyinRemoteLogin} target="_blank" rel="noreferrer" className="douyin-remote-login">
          <ExternalLink size={14} aria-hidden="true" />
          远程登录
        </a>
      ) : setupCommand ? (
        <button type="button" className="douyin-remote-login" onClick={copySetupCommand}>
          <Copy size={14} aria-hidden="true" />
          {copyLabel}
        </button>
      ) : null}
    </div>
  );
}

function TrendLegendButton({
  series,
  label,
  active,
  onToggle
}: {
  series: TrendSeries;
  label: string;
  active: boolean;
  onToggle: (series: TrendSeries) => void;
}) {
  return (
    <button
      className={`legend-toggle ${active ? "active" : ""}`}
      type="button"
      aria-pressed={active}
      title={`${active ? "隐藏" : "显示"}${label}`}
      onClick={() => onToggle(series)}
    >
      <i className={series === "total" ? "total-line" : series} aria-hidden="true" />
      {label}
    </button>
  );
}

function TrendChart({ data, visibleSeries }: { data: TrendPoint[]; visibleSeries: TrendSeriesVisibility }) {
  if (!data.length) return <div className="chart-box empty-chart">暂无趋势数据</div>;
  const activeLineSeries = trendSeriesOrder.filter(
    (series) => visibleSeries[series] && data.some((point) => trendSeriesValue(point, series) > 0)
  );
  const trendSamples = activeLineSeries
    .map((series) => ({
      series,
      samples: makeTrendLineSamples(data, series)
    }))
    .filter(({ samples }) => samples.length >= 2);
  const barMax = Math.max(
    1,
    ...data.map((point) =>
      (visibleSeries.negative ? point.negative : 0) +
        (visibleSeries.neutral ? point.neutral : 0) +
        (visibleSeries.positive ? point.positive : 0)
    )
  );
  const lineMax = Math.max(1, ...trendSamples.flatMap(({ samples }) => samples.map((sample) => sample.value)));
  const plotStyle = { "--trend-count": data.length } as React.CSSProperties;
  const lineCoordinates = (samples: TrendLineSample[]) =>
    samples.map((sample) => ({ ...sample, y: trendLineTop + (1 - sample.value / lineMax) * trendLineHeight }));

  return (
    <div className="chart-box trend-chart">
      <div className="trend-plot" style={plotStyle}>
        <svg className="trend-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id="trend-line-clip">
              <rect x="0" y="0" width="100" height={trendLineClipHeight} />
            </clipPath>
          </defs>
          <g clipPath="url(#trend-line-clip)">
          {trendSamples.map(({ series, samples }) => {
            const path = formatSmoothLinePath(lineCoordinates(samples));
            return (
              <React.Fragment key={series}>
                <path className="trend-line-halo" d={path} />
                <path className={`trend-line-path line-${series}`} d={path} />
              </React.Fragment>
            );
          })}
          </g>
        </svg>
        {data.map((point) => {
          const positive = Math.max(4, (point.positive / barMax) * 100);
          const neutral = Math.max(4, (point.neutral / barMax) * 100);
          const negative = Math.max(4, (point.negative / barMax) * 100);
          const tooltip = `${point.bucket}: 总声量 ${point.total} 条，负面 ${point.negative}，中性 ${point.neutral}，正面 ${point.positive}`;
          return (
            <div className="trend-column" key={point.bucket}>
              <div className="trend-stack" title={tooltip} aria-label={tooltip}>
                {visibleSeries.negative && point.negative ? <i className="negative" style={{ height: `${negative}%` }} /> : null}
                {visibleSeries.neutral && point.neutral ? <i className="neutral" style={{ height: `${neutral}%` }} /> : null}
                {visibleSeries.positive && point.positive ? <i className="positive" style={{ height: `${positive}%` }} /> : null}
              </div>
              <span>{point.bucket.replace(" ", "\n")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function trendSeriesValue(point: TrendPoint, series: TrendSeries) {
  if (series === "negative") return point.negative;
  if (series === "neutral") return point.neutral;
  if (series === "positive") return point.positive;
  return point.total;
}

function makeTrendLineSamples(data: TrendPoint[], series: TrendSeries): TrendLineSample[] {
  const rawValues = data.map((point) => trendSeriesValue(point, series));
  const signalCount = rawValues.filter((value) => value > 0).length;
  if (signalCount < 2) return [];

  const radius = data.length >= 14 ? 3 : 2;
  const smoothedValues = rawValues.map((_, index) => weightedTrendAverage(rawValues, index, radius));
  const sparseAverage = averageNonZeroValues(rawValues);
  const lineValues =
    signalCount <= 2
      ? rawValues.map((value) => (value > 0 ? sparseAverage : 0))
      : signalCount <= 3
        ? rawValues
        : smoothedValues;
  return data
    .map((point, index) => ({
      point,
      x: data.length === 1 ? 50 : ((index + 0.5) / data.length) * 100,
      value: lineValues[index]
    }))
    .filter((_, index) => rawValues[index] > 0);
}

function averageNonZeroValues(values: number[]) {
  const nonZeroValues = values.filter((value) => value > 0);
  return nonZeroValues.reduce((sum, value) => sum + value, 0) / Math.max(1, nonZeroValues.length);
}

function weightedTrendAverage(values: number[], index: number, radius: number) {
  let weightedSum = 0;
  let weightSum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const sampleIndex = index + offset;
    if (sampleIndex < 0 || sampleIndex >= values.length) continue;
    const weight = radius + 1 - Math.abs(offset);
    weightedSum += values[sampleIndex] * weight;
    weightSum += weight;
  }
  return weightSum ? weightedSum / weightSum : 0;
}

function formatSmoothLinePath(coordinates: TrendLineCoordinate[]) {
  if (!coordinates.length) return "";
  if (coordinates.length === 1) return `M ${coordinates[0].x.toFixed(2)} ${coordinates[0].y.toFixed(2)}`;
  if (coordinates.length === 2) {
    return `M ${coordinates[0].x.toFixed(2)} ${coordinates[0].y.toFixed(2)} L ${coordinates[1].x.toFixed(2)} ${coordinates[1].y.toFixed(2)}`;
  }

  const path = [`M ${coordinates[0].x.toFixed(2)} ${coordinates[0].y.toFixed(2)}`];
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const previous = coordinates[index - 1] || coordinates[index];
    const current = coordinates[index];
    const next = coordinates[index + 1];
    const afterNext = coordinates[index + 2] || next;
    const controlPoint1 = {
      x: current.x + (next.x - previous.x) / 6,
      y: clampLineY(current.y + (next.y - previous.y) / 6)
    };
    const controlPoint2 = {
      x: next.x - (afterNext.x - current.x) / 6,
      y: clampLineY(next.y - (afterNext.y - current.y) / 6)
    };
    path.push(
      `C ${controlPoint1.x.toFixed(2)} ${controlPoint1.y.toFixed(2)}, ${controlPoint2.x.toFixed(2)} ${controlPoint2.y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`
    );
  }
  return path.join(" ");
}

function clampLineY(value: number) {
  return Math.min(trendLineMaxY, Math.max(trendLineMinY, value));
}

function RiskAlertCard({
  alert,
  active,
  onShowDetails
}: {
  alert: AlertItem;
  active: boolean;
  onShowDetails: () => void;
}) {
  const detailId = alertDetailId(alert.id);

  return (
    <article className={`alert-item ${alert.riskLevel} ${active ? "active" : ""}`}>
      <span className="alert-level">{riskText(alert.riskLevel)}</span>
      <strong>{alert.title}</strong>
      <small>{alert.gameName} · {formatAgo(alert.publishedAt)}</small>
      {alert.reasons.length ? <small className="alert-reasons">{alert.reasons.slice(0, 2).join(" / ")}</small> : null}
      <div className="alert-actions">
        <button type="button" className="alert-detail-button" aria-expanded={active} aria-controls={detailId} onClick={onShowDetails}>
          {active ? "收起详情" : "查看详情"}
        </button>
        <a href={alert.url} target="_blank" rel="noreferrer" aria-label={`打开原文：${alert.title}`} title="打开原文">
          <ExternalLink size={14} aria-hidden="true" />
          原文
        </a>
      </div>
    </article>
  );
}

function RiskAlertDetail({
  alert,
  item,
  onClose
}: {
  alert: AlertItem;
  item?: MonitorItem;
  onClose: () => void;
}) {
  return (
    <div className={`alert-detail ${alert.riskLevel}`} id={alertDetailId(alert.id)} role="region" aria-label={`风险详情：${alert.title}`}>
      <div className="alert-detail-head">
        <div>
          <span className="alert-level">{riskText(alert.riskLevel)}</span>
          <h3>{alert.title}</h3>
          <p>{alert.gameName} · {formatAgo(alert.publishedAt)}</p>
        </div>
        <div className="alert-detail-actions">
          <a href={alert.url} target="_blank" rel="noreferrer">
            <ExternalLink size={14} aria-hidden="true" />
            打开原文
          </a>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
      </div>
      {item ? (
        <>
          <MonitorBrief item={item} />
          <div className="pill-row alert-detail-tags">
            <span className={`risk-pill ${item.riskLevel}`}>{riskText(item.riskLevel)}</span>
            <span className={`sentiment-pill ${item.sentiment}`}>{sentimentText(item.sentiment)}</span>
            {item.topics.slice(0, 4).map((topic) => (
              <span key={topic}>{topic}</span>
            ))}
            {item.riskReasons.slice(0, 4).map((reason) => (
              <span className="risk-reason" key={reason}>{reason}</span>
            ))}
            {item.keywords.slice(0, 5).map((keyword) => (
              <span key={keyword}>{keyword}</span>
            ))}
          </div>
        </>
      ) : (
        <dl className="qa-summary" aria-label="风险原因摘要">
          <div className="qa-pair">
            <dt><span>问</span>为什么要关注？</dt>
            <dd>
              <span>答</span>
              <p>{alert.reasons.length ? alert.reasons.join("；") : "该条目被判定为中高风险，需要人工复盘。"}</p>
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function MonitorCard({
  item,
  searchResult,
  highlightQuery = ""
}: {
  item: MonitorItem;
  searchResult?: SearchResult;
  highlightQuery?: string;
}) {
  return (
    <article className={`monitor-card ${item.riskLevel}`}>
      <Thumbnail item={item} />
      <div className="item-body">
        <div className="item-meta">
          <span>{item.gameName}</span>
          <span>{item.sourceLabel}</span>
          <span>{formatAgo(item.publishedAt)}</span>
          <span>{item.parsedContentCount} 段解析</span>
        </div>
        <h3><HighlightText text={item.title} query={highlightQuery} /></h3>
        <MonitorBrief item={item} highlightQuery={highlightQuery} />
        {searchResult ? (
          <div className="search-hit-meta">
            <span>{searchOriginText(searchResult.origin)}</span>
            <span>匹配 <HighlightText text={searchResult.matchedFields.slice(0, 5).join(" / ")} query={highlightQuery} /></span>
            <span>{searchResult.score} 分</span>
          </div>
        ) : null}
        {searchResult?.snippets.length ? (
          <div className="search-snippets">
            {searchResult.snippets.map((snippet, index) => (
              <div className="search-snippet" key={`${snippet.field}-${index}`}>
                <strong>{snippet.label}</strong>
                <span><HighlightText text={snippet.text} query={highlightQuery} /></span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="pill-row">
          <span className={`risk-pill ${item.riskLevel}`}>{riskText(item.riskLevel)}</span>
          <span className={`sentiment-pill ${item.sentiment}`}>{sentimentText(item.sentiment)}</span>
          {item.topics.slice(0, 4).map((topic) => (
            <span key={topic}><HighlightText text={topic} query={highlightQuery} /></span>
          ))}
          {item.riskReasons.slice(0, 3).map((reason) => (
            <span className="risk-reason" key={reason}><HighlightText text={reason} query={highlightQuery} /></span>
          ))}
          {item.keywords.slice(0, 4).map((keyword) => (
            <span key={keyword}><HighlightText text={keyword} query={highlightQuery} /></span>
          ))}
        </div>
      </div>
      <div className="item-side">
        <span>{item.author}</span>
        <span>{metricLine(item)}</span>
        <a href={item.url} target="_blank" rel="noreferrer" title="打开原文" aria-label={`打开原文：${item.title}`}>
          <ExternalLink size={18} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

function MonitorBrief({ item, highlightQuery = "" }: { item: MonitorItem; highlightQuery?: string }) {
  const brief = makeMonitorBrief(item);

  return (
    <dl className="qa-summary" aria-label="内容问答摘要">
      <div className="qa-pair">
        <dt><span>问</span>这条在说什么？</dt>
        <dd><span>答</span><p><HighlightText text={brief.overview} query={highlightQuery} /></p></dd>
      </div>
      <div className="qa-pair">
        <dt><span>问</span>为什么要关注？</dt>
        <dd><span>答</span><p><HighlightText text={brief.attention} query={highlightQuery} /></p></dd>
      </div>
      {brief.evidence.length ? (
        <div className="qa-pair">
          <dt><span>问</span>原文依据是什么？</dt>
          <dd>
            <span>答</span>
            <ul>
              {brief.evidence.map((snippet) => (
                <li key={snippet}><HighlightText text={snippet} query={highlightQuery} /></li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const terms = React.useMemo(() => makeHighlightTerms(query), [query]);
  if (!terms.length || !text) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const match = findNextHighlight(lowerText, terms, cursor);
    if (!match) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const end = match.index + match.term.length;
    nodes.push(
      <mark className="search-highlight" key={`${match.index}-${match.term}`}>
        {text.slice(match.index, end)}
      </mark>
    );
    cursor = end;
  }

  return <>{nodes}</>;
}

function makeHighlightTerms(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const terms = [trimmed, ...trimmed.split(/[\s,，、;；/]+/)]
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(terms)).sort((left, right) => right.length - left.length);
}

function findNextHighlight(lowerText: string, terms: string[], start: number) {
  let bestMatch: { index: number; term: string } | undefined;
  for (const term of terms) {
    const index = lowerText.indexOf(term, start);
    if (index === -1) continue;
    if (!bestMatch || index < bestMatch.index || (index === bestMatch.index && term.length > bestMatch.term.length)) {
      bestMatch = { index, term };
    }
  }
  return bestMatch;
}

function makeMonitorBrief(item: MonitorItem) {
  const overview = summaryLead(item.summary) || compactSnippet(normalizeBriefText(item.title), 120);
  const topicText = item.topics.slice(0, 3).join("、");
  const reasonText = item.riskReasons.length
    ? item.riskReasons.slice(0, 2).join("；")
    : item.riskLevel === "low"
      ? "当前未触发中高风险原因"
      : "存在情绪或互动异常信号";
  const attention = `${riskText(item.riskLevel)} · ${sentimentText(item.sentiment)}；${topicText ? `聚焦 ${topicText}` : "主题暂不集中"}；${reasonText}。`;

  return {
    overview,
    attention,
    evidence: makeEvidenceSnippets(item)
  };
}

function makeEvidenceSnippets(item: MonitorItem) {
  const preferredTypes = ["description", "post", "comment", "danmaku", "subtitle", "title", "tag"];
  const seen = new Set<string>();
  const snippets: string[] = [];
  const title = normalizeBriefText(item.title);
  const parts = [...item.contentParts].sort((left, right) => preferredTypes.indexOf(left.type) - preferredTypes.indexOf(right.type));

  for (const part of parts) {
    if (snippets.length >= 2) break;
    const text = normalizeBriefText(part.text);
    if (!text || text === title) continue;
    const key = text.slice(0, 64);
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push(`${contentPartLabel(part.type)}：${compactSnippet(text, 92)}`);
  }

  if (snippets.length) return snippets;

  for (const segment of summaryEvidenceSegments(item.summary)) {
    if (snippets.length >= 2) break;
    const text = normalizeBriefText(segment);
    if (!text || text === title) continue;
    snippets.push(`摘要：${compactSnippet(text, 92)}`);
  }
  return snippets;
}

function summaryLead(summary: string) {
  const normalized = normalizeBriefText(summary);
  const lead = normalized.split(/\s+\/\s+/)[0] || normalized;
  const firstSentence = lead.match(/^.+?[。！？]/)?.[0];
  return compactSnippet(firstSentence || lead, 150);
}

function summaryEvidenceSegments(summary: string) {
  return normalizeBriefText(summary).split(/\s+\/\s+/).slice(1);
}

function normalizeBriefText(value: string) {
  return value
    .replace(/\bimage_emoticon\d*\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([，。！？；、])/g, "$1")
    .trim();
}

function compactSnippet(value: string, maxLength: number) {
  const text = normalizeBriefText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function contentPartLabel(type: MonitorItem["contentParts"][number]["type"]) {
  if (type === "description") return "简介";
  if (type === "comment") return "评论";
  if (type === "danmaku") return "弹幕";
  if (type === "subtitle") return "字幕";
  if (type === "post") return "正文";
  if (type === "tag") return "标签";
  return "标题";
}

function alertDetailId(id: string) {
  return `alert-detail-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function Thumbnail({ item }: { item: MonitorItem }) {
  const [failed, setFailed] = React.useState(false);
  const imageUrl = item.thumbnail ? `/api/image?url=${encodeURIComponent(item.thumbnail)}` : "";

  if (!imageUrl || failed) {
    return (
      <div className="fallback-thumb">
        {item.source === "tieba" ? <Waves aria-hidden="true" /> : <Video aria-hidden="true" />}
      </div>
    );
  }

  return <img src={imageUrl} alt="" width={320} height={180} loading="lazy" onError={() => setFailed(true)} />;
}

function ScopeRail({
  games,
  tiebaScopeOverrideActive,
  tiebaBarsByGame,
  tiebaKeywordsByGame
}: {
  games: GameConfig[];
  tiebaScopeOverrideActive: boolean;
  tiebaBarsByGame: TiebaScopeTextMap;
  tiebaKeywordsByGame: TiebaScopeTextMap;
}) {
  if (!games.length) return null;

  const overridden = tiebaScopeOverrideActive;
  const showGameLabel = games.length > 1;

  return (
    <section className="scope-rail" aria-label="当前生效采集范围">
      <div className="scope-rail-head">
        <Database size={15} aria-hidden="true" />
        <span>当前生效范围</span>
        <em>{overridden ? "临时生效" : "配置生效"}</em>
        <small>编辑下方内容后，点击“应用采集范围”才会更新这里。</small>
      </div>
      <div className="scope-rail-list">
        {games.map((game) => {
          const configuredKeywords = game.tiebaKeywords || [];
          const supplementalBars = overridden ? splitSupplementalKeywords(tiebaBarsByGame[game.id] || "") : [];
          const overrideKeywords = overridden ? splitSupplementalKeywords(tiebaKeywordsByGame[game.id] || "") : [];
          const tiebaBars = overridden ? mergeScopeValues(game.tiebaBars || [], supplementalBars) : game.tiebaBars || [];
          const defaultTiebaKeywords = configuredKeywords;
          const defaultPlatformKeywords = mergeScopeKeywords(game.bilibiliKeywords || [], game.douyinKeywords || []);
          const supplementalTiebaKeywords = supplementalBars.length && overridden ? mergeScopeKeywords(defaultPlatformKeywords, overrideKeywords) : [];
          return (
            <div className={`scope-row ${showGameLabel ? "" : "single"} ${supplementalBars.length ? "with-supplemental" : ""}`} key={game.id}>
              {showGameLabel ? <strong>{game.shortName || game.name}</strong> : null}
              <ScopeGroup icon="source" label="贴吧来源" values={scopeValues(tiebaBars, "未配置")} />
              <ScopeGroup icon="keyword" label="默认吧规则" values={scopeValues(defaultTiebaKeywords, "全量读取")} />
              {supplementalBars.length ? (
                <ScopeGroup icon="keyword" label="补充来源匹配" values={scopeValues(supplementalTiebaKeywords, "不限关键词")} />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type ScopeValue = { text: string; muted?: boolean; overflow?: boolean };

function ScopeGroup({
  icon,
  label,
  values
}: {
  icon: "source" | "keyword";
  label: string;
  values: ScopeValue[];
}) {
  const Icon = icon === "source" ? Database : Tags;
  return (
    <div className={`scope-group ${icon}`}>
      <span className="scope-group-label">
        <Icon size={13} aria-hidden="true" />
        {label}
      </span>
      <span className="scope-chip-list">
        {values.map((value) => (
          <span className={`scope-chip ${value.muted ? "muted" : ""} ${value.overflow ? "overflow" : ""}`} key={`${label}-${value.text}`}>
            {value.text}
          </span>
        ))}
      </span>
    </div>
  );
}

function KeywordScopeGuide() {
  return (
    <details className="keyword-scope-guide">
      <summary>
        <span>
          <Info size={17} aria-hidden="true" />
          <strong>关键词和贴吧来源怎么配</strong>
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="keyword-guide-content">
        <div className="keyword-guide-main">
          <div>
            <strong>补充全平台关注词不会收窄默认贴吧；跨吧来源才需要匹配词</strong>
            <span>想在逆战吧收集生死狙击相关讨论：贴吧来源填“逆战”，补充来源匹配词填“生死狙击”。只给当前看板新增关注点时，填“补充全平台关注词”，默认贴吧仍全量读取。</span>
          </div>
        </div>
        <div className="keyword-guide-steps">
          <span><b>1</b> 补充全平台关注词</span>
          <span><b>2</b> 贴吧来源：去哪些吧找</span>
          <span><b>3</b> 补充来源匹配词</span>
        </div>
      </div>
    </details>
  );
}

type DefaultKeywordGroup = {
  id: string;
  label: string;
  keywords: string[];
};

function DefaultKeywordOverview({ groups }: { groups: DefaultKeywordGroup[] }) {
  if (!groups.length) return null;
  const showGroupLabel = groups.length > 1;

  return (
    <section className="default-keyword-overview" aria-label="当前看板默认关键词">
      <div className="default-keyword-head">
        <span className="default-keyword-title">
          <Tags size={15} aria-hidden="true" />
          <strong>当前看板默认关键词</strong>
        </span>
        <em>只读配置</em>
      </div>
      <p>这些词已经随看板默认采集；下方只添加默认词之外的新关键词。贴吧是否跨吧采集，仍看“贴吧来源”和“补充来源匹配词”。</p>
      <div className={`default-keyword-list ${showGroupLabel ? "" : "single"}`}>
        {groups.map((group) => (
          <div className="default-keyword-row" key={group.id}>
            {showGroupLabel ? <strong>{group.label}</strong> : null}
            <span className="default-keyword-chips">
              {scopeValues(group.keywords, "未配置默认关键词").map((value) => (
                <span
                  className={`scope-chip default-keyword-chip ${value.muted ? "muted" : ""} ${value.overflow ? "overflow" : ""}`}
                  key={`${group.id}-${value.text}`}
                >
                  {value.text}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ScopeEditorField({
  icon,
  title,
  description,
  values,
  emptyLabel,
  draft,
  placeholder,
  addLabel,
  lockedValues = [],
  onDraftChange,
  onAdd,
  onRemove
}: {
  icon: "source" | "keyword";
  title: string;
  description: string;
  values: string[];
  emptyLabel: string;
  draft: string;
  placeholder: string;
  addLabel: string;
  lockedValues?: string[];
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (value: string) => void;
}) {
  const Icon = icon === "source" ? Database : Tags;
  const canAdd = splitSupplementalKeywords(draft).length > 0;
  const lockedValueKeys = React.useMemo(
    () => new Set(lockedValues.map(scopeValueKey).filter(Boolean)),
    [lockedValues]
  );
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onAdd();
  };

  return (
    <div className={`scope-editor-field ${icon}`}>
      <div className="scope-editor-title">
        <span>
          <Icon size={15} aria-hidden="true" />
          {title}
        </span>
        <b>{values.length}</b>
      </div>
      <p className="scope-editor-description">{description}</p>
      <div className={`scope-editor-values ${values.length ? "" : "empty"}`}>
        {values.length ? values.map((value) => {
          const locked = lockedValueKeys.has(scopeValueKey(value));
          return (
            <span className={`scope-editor-token ${locked ? "locked" : ""}`} key={`${title}-${value}`}>
              {value}
              {locked ? (
                <span className="scope-editor-lock" title="默认贴吧来源不可删除">
                  默认
                </span>
              ) : (
                <button type="button" onClick={() => onRemove(value)} title={`移除 ${value}`} aria-label={`移除 ${value}`}>
                  <X size={13} aria-hidden="true" />
                </button>
              )}
            </span>
          );
        }) : <span>{emptyLabel}</span>}
      </div>
      <div className="scope-editor-add">
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
        />
        <button type="button" onClick={onAdd} disabled={!canAdd}>
          <Plus size={15} aria-hidden="true" />
          {addLabel}
        </button>
      </div>
    </div>
  );
}

function scopeValues(values: string[], emptyLabel: string): ScopeValue[] {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (!cleaned.length) return [{ text: emptyLabel, muted: true }];
  const visible = cleaned.slice(0, 4).map((text) => ({ text }));
  const hidden = cleaned.length - visible.length;
  return hidden > 0 ? [...visible, { text: `+${hidden}`, overflow: true }] : visible;
}

function mergeScopeValues(baseValues: string[], extraValues: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const keyword of [...baseValues, ...extraValues]) {
    const normalized = scopeValueKey(keyword);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(keyword.trim());
  }
  return merged;
}

function mergeScopeKeywords(baseKeywords: string[], extraKeywords: string[]) {
  return mergeScopeValues(baseKeywords, extraKeywords);
}

function scopeValueKey(value: string) {
  return value.trim().toLowerCase();
}

function scopeValueInList(value: string, list: string[]) {
  const key = scopeValueKey(value);
  return Boolean(key) && list.some((item) => scopeValueKey(item) === key);
}

function defaultKeywordGroupsForGames(games: GameConfig[]): DefaultKeywordGroup[] {
  return games.map((game) => ({
    id: game.id,
    label: game.shortName || game.name,
    keywords: mergeScopeKeywords(game.bilibiliKeywords || [], game.douyinKeywords || [])
  }));
}

function scopeListForGames(games: GameConfig[], key: "tiebaBars" | "tiebaKeywords") {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const game of games) {
    for (const value of game[key] || []) {
      const trimmed = value.trim();
      const normalized = trimmed.toLowerCase();
      if (!trimmed || seen.has(normalized)) continue;
      seen.add(normalized);
      values.push(trimmed);
    }
  }
  return values;
}

function makeTiebaScopeSummary(
  games: GameConfig[],
  tiebaScopeOverrideActive: boolean,
  tiebaBarsByGame: TiebaScopeTextMap
) {
  const overridden = tiebaScopeOverrideActive;
  const overrideBars = Object.values(tiebaBarsByGame).flatMap(splitSupplementalKeywords);
  const sourceValues = overridden ? mergeScopeValues(scopeListForGames(games, "tiebaBars"), overrideBars) : scopeListForGames(games, "tiebaBars");
  const baseFilterValues = scopeListForGames(games, "tiebaKeywords");

  return {
    overridden,
    primary: `${overridden ? "临时范围" : "配置范围"} · ${sourceValues.length || 0} 个贴吧`,
    secondary: `贴吧来源 ${summarizeScopeList(sourceValues, "未配置")} · 匹配词 ${summarizeScopeList(baseFilterValues, "默认吧全量读取")}`
  };
}

function summarizeScopeList(values: string[], emptyLabel: string) {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (!cleaned.length) return emptyLabel;
  if (cleaned.length <= 2) return cleaned.join("、");
  return `${cleaned.slice(0, 2).join("、")} 等 ${cleaned.length} 项`;
}

function searchOriginText(origin: SearchResult["origin"]) {
  return origin === "mindspider-douyin-db" ? "MindSpider DB" : "历史记录";
}

function keywordEffectivenessLabel(effectiveness: KeywordEffectiveness | undefined) {
  if (!effectiveness) return "待评估";
  if (effectiveness.matchedItems) return `命中 ${effectiveness.matchedItems} 条`;
  return "等待命中数据";
}

function keywordEffectivenessTitle(keyword: string, effectiveness: KeywordEffectiveness | undefined) {
  if (!effectiveness) return `${keyword}：刷新后评估`;
  if (!effectiveness.matchedItems) return `${keyword}：已加入词池，等待采集命中`;
  const sources = effectiveness.sources.length ? effectiveness.sources.map(sourceTypeText).join(" / ") : "暂无来源";
  const riskSummary = effectiveness.highRisk || effectiveness.mediumRisk
    ? `；高风险 ${effectiveness.highRisk}，中风险 ${effectiveness.mediumRisk}`
    : "";
  const latest = effectiveness.latestAt ? `；最近 ${formatDateTime(effectiveness.latestAt)}` : "";
  return `${keyword}：命中 ${effectiveness.matchedItems} 条；${sources}${riskSummary}${latest}`;
}

function keywordEffectivenessSourceText(effectiveness: KeywordEffectiveness | undefined) {
  if (!effectiveness) return "待评估";
  return effectiveness.sources.length ? effectiveness.sources.map(sourceTypeText).join(" / ") : "暂无来源";
}

function keywordRiskSummary(effectiveness: KeywordEffectiveness | undefined) {
  if (!effectiveness) return "等待刷新";
  if (!effectiveness.matchedItems) return "暂未产生条目";
  return `高 ${effectiveness.highRisk} · 中 ${effectiveness.mediumRisk}`;
}

function sourceTypeText(source: SourceType) {
  if (source === "bilibili") return "B站";
  if (source === "tieba") return "贴吧";
  if (source === "douyin") return "抖音";
  return "BettaFish";
}

function metricLine(item: MonitorItem) {
  if (item.source === "bilibili") {
    return `${formatNumber(item.metrics.views)} 播放 · ${formatNumber(item.metrics.comments)} 评论`;
  }
  if (item.source === "douyin") {
    return item.sourceLabel.includes("MindSpider")
      ? "实验爬虫"
      : item.sourceLabel.includes("authorized") || item.sourceLabel.includes("import") || item.url.startsWith("douyin-import://")
        ? "授权来源"
        : "公开搜索";
  }
  if (item.source === "bettafish") {
    return "授权导入";
  }
  return `${formatNumber(item.metrics.replies)} 回复`;
}

function riskText(level: RiskLevel) {
  return level === "high" ? "高风险" : level === "medium" ? "中风险" : "低风险";
}

function statusText(status: BettaFishProbeStatus) {
  if (status === "ok") return "可用";
  if (status === "warning") return "待完善";
  if (status === "error") return "异常";
  return "未配置";
}

function sentimentText(value: Sentiment) {
  return value === "negative" ? "负面" : value === "positive" ? "正面" : value === "mixed" ? "混合" : "中性";
}

function formatNumber(value?: number) {
  if (!value) return "0";
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return String(value);
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function sameGameSelection(left: GameId[], right: GameId[]) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function makeMonitorTitle(games: GameConfig[]) {
  if (!games.length) return "舆情监测";
  const ids = games.map((game) => game.id).sort().join(",");
  if (ids === "ss1,ss2") return "生死狙击舆情监测";
  if (games.length === 1) return `${games[0].name}舆情监测`;
  const names = games.slice(0, 2).map((game) => game.shortName || game.name).join(" / ");
  return `${names}${games.length > 2 ? "等" : ""}舆情监测`;
}

function makeTopicOptions(items: MonitorItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const itemTopic of item.topics) counts.set(itemTopic, (counts.get(itemTopic) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([itemTopic, count]) => ({ topic: itemTopic, count }));
}

function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatAgo(value: string) {
  const diffMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(diffMs / 60_000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
