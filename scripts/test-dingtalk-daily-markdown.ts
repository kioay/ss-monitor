import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { currentAnalysisVersion } from "../src/shared";
import type { MonitorItem, MonitorResponse } from "../src/shared";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ss-monitor-dingtalk-test-"));
process.env.DINGTALK_WEBHOOK = "https://example.com/robot/primary";
process.env.DINGTALK_SS1_EXTRA_WEBHOOKS = "https://example.com/robot/extra-1,https://example.com/robot/extra-2";
process.env.DINGTALK_STATE_PATH = path.join(tempDir, "dingtalk-ss1-state.json");
await fs.writeFile(process.env.DINGTALK_STATE_PATH, JSON.stringify({
  initialized: true,
  lastDailyReportDate: "2026-06-10",
  lastDailyReportSentAt: "2026-06-10T01:30:00.000Z",
  seen: {
    "ss1:tieba:previously-pushed": "2026-06-10T02:00:00.000Z|2026-06-10T03:00:00.000Z|high"
  }
}));

const payloads: Array<{ markdown?: { title?: string; text?: string } }> = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  payloads.push(JSON.parse(String(init?.body || "{}")));
  if (String(url).includes("/robot/primary")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ errcode: 300005, errmsg: "token is not exist" })
    } as Response;
  }
  return {
    ok: true,
    json: async () => ({ errcode: 0 })
  } as Response;
}) as typeof fetch;

