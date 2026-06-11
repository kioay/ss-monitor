import type { GameConfig, GameId, MonitorItem } from "../src/shared";

const ss2Markers = [
  /生死狙击\s*2/i,
  /\bss\s*2\b/i,
  /热油/
];

const ss1Markers = [
  /生死狙击\s*1/i,
  /4399\s*生死狙击/i,
  /生死狙击\s*页游/i,
  /\bss\s*1\b/i
];

const sharedMarkers = [
  /生死狙击/i
];

export function douyinTextMatchesGame(text: string, game: GameConfig) {
  const routedGameId = inferDouyinGameId(text);
  if (routedGameId) return routedGameId === game.id;
  const normalized = normalizeText(text);
  return [game.name, game.shortName, ...game.douyinKeywords].some((term) => term && normalized.includes(normalizeText(term)));
}

export function isDouyinMonitorItemGameConsistent(item: MonitorItem) {
  if (item.source !== "douyin") return true;
  const routedGameId = inferDouyinGameId([
    item.title,
    item.summary,
    item.contentParts.map((part) => part.text).join(" "),
    item.keywords.join(" ")
  ].join(" "));
  return !routedGameId || routedGameId === item.gameId;
}

export function inferDouyinGameId(text: string): GameId | undefined {
  const normalized = normalizeText(text);
  if (!normalized) return undefined;

  if (hasMarker(normalized, ss2Markers)) return "ss2";
  if (hasMarker(normalized, ss1Markers)) return "ss1";
  if (hasMarker(normalized, sharedMarkers)) return "ss1";
  return undefined;
}

function hasMarker(text: string, markers: RegExp[]) {
  return markers.some((marker) => marker.test(text));
}

function normalizeText(text: string) {
  return text.replace(/#/g, " ").replace(/\s+/g, " ").trim();
}
