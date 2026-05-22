import fs from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "ssh2";

loadEnv({ path: path.resolve(".env.local") });
loadEnv({ path: path.resolve(".env") });

process.env.CURRENT_VERSION_FOCUS_CACHE_PATH ||= "data/current-version-focus.json";

const localCachePath = path.resolve(process.env.CURRENT_VERSION_FOCUS_CACHE_PATH);
const remote = process.env.SYNC_CURRENT_VERSION_REMOTE;
const sshPort = process.env.SYNC_CURRENT_VERSION_SSH_PORT || "22";
const sshPassword = process.env.SYNC_CURRENT_VERSION_PASSWORD;
const remotePath = process.env.SYNC_CURRENT_VERSION_REMOTE_PATH;
const reloadCommand = process.env.SYNC_CURRENT_VERSION_RELOAD_COMMAND || "";

if (!process.env.CONFLUENCE_TOKEN) {
  throw new Error("CONFLUENCE_TOKEN is required in .env.local or the environment.");
}
if (!remote || !remotePath) {
  throw new Error("SYNC_CURRENT_VERSION_REMOTE and SYNC_CURRENT_VERSION_REMOTE_PATH are required.");
}
if (!sshPassword) {
  throw new Error("SYNC_CURRENT_VERSION_PASSWORD is required in .env.local or the environment.");
}

if (process.env.SYNC_CURRENT_VERSION_FORCE !== "0") {
  await fs.rm(localCachePath, { force: true });
}

const { refreshCurrentVersionFocus, getCurrentVersionFocus } = await import("../server/currentVersion");

console.log("[sync] refreshing Confluence focus locally");
await refreshCurrentVersionFocus();
const focus = getCurrentVersionFocus();
if (!focus.versionPageId || focus.terms.length === 0) {
  throw new Error("Confluence refresh produced an empty focus cache; remote sync was skipped.");
}

await fs.access(localCachePath);
const remoteDir = path.posix.dirname(remotePath);
const tempRemotePath = `${remotePath}.tmp-${Date.now()}`;
const remoteTarget = parseRemote(remote);

console.log("[sync] connecting to production by SSH");
const client = await withTimeout(connectSsh(remoteTarget, Number(sshPort), sshPassword), 20000, "SSH connection timed out");
try {
  console.log("[sync] uploading focus cache");
  await withTimeout(uploadFile(client, localCachePath, tempRemotePath), 30000, "SFTP upload timed out");
  console.log("[sync] installing focus cache on production");
  await withTimeout(
    runRemote(
      client,
      `mkdir -p ${shellQuote(remoteDir)} && install -m 0640 ${shellQuote(tempRemotePath)} ${shellQuote(remotePath)} && rm -f ${shellQuote(tempRemotePath)}`,
    ),
    30000,
    "remote install timed out"
  );

  if (reloadCommand) {
    console.log("[sync] running remote reload command");
    await withTimeout(runRemote(client, reloadCommand), 30000, "remote reload timed out");
  }
} finally {
  client.end();
}

console.log(
  JSON.stringify(
    {
      synced: true,
      version: focus.version,
      versionPageId: focus.versionPageId,
      terms: focus.terms.length,
      weaponTerms: focus.weaponTerms.length,
      remotePath
    },
    null,
    2
  )
);

function parseRemote(value: string) {
  const match = value.match(/^([^@]+)@(.+)$/);
  if (!match) throw new Error("SYNC_CURRENT_VERSION_REMOTE must use user@host format.");
  return { username: match[1], host: match[2] };
}

function connectSsh(target: { username: string; host: string }, port: number, password: string) {
  return new Promise<Client>((resolve, reject) => {
    const client = new Client();
    client
      .on("ready", () => resolve(client))
      .on("error", reject)
      .connect({
        host: target.host,
        port,
        username: target.username,
        password,
        readyTimeout: 15000
      });
  });
}

function uploadFile(client: Client, localPath: string, remoteFilePath: string) {
  return new Promise<void>((resolve, reject) => {
    client.sftp((sftpError, sftp) => {
      if (sftpError) {
        reject(sftpError);
        return;
      }
      sftp.fastPut(localPath, remoteFilePath, (uploadError) => {
        sftp.end();
        if (uploadError) reject(uploadError);
        else resolve();
      });
    });
  });
}

function runRemote(client: Client, command: string) {
  return new Promise<void>((resolve, reject) => {
    client.exec(`sh -c ${shellQuote(command)}`, (execError, stream) => {
      if (execError) {
        reject(execError);
        return;
      }
      let stderr = "";
      stream.on("data", () => {
        // Drain stdout so remote commands cannot block on a full buffer.
      });
      stream.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      stream.on("close", (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`remote command exited with code ${code}: ${stderr.trim()}`));
      });
      stream.end();
    });
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
