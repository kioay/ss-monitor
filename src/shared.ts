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
  },
  {
    id: "arena-breakout",
    label: "暗区突围",
    category: "general_reference",
    description: "暗区突围枪械涂装、战术装备、角色套装和赛季外观",
    keywords: [
      "暗区突围 武器皮肤",
      "暗区突围 枪械皮肤",
      "暗区突围 枪皮",
      "暗区突围 套装",
      "暗区突围 角色皮肤",
      "暗区突围 外观展示",
      "Arena Breakout weapon skin",
      "Arena Breakout outfit",
      "Arena Breakout cosmetics"
    ]
  },
  {
    id: "lost-light",
    label: "萤火突击",
    category: "general_reference",
    description: "萤火突击枪械涂装、战术服装、活动套装和仓库展示",
    keywords: [
      "萤火突击 武器皮肤",
      "萤火突击 枪械皮肤",
      "萤火突击 枪皮",
      "萤火突击 角色皮肤",
      "萤火突击 套装",
      "萤火突击 外观展示",
      "Lost Light weapon skin",
      "Lost Light outfit",
      "Lost Light cosmetics"
    ]
  },
  {
    id: "arc-raiders",
    label: "ARC Raiders",
    category: "general_reference",
    description: "ARC Raiders 撤离射击装备、角色服装、武器外观和科幻道具",
    keywords: [
      "ARC Raiders 武器皮肤",
      "ARC Raiders 武器外观",
      "ARC Raiders 角色皮肤",
      "ARC Raiders 套装",
      "ARC Raiders 外观展示",
      "arcRiders weapon skin",
      "arcRiders outfit",
      "ARC Raiders cosmetics"
    ]
  },
  {
    id: "warframe",
    label: "Warframe",
    category: "general_reference",
    description: "Warframe 战甲皮肤、武器外观、披饰、Prime 和 TennoGen 参考",
    keywords: [
      "Warframe 皮肤",
      "Warframe 战甲皮肤",
      "Warframe 武器皮肤",
      "Warframe 外观展示",
      "Warframe Prime 外观",
      "Warframe TennoGen",
      "Warframe skin",
      "Warframe weapon skin",
      "Warframe cosmetics"
    ]
  },
  {
    id: "bloodstrike",
    label: "Blood Strike",
    category: "general_reference",
    description: "血战英雄外观、武器皮肤、赛季套装和移动端射击审美",
    keywords: [
      "血战 武器皮肤",
      "血战 枪皮",
      "血战 角色皮肤",
      "血战 套装",
      "血战 外观展示",
      "Blood Strike weapon skin",
      "Blood Strike character skin",
      "Blood Strike outfit",
      "Blood Strike cosmetics"
    ]
  },
  {
    id: "peace-elite",
    label: "和平精英",
    category: "general_reference",
    description: "和平精英升级枪、角色套装、载具皮肤、联名和商城外观",
    keywords: [
      "和平精英 武器皮肤",
      "和平精英 枪皮",
      "和平精英 升级枪",
      "和平精英 角色皮肤",
      "和平精英 套装",
      "和平精英 外观展示",
      "和平精英 载具皮肤",
      "Peace Elite weapon skin",
      "Peace Elite outfit"
    ]
  },
  {
    id: "knives-out",
    label: "荒野行动",
    category: "general_reference",
    description: "荒野行动枪械皮肤、角色时装、联动套装和载具外观",
    keywords: [
      "荒野行动 武器皮肤",
      "荒野行动 枪皮",
      "荒野行动 角色皮肤",
      "荒野行动 时装",
      "荒野行动 套装",
      "荒野行动 外观展示",
      "Knives Out weapon skin",
      "Knives Out outfit",
      "Knives Out cosmetics"
    ]
  },
  {
    id: "halo",
    label: "Halo",
    category: "general_reference",
    description: "Halo 装甲涂装、武器涂装、载具涂装和科幻军武轮廓",
    keywords: [
      "Halo 装甲皮肤",
      "Halo 武器皮肤",
      "Halo 武器外观",
      "Halo 涂装",
      "Halo 外观展示",
      "Halo armor coating",
      "Halo weapon coating",
      "Halo cosmetics"
    ]
  },
  {
    id: "doom",
    label: "DOOM",
    category: "weapon_skin",
    description: "DOOM 武器造型、恶魔角色、机甲装备和重金属科幻材质",
    keywords: [
      "DOOM 武器外观",
      "DOOM 武器设计",
      "DOOM 角色设计",
      "DOOM 皮肤",
      "DOOM 外观展示",
      "DOOM weapon design",
      "DOOM weapon skin",
      "DOOM character design"
    ]
  },
  {
    id: "destiny-2",
    label: "命运2",
    category: "general_reference",
    description: "命运2异域武器皮肤、护甲外观、装饰品、赛季套装和光效",
    keywords: [
      "命运2 武器皮肤",
      "命运2 武器外观",
      "命运2 护甲皮肤",
      "命运2 套装",
      "命运2 装饰品",
      "命运2 外观展示",
      "Destiny 2 weapon ornament",
      "Destiny 2 armor ornament",
      "Destiny 2 cosmetics"
    ]
  },
  {
    id: "rainbow-six-siege",
    label: "彩虹六号",
    category: "general_reference",
    description: "彩虹六号干员皮肤、精英套装、武器涂装和战术装备外观",
    keywords: [
      "彩虹六号 武器皮肤",
      "彩虹六号 干员皮肤",
      "彩虹六号 精英皮肤",
      "彩虹六号 套装",
      "彩虹六号 外观展示",
      "Rainbow Six Siege weapon skin",
      "Rainbow Six Siege operator skin",
      "Rainbow Six Siege elite skin"
    ]
  },
  {
    id: "the-finals",
    label: "THE FINALS",
    category: "general_reference",
    description: "THE FINALS 选手服装、武器皮肤、贴纸、道具和赛季外观",
    keywords: [
      "THE FINALS 武器皮肤",
      "THE FINALS 角色皮肤",
      "THE FINALS 套装",
      "THE FINALS 外观展示",
      "最终决战 武器皮肤",
      "最终决战 角色皮肤",
      "THE FINALS weapon skin",
      "THE FINALS outfit",
      "THE FINALS cosmetics"
    ]
  },
  {
    id: "marvel-rivals",
    label: "漫威争锋",
    category: "character_skin",
    description: "漫威争锋英雄皮肤、漫画联动套装、武器配件和技能特效",
    keywords: [
      "漫威争锋 皮肤",
      "漫威争锋 英雄皮肤",
      "漫威争锋 角色皮肤",
      "漫威争锋 套装",
      "漫威争锋 外观展示",
      "Marvel Rivals skin",
      "Marvel Rivals costume",
      "Marvel Rivals cosmetics"
    ]
  },
  {
    id: "fragpunk",
    label: "FragPunk",
    category: "general_reference",
    description: "FragPunk 英雄外观、武器皮肤、卡牌视觉和赛博涂装",
    keywords: [
      "FragPunk 武器皮肤",
      "FragPunk 角色皮肤",
      "FragPunk 英雄皮肤",
      "FragPunk 套装",
      "FragPunk 外观展示",
      "界外狂潮 武器皮肤",
      "界外狂潮 角色皮肤",
      "FragPunk weapon skin",
      "FragPunk cosmetics"
    ]
  },
  {
    id: "strinova",
    label: "卡拉彼丘",
    category: "general_reference",
    description: "卡拉彼丘角色时装、武器皮肤、二次元战术射击外观和纸片化特效",
    keywords: [
      "卡拉彼丘 武器皮肤",
      "卡拉彼丘 枪皮",
      "卡拉彼丘 角色皮肤",
      "卡拉彼丘 时装",
      "卡拉彼丘 套装",
      "卡拉彼丘 外观展示",
      "Strinova weapon skin",
      "Strinova character skin",
      "Strinova cosmetics"
    ]
  },
  {
    id: "escape-from-tarkov",
    label: "塔科夫",
    category: "weapon_skin",
    description: "逃离塔科夫枪械改装、配件组合、战术装备和拟真材质参考",
    keywords: [
      "逃离塔科夫 武器外观",
      "逃离塔科夫 枪械改装",
      "逃离塔科夫 枪械皮肤",
      "逃离塔科夫 装备外观",
      "塔科夫 武器外观",
      "Escape from Tarkov weapon customization",
      "Escape from Tarkov weapon skin",
      "Tarkov weapon build"
    ]
  },
  {
    id: "helldivers-2",
    label: "Helldivers 2",
    category: "general_reference",
    description: "Helldivers 2 护甲套装、披风、武器造型和军武科幻阵营包装",
    keywords: [
      "Helldivers 2 护甲皮肤",
      "Helldivers 2 武器外观",
      "Helldivers 2 套装",
      "Helldivers 2 披风",
      "Helldivers 2 外观展示",
      "绝地潜兵2 护甲皮肤",
      "绝地潜兵2 武器外观",
      "Helldivers 2 armor",
      "Helldivers 2 cosmetics"
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
