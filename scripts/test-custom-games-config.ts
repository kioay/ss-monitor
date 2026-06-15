import assert from "node:assert/strict";
import type { MonitorItem } from "../src/shared";

process.env.MONITOR_GAMES_JSON = JSON.stringify({
  games: [
    {
      id: "out-of-control",
      name: "失控进化",
      shortName: "失控进化",
      bilibiliKeywords: ["失控进化"],
      douyinKeywords: ["失控进化", "失控进化手游"],
      tiebaBars: ["失控进化"]
    }
  ]
});

const { games, gameById, textMatchesGame } = await import("../server/config");
const { parseMonitorQuery, makeKeywordEffectiveness } = await import("../server/monitor");

assert.equal(games.length, 1);
assert.equal(games[0].id, "out-of-control");
assert.equal(games[0].name, "失控进化");
assert.equal(gameById.get("out-of-control")?.shortName, "失控进化");
assert.equal(textMatchesGame("失控进化 新版本 玩家反馈", games[0]), true);
assert.equal(textMatchesGame("完全无关的内容", games[0]), false);

const defaultQuery = parseMonitorQuery({});
assert.deepEqual(defaultQuery.selectedGames.map((game) => game.id), ["out-of-control"]);

const unknownQuery = parseMonitorQuery({ games: "ss1,ss2" });
assert.deepEqual(unknownQuery.selectedGames.map((game) => game.id), ["out-of-control"]);

const supplementalQuery = parseMonitorQuery({
  games: "out-of-control",
  extraKeywords: "\u5931\u63a7\u8fdb\u5316\u624b\u6e38,\u516c\u6d4b \u516c\u6d4b;\u62db\u4eba"
});
assert.deepEqual(supplementalQuery.extraKeywords, ["\u5931\u63a7\u8fdb\u5316\u624b\u6e38", "\u516c\u6d4b", "\u62db\u4eba"]);
assert.deepEqual(supplementalQuery.selectedGames[0]?.bilibiliKeywords, [
  "\u5931\u63a7\u8fdb\u5316",
  "\u5931\u63a7\u8fdb\u5316\u624b\u6e38",
  "\u516c\u6d4b",
  "\u62db\u4eba"
]);
assert.deepEqual(supplementalQuery.selectedGames[0]?.douyinKeywords, [
  "\u5931\u63a7\u8fdb\u5316",
  "\u5931\u63a7\u8fdb\u5316\u624b\u6e38",
  "\u516c\u6d4b",
  "\u62db\u4eba"
]);
assert.deepEqual(supplementalQuery.selectedGames[0]?.tiebaBars, [
  "\u5931\u63a7\u8fdb\u5316",
  "\u5931\u63a7\u8fdb\u5316\u624b\u6e38",
  "\u516c\u6d4b",
  "\u62db\u4eba"
]);

const effectiveness = makeKeywordEffectiveness([
  makeItem("1", "\u5931\u63a7\u8fdb\u5316 7\u67089\u65e5\u516c\u6d4b", "tieba"),
  makeItem("2", "\u516c\u6d4b\u653b\u7565\u6574\u7406", "bilibili"),
  makeItem("3", "\u516c\u6d4b\u961f\u53cb\u62db\u4eba", "tieba", "medium"),
  makeItem("4", "\u65e5\u5e38\u8ba8\u8bba", "douyin")
], ["\u516c\u6d4b", "\u62db\u4eba", "\u4e0d\u5b58\u5728"]);

assert.deepEqual(effectiveness.map((entry) => [entry.keyword, entry.status, entry.matchedItems]), [
  ["\u516c\u6d4b", "effective", 3],
  ["\u62db\u4eba", "weak", 1],
  ["\u4e0d\u5b58\u5728", "no_match", 0]
]);
assert.deepEqual(effectiveness[0]?.sources, ["bilibili", "tieba"]);
assert.equal(effectiveness[1]?.mediumRisk, 1);

function makeItem(id: string, title: string, source: MonitorItem["source"], riskLevel: MonitorItem["riskLevel"] = "low"): MonitorItem {
  return {
    id,
    gameId: "out-of-control",
    gameName: "\u5931\u63a7\u8fdb\u5316",
    source,
    sourceLabel: source,
    sourceItemId: id,
    title,
    author: "tester",
    url: `https://example.test/${id}`,
    publishedAt: `2026-06-11T0${id}:00:00.000Z`,
    collectedAt: "2026-06-11T12:00:00.000Z",
    freshnessHours: 1,
    metrics: {},
    contentParts: [{ type: "title", text: title, count: 1 }],
    parsedContentCount: 1,
    summary: title,
    keywords: [],
    topics: [],
    sentiment: "neutral",
    sentimentScore: 0,
    riskLevel,
    riskReasons: []
  };
}
