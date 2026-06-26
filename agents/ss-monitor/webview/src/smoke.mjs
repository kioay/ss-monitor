import { readFileSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const sdk = readFileSync("dist/agent-app-sdk.js", "utf8");

for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  // Parse only. The script needs browser globals and must not execute in Node.
  new Function(match[1]);
}

const requiredHtmlMarkers = [
  "WDCloudAgentApp.connectAgentApp",
  "sdk.state.create",
  "submitTurnAndWaitForResult",
  "session.turns.create",
  "session.actions.submit",
  "data-game-option",
  "selectedGames",
  "syncGames",
  "id=\"openMonitor\"",
  "monitor-url-row",
  "id=\"runProgress\"",
  "setRunProgress",
  "renderSummaryReport",
  "parseSummaryMarkdown",
  "summary-list-text",
  "请选择项目",
  "sourceItemUrl",
  "source-link",
  'Object.prototype.hasOwnProperty.call(state, "games")',
  "https://tieba.baidu.com/p/",
  "https://my.4399.com/forums/thread-"
];
const forbiddenHtmlMarkers = [
  'id="games"',
  "els.result.textContent = state.lastResult",
  "actions.submit({",
  "context.get(",
  "state.read(",
  "app.context.get(",
  "app.state.read(",
  "app.actions.submit({",
  "session.getState",
  "session.saveState",
  'selectedGames().join(",") || defaults.games',
  "syncGames(state.games || defaults.games)",
  "String(value || defaults.games)"
];
const requiredSdkMarkers = [
  "createAgentAppClient",
  "submitTurnAndWaitForResult",
  "connectLive",
  "permissions",
  "/snapshot",
  "createSyncedState",
  "createPresence",
  "presence.field.updated",
  "dirtyPersistentVersions",
  "/ephemeral",
  "getState",
  "saveState",
  "artifacts",
  "blob(taskRunId, artifact"
];

for (const marker of requiredHtmlMarkers) {
  if (!html.includes(marker)) throw new Error(`dist/index.html missing marker: ${marker}`);
}
for (const marker of forbiddenHtmlMarkers) {
  if (html.includes(marker)) throw new Error(`dist/index.html uses deprecated SDK pattern: ${marker}`);
}
for (const marker of requiredSdkMarkers) {
  if (!sdk.includes(marker)) throw new Error(`dist/agent-app-sdk.js missing marker: ${marker}`);
}
if (sdk.includes("WDCloud Agent App SDK is not connected")) {
  throw new Error("dist/agent-app-sdk.js is still the stub SDK");
}
