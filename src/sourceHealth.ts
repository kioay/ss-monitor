import type { SourceHealth } from "./shared";

export function sourceHealthIssues(health: SourceHealth[]) {
  return health.filter((entry) => !entry.ok || entry.blocked);
}

export function sourceHealthWarningText(health: SourceHealth[]) {
  return sourceHealthIssues(health).map(sourceHealthIssueText).join(" / ");
}

function sourceHealthIssueText(entry: SourceHealth) {
  const message = entry.message.trim();
  if (!message) return `${entry.sourceLabel}：需检查`;
  return message.startsWith(entry.sourceLabel) ? message : `${entry.sourceLabel}：${message}`;
}
