import type { GameConfig, MonitorStats, SourceType } from "./shared";

export function primarySourceOptionsForGames(games: Pick<GameConfig, "forum4399Tags">[]): SourceType[] {
  const sources: SourceType[] = ["bilibili", "tieba", "douyin"];
  if (games.some((game) => (game.forum4399Tags || []).length > 0)) sources.push("forum4399");
  return sources;
}

export function feedSourceOptionsForGames(games: Pick<GameConfig, "forum4399Tags">[]): SourceType[] {
  return [...primarySourceOptionsForGames(games), "bettafish"];
}

export function sourceMetricLabel(sources: SourceType[]) {
  return sources.map(sourceTypeText).join(" / ");
}

export function sourceMetricCount(stats: MonitorStats | undefined, source: SourceType) {
  if (!stats) return 0;
  if (source === "bilibili") return stats.bilibili;
  if (source === "tieba") return stats.tieba;
  if (source === "douyin") return stats.douyin;
  if (source === "forum4399") return stats.forum4399;
  return stats.bettafish;
}

export function sourceTypeText(source: SourceType) {
  if (source === "bilibili") return "B站";
  if (source === "tieba") return "贴吧";
  if (source === "douyin") return "抖音";
  if (source === "forum4399") return "4399论坛";
  return "BettaFish";
}
