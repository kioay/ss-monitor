import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "ssh2";

loadEnv({ path: path.resolve(".env.local") });
loadEnv({ path: path.resolve(".env") });

const mlRelDir = "SentimentAnalysisModel/WeiboSentiment_MachineLearning";
const supportedModels = new Map([
  ["bayes", "bayes_model.pkl"],
  ["svm", "svm_model.pkl"],
  ["xgboost", "xgboost_model.pkl"]
]);

const localRepoDir = resolveLocalBettaFishRepo(
  process.env.SYNC_BETTAFISH_LOCAL_REPO
    || process.env.BETTAFISH_REPO_DIR
    || ""
);
const remote = process.env.SYNC_BETTAFISH_REMOTE;
const sshPort = Number(process.env.SYNC_BETTAFISH_SSH_PORT || "22");
const sshPassword = process.env.SYNC_BETTAFISH_PASSWORD;
const rootPassword = process.env.SYNC_BETTAFISH_ROOT_PASSWORD || sshPassword;
const remoteRoot = normalizeRemoteRoot(process.env.SYNC_BETTAFISH_REMOTE_ROOT || "/opt/BettaFish");
const installDeps = parseBoolean(process.env.SYNC_BETTAFISH_INSTALL_DEPS || "true");
const models = parseModels(process.env.SYNC_BETTAFISH_MODELS || "bayes");
const pythonPackages = (process.env.SYNC_BETTAFISH_PYTHON_PACKAGES || "scikit-learn==0.24.2 jieba==0.42.1")
  .split(/\s+/)
  .map((entry) => entry.trim())
  .filter(Boolean);

if (!remote) throw new Error("SYNC_BETTAFISH_REMOTE is required, for example yq@example.com.");
if (!sshPassword) throw new Error("SYNC_BETTAFISH_PASSWORD is required.");
if (!rootPassword) throw new Error("SYNC_BETTAFISH_ROOT_PASSWORD is required when it differs from SSH password.");

const target = parseRemote(remote);
const files = await collectFiles(localRepoDir, models);
const tempRemoteDir = `/tmp/ss-monitor-bettafish-semantic-${Date.now()}`;

console.log(`[bettafish-sync] local repo: ${localRepoDir}`);
console.log(`[bettafish-sync] remote root: ${remoteRoot}`);
console.log(`[bettafish-sync] models: ${models.join(", ")}`);
console.log(`[bettafish-sync] files: ${files.length}`);

const client = await withTimeout(connectSsh(target, sshPort, sshPassword), 20000, "SSH connection timed out");
try {
  await withTimeout(runRemote(client, `rm -rf ${shellQuote(tempRemoteDir)} && mkdir -p ${shellQuote(tempRemoteDir)}`), 30000, "remote temp directory setup timed out");
  await withTimeout(uploadFiles(client, files, tempRemoteDir), 60000, "SFTP upload timed out");
  await withTimeout(installRemoteFiles(client, tempRemoteDir), 120000, "remote install timed out");
  await withTimeout(runRemote(client, `rm -rf ${shellQuote(tempRemoteDir)}`), 30000, "remote temp cleanup timed out");
} finally {
  client.end();
}

console.log(
  JSON.stringify(
    {
      synced: true,
      remoteRoot,
      models,
      files: files.map((file) => file.relPath),
      installDeps
    },
    null,
    2
  )
);

function resolveLocalBettaFishRepo(explicitPath: string) {
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), "..", "BettaFish"),
    path.resolve(process.cwd(), "..", "..", "BettaFish"),
    path.resolve(process.env.USERPROFILE || "", "Documents", "BettaFish"),
    path.resolve(process.env.HOME || "", "BettaFish")
  ].filter(Boolean);

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (isBettaFishSemanticRepo(resolved)) return resolved;
  }
  throw new Error("BettaFish semantic model directory was not found. Set SYNC_BETTAFISH_LOCAL_REPO.");
}

async function collectFiles(repoDir: string, modelNames: string[]) {
  const relPaths = [
    `${mlRelDir}/utils.py`,
    `${mlRelDir}/README.md`,
    `${mlRelDir}/requirements.txt`,
    `${mlRelDir}/data/stopwords.txt`,
    ...modelNames.map((model) => `${mlRelDir}/model/${supportedModels.get(model)}`)
  ];

  const files: Array<{ localPath: string; relPath: string }> = [];
  for (const relPath of relPaths) {
    const localPath = path.join(repoDir, ...relPath.split("/"));
    try {
      const stat = await fs.stat(localPath);
      if (stat.isFile()) files.push({ localPath, relPath });
    } catch {
      if (relPath.endsWith(".pkl")) throw new Error(`Required model file is missing: ${localPath}`);
    }
  }
  return files;
}

