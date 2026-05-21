import { runtimeConfig } from "./config";

const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export class SourceError extends Error {
  blocked: boolean;

  constructor(message: string, blocked = false) {
    super(message);
    this.name = "SourceError";
    this.blocked = blocked;
  }
}

export async function fetchText(
  url: string,
  options: { referer?: string; cookie?: string; timeoutMs?: number } = {}
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.5",
        Referer: options.referer || inferReferer(url),
        ...(options.cookie ? { Cookie: options.cookie } : {})
      }
    });

    const text = await response.text();
    if (!response.ok) {
      throw new SourceError(`HTTP ${response.status}: ${text.slice(0, 80)}`, response.status === 412 || looksBlocked(text));
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson<T>(
  url: string,
  options: { referer?: string; cookie?: string; timeoutMs?: number } = {}
): Promise<T> {
  const text = await fetchText(url, options);
  if (looksBlocked(text)) {
    throw new SourceError("触发来源站点风控或安全验证", true);
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new SourceError(`返回内容不是 JSON: ${(error as Error).message}`, false);
  }
}

export function sourceCookie(source: "bilibili" | "baidu") {
  return source === "bilibili" ? runtimeConfig.bilibiliCookie : runtimeConfig.baiduCookie;
}

export function looksBlocked(text: string) {
  return (
    text.includes("错误号: 412") ||
    text.includes("security control policy") ||
    text.includes("百度安全验证") ||
    text.includes("BIOC_OPTIONS")
  );
}

function inferReferer(url: string) {
  if (url.includes("bilibili.com")) return "https://www.bilibili.com/";
  if (url.includes("tieba.baidu.com")) return "https://tieba.baidu.com/";
  return "https://www.baidu.com/";
}
