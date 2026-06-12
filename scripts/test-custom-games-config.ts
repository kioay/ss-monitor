import assert from "node:assert/strict";

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
const { parseMonitorQuery } = await import("../server/monitor");

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
