import "dotenv/config";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { GameConfig, GameId } from "../src/shared";

const defaultGames: GameConfig[] = [
  {
    id: "ss1",
    name: "生死狙击1",
    shortName: "SS1",
    bilibiliKeywords: ["生死狙击", "生死狙击1", "4399生死狙击", "生死狙击页游"],
    douyinKeywords: ["生死狙击", "生死狙击1", "4399生死狙击", "生死狙击页游"],
    tiebaBars: ["生死狙击"],
    tiebaKeywords: []
  },
  {
    id: "ss2",
    name: "生死狙击2",
    shortName: "SS2",
    bilibiliKeywords: ["生死狙击2", "生死狙击2热油"],
    douyinKeywords: ["生死狙击2", "生死狙击2热油"],
    tiebaBars: ["生死狙击2"],
    tiebaKeywords: []
  }
];

export const games: GameConfig[] = loadConfiguredGames();
export const gameById = new Map<GameId, GameConfig>(games.map((game) => [game.id, game]));

const detectedBettaFishRepoDir = resolveBettaFishRepoDir(process.env.BETTAFISH_REPO_DIR || "");
const bettaFishRuntimeRepoDetected = Boolean(detectedBettaFishRepoDir && isBettaFishRepo(detectedBettaFishRepoDir));
const bettaFishRepoAutoDetected = Boolean(bettaFishRuntimeRepoDetected && !process.env.BETTAFISH_REPO_DIR);
const bettaFishRoot = process.env.BETTAFISH_ROOT || process.env.DOUYIN_SERVER_BETTAFISH_ROOT || inferBettaFishRoot(detectedBettaFishRepoDir);
const bettaFishPython = process.env.BETTAFISH_PYTHON || detectBettaFishPython(detectedBettaFishRepoDir) || detectPythonCommand();
const bettaFishStartCommand = process.env.BETTAFISH_START_COMMAND || (bettaFishRuntimeRepoDetected ? `${quoteShell(bettaFishPython)} app.py` : "");
const bettaFishDeployCommand = process.env.BETTAFISH_DEPLOY_COMMAND || (bettaFishRuntimeRepoDetected ? "git pull --ff-only && git submodule update --init --recursive" : "");
const bettaFishBaseUrl = normalizeOptionalBaseUrl(process.env.BETTAFISH_BASE_URL || (bettaFishRuntimeRepoDetected ? "http://127.0.0.1:5000" : ""));
const mindSpiderDouyinImportDir = process.env.MINDSPIDER_DOUYIN_IMPORT_DIR
  || process.env.MINDSPIDER_IMPORT_DIR
  || [
    "data/mindspider-douyin-imports",
    bettaFishRuntimeRepoDetected ? path.join(detectedBettaFishRepoDir, "MindSpider", "DeepSentimentCrawling", "MediaCrawler", "data") : ""
  ].filter(Boolean).join(path.delimiter);

