export type GameId = string;
export type SourceType = "bilibili" | "tieba" | "douyin" | "bettafish";
export type Sentiment = "positive" | "neutral" | "negative" | "mixed";
export type RiskLevel = "low" | "medium" | "high";
export type RiskSignalSource = "thread" | "new_reply" | "stale_thread";

export const currentAnalysisVersion = 3;

export interface GameConfig {
  id: GameId;
  name: string;
  shortName: string;
  bilibiliKeywords: string[];
  douyinKeywords: string[];
  tiebaBars: string[];
}

export interface ContentPart {
  type: "title" | "description" | "tag" | "comment" | "danmaku" | "subtitle" | "post";
  text: string;
  count?: number;
  publishedAt?: string;
}

export interface MonitorItem {
  id: string;
  gameId: GameId;
  gameName: string;
  source: SourceType;
  sourceLabel: string;
  sourceItemId: string;
  title: string;
  author: string;
  url: string;
  thumbnail?: string;
  publishedAt: string;
  collectedAt: string;
  freshnessHours: number;
  metrics: {
    views?: number;
    replies?: number;
    comments?: number;
    likes?: number;
    danmaku?: number;
    favorites?: number;
    shares?: number;
  };
  contentParts: ContentPart[];
  parsedContentCount: number;
  summary: string;
  keywords: string[];
  topics: string[];
  sentiment: Sentiment;
  sentimentScore: number;
  analysisVersion?: number;
  riskLevel: RiskLevel;
  riskReasons: string[];
  riskSignalSource?: RiskSignalSource;
  riskSignalAt?: string;
}

export interface SourceHealth {
  source: SourceType;
  sourceLabel: string;
  gameId?: GameId;
  ok: boolean;
  fetchedAt: string;
  latencyMs: number;
  itemCount: number;
  staleDropped: number;
  blocked?: boolean;
  message: string;
}

export interface MonitorStats {
  total: number;
  highRisk: number;
  mediumRisk: number;
  negativeRate: number;
  bilibili: number;
  tieba: number;
  douyin: number;
  bettafish: number;
  freshestAt?: string;
}

export interface TrendPoint {
  bucket: string;
  total: number;
  positive: number;
  neutral: number;
  negative: number;
  highRisk: number;
}

export interface TopicStat {
  topic: string;
  count: number;
  negative: number;
  risk: number;
}

export interface AlertItem {
  id: string;
  title: string;
  source: SourceType;
  gameName: string;
  riskLevel: RiskLevel;
  reasons: string[];
  url: string;
  publishedAt: string;
  riskSignalSource?: RiskSignalSource;
}

export interface BettaFishPanelCapability {
  id: "import" | "semantic" | "status";
  label: string;
  value: string;
  description: string;
  evidence: string[];
}

export type KeywordEffectivenessStatus = "effective" | "weak" | "no_match";

export interface KeywordEffectiveness {
  keyword: string;
  status: KeywordEffectivenessStatus;
  matchedItems: number;
  highRisk: number;
  mediumRisk: number;
  sources: SourceType[];
  latestAt?: string;
  sampleTitles: string[];
}

export interface MonitorResponse {
  generatedAt: string;
  windowHours: number;
  freshnessCutoff: string;
  analysisVersion: number;
  riskBacktest: RiskBacktestStatus;
  updatePolicy: {
    mode: "day" | "night";
    intervalSeconds: number;
    nextUpdateAt: string;
    nightStartHour: number;
    nightEndHour: number;
    label: string;
  };
  cache: {
    hit: boolean;
    ageSeconds: number;
    ttlSeconds: number;
  };
  stats: MonitorStats;
  trends: TrendPoint[];
  topicStats: TopicStat[];
  alerts: AlertItem[];
  health: SourceHealth[];
  keywordEffectiveness: KeywordEffectiveness[];
  bettafishCapabilities?: BettaFishPanelCapability[];
  items: MonitorItem[];
}

export interface RiskBacktestStatus {
  status: "idle" | "running" | "passed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  caseCount?: number;
  message: string;
  details?: string;
}

export type SearchResultOrigin = "monitor-history" | "mindspider-douyin-db";

export interface SearchMatchSnippet {
  field: string;
  label: string;
  text: string;
}

export interface SearchResult {
  item: MonitorItem;
  score: number;
  matchedFields: string[];
  snippets: SearchMatchSnippet[];
  origin: SearchResultOrigin;
}

export interface SearchSourceSummary {
  origin: SearchResultOrigin;
  label: string;
  checked: boolean;
  matched: number;
  message: string;
}

export interface SearchResponse {
  generatedAt: string;
  query: string;
  terms: string[];
  windowHours: number;
  limit: number;
  totalMatched: number;
  sources: SearchSourceSummary[];
  items: SearchResult[];
  errors: string[];
}

export type BettaFishProbeStatus = "ok" | "warning" | "error" | "skipped";
export type BettaFishOperationSafety = "read" | "manual" | "research";

export interface BettaFishEndpointProbe {
  id: string;
  label: string;
  method: "GET";
  path: string;
  target?: string;
  status: BettaFishProbeStatus;
  latencyMs: number;
  message: string;
  checkedAt: string;
}