function isBettaFishSemanticRepo(candidate: string) {
  return fileExists(path.join(candidate, ...mlRelDir.split("/"), "model", "bayes_model.pkl"));
}

function fileExists(targetPath: string) {
  return existsSync(targetPath);
}

function parseModels(value: string) {
  const models = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const invalid = models.filter((model) => !supportedModels.has(model));
  if (invalid.length) throw new Error(`Unsupported BettaFish semantic model(s): ${invalid.join(", ")}`);
  return models.length ? models : ["bayes"];
}

function parseRemote(value: string) {
  const match = value.match(/^([^@]+)@(.+)$/);
  if (!match) throw new Error("SYNC_BETTAFISH_REMOTE must use user@host format.");
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

async function uploadFiles(client: Client, files: Array<{ localPath: string; relPath: string }>, tempRoot: string) {
  const dirs = Array.from(new Set(files.map((file) => path.posix.dirname(path.posix.join(tempRoot, file.relPath)))));
  await runRemote(client, `mkdir -p ${dirs.map(shellQuote).join(" ")}`);
  const sftp = await openSftp(client);
  try {
    for (const file of files) {
      const remotePath = path.posix.join(tempRoot, file.relPath);
      await fastPut(sftp, file.localPath, remotePath);
      console.log(`[bettafish-sync] uploaded ${file.relPath}`);
    }
  } finally {
    sftp.end();
  }
}

function openSftp(client: Client) {
  return new Promise<NonNullable<Parameters<Parameters<Client["sftp"]>[0]>[1]>>((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error || !sftp) reject(error || new Error("SFTP session was not created."));
      else resolve(sftp);
    });
  });
}

function fastPut(sftp: NonNullable<Parameters<Parameters<Client["sftp"]>[0]>[1]>, localPath: string, remotePath: string) {
  return new Promise<void>((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function installRemoteFiles(client: Client, tempRoot: string) {
  const packageArgs = pythonPackages.map(shellQuote).join(" ");
  const dependencyBlock = installDeps
    ? `
if ! command -v python3 >/dev/null 2>&1; then
  yum -y install python3 python3-pip python3-setuptools python3-wheel
fi
if [ ! -x "$remote_root/.venv/bin/python" ]; then
  python3 -m venv "$remote_root/.venv"
fi
"$remote_root/.venv/bin/python" -m pip install --upgrade 'pip<22' setuptools wheel
"$remote_root/.venv/bin/python" -m pip install ${packageArgs}
`
    : "";
  const command = `
set -e
remote_root=${shellQuote(remoteRoot)}
temp_root=${shellQuote(tempRoot)}
ml_rel=${shellQuote(mlRelDir)}
mkdir -p "$remote_root/$ml_rel"
rm -rf "$remote_root/$ml_rel/model" "$remote_root/$ml_rel/data"
cp -a "$temp_root/$ml_rel/." "$remote_root/$ml_rel/"
find "$remote_root/$ml_rel" -name __pycache__ -type d -prune -exec rm -rf {} +
chown -R root:root "$remote_root/SentimentAnalysisModel"
${dependencyBlock}
`;
  return runRoot(client, command);
}

function runRemote(client: Client, command: string) {
  return new Promise<void>((resolve, reject) => {
    client.exec(`sh -c ${shellQuote(command)}`, (execError, stream) => {
      if (execError) {
        reject(execError);
        return;
      }
      let stdout = "";
      let stderr = "";
      stream.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      stream.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      stream.on("close", (code: number) => {
        if (stdout.trim()) console.log(stdout.trim());
        if (code === 0) resolve();
        else reject(new Error(`remote command exited with code ${code}: ${stderr.trim()}`));
      });
      stream.end();
    });
  });
}

function runRoot(client: Client, command: string) {
  return runRemote(
    client,
    `printf '%s\\n' ${shellQuote(rootPassword || "")} | su - root -c ${shellQuote(command)}`
  );
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

function parseBoolean(value: string) {
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function normalizeRemoteRoot(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed.startsWith("/")) throw new Error("SYNC_BETTAFISH_REMOTE_ROOT must be an absolute path.");
  return trimmed || "/opt/BettaFish";
}
