import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webviewRoot = resolve(here, "..");
const dist = resolve(webviewRoot, "dist");
const sharedSdk = resolve(here, "../../../../shared/agent-app-sdk/browser.js");
const bundledSdk = resolve(here, "agent-app-sdk.js");

rmSync(dist, { force: true, recursive: true });
mkdirSync(dist, { recursive: true });
copyFileSync(resolve(webviewRoot, "index.html"), resolve(dist, "index.html"));
copyFileSync(existsSync(sharedSdk) ? sharedSdk : bundledSdk, resolve(dist, "agent-app-sdk.js"));
