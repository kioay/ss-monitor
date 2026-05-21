import cors from "cors";
import express from "express";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { games, getUpdatePolicy, runtimeConfig } from "./config";
import { getMonitorResponse } from "./monitor";

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
    sources: ["bilibili", "tieba"]
  });
});

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    updatePolicy: getUpdatePolicy(),
    hasBilibiliCookie: Boolean(runtimeConfig.bilibiliCookie),
    hasBaiduCookie: Boolean(runtimeConfig.baiduCookie)
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
        Referer: imageUrl.hostname.includes("hdslb.com") ? "https://www.bilibili.com/" : "https://tieba.baidu.com/"
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

app.use(express.static(distDir));
app.get(/^(?!\/api).*/, (_request, response) => {
  response.sendFile(path.join(distDir, "index.html"));
});

app.listen(runtimeConfig.port, runtimeConfig.host, () => {
  console.log(`Sentiment monitor listening on http://${runtimeConfig.host}:${runtimeConfig.port}`);
});

function isAllowedImageHost(hostname: string) {
  return hostname.endsWith(".hdslb.com") || hostname === "hdslb.com" || hostname.endsWith(".baidu.com") || hostname.endsWith(".bdstatic.com");
}
