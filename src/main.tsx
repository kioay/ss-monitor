import React from "react";
import ReactDOM from "react-dom/client";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Filter,
  RefreshCw,
  Search,
  ShieldAlert,
  Video,
  Waves
} from "lucide-react";
import type { GameConfig, GameId, MonitorItem, MonitorResponse, RiskLevel, Sentiment, SourceHealth, SourceType, TrendPoint } from "./shared";
import "./styles.css";

const api = {
  config: "/api/config",
  monitor: "/api/monitor"
};
const clientCacheMaxAgeMs = 4 * 3_600_000;

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

function App() {
  const [config, setConfig] = React.useState<{
    games: GameConfig[];
    defaultWindowHours: number;
    updatePolicy: MonitorResponse["updatePolicy"];
  }>();
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
          limit: "160",
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
      if (sameGameSelection(selectedGames, gameIds)) return;
      resetFeedFilters();
      setSelectedGames(gameIds);
    },
    [resetFeedFilters, selectedGames]
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
      window.requestAnimationFrame(() => document.getElementById("latest-feed")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    },
    []
  );
  const jumpToAlerts = React.useCallback(() => {
    setRisk("high");
    setSource("all");
    setSentiment("all");
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
          label="B站 / 贴吧 / 抖音 / BettaFish"
          tone="blue"
          hint="分别跳到来源条目"
          value={
            <span className="split-metric">
              <button onClick={() => jumpToFeed({ source: "bilibili" })}>{data?.stats.bilibili ?? 0}</button>
              <i>/</i>
              <button onClick={() => jumpToFeed({ source: "tieba" })}>{data?.stats.tieba ?? 0}</button>
              <i>/</i>
              <button onClick={() => jumpToFeed({ source: "douyin" })}>{data?.stats.douyin ?? 0}</button>
              <i>/</i>
              <button onClick={() => jumpToFeed({ source: "bettafish" })}>{data?.stats.bettafish ?? 0}</button>
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
    </main>
  );
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
    return "公开搜索";
  }
  if (item.source === "bettafish") {
    return "授权导入";
  }
  return `${formatNumber(item.metrics.replies)} 回复`;
}

function riskText(level: RiskLevel) {
  return level === "high" ? "高风险" : level === "medium" ? "中风险" : "低风险";
}

function sentimentText(value: Sentiment) {
  return value === "negative" ? "负面" : value === "positive" ? "正面" : value === "mixed" ? "混合" : "中性";
}

function formatNumber(value?: number) {
  if (!value) return "0";
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return String(value);
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
