param(
  [string]$CredentialFile = $env:BETTAFISH_INNER_CREDENTIAL_FILE,
  [string]$HostName = "",
  [int]$Port = 22,
  [string]$UserName = "root",
  [string]$RemoteRoot = "/opt/ss-monitor",
  [string]$ServiceName = "ss-monitor",
  [string]$ArchivePath = "",
  [switch]$KeepArchive
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$commit = (git -C $repoRoot rev-parse --short HEAD).Trim()

if (-not $ArchivePath) {
  $ArchivePath = Join-Path $env:TEMP "ss-monitor-$commit.tar.gz"
}

if (-not $CredentialFile) {
  $innerCredentialName = [string]::Concat([char]0x5185, [char]0x7f51, [char]0x673a) + ".txt"
  $CredentialFile = Join-Path $env:USERPROFILE "Desktop\$innerCredentialName"
}

if (-not (Test-Path -LiteralPath $CredentialFile)) {
  throw "Credential file not found: $CredentialFile. Set BETTAFISH_INNER_CREDENTIAL_FILE or create the indexed desktop credential file."
}

$credentialText = Get-Content -LiteralPath $CredentialFile -Raw
if (-not $HostName) {
  if ($credentialText -match "root@([^\r\n\s]+)") {
    $HostName = $matches[1].Trim()
  } else {
    $HostName = "192.168.8.242"
  }
}

if ($credentialText -notmatch "password:([^\r\n]+)") {
  throw "Credential file must contain a password:<value> line."
}
$password = $matches[1].Trim()

Write-Host "[deploy] Creating fresh deploy archive for $commit"
& (Join-Path $PSScriptRoot "create-deploy-archive.ps1") -OutputPath $ArchivePath
if ($LASTEXITCODE -ne 0) {
  throw "create-deploy-archive.ps1 failed with exit code $LASTEXITCODE"
}

$archiveItem = Get-Item -LiteralPath $ArchivePath
Write-Host "[deploy] Archive ready: $($archiveItem.FullName) ($($archiveItem.Length) bytes)"

$deployScriptPath = Join-Path ([System.IO.Path]::GetTempPath()) "ss-monitor-deploy-$commit-$([System.Guid]::NewGuid().ToString('N')).mjs"
$deployScript = @'
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const input = await new Promise((resolve, reject) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    data += chunk;
  });
  process.stdin.on("end", () => resolve(data));
  process.stdin.on("error", reject);
});

let config;
try {
  config = JSON.parse(input.replace(/^\uFEFF/, ""));
} catch {
  throw new Error("Invalid deploy payload JSON.");
}
const require = createRequire(path.join(config.repoRoot, "package.json"));
const { Client } = require("ssh2");

const archiveStat = fs.statSync(config.archivePath);
const releaseName = `ss-monitor-${config.commit}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
const remoteArchive = `/tmp/ss-monitor-${config.commit}-${Date.now()}.tar.gz`;
const client = new Client();

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function connect() {
  return new Promise((resolve, reject) => {
    client
      .on("ready", resolve)
      .on("error", reject)
      .connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        readyTimeout: 20000
      });
  });
}

function openSftp() {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp)));
  });
}

function uploadFile(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (error) => (error ? reject(error) : resolve()));
  });
}

function execRemote(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      reject(new Error(`Remote command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    client.exec(command, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      stream.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
      stream.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      stream.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    });
  });
}

await connect();
console.log(`[deploy] Connected to ${config.username}@${config.host}:${config.port}`);

const sftp = await openSftp();
try {
  await uploadFile(sftp, config.archivePath, remoteArchive);
} finally {
  sftp.end();
}
console.log(`[deploy] Uploaded ${remoteArchive} (${archiveStat.size} bytes)`);

const remoteScript = `
set -euo pipefail
app=${shellQuote(config.remoteRoot)}
service=${shellQuote(config.serviceName)}
release=${shellQuote(releaseName)}
archive=${shellQuote(remoteArchive)}
release_dir="$app/releases/$release"

mkdir -p "$release_dir" "$app/state" "$app/data"
tar -xzf "$archive" -C "$release_dir"

cd "$release_dir"
npm ci --omit=dev

if [ -f "$app/.env" ]; then
  cp -a "$app/.env" "$release_dir/.env"
else
  cp "$release_dir/.env.example" "$app/.env"
  cp -a "$app/.env" "$release_dir/.env"
fi

ln -sfn "$release_dir" "$app/current.tmp"
mv -Tf "$app/current.tmp" "$app/current"

if [ -f "$app/.env" ]; then
  cp -a "$app/.env" "$app/current/.env"
fi

systemctl daemon-reload
systemctl restart "$service"
sleep 3
systemctl is-active --quiet "$service"

port="$(awk -F= '$1=="PORT" {print $2; exit}' "$app/.env" 2>/dev/null || true)"
port="\${port:-8787}"
health="$(curl -fsS "http://127.0.0.1:$port/api/health")"
page_status="$(curl -fsSI "http://127.0.0.1:$port/" | head -n 1 || true)"
current_target="$(readlink -f "$app/current")"

rm -f "$archive"

printf 'release=%s\n' "$release"
printf 'current=%s\n' "$current_target"
printf 'service=%s\n' "$(systemctl is-active "$service")"
printf 'page=%s\n' "$page_status"
printf 'health=%s\n' "$health"
`;

const result = await execRemote(`bash -lc ${shellQuote(remoteScript)}`, 600000);
client.end();

if (result.stdout.trim()) console.log(result.stdout.trim());
if (result.stderr.trim()) console.error(result.stderr.trim());
if (result.code !== 0) {
  throw new Error(`Remote deploy failed with exit ${result.code}`);
}
'@

Set-Content -LiteralPath $deployScriptPath -Value $deployScript -Encoding UTF8

try {
  $payload = @{
    repoRoot = $repoRoot.Path
    archivePath = $archiveItem.FullName
    commit = $commit
    host = $HostName
    port = $Port
    username = $UserName
    password = $password
    remoteRoot = $RemoteRoot
    serviceName = $ServiceName
  } | ConvertTo-Json -Compress

  $payload | node $deployScriptPath
  if ($LASTEXITCODE -ne 0) {
    throw "Node deploy helper failed with exit code $LASTEXITCODE"
  }
} finally {
  if (Test-Path -LiteralPath $deployScriptPath) {
    Remove-Item -LiteralPath $deployScriptPath -Force
  }
  if (-not $KeepArchive -and (Test-Path -LiteralPath $ArchivePath)) {
    Remove-Item -LiteralPath $ArchivePath -Force
  }
}

Write-Host "[deploy] Production deployment completed."
