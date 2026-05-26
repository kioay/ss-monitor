import "dotenv/config";
import type { GameConfig, GameId } from "../src/shared";

export const games: GameConfig[] = [
  {
    id: "ss1",
    name: "生死狙击1",
    shortName: "SS1",
    bilibiliKeywords: ["生死狙击", "生死狙击1", "4399生死狙击", "生死狙击页游"],
    douyinKeywords: ["生死狙击", "生死狙击1", "4399生死狙击", "生死狙击页游"],
    tiebaBars: ["生死狙击"]
  },
  {
    id: "ss2",
    name: "生死狙击2",
    shortName: "SS2",
    bilibiliKeywords: ["生死狙击2", "生死狙击2热油"],
    douyinKeywords: ["生死狙击2", "生死狙击2热油"],
    tiebaBars: ["生死狙击2"]
  }
];

export const gameById = new Map<GameId, GameConfig>(games.map((game) => [game.id, game]));

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
  douyinImportDir: process.env.DOUYIN_IMPORT_DIR || "data/douyin-imports",
  douyinAuthorizedSourcesPath: process.env.DOUYIN_AUTHORIZED_SOURCES_PATH || "data/douyin-authorized-sources.json",
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
  dingTalkTestCooldownSeconds: Math.max(0, Number(process.env.DINGTALK_TEST_COOLDOWN_MINUTES || 240) * 60),
  maxVideosPerGame: 18,
  maxVideosToDeepParsePerGame: 8,
  maxDouyinItemsPerGame: 18,
  maxDouyinImportedItemsPerGame: Math.max(1, Number(process.env.MAX_DOUYIN_IMPORTED_ITEMS_PER_GAME || 80)),
  maxTiebaThreadsPerBar: 30,
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
    "宏",
    "内存宏",
    "鼠标宏",
    "压枪宏",
    "脚本",
    "科技",
    "辅助",
    "作弊",
    "锁头",
    "自瞄",
    "透视",
    "穿墙",
    "无后座",
    "无后坐",
    "DMA",
    "驱动",
    "过检测",
    "免封",
    "QQ群",
    "群号",
    "售卖",
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
  "氪",
  "白氪",
  "骂",
  "恶心",
  "烂",
  "削弱",
  "有救吗",
  "没救"
];
