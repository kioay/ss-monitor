import cors from "cors";
import express, { type Request } from "express";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { games, getUpdatePolicy, runtimeConfig } from "./config";
import { sendDingTalkDailyReport, sendDingTalkTest } from "./dingtalk";
import { getBettaFishLabResponse, runBettaFishLabAction } from "./bettafishLab";
import { getMonitorResponse } from "./monitor";
import { getSearchResponse } from "./search";
import type { GameId } from "../src/shared";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");

app.use(cors());
app.use(express.json());

app.get("/api/config", (_request, response) => {
  response.json({
    games,
    defaultWindowHours: runtimeConfig.defaultWindowHours,
    updatePolicy: getUpdatePolicy(),
    sources: ["bilibili", "tieba", "douyin", "bettafish"]
  });
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    updatePolicy: getUpdatePolicy(),
    hasBilibiliCookie: Boolean(runtimeConfig.bilibiliCookie),
    hasBaiduCookie: Boolean(runtimeConfig.baiduCookie),
    hasBettaFishBaseUrl: Boolean(runtimeConfig.bettaFishBaseUrl)
  });
});

app.get("/api/image", async (request, response) => {
  const rawUrl = typeof request.query.url === "string" ? request.query.url : "";
  try {
    const imageUrl = new URL(rawUrl);
    if (!isAllowedImageHost(imageUrl.hostname)) {
      response.status(400).send("Unsupported image host");
      return;
    }

    const upstream = await fetch(imageUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: imageReferer(imageUrl.hostname)
      }
    });

    if (!upstream.ok) {
      response.status(upstream.status).send("Image fetch failed");
      return;
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const contentLength = upstream.headers.get("content-length");
    response.setHeader("Content-Type", contentType);
    if (contentLength) response.setHeader("Content-Length", contentLength);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Image-Proxy", "stream-only-no-disk-cache");
    if (!upstream.body) {
      response.status(502).send("Image stream unavailable");
      return;
    }

    await pipeline(Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>), response);
  } catch {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.status(400).send("Invalid image url");
  }
});

app.get("/api/monitor", async (request, response) => {
  try {
    const data = await getMonitorResponse(request.query);
    response.json(data);
  } catch (error) {
    response.status(500).json({
      message: error instanceof Error ? error.message : "未知错误"
    });
  }
});

app.get("/api/search", async (request, response) => {
  try {
    const data = await getSearchResponse(request.query);
    response.json(data);
  } catch (error) {
    response.status(500).json({
      message: error instanceof Error ? error.message : "未知错误"
    });
  }
});

app.get("/api/bettafish/lab", async (request, response) => {
  try {
    const data = await getBettaFishLabResponse(request.query);
    response.json(data);
  } catch (error) {
    response.status(500).json({
      message: error instanceof Error ? error.message : "未知错误"
    });
  }
});

app.post("/api/bettafish/lab/action", async (request, response) => {
  try {
    const result = await runBettaFishLabAction(request.body);
    response.status(result.ok ? 200 : 400).json(result);
  } catch (error) {
    response.status(500).json({
      ok: false,
      action: "unknown",
      generatedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : "未知错误"
    });
  }
});

app.post("/api/notify/dingtalk/test", async (request, response) => {
  if (!isLocalRequest(request)) {
    response.status(403).json({ message: "Local access only" });
    return;
  }
  try {
    const requestedGameId = typeof request.query.game === "string" ? request.query.game : "";
    const gameId = games.some((game) => game.id === requestedGameId) ? requestedGameId : games[0]?.id;
    if (!gameId) {
      response.status(400).json({ message: "No monitor games configured" });
      return;
    }
    const force = request.query.force === "1" || request.query.force === "true";
    const data = await getMonitorResponse({ games: gameId, windowHours: "72", limit: "200", force: "1", notify: "0" });
    const result = await sendDingTalkTest(data, gameId, { force });
    response.json(result);
  } catch (error) {
    response.status(500).json({
      message: error instanceof Error ? error.message : "未知错误"
    });
  }
});

app.use(express.static(distDir));
app.get(/^(?!\/api).*/, (_request, response) => {
  response.sendFile(path.join(distDir, "index.html"));
});

app.listen(runtimeConfig.port, runtimeConfig.host, () => {
  console.log(`Sentiment monitor listening on http://${runtimeConfig.host}:${runtimeConfig.port}`);
  startBackgroundMonitor();
  startDailyReportScheduler();
});

function startBackgroundMonitor() {
  const run = async () => {
    try {
      await Promise.all(games.map((game) => refreshRobotGame(game.id)));
    } catch (error) {
      console.error("Background monitor refresh failed", error);
    } finally {
      const policy = getUpdatePolicy();
      setTimeout(run, policy.intervalSeconds * 1000);
    }
  };
  setTimeout(run, 60_000);
}

function refreshRobotGame(gameId: GameId) {
  return getMonitorResponse({ games: gameId, windowHours: "72", limit: "200", force: "1", notify: "0" });
}

function startDailyReportScheduler() {
  const run = async () => {
    try {
      const gameIds = games.map((game) => game.id);
      const data = await getMonitorResponse({ games: gameIds.join(","), windowHours: "72", limit: "300", force: "1", notify: "0" });
      await Promise.all(gameIds.map((gameId) => sendDingTalkDailyReport(data, gameId)));
    } catch (error) {
      console.error("Daily DingTalk report failed", error);
    } finally {
      setTimeout(run, msUntilNextDailyReport());
    }
  };
  setTimeout(run, msUntilNextDailyReport());
}

function msUntilNextDailyReport(now = new Date()) {
  const next = new Date(now);
  next.setHours(9, 30, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  while (!isWorkday(next)) next.setDate(next.getDate() + 1);
  return Math.max(1_000, next.getTime() - now.getTime());
}

function isWorkday(value: Date) {
  const day = value.getDay();
  return day >= 1 && day <= 5;
}

function isLocalRequest(request: Request) {
  const host = request.headers.host || "";
  const remoteAddress = request.socket.remoteAddress || "";
  const isLocalHost = /^(127\.0\.0\.1|localhost|\[::1\])(?::|$)/.test(host);
  const isLocalSocket = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);
  return isLocalHost && isLocalSocket;
}

function isAllowedImageHost(hostname: string) {
  return (
    hostname.endsWith(".hdslb.com") ||
    hostname === "hdslb.com" ||
    hostname.endsWith(".baidu.com") ||
    hostname.endsWith(".bdstatic.com") ||
    hostname.endsWith(".douyinpic.com") ||
    hostname.endsWith(".sogoucdn.com")
  );
}

function imageReferer(hostname: string) {
  if (hostname.includes("hdslb.com")) return "https://www.bilibili.com/";
  if (hostname.includes("douyinpic.com")) return "https://www.douyin.com/";
  if (hostname.includes("sogoucdn.com")) return "https://www.sogou.com/";
  return "https://tieba.baidu.com/";
}
