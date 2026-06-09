import React from "react";
import ReactDOM from "react-dom/client";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  Filter,
  Info,
  Plug,
  RefreshCw,
  Search,
  ShieldAlert,
  TestTube2,
  Video,
  Waves
} from "lucide-react";
import type {
  BettaFishActionResponse,
  BettaFishCapability,
  BettaFishGameMonitor,
  BettaFishLabResponse,
  BettaFishOperation,
  BettaFishProbeStatus,
  GameConfig,
  GameId,
  MonitorItem,
  MonitorResponse,
  RiskLevel,
  Sentiment,
  SourceHealth,
  SourceType,
  TrendPoint
} from "./shared";
import "./styles.css";

const api = {
  config: "/api/config",
  monitor: "/api/monitor",
  bettafishLab: "/api/bettafish/lab",
  bettafishLabAction: "/api/bettafish/lab/action"
};
const clientCacheMaxAgeMs = 4 * 3_600_000;

type AppPage = "monitor" | "bettafish-lab";
type TrendSeries = "negative" | "neutral" | "positive" | "total";
type TrendSeriesVisibility = Record<TrendSeries, boolean>;
type TrendLineSample = { point: TrendPoint; x: number; value: number };
type TrendLineCoordinate = TrendLineSample & { y: number };

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
        term: "SS1 / SS2",
        meaning: "分别指生死狙击 1 和生死狙击 2。",
        role: "测试台按项目拆开看数据，避免两个游戏的舆情和关键词互相污染。"
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
        meaning: "BettaFish 或 MindSpider 导出里匹配到 SS1/SS2 关键词的条目数。",
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
        meaning: "B站、贴吧、抖音、BettaFish 等来源的采集结果和异常状态。",
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

function monitorCacheKey(gameIds: GameId[], windowHours: number) {
  return `ss-monitor:${[...gameIds].sort().join(",")}:${windowHours}`;
}