export const runtimeConfig = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || "127.0.0.1",
  dayUpdateSeconds: Math.max(60, Number(process.env.DAY_UPDATE_INTERVAL_MINUTES || 60) * 60),
  nightUpdateSeconds: Math.max(60, Number(process.env.NIGHT_UPDATE_INTERVAL_MINUTES || 240) * 60),
  nightStartHour: clampHour(Number(process.env.NIGHT_START_HOUR || 0)),
  nightEndHour: clampHour(Number(process.env.NIGHT_END_HOUR || 8)),
  defaultWindowHours: Math.max(1, Number(process.env.DEFAULT_WINDOW_HOURS || 72)),
  bilibiliCookie: process.env.BILIBILI_COOKIE || "",
  baiduCookie: process.env.BAIDU_COOKIE || "",
  confluenceToken: process.env.CONFLUENCE_TOKEN || "",
  confluencePageId: process.env.CONFLUENCE_PAGE_ID || "231710712",
  currentVersionFocusCachePath: process.env.CURRENT_VERSION_FOCUS_CACHE_PATH || "data/current-version-focus.json",
  monitorSnapshotPath: process.env.MONITOR_SNAPSHOT_PATH || "data/monitor-snapshot.json",
  monitorHistoryPath: process.env.MONITOR_HISTORY_PATH || "data/monitor-history.json",
  monitorHistoryRetentionHours: Math.max(24, Number(process.env.MONITOR_HISTORY_RETENTION_HOURS || 24 * 30)),
  monitorHistoryMaxItems: Math.max(100, Number(process.env.MONITOR_HISTORY_MAX_ITEMS || 5000)),
  douyinImportDir: process.env.DOUYIN_IMPORT_DIR || "data/douyin-imports",
  douyinAuthorizedSourcesPath: process.env.DOUYIN_AUTHORIZED_SOURCES_PATH || "data/douyin-authorized-sources.json",
  douyinPublicSearchEnabled: parseBoolean(process.env.DOUYIN_PUBLIC_SEARCH_ENABLED || "false"),
  bettaFishBaseUrl,
  bettaFishBaseUrlAutoConfigured: Boolean(bettaFishBaseUrl && !process.env.BETTAFISH_BASE_URL),
  bettaFishImportDir: process.env.BETTAFISH_IMPORT_DIR || "data/bettafish-imports",
  bettaFishLabActionsEnabled: parseBoolean(process.env.BETTAFISH_LAB_ACTIONS_ENABLED || "true"),
  bettaFishRoot,
  bettaFishRepoDir: detectedBettaFishRepoDir,
  bettaFishRepoAutoDetected,
  bettaFishPython,
  bettaFishStartCommand,
  bettaFishStartCommandAutoConfigured: Boolean(bettaFishStartCommand && !process.env.BETTAFISH_START_COMMAND),
  bettaFishDeployCommand,
  bettaFishDeployCommandAutoConfigured: Boolean(bettaFishDeployCommand && !process.env.BETTAFISH_DEPLOY_COMMAND),
  bettaFishSentimentCommand: process.env.BETTAFISH_SENTIMENT_COMMAND || "",
  bettaFishSemanticEnabled: parseBoolean(process.env.BETTAFISH_SEMANTIC_ENABLED || (detectedBettaFishRepoDir ? "true" : "false")),
  bettaFishSemanticCommand: process.env.BETTAFISH_SEMANTIC_COMMAND || "",
  bettaFishSemanticModels: process.env.BETTAFISH_SEMANTIC_MODELS || "bayes",
  bettaFishSemanticMaxItems: Math.max(1, Number(process.env.BETTAFISH_SEMANTIC_MAX_ITEMS || 80)),
  bettaFishSemanticTimeoutMs: Math.max(1000, Number(process.env.BETTAFISH_SEMANTIC_TIMEOUT_MS || 15_000)),
  bettaFishSemanticMinConfidence: clampRatio(Number(process.env.BETTAFISH_SEMANTIC_MIN_CONFIDENCE || 0.56)),
  bettaFishSemanticOverrideConfidence: clampRatio(Number(process.env.BETTAFISH_SEMANTIC_OVERRIDE_CONFIDENCE || 0.72)),
  bettaFishSemanticRiskConfidence: clampRatio(Number(process.env.BETTAFISH_SEMANTIC_RISK_CONFIDENCE || 0.78)),
  bettaFishSemanticFailureCooldownSeconds: Math.max(0, Number(process.env.BETTAFISH_SEMANTIC_FAILURE_COOLDOWN_SECONDS || 600)),
  mindSpiderDouyinEnabled: parseBoolean(process.env.MINDSPIDER_DOUYIN_ENABLED || "true"),
  mindSpiderDouyinImportDir,
  douyinCrawlServiceName: process.env.BETTAFISH_DOUYIN_CRAWL_SERVICE || "ss-monitor-douyin-crawl.service",
  douyinCrawlTimerName: process.env.BETTAFISH_DOUYIN_CRAWL_TIMER || "ss-monitor-douyin-crawl.timer",
  douyinCrawlLoginType: process.env.BETTAFISH_DOUYIN_LOGIN_TYPE || process.env.SERVER_DOUYIN_LOGIN_TYPE || "cookie",
  douyinCrawlStatePath: process.env.BETTAFISH_DOUYIN_STATE_PATH
    || path.join(process.env.BETTAFISH_DOUYIN_STATE_DIR || path.join(bettaFishRoot, "runtime", "douyin-crawl-scheduler"), "state.env"),
  douyinMediaCrawlerDir: process.env.BETTAFISH_DOUYIN_MEDIA_CRAWLER_DIR
    || path.join(detectedBettaFishRepoDir || path.join(bettaFishRoot, "current"), "MindSpider", "DeepSentimentCrawling", "MediaCrawler"),
  douyinRemoteLoginUrl: process.env.DOUYIN_REMOTE_LOGIN_URL || process.env.BETTAFISH_DOUYIN_REMOTE_LOGIN_URL || "",
  douyinRemoteLoginServiceName: process.env.DOUYIN_REMOTE_LOGIN_SERVICE || "ss-monitor-douyin-remote-login.service",
  mindSpiderEnvFile: process.env.MINDSPIDER_ENV_FILE || "",
  mindSpiderDouyinTable: process.env.MINDSPIDER_DOUYIN_TABLE || "douyin_aweme",
  mindSpiderDouyinCommentsTable: process.env.MINDSPIDER_DOUYIN_COMMENTS_TABLE || "douyin_aweme_comment",
  mindSpiderSqlitePath: process.env.MINDSPIDER_SQLITE_PATH || process.env.SQLITE_PATH || "",
  mindSpiderSqliteCommand: process.env.MINDSPIDER_SQLITE_COMMAND || process.env.SQLITE3_COMMAND || "sqlite3",
  mindSpiderDbLimit: Math.max(1, Number(process.env.MINDSPIDER_DB_LIMIT || 1000)),
  mindSpiderDbQueryTimeoutMs: Math.max(1000, Number(process.env.MINDSPIDER_DB_QUERY_TIMEOUT_MS || 12_000)),
  dingTalkWebhook: process.env.DINGTALK_WEBHOOK || "",
  dingTalkSecret: process.env.DINGTALK_SECRET || "",
  dingTalkSs1ExtraWebhooks: process.env.DINGTALK_SS1_EXTRA_WEBHOOKS || "",
  dingTalkSs1ExtraSecrets: process.env.DINGTALK_SS1_EXTRA_SECRETS || "",
  dingTalkStatePath: process.env.DINGTALK_STATE_PATH || "data/dingtalk-ss1-state.json",
  dingTalkSs2Webhook: process.env.DINGTALK_SS2_WEBHOOK || "",
  dingTalkSs2Secret: process.env.DINGTALK_SS2_SECRET || "",
  dingTalkSs2ExtraWebhooks: process.env.DINGTALK_SS2_EXTRA_WEBHOOKS || "",
  dingTalkSs2ExtraSecrets: process.env.DINGTALK_SS2_EXTRA_SECRETS || "",
  dingTalkSs2StatePath: process.env.DINGTALK_SS2_STATE_PATH || "data/dingtalk-ss2-state.json",
  dingTalkRobotsJson: process.env.DINGTALK_ROBOTS_JSON || "",
  dingTalkTestCooldownSeconds: Math.max(0, Number(process.env.DINGTALK_TEST_COOLDOWN_MINUTES || 240) * 60),
  dingTalkMonitorUrl: process.env.DINGTALK_MONITOR_URL || "http://ss-monitor.qinoay.top/",
  maxBilibiliSearchPages: Math.max(1, Number(process.env.MAX_BILIBILI_SEARCH_PAGES || 5)),
  maxVideosPerGame: Math.max(1, Number(process.env.MAX_BILIBILI_VIDEOS_PER_GAME || 120)),
  maxVideosToDeepParsePerGame: 8,
  maxDouyinItemsPerGame: Math.max(1, Number(process.env.MAX_DOUYIN_ITEMS_PER_GAME || 300)),
  maxDouyinImportedItemsPerGame: Math.max(1, Number(process.env.MAX_DOUYIN_IMPORTED_ITEMS_PER_GAME || 300)),
  maxBettaFishImportedItemsPerGame: Math.max(1, Number(process.env.MAX_BETTAFISH_IMPORTED_ITEMS_PER_GAME || 300)),
  maxTiebaListPages: Math.max(1, Number(process.env.MAX_TIEBA_LIST_PAGES || 5)),
  minTiebaListPages: Math.max(1, Number(process.env.MIN_TIEBA_LIST_PAGES || 4)),
  tiebaThreadsPerPage: Math.max(1, Number(process.env.TIEBA_THREADS_PER_PAGE || 30)),
  maxTiebaThreadsPerBar: Math.max(1, Number(process.env.MAX_TIEBA_THREADS_PER_BAR || 150)),
  maxTiebaThreadsToDeepParse: 8
};

