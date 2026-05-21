import crypto from "node:crypto";

export function md5(input: string) {
  return crypto.createHash("md5").update(input).digest("hex");
}

export function stripHtml(input: string) {
  return decodeHtml(input)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeHtml(input: string) {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function uniq<T>(items: T[]) {
  return Array.from(new Set(items));
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function nowIso() {
  return new Date().toISOString();
}

export function hoursBetween(later: Date, earlier: Date) {
  return Math.max(0, (later.getTime() - earlier.getTime()) / 36e5);
}

export function normalizeUrl(url: string) {
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `https://tieba.baidu.com${url}`;
  return url.replace(/^http:\/\//, "https://");
}

export function compactText(parts: string[], maxLength = 420) {
  const text = parts
    .map((part) => stripHtml(part))
    .filter(Boolean)
    .join(" / ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
