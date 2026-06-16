import assert from "node:assert/strict";
import { dashboardGameOptions, normalizeDashboardGameSelection } from "../src/dashboardGames";
import { feedSourceOptionsForGames, primarySourceOptionsForGames, sourceMetricLabel } from "../src/sourceDisplay";
import type { GameConfig } from "../src/shared";

const ss1 = makeGame("ss1", ["81899"]);
const ss2 = makeGame("ss2", []);

assert.deepEqual(primarySourceOptionsForGames([ss1]), ["bilibili", "tieba", "douyin", "forum4399"]);
assert.equal(sourceMetricLabel(primarySourceOptionsForGames([ss1])), "B站 / 贴吧 / 抖音 / 4399论坛");
assert.deepEqual(feedSourceOptionsForGames([ss1]), ["bilibili", "tieba", "douyin", "forum4399", "bettafish"]);

assert.deepEqual(primarySourceOptionsForGames([ss2]), ["bilibili", "tieba", "douyin"]);
assert.equal(sourceMetricLabel(primarySourceOptionsForGames([ss2])), "B站 / 贴吧 / 抖音");
assert.deepEqual(feedSourceOptionsForGames([ss2]), ["bilibili", "tieba", "douyin", "bettafish"]);

assert.deepEqual(primarySourceOptionsForGames([ss1, ss2]), ["bilibili", "tieba", "douyin", "forum4399"]);
assert.deepEqual(dashboardGameOptions([ss1, ss2]).map((option) => option.label), ["SS1", "SS2"]);
assert.equal(dashboardGameOptions([ss1, ss2]).some((option) => option.label === "全部"), false);
assert.deepEqual(normalizeDashboardGameSelection(["ss1", "ss2"], [ss1, ss2]), ["ss1"]);
assert.deepEqual(normalizeDashboardGameSelection(["missing"], [ss1, ss2]), ["ss1"]);

function makeGame(id: string, forum4399Tags: string[]): GameConfig {
  return {
    id,
    name: id,
    shortName: id.toUpperCase(),
    bilibiliKeywords: [],
    douyinKeywords: [],
    tiebaBars: [],
    tiebaKeywords: [],
    forum4399Tags,
    forum4399Keywords: []
  };
}