export function getUpdatePolicy(now = new Date(), baseTime = now) {
  const isNight = isNightHour(now.getHours());
  const intervalSeconds = isNight ? runtimeConfig.nightUpdateSeconds : runtimeConfig.dayUpdateSeconds;
  const nextUpdateAt = new Date(baseTime.getTime() + intervalSeconds * 1000);
  return {
    mode: isNight ? "night" as const : "day" as const,
    intervalSeconds,
    nextUpdateAt: nextUpdateAt.toISOString(),
    nightStartHour: runtimeConfig.nightStartHour,
    nightEndHour: runtimeConfig.nightEndHour,
    label: `${isNight ? "夜间" : "日间"}每 ${formatInterval(intervalSeconds)}更新`
  };
}

function isNightHour(hour: number) {
  const start = runtimeConfig.nightStartHour;
  const end = runtimeConfig.nightEndHour;
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

function clampHour(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(23, Math.trunc(value)));
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeOptionalBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

function parseBoolean(value: string) {
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function loadConfiguredGames() {
  try {
    const fromJson = parseGamesJson(process.env.MONITOR_GAMES_JSON || "");
    if (fromJson.length) return fromJson;

    const gamesPath = (process.env.MONITOR_GAMES_PATH || "").trim();
    if (gamesPath) {
      const raw = fs.readFileSync(path.resolve(gamesPath), "utf-8");
      const fromFile = parseGamesJson(raw);
      if (fromFile.length) return fromFile;
      console.warn(`MONITOR_GAMES_PATH did not contain any valid monitor games: ${gamesPath}`);
    }
  } catch (error) {
    console.warn("Custom monitor games config is invalid; falling back to SS1/SS2 defaults", error instanceof Error ? error.message : error);
  }
  return defaultGames;
}

function parseGamesJson(raw: string): GameConfig[] {
  const text = raw.trim();
  if (!text) return [];
  const parsed = JSON.parse(text) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.games)
      ? parsed.games
      : [];
  return rows.map(normalizeGameConfig).filter((game): game is GameConfig => Boolean(game));
}

function normalizeGameConfig(value: unknown): GameConfig | undefined {
  if (!isRecord(value)) return undefined;
  const id = String(value.id || "").trim();
  const name = String(value.name || "").trim();
  if (!isValidGameId(id) || !name) return undefined;

  const shortName = String(value.shortName || value.short_name || name).trim();
  const bilibiliKeywords = stringList(value.bilibiliKeywords || value.bilibili_keywords, [name, shortName]);
  const douyinKeywords = stringList(value.douyinKeywords || value.douyin_keywords, bilibiliKeywords);
  const tiebaBars = stringList(value.tiebaBars || value.tieba_bars, [name]);
  const tiebaKeywords = stringList(value.tiebaKeywords || value.tieba_keywords, []);

  return {
    id,
    name,
    shortName,
    bilibiliKeywords,
    douyinKeywords,
    tiebaBars,
    tiebaKeywords
  };
}

function isValidGameId(value: string) {
  return /^[A-Za-z0-9_-]{1,50}$/.test(value);
}

function stringList(value: unknown, fallback: string[]) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,，;；|]+/)
      : [];
  const normalized = items.map((item) => String(item).trim()).filter(Boolean);
  const merged = normalized.length ? normalized : fallback;
  return uniqStrings(merged).slice(0, 20);
}

