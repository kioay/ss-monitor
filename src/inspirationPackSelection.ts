import { inspirationSeedPresets } from "./shared";

export function allInspirationPackIds() {
  return inspirationSeedPresets.map((seed) => seed.id);
}

export function toggleInspirationPackSelection(current: string[], packId: string) {
  return current.includes(packId) ? current.filter((id) => id !== packId) : [...current, packId];
}

export function invertInspirationPackSelection(current: string[]) {
  const selected = new Set(current);
  return allInspirationPackIds().filter((id) => !selected.has(id));
}