function readCachedMonitor(key: string) {
  try {
    const raw = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
    if (!raw) return undefined;
    const payload = JSON.parse(raw) as { cachedAt: number; data: MonitorResponse };
    if (!payload?.cachedAt || Date.now() - payload.cachedAt > clientCacheMaxAgeMs) return undefined;
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

function App() {
  const [config, setConfig] = React.useState<{
    games: GameConfig[];
    defaultWindowHours: number;
    updatePolicy: MonitorResponse["updatePolicy"];
  }>();
  const [activePage, setActivePage] = React.useState<AppPage>("monitor");
  const [selectedGames, setSelectedGames] = React.useState<GameId[]>(["ss1", "ss2"]);
  const [windowHours, setWindowHours] = React.useState(72);
  const [source, setSource] = React.useState<"all" | SourceType>("all");
  const [risk, setRisk] = React.useState<"all" | RiskLevel>("all");
  const [sentiment, setSentiment] = React.useState<"all" | Sentiment>("all");
  const [topic, setTopic] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [data, setData] = React.useState<MonitorResponse>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [trendSeries, setTrendSeries] = React.useState<TrendSeriesVisibility>(defaultTrendSeriesVisibility);
  const [isControlFloating, setControlFloating] = React.useState(false);
  const controlSentinelRef = React.useRef<HTMLDivElement>(null);
  const latestRequestRef = React.useRef(0);

  React.useEffect(() => {
    fetch(api.config)
      .then((response) => response.json())
      .then((payload) => {
        setConfig(payload);
        setWindowHours(payload.defaultWindowHours || 72);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  const load = React.useCallback(
    async (force = false) => {
      const requestId = latestRequestRef.current + 1;
      latestRequestRef.current = requestId;
      const cacheKey = monitorCacheKey(selectedGames, windowHours);
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
          ...(force ? { force: "1" } : {})
        });
        const response = await fetch(`${api.monitor}?${params.toString()}`);
        if (!response.ok) throw new Error(`API ${response.status}`);
        const payload = (await response.json()) as MonitorResponse;
        if (latestRequestRef.current !== requestId) return;
        setData(payload);
        writeCachedMonitor(cacheKey, payload);
      } catch (reason) {
        if (latestRequestRef.current !== requestId) return;
        if (!cachedPayload) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        if (latestRequestRef.current === requestId) setLoading(false);
      }
    },
    [selectedGames, windowHours]
  );

  React.useEffect(() => {
    load(false);
  }, [load]);

  React.useEffect(() => {
    if (!data?.updatePolicy.nextUpdateAt) return;
    const delayMs = Math.max(1000, new Date(data.updatePolicy.nextUpdateAt).getTime() - Date.now() + 1000);
    const timer = window.setTimeout(() => load(false), delayMs);
    return () => window.clearTimeout(timer);
  }, [data?.updatePolicy.nextUpdateAt, load]);

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

  const visiblePolicy = data?.updatePolicy || config?.updatePolicy;
  const configuredGameIds = React.useMemo(() => {
    const configuredGames = config?.games || [];
    return configuredGames.length ? configuredGames.map((game) => game.id) : (["ss1", "ss2"] as GameId[]);
  }, [config?.games]);
  const gameOptions = React.useMemo(() => {
    const configuredGames = config?.games || [];
    return [
      { key: "all", label: "全部", ids: configuredGameIds },
      ...configuredGames.map((game) => ({ key: game.id, label: game.shortName, ids: [game.id] }))
    ];
  }, [config?.games, configuredGameIds]);
  const visibleHealth = React.useMemo(
    () => makeVisibleHealth(data?.health || [], sameGameSelection(selectedGames, configuredGameIds)),
    [configuredGameIds, data?.health, selectedGames]
  );
  const topicOptions = React.useMemo(() => makeTopicOptions(data?.items || []), [data?.items]);
  const selectGames = React.useCallback(
    (gameIds: GameId[]) => {
      const sameSelection = sameGameSelection(selectedGames, gameIds);
      resetFeedFilters();
      clearCachedMonitor(monitorCacheKey(gameIds, windowHours));
      if (sameSelection) {
        void load(true);
        return;
      }
      setData(undefined);
      setSelectedGames(gameIds);
    },
    [load, resetFeedFilters, selectedGames, windowHours]
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
      window.requestAnimationFrame(() => document.getElementById("latest-feed")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    },
    []
  );
  const jumpToAlerts = React.useCallback(() => {
    setRisk("high");
    setSource("all");
    setSentiment("all");
    setTopic("all");
    setQuery("");
    window.requestAnimationFrame(() => document.getElementById("risk-alerts")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Live Monitor</p>
          <h1>生死狙击舆情监测</h1>
        </div>
        <div className="top-actions">
          <nav className="page-tabs" aria-label="页面切换">
            <button
              className={activePage === "monitor" ? "active" : ""}
              type="button"
              onClick={() => setActivePage("monitor")}
              title="监测看板"
            >
              <Waves size={16} />
              监测看板
            </button>
            <button
              className={activePage === "bettafish-lab" ? "active" : ""}
              type="button"
              onClick={() => setActivePage("bettafish-lab")}
              title="BettaFish 测试台"
            >
              <TestTube2 size={16} />
              BettaFish 测试台
            </button>
          </nav>
          <span className="timestamp">
            <Clock3 size={16} />
            {data ? formatDateTime(data.generatedAt) : "等待采集"}
          </span>
          {visiblePolicy ? <UpdatePolicyBadge policy={visiblePolicy} /> : null}
          <button className="icon-button primary" onClick={() => load(true)} disabled={loading} title="强制刷新">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
        </div>
      </section>

      {activePage === "monitor" ? (
        <>
      <div className="control-sentinel" ref={controlSentinelRef} aria-hidden="true" />
      <section className={`control-band ${isControlFloating ? "is-floating" : ""}`}>
        <div className="segmented">
          {gameOptions.map((option) => (
            <button
              key={option.key}
              className={sameGameSelection(selectedGames, option.ids) ? "active" : ""}
              onClick={() => selectGames(option.ids)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>窗口</span>
          <select value={windowHours} onChange={(event) => selectWindowHours(Number(event.target.value))}>
            <option value={24}>24 小时</option>
            <option value={72}>72 小时</option>
            <option value={168}>7 天</option>
            <option value={336}>14 天</option>
          </select>
        </label>
        <label className="field search-field">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者、关键词" />
        </label>
      </section>

      {error ? <div className="error-strip">{error}</div> : null}

      <section className="metrics-grid">
        <Metric label="总声量" value={data?.stats.total ?? 0} tone="green" hint="跳到全部条目" onClick={() => jumpToFeed()} />
        <Metric label="高风险" value={data?.stats.highRisk ?? 0} tone="red" hint="跳到高风险预警" onClick={jumpToAlerts} />
        <Metric
          label="负面占比"
          value={`${Math.round((data?.stats.negativeRate ?? 0) * 100)}%`}
          tone="gold"
          hint="筛选负面条目"
          onClick={() => jumpToFeed({ sentiment: "negative" })}
        />
        <Metric
          label="B站 / 贴吧 / 抖音"
          tone="blue"
          hint="分别跳到来源条目"
          value={
            <span className="split-metric">
              <button onClick={() => jumpToFeed({ source: "bilibili" })}>{data?.stats.bilibili ?? 0}</button>
              <i>/</i>
              <button onClick={() => jumpToFeed({ source: "tieba" })}>{data?.stats.tieba ?? 0}</button>
              <i>/</i>
              <button onClick={() => jumpToFeed({ source: "douyin" })}>{data?.stats.douyin ?? 0}</button>
            </span>
          }
        />
      </section>

      <section className="health-row">
        {visibleHealth.map((health, index) => (
          <div className="health-tile" key={`${health.source}-${health.gameId || "all"}-${index}`} title={health.message}>
            <div className="health-main">
              {health.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <strong>{health.sourceLabel}</strong>
              {health.gameId ? <span>{health.gameId.toUpperCase()}</span> : null}
            </div>
            <p>{health.message}</p>
            <div className="health-meta">
              <span>{health.itemCount} 条</span>
              <span>旧 {health.staleDropped}</span>
              <span>{health.latencyMs} ms</span>
            </div>
          </div>
        ))}
      </section>

      <section className="workspace-grid">
        <div className="chart-area">
          <div className="chart-heading">
            <div className="section-title">
              <Waves size={18} />
              <h2>声量趋势</h2>
            </div>
            <div className="chart-legend" aria-label="声量趋势筛选">
              <TrendLegendButton series="negative" label="负面" active={trendSeries.negative} onToggle={toggleTrendSeries} />
              <TrendLegendButton series="neutral" label="中性" active={trendSeries.neutral} onToggle={toggleTrendSeries} />
              <TrendLegendButton series="positive" label="正面" active={trendSeries.positive} onToggle={toggleTrendSeries} />
              <TrendLegendButton series="total" label="总声量折线" active={trendSeries.total} onToggle={toggleTrendSeries} />
              <small>柱子=情绪构成 · 折线=平滑趋势</small>
            </div>
          </div>
          <TrendChart data={data?.trends || []} visibleSeries={trendSeries} />
        </div>

        <div className="topic-area">
          <div className="section-title">
            <Filter size={18} />
            <h2>主题分布</h2>
          </div>
          <div className="topic-list">
            {(data?.topicStats || []).map((topic) => (
              <div className="topic-row" key={topic.topic}>
                <span>{topic.topic}</span>
                <div className="topic-bar">
                  <i style={{ width: `${Math.min(100, topic.count * 12)}%` }} />
                </div>
                <b>{topic.count}</b>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="alert-band" id="risk-alerts">
        <div className="section-title">
          <ShieldAlert size={18} />
          <h2>风险预警</h2>
        </div>
        <div className="alert-list">
          {(data?.alerts || []).length ? (
            data?.alerts.map((alert) => (
              <a className={`alert-item ${alert.riskLevel}`} href={alert.url} target="_blank" rel="noreferrer" key={alert.id}>
                <span>{riskText(alert.riskLevel)}</span>
                <strong>{alert.title}</strong>
                <small>{alert.gameName} · {formatAgo(alert.publishedAt)}</small>
                {alert.reasons.length ? <small className="alert-reasons">{alert.reasons.slice(0, 2).join(" / ")}</small> : null}
              </a>
            ))
          ) : (
            <p className="empty">暂无中高风险条目</p>
          )}
        </div>
      </section>

      <section className="feed-toolbar" id="latest-feed">
        <div>
          <h2>最新条目</h2>
          <p>{data ? `仅显示 ${formatDateTime(data.freshnessCutoff)} 之后的信息` : "等待数据"}</p>
        </div>
        <div className="filters">
          <select value={source} onChange={(event) => setSource(event.target.value as "all" | SourceType)}>
            <option value="all">全部来源</option>
            <option value="bilibili">B站</option>
            <option value="tieba">贴吧</option>
            <option value="douyin">抖音</option>
            <option value="bettafish">BettaFish</option>
          </select>
          <select value={risk} onChange={(event) => setRisk(event.target.value as "all" | RiskLevel)}>
            <option value="all">全部风险</option>
            <option value="high">高风险</option>
            <option value="medium">中风险</option>
            <option value="low">低风险</option>
          </select>
          <select value={sentiment} onChange={(event) => setSentiment(event.target.value as "all" | Sentiment)}>
            <option value="all">全部情绪</option>
            <option value="negative">负面</option>
            <option value="mixed">混合</option>
            <option value="neutral">中性</option>
            <option value="positive">正面</option>
          </select>
          <select value={topic} onChange={(event) => setTopic(event.target.value)}>
            <option value="all">全部主题</option>
            {topicOptions.map((option) => (
              <option value={option.topic} key={option.topic}>{`${option.topic} ${option.count}`}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="feed-list">
        {loading && !data ? <p className="empty">采集中...</p> : null}
        {filteredItems.map((item) => (
          <MonitorCard item={item} key={item.id} />
        ))}
        {!loading && data && filteredItems.length === 0 ? <p className="empty">当前筛选下没有新鲜条目</p> : null}
      </section>
        </>
      ) : (
        <BettaFishLabPage windowHours={windowHours} />
      )}
    </main>
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
          <button className="icon-button primary" type="button" onClick={() => loadLab(true)} disabled={loading} title="刷新测试台和舆情监控">
            <RefreshCw size={18} className={loading ? "spin" : ""} />
          </button>
        </div>
      </section>

      {error ? <div className="error-strip">{error}</div> : null}

      <BettaFishGlossaryPanel />

      <section className="metrics-grid lab-metrics">
        <Metric label="监控条目" value={totalMonitorItems} tone="green" hint={`${totalMonitorAlerts} 条高风险 · 复用主看板采集`} />
        <Metric label="导入命中" value={totalItems} tone="green" hint={`${totalRows} 行外部导出里匹配项目关键词`} />
        <Metric label="只读端点" value={`${reachableEndpoints}/${data?.endpointProbes.length ?? 0}`} tone="blue" hint="只检查状态，不触发搜索/爬虫/报告" />
        <Metric label="能力就绪" value={`${readyCapabilities}/${data?.capabilities.length ?? 0}`} tone="gold" hint="已可测试的 BettaFish 能力" />
        <Metric label="测试窗口" value={`${data?.windowHours ?? windowHours}h`} tone="red" hint={data ? `只统计 ${formatDateTime(data.freshnessCutoff)} 之后` : "沿用看板窗口"} />
      </section>

      {!data && loading ? <p className="empty">读取 BettaFish 测试状态...</p> : null}

      {data ? (
        <>
          <LabGameMonitorSection monitors={data.gameMonitors} loading={loading} onRefresh={() => loadLab(true)} />

          <LabActionPanel data={data} loadingAction={actionLoading} actionResult={actionResult} onAction={runAction} />

          <section className="lab-section">
            <div className="section-title">
              <Plug size={18} />
              <h2>能力说明与测试覆盖</h2>
            </div>
            <p className="section-note">每张卡片说明一个 BettaFish 能力：它是什么、当前在本平台怎么用、测试台能覆盖哪些检查，以及下一步该验证什么。</p>
            <div className="capability-grid">
              {data.capabilities.map((capability) => (
                <CapabilityCard capability={capability} key={capability.id} />
              ))}
            </div>
          </section>

          <section className="lab-section">
            <div className="section-title">
              <Database size={18} />
              <h2>导入解析测试</h2>
            </div>
            <p className="section-note">这里只读取授权导出和轻量 JSON 文本，验证外部数据能否被解析、匹配项目关键词并进入统一风险分析。</p>
            <div className="import-grid">
              {data.importPreviews.map((preview) => (
                <div className="import-preview" key={preview.gameId}>
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
          </section>

          <section className="lab-section">
            <div className="section-title">
              <FileText size={18} />
              <h2>只读端点探测</h2>
            </div>
            <p className="section-note">只读端点用于检查 BettaFish 是否在线、日志或模板是否可读，不会启动 Agent、爬虫或报告任务。</p>
            <div className="endpoint-list">
              {data.endpointProbes.map((probe) => (
                <div className="endpoint-row" key={probe.id}>
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
                        <ExternalLink size={16} />
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="lab-section recommendations">
            <div className="section-title">
              <ShieldAlert size={18} />
              <h2>接入建议</h2>
            </div>
            <div className="recommendation-list">
              {data.recommendations.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function BettaFishGlossaryPanel() {
  return (
    <section className="lab-glossary" aria-labelledby="bettafish-glossary-title">
      <div className="section-title glossary-title">
        <Info size={18} />
        <div>
          <h2 id="bettafish-glossary-title">术语说明</h2>
          <p className="section-note">先看这里再操作：测试台把 BettaFish 当作外部研究系统，每个名词都标清含义和在当前流程里的作用。</p>
        </div>
      </div>
      <div className="glossary-grid">
        {bettaFishGlossaryGroups.map((group) => (
          <article className="glossary-group" key={group.title}>
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
    </section>
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
    <section className="lab-section game-monitor-section">
      <div className="section-title monitor-section-title">
        <div>
          <Waves size={18} />
          <h2>生死1 / 生死2 舆情监测</h2>
        </div>
        <button className="lab-action-button manual compact-button" type="button" onClick={onRefresh} disabled={loading} title="刷新两个游戏的测试台监控快照">
          {loading ? "刷新中..." : "刷新监控"}
        </button>
      </div>
      <p className="section-note">这个区域复用正式看板的采集、语义判定、风险分类、来源健康和最新条目逻辑，只展示测试快照，不发送通知。</p>
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
          <strong>{monitor.gameName}</strong>
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
            <GameMonitorStat label="BettaFish" value={stats.bettafish} note="授权导入条目" />
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
  const [agentQuery, setAgentQuery] = React.useState("生死狙击最近玩家最主要的不满点是什么？");
  const [reportQuery, setReportQuery] = React.useState("生死狙击近 72 小时舆情复盘");
  const [reportTaskId, setReportTaskId] = React.useState("");
  const [sentimentText, setSentimentText] = React.useState("这次更新匹配体验变差了，外挂也有点多，希望官方尽快处理。");
  const [platformsText, setPlatformsText] = React.useState("dy");
  const [maxKeywords, setMaxKeywords] = React.useState(3);
  const [maxNotes, setMaxNotes] = React.useState(5);
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

  const run = (payload: Record<string, unknown>) => onAction(payload);
  const crawlerPlatforms = platformsText.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);

  return (
    <section className="lab-section action-console">
      <div className="section-title">
        <TestTube2 size={18} />
        <h2>研究操作测试台</h2>
      </div>
      <p className="section-note">这里的按钮用于验证 BettaFish 能力，不会进入正式监控链路；带 research 的操作可能启动服务、搜索、爬取或生成报告。</p>

      <div className="lab-status-strip">
        <StatusFact label="研究操作" value={data.runtime.actionsEnabled ? "已开启" : "未开启"} tone={data.runtime.actionsEnabled ? "ok" : "warning"} note="是否允许测试台执行启动、搜索、爬取和报告动作" />
        <StatusFact label="BettaFish URL" value={baseUrlValue} tone={data.runtime.baseUrlConfigured ? "ok" : "skipped"} note="外部 BettaFish Flask/API 服务地址" />
        <StatusFact label="Repo" value={repoValue} tone={data.runtime.repoConfigured ? "ok" : "skipped"} note="本机 BettaFish 仓库路径，本地命令依赖它" />
        <StatusFact label="Python" value={pythonValue} tone={data.runtime.pythonAvailable ? "ok" : "error"} note="执行 BettaFish 与 MindSpider 脚本的解释器" />
        <StatusFact label="MindSpider DB" value={mindSpiderDbValue} tone={data.mindSpider.dbDirectConfigured ? "ok" : "warning"} note="爬虫数据库直连状态，用来确认数据表可读" />
        <StatusFact label="部署命令" value={deployValue} tone={data.runtime.deployCommandConfigured ? "ok" : "skipped"} note="预先配置的固定部署脚本，不从页面拼命令" />
        <StatusFact label="本地进程" value={data.runtime.localProcessRunning ? "运行中" : "未运行"} tone={data.runtime.localProcessRunning ? "ok" : "skipped"} note="由测试台启动的 BettaFish 子进程状态" />
      </div>

      <div className="action-grid">
        <div className="action-panel">
          <h3>Query / Media / Insight Agent</h3>
          <p className="action-panel-note">启动三个 Agent 后，可以把同一个舆情问题交给 BettaFish 检索、抽取和归纳。</p>
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
            <textarea value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} rows={3} />
          </label>
          <ActionButton operation={op("agent.search")} busy={loadingAction === "agent.search"} disabled={isBusy} onClick={() => run({ action: "agent.search", query: agentQuery })} />
        </div>

        <div className="action-panel">
          <h3>ForumEngine</h3>
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

        <div className="action-panel">
          <h3>ReportEngine</h3>
          <p className="action-panel-note">生成专项舆情报告，并用 Task ID 跟踪进度、读取结果或取消任务。</p>
          <label className="lab-input">
            <span>报告主题</span>
            <small>报告生成时传给 BettaFish 的主题或分析问题。</small>
            <input value={reportQuery} onChange={(event) => setReportQuery(event.target.value)} />
          </label>
          <ActionButton operation={op("report.generate")} busy={loadingAction === "report.generate"} disabled={isBusy} onClick={() => run({ action: "report.generate", query: reportQuery })} />
          <label className="lab-input">
            <span>Task ID</span>
            <small>生成报告后返回的任务编号，用于查询同一份报告。</small>
            <input value={reportTaskId} onChange={(event) => setReportTaskId(event.target.value)} placeholder="report_..." />
          </label>
          <div className="mini-button-grid three">
            <ActionButton operation={op("report.progress")} busy={loadingAction === "report.progress"} disabled={isBusy} onClick={() => run({ action: "report.progress", taskId: reportTaskId })} />
            <ActionButton operation={op("report.resultJson")} busy={loadingAction === "report.resultJson"} disabled={isBusy} onClick={() => run({ action: "report.resultJson", taskId: reportTaskId })} />
            <ActionButton operation={op("report.cancel")} busy={loadingAction === "report.cancel"} disabled={isBusy} onClick={() => run({ action: "report.cancel", taskId: reportTaskId })} />
          </div>
        </div>

        <div className="action-panel">
          <h3>MindSpider</h3>
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
              <input value={platformsText} onChange={(event) => setPlatformsText(event.target.value)} />
            </label>
            <label className="lab-input">
              <span>关键词</span>
              <small>本次最多取多少个关键词。</small>
              <input type="number" min={1} max={50} value={maxKeywords} onChange={(event) => setMaxKeywords(Number(event.target.value))} />
            </label>
            <label className="lab-input">
              <span>条数</span>
              <small>每个测试任务最多抓取多少条。</small>
              <input type="number" min={1} max={50} value={maxNotes} onChange={(event) => setMaxNotes(Number(event.target.value))} />
            </label>
          </div>
          <ActionButton
            operation={op("mindspider.crawlTest")}
            busy={loadingAction === "mindspider.crawlTest"}
            disabled={isBusy}
            onClick={() => run({ action: "mindspider.crawlTest", platforms: crawlerPlatforms, maxKeywords, maxNotes })}
          />
        </div>

        <div className="action-panel">
          <h3>情感模型 / LLM</h3>
          <p className="action-panel-note">把一段文本交给 BettaFish 情感模型或 LLM，和本平台判定结果做并排校验。</p>
          <div className="candidate-list">
            <span>模型候选：{data.sentiment.modelCandidates.length}</span>
            <span>命令：{data.sentiment.commandConfigured ? "已配置" : "未配置"}</span>
          </div>
          <label className="lab-input">
            <span>待分析文本</span>
            <small>用于测试情绪、风险和语义判断的一段样本文本。</small>
            <textarea value={sentimentText} onChange={(event) => setSentimentText(event.target.value)} rows={4} />
          </label>
          <ActionButton operation={op("sentiment.analyze")} busy={loadingAction === "sentiment.analyze"} disabled={isBusy} onClick={() => run({ action: "sentiment.analyze", text: sentimentText })} />
        </div>

        <div className="action-panel">
          <h3>自动启动 / 控制 / 部署</h3>
          <p className="action-panel-note">验证外部 BettaFish 服务能否由测试台启动、关闭或执行固定部署命令。</p>
          <div className="mini-button-grid">
            <ActionButton operation={op("runtime.localStart")} busy={loadingAction === "runtime.localStart"} disabled={isBusy} onClick={() => run({ action: "runtime.localStart" })} />
            <ActionButton operation={op("runtime.localStop")} busy={loadingAction === "runtime.localStop"} disabled={isBusy} onClick={() => run({ action: "runtime.localStop" })} />
            <ActionButton operation={op("runtime.systemStart")} busy={loadingAction === "runtime.systemStart"} disabled={isBusy} onClick={() => run({ action: "runtime.systemStart" })} />
            <ActionButton operation={op("runtime.systemShutdown")} busy={loadingAction === "runtime.systemShutdown"} disabled={isBusy} onClick={() => run({ action: "runtime.systemShutdown" })} />
          </div>
          <ActionButton operation={op("runtime.deploy")} busy={loadingAction === "runtime.deploy"} disabled={isBusy} onClick={() => run({ action: "runtime.deploy" })} />
        </div>
      </div>

      {actionResult ? <ActionResultView result={actionResult} /> : null}
    </section>
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
  return (
    <button className={`lab-action-button ${operation.safety}`} type="button" disabled={isDisabled} onClick={onClick} title={operation.disabledReason || operation.description}>
      {busy ? "执行中..." : operation.label}
    </button>
  );
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
    <article className={`capability-card ${capability.status}`}>
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
      <i className={series === "total" ? "total-line" : series} />
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

function MonitorCard({ item }: { item: MonitorItem }) {
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
        <h3>{item.title}</h3>
        <p>{item.summary}</p>
        <div className="pill-row">
          <span className={`risk-pill ${item.riskLevel}`}>{riskText(item.riskLevel)}</span>
          <span className={`sentiment-pill ${item.sentiment}`}>{sentimentText(item.sentiment)}</span>
          {item.topics.slice(0, 4).map((topic) => (
            <span key={topic}>{topic}</span>
          ))}
          {item.riskReasons.slice(0, 3).map((reason) => (
            <span className="risk-reason" key={reason}>{reason}</span>
          ))}
          {item.keywords.slice(0, 4).map((keyword) => (
            <span key={keyword}>{keyword}</span>
          ))}
        </div>
      </div>
      <div className="item-side">
        <span>{item.author}</span>
        <span>{metricLine(item)}</span>
        <a href={item.url} target="_blank" rel="noreferrer" title="打开原文">
          <ExternalLink size={18} />
        </a>
      </div>
    </article>
  );
}

function Thumbnail({ item }: { item: MonitorItem }) {
  const [failed, setFailed] = React.useState(false);
  const imageUrl = item.thumbnail ? `/api/image?url=${encodeURIComponent(item.thumbnail)}` : "";

  if (!imageUrl || failed) {
    return (
      <div className="fallback-thumb">
        {item.source === "tieba" ? <Waves /> : <Video />}
      </div>
    );
  }

  return <img src={imageUrl} alt="" loading="lazy" onError={() => setFailed(true)} />;
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

function makeVisibleHealth(health: SourceHealth[], aggregateBySource: boolean) {
  if (!aggregateBySource) return health;
  const bySource = new Map<SourceType, SourceHealth[]>();
  for (const entry of health) {
    bySource.set(entry.source, [...(bySource.get(entry.source) || []), entry]);
  }
  const sourceOrder: SourceType[] = ["bilibili", "tieba", "douyin", "bettafish"];
  return Array.from(bySource.values())
    .map((entries) => {
      const [first] = entries;
      const gameLabels = entries.map((entry) => entry.gameId?.toUpperCase()).filter((value): value is string => Boolean(value));
      const issueMessages = Array.from(new Set(entries.filter((entry) => !entry.ok || entry.blocked).map((entry) => entry.message).filter(Boolean)));
      const fetchedAt = entries.reduce((latest, entry) => (new Date(entry.fetchedAt).getTime() > new Date(latest).getTime() ? entry.fetchedAt : latest), first.fetchedAt);
      return {
        ...first,
        gameId: undefined,
        ok: entries.every((entry) => entry.ok),
        fetchedAt,
        latencyMs: Math.max(...entries.map((entry) => entry.latencyMs)),
        itemCount: entries.reduce((sum, entry) => sum + entry.itemCount, 0),
        staleDropped: entries.reduce((sum, entry) => sum + entry.staleDropped, 0),
        blocked: entries.some((entry) => entry.blocked),
        message: issueMessages.length ? issueMessages.join(" / ") : `覆盖 ${gameLabels.join(" / ") || "全部项目"}`
      } satisfies SourceHealth;
    })
    .sort((left, right) => sourceOrder.indexOf(left.source) - sourceOrder.indexOf(right.source));
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
