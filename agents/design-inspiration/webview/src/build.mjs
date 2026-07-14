import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webviewRoot = resolve(here, "..");
const dist = resolve(webviewRoot, "dist");
const bundledSdk = resolve(here, "agent-app-sdk.js");

rmSync(dist, { force: true, recursive: true });
mkdirSync(dist, { recursive: true });
copyFileSync(resolve(webviewRoot, "index.html"), resolve(dist, "index.html"));
copyFileSync(bundledSdk, resolve(dist, "agent-app-sdk.js"));