try {
  const { sendDingTalkDailyReport } = await import("../server/dingtalk");
  const response = makeResponse([
    makeItem("tieba:before-window", "high", "2026-06-10T01:29:00.000Z"),
    makeItem("tieba:previously-pushed", "high", "2026-06-10T03:00:00.000Z"),
    makeItem("tieba:previously-pushed-refreshed", "high", "2026-06-10T03:05:00.000Z", "ss1", {
      sourceItemId: "previously-pushed",
      title: "tieba:previously-pushed",
      url: "https://tieba.baidu.com/p/previously-pushed?see_lz=1"
    }),
    makeItem("tieba:risk", "high", "2026-06-10T02:30:00.000Z"),
    makeItem("tieba:medium", "medium", "2026-06-11T01:59:00.000Z"),
    makeItem("tieba:at-send-time", "high", "2026-06-11T02:00:00.000Z"),
    makeItem("tieba:ss2-risk", "high", "2026-06-10T02:30:00.000Z", "ss2"),
    makeForumItem("forum4399:water-slogan", "2026-06-10T04:00:00.000Z", {
      title: "重振生坛荣光",
      replies: 315
    }),
    makeForumItem("forum4399:water-activity", "2026-06-10T04:10:00.000Z", {
      riskLevel: "medium",
      sentiment: "negative",
      sentimentScore: -0.42,
      riskReasons: ["负面表达集中", "命中敏感风险词"],
      title: "活跃：2",
      description: "没救了"
    }),
    makeForumItem("forum4399:water-recruit", "2026-06-10T04:15:00.000Z", {
      riskLevel: "medium",
      riskReasons: ["命中治理类风险词"],
      title: "水军势力招人",
      description: "水军势力招人111"
    }),
    makeForumItem("forum4399:real-complaint", "2026-06-10T04:20:00.000Z", {
      riskLevel: "medium",
      sentiment: "negative",
      sentimentScore: -0.5,
      riskReasons: ["负面表达集中"],
      title: "副本好几万的币都没用",
      description: "副本好几万的币都没用，换了装备也打不动，希望官方看看这个掉落设计"
    }),
    makeForumItem("tieba:account-sale", "2026-06-10T05:00:00.000Z", {
      source: "tieba",
      riskLevel: "medium",
      sentiment: "negative",
      sentimentScore: -0.72,
      riskReasons: ["新回复带来风险", "负面表达集中"],
      topics: ["当前版本重点", "氪金付费"],
      title: "走⚡出个浩，感谢理解",
      description: "基本全传说彩金2，可⚡3000，奇珍币可回本600，千元翅膀＋星珀千元皮"
    }),
    makeForumItem("forum4399:buy-talk", "2026-06-10T05:10:00.000Z", {
      riskLevel: "medium",
      sentiment: "negative",
      sentimentScore: -0.62,
      riskReasons: ["账号租赁/交易导流", "当前版本重点负反馈"],
      topics: ["氪金付费", "匹配平衡"],
      title: "削弱蝶梦！",
      description: "蝶梦这个版本太弱了，氪了皮肤也没用，希望官方平衡一下",
      comments: ["买号划算", "氪金不如买号或者租号"]
    }),
    makeForumItem("forum4399:account-quote", "2026-06-10T05:20:00.000Z", {
      riskLevel: "medium",
      sentiment: "positive",
      sentimentScore: 0.83,
      riskReasons: ["账号租赁/交易导流"],
      topics: ["当前版本重点", "氪金付费"],
      title: "断罪终焉残辉贰太一贰瑶光传承的黄火V6",
      description: "如题，500搞个断罪终焉，残辉贰，太一贰，瑶光传承的新氪V6有没有搞头"
    })
  ]);
  const result = await sendDingTalkDailyReport(response, "ss1", new Date("2026-06-11T10:00:00+08:00"));

  assert.equal(result.ok, true);
  assert.equal(result.mode, "daily");
  assert.equal(result.sent, 11);
  assert.equal(result.existing, 2);
  assert.equal(payloads.length, 3);

  for (const payload of payloads) {
    const text = payload.markdown?.text || "";
    assert.equal(payload.markdown?.title?.includes("昨日舆情日报"), false);
    assert.equal(text.includes("本期概况"), true);
    assert.equal(text.includes("统计范围"), true);
    assert.equal(text.includes("tieba:risk"), true);
    assert.equal(text.includes("tieba:medium"), true);
    assert.equal(text.includes("tieba:previously-pushed"), false);
    assert.equal(text.includes("重振生坛荣光"), false);
    assert.equal(text.includes("活跃：2"), false);
    assert.equal(text.includes("水军势力招人"), false);
    assert.equal(text.includes("副本好几万的币都没用"), true);
    assert.equal(text.includes("走⚡出个浩"), false);
    assert.equal(text.includes("断罪终焉残辉贰太一贰"), false);
    assert.equal(text.includes("削弱蝶梦！"), true);
    assert.equal(text.includes("已剔除近 72 小时内推送过的 2 条重点舆情"), true);
    assert.equal(text.includes("tieba:before-window"), false);
    assert.equal(text.includes("tieba:at-send-time"), false);
    assert.equal(text.includes("tieba:ss2-risk"), false);
    assert.equal(text.includes("中高风险持续汇总"), false);
    assert.equal(text.includes("近72小时中高风险存量"), false);
    assert.equal(text.includes("近72小时暂无中高风险舆情存量"), false);
  }

  const state = JSON.parse(await fs.readFile(process.env.DINGTALK_STATE_PATH, "utf-8")) as {
    lastDailyReportDate?: string;
    lastDailyReportSentAt?: string;
    seen?: Record<string, string>;
  };
  assert.equal(state.lastDailyReportDate, "2026-06-11");
  assert.equal(state.lastDailyReportSentAt, "2026-06-11T02:00:00.000Z");
  assert.equal(Boolean(state.seen?.["ss1:tieba:previously-pushed"]), true);
  assert.equal(state.seen?.["ss1:tieba:risk"]?.startsWith("2026-06-11T02:00:00.000Z|"), true);
  assert.equal(state.seen?.["ss1:tieba:url:https://tieba.baidu.com/p/risk"]?.startsWith("2026-06-11T02:00:00.000Z|"), true);
  assert.equal(state.seen?.["ss1:tieba:medium"]?.startsWith("2026-06-11T02:00:00.000Z|"), true);
  assert.equal(state.seen?.["ss1:forum4399:water-slogan"], undefined);
  assert.equal(state.seen?.["ss1:forum4399:water-activity"], undefined);
  assert.equal(state.seen?.["ss1:forum4399:water-recruit"], undefined);
  assert.equal(state.seen?.["ss1:forum4399:buy-talk"]?.startsWith("2026-06-11T02:00:00.000Z|"), true);
  assert.equal(state.seen?.["ss1:tieba:account-sale"], undefined);
  assert.equal(state.seen?.["ss1:forum4399:account-quote"], undefined);
  assert.equal(state.seen?.["ss1:forum4399:real-complaint"]?.startsWith("2026-06-11T02:00:00.000Z|"), true);

  payloads.length = 0;
  await fs.writeFile(process.env.DINGTALK_STATE_PATH, JSON.stringify({
    initialized: true,
    lastDailyReportDate: "2026-06-14",
    lastDailyReportSentAt: "2026-06-14T01:30:00.000Z",
    seen: {}
  }));

  const mondayResponse = makeResponse([
    makeItem("tieba:friday-night", "high", "2026-06-12T15:59:00.000Z"),
    makeItem("tieba:saturday-risk", "high", "2026-06-12T16:00:00.000Z"),
    makeItem("tieba:sunday-risk", "medium", "2026-06-14T12:00:00.000Z"),
    makeItem("tieba:monday-at-send-time", "high", "2026-06-15T01:30:00.000Z")
  ]);
  const mondayResult = await sendDingTalkDailyReport(mondayResponse, "ss1", new Date("2026-06-15T09:30:00+08:00"));

  assert.equal(mondayResult.ok, true);
  assert.equal(mondayResult.mode, "daily");
  assert.equal(mondayResult.sent, 2);
  assert.equal(payloads.length, 3);

  for (const payload of payloads) {
    const text = payload.markdown?.text || "";
    assert.equal(text.includes("tieba:saturday-risk"), true);
    assert.equal(text.includes("tieba:sunday-risk"), true);
    assert.equal(text.includes("tieba:friday-night"), false);
    assert.equal(text.includes("tieba:monday-at-send-time"), false);
  }
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

function makeResponse(items: MonitorItem[]): MonitorResponse {
  return {
    generatedAt: "2026-06-11T01:00:00.000Z",
    windowHours: 72,
    freshnessCutoff: "2026-06-08T01:00:00.000Z",
    analysisVersion: currentAnalysisVersion,
    riskBacktest: {
      status: "passed",
      message: "风险回测通过",
      caseCount: 10
    },
    updatePolicy: {
      mode: "day",
      intervalSeconds: 3600,
      nextUpdateAt: "2026-06-11T02:00:00.000Z",
      nightStartHour: 0,
      nightEndHour: 8,
      label: "日间每 1 小时更新"
    },
    cache: {
      hit: false,
      ageSeconds: 0,
      ttlSeconds: 3600
    },
    stats: {
      total: items.length,
      highRisk: items.filter((item) => item.riskLevel === "high").length,
      mediumRisk: items.filter((item) => item.riskLevel === "medium").length,
      negativeRate: 0,
      bilibili: 0,
      tieba: items.length,
      douyin: 0,
      forum4399: 0,
      bettafish: 0
    },
    trends: [],
    topicStats: [],
    alerts: [],
    health: [],
    keywordEffectiveness: [],
    items
  };
}

function makeItem(
  id: string,
  riskLevel: MonitorItem["riskLevel"],
  publishedAt: string,
  gameId: MonitorItem["gameId"] = "ss1",
  overrides: Partial<Pick<MonitorItem, "sourceItemId" | "title" | "url" | "author">> = {}
): MonitorItem {
  const sourceItemId = overrides.sourceItemId || id.split(":")[1];
  const title = overrides.title || id;
  return {
    id,
    gameId,
    gameName: gameId === "ss1" ? "生死狙击1" : "生死狙击2",
    source: "tieba",
    sourceLabel: "百度贴吧",
    sourceItemId,
    title,
    author: overrides.author || "tester",
    url: overrides.url || `https://tieba.baidu.com/p/${sourceItemId}`,
    publishedAt,
    collectedAt: "2026-06-11T01:00:00.000Z",
    freshnessHours: 22,
    metrics: { replies: 10, comments: 10 },
    contentParts: [{ type: "title", text: title, count: 1 }],
    parsedContentCount: 1,
    summary: id,
    keywords: [],
    topics: ["外挂公平"],
    sentiment: "negative",
    sentimentScore: -0.8,
    riskLevel,
    riskReasons: riskLevel === "high" ? ["疑似外挂演示内容"] : ["命中外挂治理线索"]
  };
}

function makeForumItem(
  id: string,
  publishedAt: string,
  overrides: Partial<{
    source: MonitorItem["source"];
    riskLevel: MonitorItem["riskLevel"];
    sentiment: MonitorItem["sentiment"];
    sentimentScore: number;
    riskReasons: string[];
    topics: string[];
    title: string;
    description: string;
    comments: string[];
    replies: number;
  }> = {}
): MonitorItem {
  const sourceItemId = id.split(":")[1];
  const title = overrides.title || id;
  const description = overrides.description || title;
  const replies = overrides.replies ?? 1;
  const source = overrides.source || "forum4399";
  return {
    id,
    gameId: "ss1",
    gameName: "生死狙击1",
    source,
    sourceLabel: source === "tieba" ? "百度贴吧" : "4399论坛",
    sourceItemId,
    title,
    author: "tester",
    url: source === "tieba" ? `https://tieba.baidu.com/p/${sourceItemId}` : `https://my.4399.com/forums/thread-${sourceItemId}`,
    publishedAt,
    collectedAt: "2026-06-11T01:00:00.000Z",
    freshnessHours: 3,
    metrics: { views: 120, replies, comments: replies },
    contentParts: [
      { type: "title", text: title, count: 1 },
      { type: "tag", text: "[玩家交流]", count: 1 },
      { type: "description", text: description, count: 1 },
      ...(overrides.comments || []).map((comment) => ({ type: "post" as const, text: comment, count: 1 }))
    ],
    parsedContentCount: 3,
    summary: `主题暂不集中，情绪相对中性。${title}`,
    keywords: [],
    topics: overrides.topics || ["综合讨论"],
    sentiment: overrides.sentiment || "neutral",
    sentimentScore: overrides.sentimentScore ?? 0,
    riskLevel: overrides.riskLevel || "low",
    riskReasons: overrides.riskReasons || []
  };
}