export function gameTermsForMatching(game: GameConfig) {
  const tiebaKeywords = game.tiebaKeywords || [];
  const tiebaTerms = tiebaKeywords.length ? tiebaKeywords : game.tiebaBars;
  return uniqStrings([
    game.id,
    game.name,
    game.shortName,
    ...game.bilibiliKeywords,
    ...game.douyinKeywords,
    ...tiebaTerms
  ]).filter((term) => term.length >= 2);
}

export function textMatchesGame(text: string, game: GameConfig) {
  const normalized = normalizeMatchText(text);
  if (!normalized) return false;
  return gameTermsForMatching(game).some((term) => normalized.includes(normalizeMatchText(term)));
}

function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/[#_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function uniqStrings(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveBettaFishRepoDir(explicitPath: string) {
  const explicit = explicitPath.trim();
  if (explicit) return path.resolve(explicit);

  const candidates = [
    path.resolve(process.cwd(), "..", "BettaFish"),
    path.resolve(process.cwd(), "..", "..", "BettaFish"),
    path.resolve(process.env.USERPROFILE || "", "Documents", "BettaFish"),
    path.resolve(process.env.HOME || "", "BettaFish"),
    "/opt/BettaFish/current",
    "/home/yq/BettaFish",
    "/opt/BettaFish"
  ];

  return candidates.find(isBettaFishRepo) || (explicit ? path.resolve(explicit) : "");
}

function inferBettaFishRoot(repoDir: string) {
  if (!repoDir) return process.platform === "win32" ? "" : "/opt/BettaFish";
  const normalized = path.resolve(repoDir);
  if (path.basename(normalized) === "current") return path.dirname(normalized);
  return normalized;
}

