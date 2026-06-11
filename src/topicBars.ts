export function topicBarWidthPercent(count: number, maxCount: number) {
  if (!Number.isFinite(count) || !Number.isFinite(maxCount) || count <= 0 || maxCount <= 0) return 0;
  if (count >= maxCount) return 100;
  return Math.max(6, Math.round((count / maxCount) * 1000) / 10);
}
