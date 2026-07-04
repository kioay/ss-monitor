import assert from "node:assert/strict";
import { rowsToDouyinMonitorItems } from "../server/collectors/douyinImport";
import { games } from "../server/config";
import { mergeHistoryItems } from "../server/monitorHistory";
import type { ContentPart, GameId, MonitorItem } from "../src/shared";

const ss1 = games.find((game) => game.id === "ss1");
const ss2 = games.find((game) => game.id === "ss2");
assert.ok(ss1);
assert.ok(ss2);

const now = new Date("2026-06-11T12:00:00.000Z");
const cutoff = new Date("2026-06-10T00:00:00.000Z");

const ss2OnlyRow = {
  sourceItemId: "aweme-ss2-only",
  title: "never say goodbye #生死狙击2",
  description: "#生死狙击2 #挑战榜top1",
  tags: "#生死狙击2;#DOU上热门",
  sourceKeyword: "生死狙击2",
  publishedAt: "2026-06-11T08:00:00.000Z",
  collectedAt: now.toISOString()
};

assert.equal(rowsToDouyinMonitorItems(ss1, cutoff, [ss2OnlyRow]).items.length, 0);
assert.deepEqual(
  rowsToDouyinMonitorItems(ss2, cutoff, [ss2OnlyRow]).items.map((item) => item.gameId),
  ["ss2"]
);

for (const keyword of ["生死狙击2热游", "生死狙击2端游", "无端生死狙击2", "生死2"]) {
  const row = {
    ...ss2OnlyRow,
    sourceItemId: `aweme-${keyword}`,
    title: `${keyword} 新内容讨论`,
    description: `${keyword} 玩家反馈`,
    tags: `#${keyword}`,
    sourceKeyword: keyword
  };

  assert.deepEqual(
    rowsToDouyinMonitorItems(ss2, cutoff, [row]).items.map((item) => item.gameId),
    ["ss2"],
    keyword
  );
  assert.equal(rowsToDouyinMonitorItems(ss1, cutoff, [row]).items.length, 0, keyword);
}

assert.equal(rowsToDouyinMonitorItems(ss1, cutoff, [{ ...ss2OnlyRow, gameId: "ss1" }]).items.length, 0);

const ss1BroadRow = {
  sourceItemId: "aweme-ss1-broad",
  title: "whatthefack.啊为啥大家都有这个活动 #生死狙击",
  description: "玩家求助咨询，更新活动",
  tags: "#生死狙击;#活动",
  sourceKeyword: "生死狙击",
  publishedAt: "2026-06-11T08:00:00.000Z",
  collectedAt: now.toISOString()
};

assert.deepEqual(
  rowsToDouyinMonitorItems(ss1, cutoff, [ss1BroadRow]).items.map((item) => item.gameId),
  ["ss1"]
);
assert.equal(rowsToDouyinMonitorItems(ss2, cutoff, [ss1BroadRow]).items.length, 0);

const staleWrongHistory = makeDouyinItem("ss1", "never say goodbye #生死狙击2", [
  { type: "title", text: "never say goodbye #生死狙击2", count: 1 },
  { type: "tag", text: "#生死狙击2 #挑战榜top1", count: 2 }
]);

assert.deepEqual(
  mergeHistoryItems([staleWrongHistory], [], {
    now,
    retentionHours: 24 * 30,
    maxItems: 5000
  }).map((item) => item.id),
  []
);

function makeDouyinItem(gameId: GameId, title: string, contentParts: ContentPart[]): MonitorItem {
  return {
    id: "douyin:aweme-ss2-only",
    gameId,
    gameName: gameId === "ss1" ? "生死狙击1" : "生死狙击2",
    source: "douyin",
    sourceLabel: "抖音视频",
    sourceItemId: "aweme-ss2-only",
    title,
    author: "tester",
    url: "https://www.douyin.com/video/aweme-ss2-only",
    publishedAt: "2026-06-11T08:00:00.000Z",
    collectedAt: now.toISOString(),
    freshnessHours: 4,
    metrics: {},
    contentParts,
    parsedContentCount: contentParts.length,
    summary: title,
    keywords: [],
    topics: [],
    sentiment: "neutral",
    sentimentScore: 0,
    riskLevel: "low",
    riskReasons: []
  };
}
