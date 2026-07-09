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
  "inspiration.collect",
  "inspiration.health",
  "asset-grid",
  "renderAssetCards",
  "report-overview",
  "report-section-list",
  "renderReportOverview",
  "parseReport",
  "pack-grid",
  "data-pack-option",
  "selectedPackIds",
  "syncPacks",
  "crossfire",
  "crossfire-mobile",
  "crossfire-hd",
  "counter-strike-online",
  "nz",
  "nz-future",
  "全选",
  "反选",
  "清空",
  "竞品素材侦查",
  "采集素材",
  "检查接口"
];
const forbiddenHtmlMarkers = [
  "actions.submit({",
  "context.get(",
  "state.read(",
  "app.context.get(",
  "app.state.read(",
  "app.actions.submit({",
  "session.getState",
  "session.saveState"
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
