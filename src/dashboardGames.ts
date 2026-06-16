import type { GameConfig, GameId } from "./shared";

export function dashboardGameOptions(games: Pick<GameConfig, "id" | "shortName">[]) {
  return games.map((game) => ({ key: game.id, label: game.shortName, ids: [game.id] }));
}

export function normalizeDashboardGameSelection(current: GameId[], games: Pick<GameConfig, "id">[]): GameId[] {
  const configuredIds = games.map((game) => game.id);
  const retained = current.find((id) => configuredIds.includes(id));
  return retained ? [retained] : configuredIds.slice(0, 1);
}