export interface BettaFishCapability {
  id: string;
  name: string;
  goal: string;
  currentProjectUse: string;
  testCoverage: string;
  status: BettaFishProbeStatus;
  evidence: string[];
  nextStep: string;
}

export interface BettaFishImportPreview {
  gameId: GameId;
  gameName: string;
  fileCount: number;
  rowCount: number;
  matchedItems: number;
  staleDropped: number;
  errors: string[];
  samples: MonitorItem[];
}

export interface BettaFishGameMonitor {
  gameId: GameId;
  gameName: string;
  status: BettaFishProbeStatus;
  message: string;
  response?: MonitorResponse;
}

export interface BettaFishRuntimeStatus {
  actionsEnabled: boolean;
  repoConfigured: boolean;
  repoAutoDetected: boolean;
  repoDir?: string;
  python: string;
  pythonAvailable: boolean;
  pythonVersion?: string;
  localProcessRunning: boolean;
  baseUrlConfigured: boolean;
  baseUrlAutoConfigured: boolean;
  startCommandConfigured: boolean;
  startCommandAutoConfigured: boolean;
  deployCommandConfigured: boolean;
  deployCommandAutoConfigured: boolean;
  sentimentCommandConfigured: boolean;
}

export interface BettaFishLoginStateCandidate {
  label: string;
  path: string;
  exists: boolean;
  fileCount?: number;
  latestModifiedAt?: string;
}

export interface BettaFishMindSpiderStatus {
  repoAvailable: boolean;
  dbDirectConfigured: boolean;
  dbDialect?: "mysql" | "postgresql" | "sqlite";
  sqlitePath?: string;
  crawlerPlatforms: string[];
  tables: string[];
  loginStateCandidates: BettaFishLoginStateCandidate[];
}

export interface BettaFishSentimentStatus {
  localModelsAvailable: boolean;
  commandConfigured: boolean;
  bridgeAvailable: boolean;
  modelCandidates: Array<{
    name: string;
    path: string;
    kind: string;
  }>;
}

export interface BettaFishOperation {
  id: string;
  group: "agents" | "forum" | "report" | "mindspider" | "sentiment" | "runtime";
  label: string;
  description: string;
  safety: BettaFishOperationSafety;
  enabled: boolean;
  disabledReason?: string;
  target?: string;
}

export interface BettaFishLabResponse {
  generatedAt: string;
  mode: "test-lab";
  windowHours: number;
  freshnessCutoff: string;
  importDir: string;
  baseUrlConfigured: boolean;
  baseUrl?: string;
  runtime: BettaFishRuntimeStatus;
  mindSpider: BettaFishMindSpiderStatus;
  sentiment: BettaFishSentimentStatus;
  operations: BettaFishOperation[];
  gameMonitors: BettaFishGameMonitor[];
  importPreviews: BettaFishImportPreview[];
  endpointProbes: BettaFishEndpointProbe[];
  capabilities: BettaFishCapability[];
  recommendations: string[];
}

export interface BettaFishActionResponse {
  ok: boolean;
  action: string;
  generatedAt: string;
  message: string;
  target?: string;
  taskId?: string;
  result?: unknown;
  output?: string[];
}

export type DouyinCrawlIssueType = "login" | "crawl" | "config";
export type DouyinCrawlIssueSeverity = "warning" | "error";

export interface DouyinCrawlStatusIssue {
  type: DouyinCrawlIssueType;
  severity: DouyinCrawlIssueSeverity;
  message: string;
  detail?: string;
}

export interface DouyinCrawlServiceStatus {
  available: boolean;
  activeState?: string;
  subState?: string;
  result?: string;
  execMainStatus?: number;
  execMainStartTimestamp?: string;
  execMainExitTimestamp?: string;
  message?: string;
}

export interface DouyinCrawlSchedulerState {
  exists: boolean;
  lastCompletedAt?: string;
  mode?: "day" | "night";
  intervalMinutes?: number;
  loginType?: string;
  saveDataOption?: string;
  headless?: boolean;
  nextEligibleAt?: string;
  ageSeconds?: number;
}

export interface DouyinLoginProfileStatus {
  checked: boolean;
  profileDir: string;
  exists: boolean;
  cookieDbCount: number;
  hasSessionCookie: boolean;
  cookieConfigured?: boolean;
  configReadable?: boolean;
  latestCookieModifiedAt?: string;
  error?: string;
}

export interface DouyinRemoteLoginStatus {
  ready: boolean;
  url: string;
  setupCommand: string;
  message: string;
  missing: string[];
}

export interface DouyinCrawlStatus {
  generatedAt: string;
  status: BettaFishProbeStatus;
  ok: boolean;
  loginOk: boolean;
  crawlOk: boolean;
  message: string;
  issues: DouyinCrawlStatusIssue[];
  remoteLoginUrl?: string;
  remoteLogin: DouyinRemoteLoginStatus;
  service: DouyinCrawlServiceStatus;
  scheduler: DouyinCrawlSchedulerState;
  loginProfile: DouyinLoginProfileStatus;
}
