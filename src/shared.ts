export type GameId = "ss1" | "ss2";
export type SourceType = "bilibili" | "tieba" | "douyin" | "bettafish";
export type Sentiment = "positive" | "neutral" | "negative" | "mixed";
export type RiskLevel = "low" | "medium" | "high";

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
  riskLevel: RiskLevel;
  riskReasons: string[];
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
}

export interface MonitorResponse {
  generatedAt: string;
  windowHours: number;
  freshnessCutoff: string;
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
  items: MonitorItem[];
}

export type BettaFishProbeStatus = "ok" | "warning" | "error" | "skipped";

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

export interface BettaFishLabResponse {
  generatedAt: string;
  mode: "read-only";
  windowHours: number;
  freshnessCutoff: string;
  importDir: string;
  baseUrlConfigured: boolean;
  baseUrl?: string;
  importPreviews: BettaFishImportPreview[];
  endpointProbes: BettaFishEndpointProbe[];
  capabilities: BettaFishCapability[];
  recommendations: string[];
}