function isBettaFishRepo(candidate: string) {
  if (!candidate) return false;
  return fs.existsSync(path.join(candidate, "app.py")) && fs.existsSync(path.join(candidate, "MindSpider", "main.py"));
}

function detectPythonCommand() {
  if (process.platform === "win32") {
    if (commandExists("python")) return "python";
    if (commandExists("py")) return "py";
    return "python";
  }

  if (commandExists("python3")) return "python3";
  if (commandExists("python")) return "python";
  return "python3";
}

function detectBettaFishPython(repoDir: string) {
  if (!repoDir) return "";
  const candidates = process.platform === "win32"
    ? [
        path.join(repoDir, ".venv-mediacrawler", "Scripts", "python.exe"),
        path.join(repoDir, ".venv", "Scripts", "python.exe"),
        path.join(repoDir, "venv", "Scripts", "python.exe")
      ]
    : [
        path.join(repoDir, "..", ".venv", "bin", "python"),
        path.join(repoDir, ".venv-mediacrawler", "bin", "python"),
        path.join(repoDir, ".venv", "bin", "python"),
        path.join(repoDir, "venv", "bin", "python")
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function commandExists(command: string) {
  const result = spawnSync(command, ["-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)"], {
    stdio: "ignore",
    windowsHide: true
  });
  return !result.error && result.status === 0;
}

function quoteShell(value: string) {
  if (!/\s/.test(value)) return value;
  return process.platform === "win32" ? `"${value.replace(/"/g, '\\"')}"` : `'${value.replace(/'/g, "'\\''")}'`;
}

function formatInterval(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

export const topicLexicon: Record<string, string[]> = {
  更新活动: ["更新", "新版本", "版本", "前瞻", "爆料", "联动", "活动", "官宣", "赛季", "塔菲"],
  氪金付费: ["氪", "充值", "付费", "抽", "金皮", "红皮", "皮肤", "礼包", "白氪", "微氪"],
  外挂公平: [
    "外挂",
    "外卦",
    "开挂",
    "内存宏",
    "鼠标宏",
    "压枪宏",
    "脚本",
    "作弊",
    "锁头",
    "自瞄",
    "透视",
    "穿墙",
    "无后座",
    "无后坐",
    "DMA",
    "驱动挂",
    "过检测",
    "免封",
    "科技售卖",
    "辅助售卖",
    "水军"
  ],
  BUG体验: ["bug", "BUG", "卡顿", "掉帧", "闪退", "崩溃", "炸服", "延迟", "掉线"],
  匹配平衡: ["匹配", "战力", "平衡", "削弱", "加强", "伤害", "单排", "四排", "巅峰"],
  模式玩法: ["变异", "追击", "冒险", "PVE", "pve", "PVP", "pvp", "刀战", "身法", "教程", "攻略"],
  社区情绪: ["倒闭", "有救", "难受", "骂", "破游戏", "退坑", "凉", "神人", "喷"]
};

export const positiveWords = [
  "好玩",
  "期待",
  "喜欢",
  "支持",
  "爽",
  "强",
  "不错",
  "良心",
  "舒服",
  "热度",
  "回归",
  "可以",
  "666",
  "厉害",
  "香"
];

export const negativeWords = [
  "垃圾",
  "破游戏",
  "难受",
  "倒闭",
  "退坑",
  "外挂",
  "外卦",
  "开挂",
  "作弊",
  "科技",
  "辅助",
  "内存宏",
  "脚本",
  "锁头",
  "自瞄",
  "透视",
  "封号",
  "bug",
  "BUG",
  "卡顿",
  "崩溃",
  "闪退",
  "白氪",
  "骗氪",
  "逼氪",
  "太贵",
  "骂",
  "恶心",
  "坨屎",
  "一坨",
  "暴毙",
  "背刺",
  "强行绑定",
  "烂",
  "削弱",
  "没人玩",
  "没人",
  "排不到人",
  "排不到",
  "都不玩",
  "难看",
  "一般般",
  "不值",
  "氪再多也没用",
  "没用",
  "敷衍",
  "低配",
  "不敢想象",
  "不好玩",
  "不好",
  "挂狗",
  "宏孩儿",
  "踹人",
  "人机局",
  "比不了",
  "不正常",
  "有问题",
  "对不上",
  "太牢",
  "很牢",
  "牢的",
  "有救吗",
  "没救"
];
