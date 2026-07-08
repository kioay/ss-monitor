export type GameId = string;
export type SourceType = "bilibili" | "tieba" | "douyin" | "forum4399" | "bettafish";
export type Sentiment = "positive" | "neutral" | "negative" | "mixed";
export type RiskLevel = "low" | "medium" | "high";
export type RiskSignalSource = "thread" | "new_reply" | "stale_thread";
export type InspirationCategory = "weapon_skin" | "character_skin" | "general_reference";
export type InspirationAssetKind = "video" | "image";

export const currentAnalysisVersion = 3;

export interface InspirationSeedPreset {
  id: string;
  label: string;
  category: InspirationCategory;
  description: string;
  keywords: string[];
}

export const inspirationSeedPresets: InspirationSeedPreset[] = [
  {
    id: "valorant",
    label: "VALORANT",
    category: "general_reference",
    description: "无畏契约武器套装、检视动画、击杀特效、角色外观",
    keywords: [
      "无畏契约",
      "无畏契约 武器皮肤",
      "无畏契约 枪皮",
      "无畏契约 套装",
      "无畏契约 检视动画",
      "无畏契约 击杀特效",
      "无畏契约 角色皮肤",
      "VALORANT skin",
      "VALORANT bundle",
      "VALORANT weapon skin"
    ]
  },
  {
    id: "apex",
    label: "Apex",
    category: "general_reference",
    description: "Apex 英雄武器皮肤、传奇皮肤、传家宝、活动套装",
    keywords: [
      "Apex",
      "Apex 英雄",
      "Apex 武器皮肤",
      "Apex 枪皮",
      "Apex 传奇皮肤",
      "Apex 传家宝",
      "Apex 活动皮肤",
      "Apex 外观展示",
      "Apex skins",
      "Apex heirloom",
      "Apex weapon skin"
    ]
  },
  {
    id: "call-of-duty",
    label: "COD",
    category: "general_reference",
    description: "使命召唤干员皮肤、蓝图枪、曳光包、处决展示",
    keywords: [
      "使命召唤",
      "使命召唤 武器皮肤",
      "使命召唤 枪械蓝图",
      "使命召唤 干员皮肤",
      "使命召唤 曳光包",
      "使命召唤 处决",
      "COD weapon skin",
      "COD operator skin",
      "Warzone bundle",
      "tracer pack"
    ]
  },
  {
    id: "delta-force",
    label: "三角洲行动",
    category: "general_reference",
    description: "三角洲行动枪械外观、干员皮肤、赛季活动素材",
    keywords: [
      "三角洲行动",
      "三角洲行动 武器皮肤",
      "三角洲行动 枪皮",
      "三角洲行动 干员皮肤",
      "三角洲行动 外观",
      "三角洲行动 赛季皮肤",
      "Delta Force skin",
      "Delta Force weapon skin",
      "Delta Force operator skin"
    ]
  },
  {
    id: "overwatch",
    label: "守望先锋",
    category: "general_reference",
    description: "守望先锋英雄皮肤、神话皮肤、武器外观、特效展示",
    keywords: [
      "守望先锋",
      "守望先锋 皮肤",
      "守望先锋 英雄皮肤",
      "守望先锋 神话皮肤",
      "守望先锋 武器皮肤",
      "守望先锋 外观展示",
      "Overwatch skin",
      "Overwatch mythic skin",
      "Overwatch weapon skin"
    ]
  },
  {
    id: "pubg",
    label: "PUBG",
    category: "general_reference",
    description: "PUBG 枪皮、角色套装、联名皮肤、通行证外观",
    keywords: [
      "PUBG",
      "绝地求生",
      "PUBG 武器皮肤",
      "PUBG 枪皮",
      "PUBG 角色皮肤",
      "PUBG 套装",
      "绝地求生 皮肤",
      "绝地求生 枪皮",
      "PUBG skin",
      "PUBG weapon skin"
    ]
  },
  {
    id: "cs2",
    label: "CS2",
    category: "weapon_skin",
    description: "CS2 枪皮、刀皮、手套、饰品磨损和市场审美",
    keywords: [
      "CS2",
      "反恐精英2",
      "CS2 枪皮",
      "CS2 武器皮肤",
      "CS2 刀皮",
      "CS2 手套",
      "反恐精英2 皮肤",
      "CSGO 枪皮",
      "CS2 skin",
      "CS2 knife skin",
      "CS2 weapon skin"
    ]
  },
  {
    id: "fortnite",
    label: "堡垒之夜",
    category: "character_skin",
    description: "堡垒之夜角色皮肤、联名套装、背饰和动作展示",
    keywords: [
      "堡垒之夜",
      "堡垒之夜 皮肤",
      "堡垒之夜 角色皮肤",
      "堡垒之夜 联名皮肤",
      "堡垒之夜 套装",
      "Fortnite skin",
      "Fortnite outfit",
      "Fortnite bundle",
      "Fortnite cosmetics"
    ]
  }
];

export interface GameConfig {
  id: GameId;
  name: string;
  shortName: string;
  bilibiliKeywords: string[];
  douyinKeywords: string[];
  tiebaBars: string[];
  tiebaKeywords: string[];
  tiebaBarKeywords?: Record<string, string[]>;
  forum4399Tags?: string[];
  forum4399Keywords?: string[];
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
  forum4399: number;
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

export interface InspirationAsset {
  id: string;
  item: MonitorItem;
  kind: InspirationAssetKind;
  category: InspirationCategory;
  score: number;
  matchedSeeds: string[];
  visualTags: string[];
  reason: string;
}

export interface InspirationStats {
  total: number;
  videos: number;
  images: number;
  weaponSkins: number;
  characterSkins: number;
  sourceBreakdown: Array<{
    source: SourceType;
    count: number;
  }>;
}

export interface InspirationResponse {
  generatedAt: string;
  windowHours: number;
  query: string;
  category: "all" | InspirationCategory;
  kind: "all" | InspirationAssetKind;
  totalMatched: number;
  stats: InspirationStats;
  seeds: InspirationSeedPreset[];
  assets: InspirationAsset[];
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
