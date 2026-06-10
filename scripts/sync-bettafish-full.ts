import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Client } from "ssh2";

loadEnv({ path: path.resolve(".env.local") });
loadEnv({ path: path.resolve(".env") });

const localRepoDir = resolveLocalBettaFishRepo(
  process.env.SYNC_BETTAFISH_FULL_LOCAL_REPO
    || process.env.SYNC_BETTAFISH_LOCAL_REPO
    || process.env.BETTAFISH_REPO_DIR
    || ""
);
const remote = process.env.SYNC_BETTAFISH_FULL_REMOTE || process.env.SYNC_BETTAFISH_REMOTE;
const sshPort = Number(process.env.SYNC_BETTAFISH_FULL_SSH_PORT || process.env.SYNC_BETTAFISH_SSH_PORT || "22");
const sshPassword = process.env.SYNC_BETTAFISH_FULL_PASSWORD || process.env.SYNC_BETTAFISH_PASSWORD;
const remoteRoot = normalizeRemoteRoot(
  process.env.SYNC_BETTAFISH_FULL_REMOTE_ROOT
    || process.env.SYNC_BETTAFISH_REMOTE_ROOT
    || "/opt/BettaFish"
);
const installDeps = parseBoolean(process.env.SYNC_BETTAFISH_FULL_INSTALL_DEPS || "true");
const installPlaywright = parseBoolean(process.env.SYNC_BETTAFISH_FULL_INSTALL_PLAYWRIGHT || "true");
const updateMonitorEnv = parseBoolean(process.env.SYNC_BETTAFISH_FULL_UPDATE_MONITOR_ENV || "true");
const restartMonitor = parseBoolean(process.env.SYNC_BETTAFISH_FULL_RESTART_MONITOR || "true");
const includeTrainingData = parseBoolean(process.env.SYNC_BETTAFISH_FULL_INCLUDE_TRAINING_DATA || "true");
const includeRuntimeState = parseBoolean(process.env.SYNC_BETTAFISH_FULL_INCLUDE_RUNTIME_STATE || "false");
const cloneUpstream = parseBoolean(process.env.SYNC_BETTAFISH_FULL_CLONE_UPSTREAM || "true");
const upstreamRepoUrl = process.env.SYNC_BETTAFISH_FULL_UPSTREAM_URL || "https://github.com/666ghj/BettaFish.git";
const semanticModels = process.env.SYNC_BETTAFISH_FULL_SEMANTIC_MODELS || "svm,bayes,xgboost";
const semanticDependencyPackages = (process.env.SYNC_BETTAFISH_FULL_SEMANTIC_DEP_PACKAGES
  || "numpy==1.26.4 scipy==1.11.4 scikit-learn==1.2.2 xgboost==2.0.3")
  .split(/\s+/)
  .map((entry) => entry.trim())
  .filter(Boolean);

if (!remote) throw new Error("SYNC_BETTAFISH_FULL_REMOTE or SYNC_BETTAFISH_REMOTE is required, for example root@example.com.");
if (!sshPassword) throw new Error("SYNC_BETTAFISH_FULL_PASSWORD or SYNC_BETTAFISH_PASSWORD is required.");

const target = parseRemote(remote);
const localRevisionFull = await resolveLocalRevisionFull(localRepoDir);
if (cloneUpstream && localRevisionFull === "local") {
  throw new Error("SYNC_BETTAFISH_FULL_CLONE_UPSTREAM=true requires a Git-backed BettaFish repo.");
}
const localRevision = localRevisionFull.slice(0, 7);
const releaseName = `release-${localRevision}-${timestamp()}`;
const tempRoot = path.join(os.tmpdir(), `ss-monitor-bettafish-full-${releaseName}`);
const stageDir = path.join(tempRoot, "stage");
const archivePath = path.join(tempRoot, "bettafish-full.tar.gz");
const remoteArchive = `/tmp/ss-monitor-bettafish-full-${releaseName}.tar.gz`;

const runtimeCacheDirs = new Set([
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".ipynb_checkpoints",
  ".venv",
  ".venv-mediacrawler",
  "venv",
  "env",
  "node_modules",
  "htmlcov",
  "dist",
  "build"
]);

const runtimeRootDirs = new Set([
  "logs",
  "final_reports",
  "insight_engine_streamlit_reports",
  "media_engine_streamlit_reports",
  "query_engine_streamlit_reports",
  "db_data",
  "agent_zone",
  "debug_tools",
  "wordcloud_temp",
  "test_output",
  "test_results",
  "temp",
  "tmp"
]);

const secretFileNames = new Set(["secrets.json", ".secrets", "credentials.json", "api_keys.txt"]);
const secretExtensions = new Set([".key", ".pem", ".crt", ".p12", ".pfx"]);
const archiveExtensions = new Set([".zip", ".rar", ".7z", ".gz", ".bz2", ".xz", ".tgz"]);

console.log(`[bettafish-full-sync] local repo: ${localRepoDir}`);
console.log(`[bettafish-full-sync] remote root: ${remoteRoot}`);
console.log(`[bettafish-full-sync] release: ${releaseName}`);
console.log(`[bettafish-full-sync] upstream clone: ${cloneUpstream ? `${upstreamRepoUrl}#${localRevisionFull}` : "disabled"}`);
console.log(`[bettafish-full-sync] include training data: ${includeTrainingData}`);
console.log(`[bettafish-full-sync] include runtime state: ${includeRuntimeState}`);

try {
  if (!cloneUpstream) {
    const summary = await createArchive(localRepoDir, stageDir, archivePath);
    console.log(
      `[bettafish-full-sync] archive ready: ${summary.includedFiles} files, ${formatBytes(summary.includedBytes)} included, ${summary.excludedFiles} excluded`
    );
    for (const [reason, count] of Object.entries(summary.excludedByReason).sort()) {
      if (count) console.log(`[bettafish-full-sync] excluded ${reason}: ${count}`);
    }
  }

  const client = await withTimeout(connectSsh(target, sshPort, sshPassword), 20_000, "SSH connection timed out");
  try {
    if (!cloneUpstream) {
      await withTimeout(uploadFile(client, archivePath, remoteArchive), 10 * 60_000, "SFTP upload timed out");
    }
    await withTimeout(installRemoteRelease(client), 45 * 60_000, "remote full BettaFish install timed out");
  } finally {
    client.end();
  }

  console.log(
    JSON.stringify(
      {
        synced: true,
        remoteRoot,
        releaseName,
        localRevision: localRevisionFull,
        cloneUpstream,
        upstreamRepoUrl,
        installDeps,
        installPlaywright,
        updateMonitorEnv,
        restartMonitor,
        semanticModels,
        semanticDependencyPackages
      },
      null,
      2
    )
  );
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function createArchive(repoDir: string, stage: string, output: string) {
  const summary = {
    includedFiles: 0,
    includedBytes: 0,
    excludedFiles: 0,
    excludedByReason: {} as Record<string, number>
  };
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });

  await copyFiltered(repoDir, stage, "", summary);
  await runLocal("tar", ["-czf", output, "-C", stage, "."]);
  return summary;
}

async function copyFiltered(sourceRoot: string, targetRoot: string, relDir: string, summary: Awaited<ReturnType<typeof createArchive>>) {
  const sourceDir = path.join(sourceRoot, ...relDir.split("/").filter(Boolean));
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
    const reason = exclusionReason(relPath, entry.isDirectory());
    if (reason) {
      summary.excludedFiles += 1;
      summary.excludedByReason[reason] = (summary.excludedByReason[reason] || 0) + 1;
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetRoot, ...relPath.split("/"));
    if (entry.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: true });
      await copyFiltered(sourceRoot, targetRoot, relPath, summary);
    } else if (entry.isFile()) {
      const stat = await fs.stat(sourcePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
      summary.includedFiles += 1;
      summary.includedBytes += stat.size;
    }
  }
}

function exclusionReason(relPath: string, isDirectory: boolean) {
  const normalized = relPath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  const basename = segments[segments.length - 1];
  const first = segments[0];

  if (basename === ".git" || segments.includes(".git")) return "vcs";
  if (segments.some((segment) => runtimeCacheDirs.has(segment))) return "cache";
  if (basename === ".env" || /^\.env\.(?!example$)/.test(basename)) return "secret";
  if (secretFileNames.has(basename) || secretExtensions.has(path.extname(basename).toLowerCase())) return "secret";
  if (!includeRuntimeState && runtimeRootDirs.has(first)) return "runtime";
  if (!includeRuntimeState && mediaCrawlerRuntimePath(normalized)) return "runtime";
  if (!includeTrainingData && trainingDataPath(normalized, segments)) return "training-data";
  if (archiveExtensions.has(path.extname(basename).toLowerCase())) return "archive";
  if (isDirectory && basename === "OperationGuidance") return "local-agent-notes";
  return "";
}

function mediaCrawlerRuntimePath(normalized: string) {
  const runtimePrefixes = [
    "MindSpider/DeepSentimentCrawling/MediaCrawler/browser_data/",
    "MindSpider/DeepSentimentCrawling/MediaCrawler/data/",
    "MindSpider/DeepSentimentCrawling/MediaCrawler/temp_image/"
  ];
  if (runtimePrefixes.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix))) return true;
  return /^MindSpider\/DeepSentimentCrawling\/MediaCrawler\/database\/.+\.(db|sqlite|sqlite3)$/i.test(normalized);
}

function trainingDataPath(normalized: string, segments: string[]) {
  return segments.includes("dataset")
    || segments.includes("datasets")
    || normalized.startsWith("SentimentAnalysisModel/WeiboSentiment_MachineLearning/data/weibo2018/");
}

function installRemoteRelease() {
  const command = `
set -euo pipefail
remote_root=${shellQuote(remoteRoot)}
release_name=${shellQuote(releaseName)}
archive=${shellQuote(remoteArchive)}
clone_upstream=${cloneUpstream ? "1" : "0"}
upstream_repo_url=${shellQuote(upstreamRepoUrl)}
target_revision=${shellQuote(localRevisionFull)}
install_deps=${installDeps ? "1" : "0"}
install_playwright=${installPlaywright ? "1" : "0"}
update_monitor_env=${updateMonitorEnv ? "1" : "0"}
restart_monitor=${restartMonitor ? "1" : "0"}
semantic_models=${shellQuote(semanticModels)}
semantic_dep_packages=${shellQuote(semanticDependencyPackages.join(" "))}
release_dir="$remote_root/releases/$release_name"
runtime_root="$remote_root/runtime"
venv="$remote_root/.venv"
env_file="$remote_root/.env"
playwright_browsers_path="$remote_root/playwright-browsers"

if ! id yq >/dev/null 2>&1; then useradd -m -s /bin/bash yq; fi

if command -v dnf >/dev/null 2>&1; then
  dnf -y install git python3.11 python3.11-pip python3.11-devel python3 python3-pip python3-devel gcc gcc-c++ make tar gzip libffi-devel openssl-devel zlib-devel bzip2-devel xz-devel sqlite-devel cairo pango gdk-pixbuf2 libjpeg-turbo-devel freetype-devel mesa-libGL libXext libXrender fontconfig >/dev/null
elif command -v yum >/dev/null 2>&1; then
  yum -y install git python3.11 python3.11-pip python3.11-devel python3 python3-pip python3-devel gcc gcc-c++ make tar gzip libffi-devel openssl-devel zlib-devel bzip2-devel xz-devel sqlite-devel cairo pango gdk-pixbuf2 libjpeg-turbo-devel freetype-devel mesa-libGL libXext libXrender fontconfig >/dev/null || yum -y install git python3 python3-pip python3-devel gcc gcc-c++ make tar gzip libffi-devel openssl-devel zlib-devel bzip2-devel xz-devel sqlite-devel cairo pango gdk-pixbuf2 libjpeg-turbo-devel freetype-devel mesa-libGL libXext libXrender fontconfig >/dev/null
fi
python_cmd="$(command -v python3.11 || command -v python3)"
if [ -z "$python_cmd" ]; then
  echo "python3.11 or python3 is required" >&2
  exit 1
fi

mkdir -p "$remote_root/releases" "$runtime_root" "$playwright_browsers_path" "$runtime_root/logs" "$runtime_root/final_reports" "$runtime_root/insight_engine_streamlit_reports" "$runtime_root/media_engine_streamlit_reports" "$runtime_root/query_engine_streamlit_reports" "$runtime_root/mediacrawler-data" "$runtime_root/mediacrawler-browser_data" "$runtime_root/mediacrawler-temp_image"
rm -rf "$release_dir"
if [ "$clone_upstream" = "1" ]; then
  if ! command -v git >/dev/null 2>&1; then
    echo "git is required for full upstream clone mode" >&2
    exit 1
  fi
  git clone --recurse-submodules "$upstream_repo_url" "$release_dir"
  git -C "$release_dir" fetch origin "$target_revision"
  git -C "$release_dir" checkout --detach "$target_revision"
  git -C "$release_dir" submodule update --init --recursive
else
  mkdir -p "$release_dir"
  tar -xzf "$archive" -C "$release_dir"
fi

apply_bettafish_production_patches() {
  release_dir="$1"
  "$python_cmd" - "$release_dir" <<'PY'
import sys
from pathlib import Path

release_dir = Path(sys.argv[1])


def patch_app_config_redaction():
    app_path = release_dir / "app.py"
    text = app_path.read_text(encoding="utf-8")
    helper = '''SENSITIVE_CONFIG_MARKERS = ("API_KEY", "PASSWORD", "TOKEN", "SECRET", "COOKIE", "PRIVATE_KEY")


def is_sensitive_config_key(key):
    """Return True when a config key should never be exposed over HTTP."""
    normalized = str(key or "").upper()
    return any(marker in normalized for marker in SENSITIVE_CONFIG_MARKERS)


def redact_config_values(values):
    """Redact sensitive config values before returning them to clients."""
    redacted = {}
    for key, value in values.items():
        if is_sensitive_config_key(key) and value:
            redacted[key] = "<redacted>"
        else:
            redacted[key] = value
    return redacted


'''
    if "def redact_config_values" not in text:
        anchor = "def _serialize_config_value(value):\n"
        if anchor not in text:
            raise RuntimeError("app.py serialize anchor not found")
        text = text.replace(anchor, helper + anchor, 1)
    text = text.replace(
        "return jsonify({'success': True, 'config': config_values})",
        "return jsonify({'success': True, 'config': redact_config_values(config_values)})",
        1,
    )
    text = text.replace(
        "return jsonify({'success': True, 'config': updated_config})",
        "return jsonify({'success': True, 'config': redact_config_values(updated_config)})",
        1,
    )
    app_path.write_text(text, encoding="utf-8")


MEDIA_CRAWLER_DB_CONFIG = '''# MediaCrawler DB config generated by ss-monitor production deployment.
# Credentials are intentionally resolved from environment variables at runtime.

import os


def env_value(*names, default=""):
    for name in names:
        value = os.getenv(name)
        if value not in (None, ""):
            return value
    return default


def env_int(*names, default=0):
    value = env_value(*names, default=str(default))
    try:
        return int(value)
    except (TypeError, ValueError):
        return int(default)


MYSQL_DB_PWD = env_value("MYSQL_DB_PWD", "MINDSPIDER_DB_PASSWORD", "DB_PASSWORD", default="123456")
MYSQL_DB_USER = env_value("MYSQL_DB_USER", "MINDSPIDER_DB_USER", "DB_USER", default="root")
MYSQL_DB_HOST = env_value("MYSQL_DB_HOST", "MINDSPIDER_DB_HOST", "DB_HOST", default="localhost")
MYSQL_DB_PORT = env_int("MYSQL_DB_PORT", "MINDSPIDER_DB_PORT", "DB_PORT", default=3306)
MYSQL_DB_NAME = env_value("MYSQL_DB_NAME", "MINDSPIDER_DB_NAME", "DB_NAME", default="media_crawler")
mysql_db_config = {
    "user": MYSQL_DB_USER,
    "password": MYSQL_DB_PWD,
    "host": MYSQL_DB_HOST,
    "port": MYSQL_DB_PORT,
    "db_name": MYSQL_DB_NAME,
}

REDIS_DB_HOST = env_value("REDIS_DB_HOST", default="127.0.0.1")
REDIS_DB_PWD = env_value("REDIS_DB_PWD", default="123456")
REDIS_DB_PORT = env_int("REDIS_DB_PORT", default=6379)
REDIS_DB_NUM = env_int("REDIS_DB_NUM", default=0)
CACHE_TYPE_REDIS = "redis"
CACHE_TYPE_MEMORY = "memory"

SQLITE_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "database", "sqlite_tables.db")
sqlite_db_config = {"db_path": SQLITE_DB_PATH}

MONGODB_HOST = env_value("MONGODB_HOST", default="localhost")
MONGODB_PORT = env_int("MONGODB_PORT", default=27017)
MONGODB_USER = env_value("MONGODB_USER", default="")
MONGODB_PWD = env_value("MONGODB_PWD", default="")
MONGODB_DB_NAME = env_value("MONGODB_DB_NAME", default="media_crawler")
mongodb_config = {
    "host": MONGODB_HOST,
    "port": int(MONGODB_PORT),
    "user": MONGODB_USER,
    "password": MONGODB_PWD,
    "db_name": MONGODB_DB_NAME,
}

POSTGRES_DB_PWD = env_value("POSTGRES_DB_PWD", "MINDSPIDER_DB_PASSWORD", "DB_PASSWORD", default="123456")
POSTGRES_DB_USER = env_value("POSTGRES_DB_USER", "MINDSPIDER_DB_USER", "DB_USER", default="postgres")
POSTGRES_DB_HOST = env_value("POSTGRES_DB_HOST", "MINDSPIDER_DB_HOST", "DB_HOST", default="localhost")
POSTGRES_DB_PORT = env_int("POSTGRES_DB_PORT", "MINDSPIDER_DB_PORT", "DB_PORT", default=5432)
POSTGRES_DB_NAME = env_value("POSTGRES_DB_NAME", "MINDSPIDER_DB_NAME", "DB_NAME", default="media_crawler")
postgres_db_config = {
    "user": POSTGRES_DB_USER,
    "password": POSTGRES_DB_PWD,
    "host": POSTGRES_DB_HOST,
    "port": POSTGRES_DB_PORT,
    "db_name": POSTGRES_DB_NAME,
}
'''


def patch_platform_crawler_db_config_generation():
    crawler_path = release_dir / "MindSpider" / "DeepSentimentCrawling" / "platform_crawler.py"
    text = crawler_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if "new_config = f'''" not in line:
            continue
        indent = line[: len(line) - len(line.lstrip())]
        end = index + 1
        while end < len(lines) and lines[end].strip() != "'''":
            end += 1
        if end >= len(lines):
            raise RuntimeError("platform_crawler.py new_config block end not found")
        replacement = [f"{indent}# Keep credentials out of db_config.py; MediaCrawler reads them from env."]
        replacement += [f"{indent}new_config = {MEDIA_CRAWLER_DB_CONFIG!r}"]
        lines = lines[:index] + replacement + lines[end + 1 :]
        break
    else:
        if "Credentials are intentionally resolved from environment variables at runtime." not in text:
            raise RuntimeError("platform_crawler.py new_config block not found")

    text = "\n".join(lines) + "\n"
    marker = "            # 切换到MediaCrawler目录并执行\n"
    env_block = '''            child_env = os.environ.copy()
            child_env.update({
                "MYSQL_DB_PWD": str(config.settings.DB_PASSWORD or ""),
                "MYSQL_DB_USER": str(config.settings.DB_USER or ""),
                "MYSQL_DB_HOST": str(config.settings.DB_HOST or ""),
                "MYSQL_DB_PORT": str(config.settings.DB_PORT or ""),
                "MYSQL_DB_NAME": str(config.settings.DB_NAME or ""),
                "MINDSPIDER_DB_PASSWORD": str(config.settings.DB_PASSWORD or ""),
                "MINDSPIDER_DB_USER": str(config.settings.DB_USER or ""),
                "MINDSPIDER_DB_HOST": str(config.settings.DB_HOST or ""),
                "MINDSPIDER_DB_PORT": str(config.settings.DB_PORT or ""),
                "MINDSPIDER_DB_NAME": str(config.settings.DB_NAME or ""),
                "DB_PASSWORD": str(config.settings.DB_PASSWORD or ""),
                "DB_USER": str(config.settings.DB_USER or ""),
                "DB_HOST": str(config.settings.DB_HOST or ""),
                "DB_PORT": str(config.settings.DB_PORT or ""),
                "DB_NAME": str(config.settings.DB_NAME or ""),
            })
'''
    if "child_env = os.environ.copy()" not in text:
        if marker not in text:
            raise RuntimeError("platform_crawler.py subprocess marker not found")
        text = text.replace(marker, marker + env_block, 1)
    if "env=child_env," not in text:
        cwd_line = "                cwd=self.mediacrawler_path,\n"
        if cwd_line not in text:
            raise RuntimeError("platform_crawler.py cwd line not found")
        text = text.replace(cwd_line, cwd_line + "                env=child_env,\n", 1)
    crawler_path.write_text(text, encoding="utf-8")


def patch_media_crawler_db_config():
    db_config = release_dir / "MindSpider" / "DeepSentimentCrawling" / "MediaCrawler" / "config" / "db_config.py"
    if db_config.exists():
        db_config.write_text(MEDIA_CRAWLER_DB_CONFIG, encoding="utf-8")


patch_app_config_redaction()
patch_platform_crawler_db_config_generation()
patch_media_crawler_db_config()
print("Applied BettaFish production compatibility patches")
PY
}

apply_bettafish_production_patches "$release_dir"
"$python_cmd" -m py_compile \
  "$release_dir/app.py" \
  "$release_dir/MindSpider/DeepSentimentCrawling/platform_crawler.py" \
  "$release_dir/MindSpider/DeepSentimentCrawling/MediaCrawler/config/db_config.py"

set_env_file() {
  file="$1"; key="$2"; value="$3"; tmp="$file.tmp.$$"
  touch "$file"
  awk -v key="$key" -v value="$value" '
    index($0, key "=") == 1 { print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

get_ss_env() {
  key="$1"
  awk -F= -v key="$key" 'index($0, key "=") == 1 { print substr($0, index($0, "=") + 1); exit }' /opt/ss-monitor/.env 2>/dev/null || true
}

if [ ! -f "$env_file" ]; then
  if [ -f "$release_dir/.env.example" ]; then cp "$release_dir/.env.example" "$env_file"; else touch "$env_file"; fi
fi
set_env_file "$env_file" HOST 127.0.0.1
set_env_file "$env_file" PORT 5000
set_env_file "$env_file" DB_DIALECT "$(get_ss_env MINDSPIDER_DB_DIALECT || true)"
set_env_file "$env_file" DB_HOST "$(get_ss_env MINDSPIDER_DB_HOST || true)"
set_env_file "$env_file" DB_PORT "$(get_ss_env MINDSPIDER_DB_PORT || true)"
set_env_file "$env_file" DB_USER "$(get_ss_env MINDSPIDER_DB_USER || true)"
set_env_file "$env_file" DB_PASSWORD "$(get_ss_env MINDSPIDER_DB_PASSWORD || true)"
set_env_file "$env_file" DB_NAME "$(get_ss_env MINDSPIDER_DB_NAME || true)"
set_env_file "$env_file" DB_CHARSET "$(get_ss_env MINDSPIDER_DB_CHARSET || true)"
set_env_file "$env_file" PLAYWRIGHT_BROWSERS_PATH "$playwright_browsers_path"

link_runtime_dir() {
  target="$1"; source="$2"
  rm -rf "$target"
  mkdir -p "$source" "$(dirname "$target")"
  ln -sfn "$source" "$target"
}
mkdir -p "$release_dir/logs" "$release_dir/final_reports" "$release_dir/insight_engine_streamlit_reports" "$release_dir/media_engine_streamlit_reports" "$release_dir/query_engine_streamlit_reports"
link_runtime_dir "$release_dir/MindSpider/DeepSentimentCrawling/MediaCrawler/data" "$runtime_root/mediacrawler-data"
link_runtime_dir "$release_dir/MindSpider/DeepSentimentCrawling/MediaCrawler/browser_data" "$runtime_root/mediacrawler-browser_data"
link_runtime_dir "$release_dir/MindSpider/DeepSentimentCrawling/MediaCrawler/temp_image" "$runtime_root/mediacrawler-temp_image"

if [ -x "$venv/bin/python" ] && ! "$venv/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1; then
  rm -rf "$venv"
fi
if [ ! -x "$venv/bin/python" ]; then
  "$python_cmd" -m venv "$venv"
fi
if [ "$install_deps" = "1" ]; then
  "$venv/bin/python" -m pip install --upgrade pip
  "$venv/bin/python" -m pip install "setuptools<82" "wheel==0.45.1" "packaging==23.2"
  "$venv/bin/python" -m pip install -r "$release_dir/requirements.txt"
  "$venv/bin/python" -m pip install -r "$release_dir/MindSpider/requirements.txt"
  "$venv/bin/python" -m pip install -r "$release_dir/MindSpider/DeepSentimentCrawling/MediaCrawler/requirements.txt"
  if [ -n "$semantic_dep_packages" ]; then
    read -r -a semantic_dep_package_array <<< "$semantic_dep_packages"
    "$venv/bin/python" -m pip install "\${semantic_dep_package_array[@]}"
  fi
  "$venv/bin/python" -m pip install "setuptools<82" "wheel==0.45.1" "packaging==23.2"
fi
if [ "$install_playwright" = "1" ]; then
  PLAYWRIGHT_BROWSERS_PATH="$playwright_browsers_path" "$venv/bin/python" -m playwright install chromium
fi

install -m 0640 -o root -g yq "$env_file" "$release_dir/.env"
chown -R yq:yq "$release_dir"
chown -R yq:yq "$playwright_browsers_path"
chown -R yq:yq "$runtime_root"
find "$release_dir" -type d -exec chmod 0755 {} +
find "$release_dir" -type f -exec chmod a+r {} +
find "$playwright_browsers_path" -type d -exec chmod 0755 {} + 2>/dev/null || true
find "$playwright_browsers_path" -type f -exec chmod a+r {} + 2>/dev/null || true
for writable_dir in \
  "$release_dir/logs" \
  "$release_dir/final_reports" \
  "$release_dir/insight_engine_streamlit_reports" \
  "$release_dir/media_engine_streamlit_reports" \
  "$release_dir/query_engine_streamlit_reports" \
  "$release_dir/agent_zone" \
  "$release_dir/debug_tools" \
  "$release_dir/wordcloud_temp" \
  "$release_dir/test_output" \
  "$release_dir/test_results" \
  "$release_dir/temp" \
  "$release_dir/tmp" \
  "$release_dir/MindSpider/DeepSentimentCrawling/MediaCrawler/data" \
  "$release_dir/MindSpider/DeepSentimentCrawling/MediaCrawler/browser_data" \
  "$release_dir/MindSpider/DeepSentimentCrawling/MediaCrawler/temp_image"; do
  mkdir -p "$writable_dir"
  resolved_dir="$(readlink -f "$writable_dir" || printf '%s' "$writable_dir")"
  chown -R yq:yq "$resolved_dir"
  chmod -R u+rwX,go+rX "$resolved_dir"
done
chown root:yq "$release_dir/.env" "$env_file" 2>/dev/null || true
chmod 0640 "$release_dir/.env" "$env_file" 2>/dev/null || true

ln -sfn "releases/$release_name" "$remote_root/current.tmp"
mv -Tf "$remote_root/current.tmp" "$remote_root/current"

cat > /etc/systemd/system/bettafish-full.service <<'UNIT'
[Unit]
Description=Full BettaFish Public Opinion System
After=network.target mariadb.service
Wants=mariadb.service

[Service]
Type=simple
User=yq
WorkingDirectory=/opt/BettaFish/current
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONIOENCODING=utf-8
EnvironmentFile=/opt/BettaFish/.env
ExecStart=/opt/BettaFish/.venv/bin/python app.py
Restart=always
RestartSec=5
KillSignal=SIGTERM
KillMode=control-group

[Install]
WantedBy=multi-user.target
UNIT

if [ "$update_monitor_env" = "1" ] && [ -f /opt/ss-monitor/.env ]; then
  backup="/opt/ss-monitor/.env.bak-bettafish-full-$(date +%Y%m%d%H%M%S)"
  cp -a /opt/ss-monitor/.env "$backup"
  set_env_file /opt/ss-monitor/.env BETTAFISH_BASE_URL http://127.0.0.1:5000
  set_env_file /opt/ss-monitor/.env BETTAFISH_REPO_DIR "$remote_root/current"
  set_env_file /opt/ss-monitor/.env BETTAFISH_PYTHON "$venv/bin/python"
  set_env_file /opt/ss-monitor/.env BETTAFISH_START_COMMAND "$venv/bin/python app.py"
  set_env_file /opt/ss-monitor/.env BETTAFISH_DEPLOY_COMMAND ""
  set_env_file /opt/ss-monitor/.env BETTAFISH_SEMANTIC_MODELS "$semantic_models"
  set_env_file /opt/ss-monitor/.env MINDSPIDER_ENV_FILE "$env_file"
  set_env_file /opt/ss-monitor/.env MINDSPIDER_DOUYIN_IMPORT_DIR "/opt/ss-monitor/data/mindspider-douyin-imports:$remote_root/current/MindSpider/DeepSentimentCrawling/MediaCrawler/data"
  set_env_file /opt/ss-monitor/.env PLAYWRIGHT_BROWSERS_PATH "$playwright_browsers_path"
  if [ -L /opt/ss-monitor/current ] || [ -d /opt/ss-monitor/current ]; then
    install -m 0640 -o root -g yq /opt/ss-monitor/.env /opt/ss-monitor/current/.env
  fi
fi

systemctl daemon-reload
systemctl enable bettafish-full
systemctl restart bettafish-full
if [ "$restart_monitor" = "1" ] && systemctl list-unit-files ss-monitor.service >/dev/null 2>&1; then
  systemctl restart ss-monitor
fi
sleep 5
systemctl --no-pager --full status bettafish-full | sed -n '1,18p'
if [ -d "$release_dir/.git" ]; then
  git config --global --add safe.directory "$release_dir" || true
  git config --global --add safe.directory "$release_dir/MindSpider/DeepSentimentCrawling/MediaCrawler" || true
  printf '\\nBETTAFISH_GIT_HEAD='
  git -C "$release_dir" rev-parse HEAD
  printf 'BETTAFISH_GIT_STATUS_BEGIN\\n'
  git -C "$release_dir" -c core.quotepath=false status --short --untracked-files=no --ignore-submodules=dirty
  printf 'BETTAFISH_GIT_STATUS_END\\n'
  printf 'BETTAFISH_SUBMODULES_BEGIN\\n'
  git -C "$release_dir" -c core.quotepath=false submodule status --recursive
  printf 'BETTAFISH_SUBMODULES_END\\n'
fi
printf '\\nBETTAFISH_PIP_CHECK='
"$venv/bin/python" -m pip check
printf '\\nBETTAFISH_STATUS='
curl -fsS http://127.0.0.1:5000/api/status
printf '\\n'
if [ "$restart_monitor" = "1" ]; then
  printf 'SS_MONITOR_HEALTH='
  curl -fsS -H 'Host: 192.168.8.242' http://127.0.0.1/api/health || true
  printf '\\n'
fi
rm -f "$archive"
`;
  return runRemote(command);
}

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
    if (isBettaFishRepo(resolved)) return resolved;
  }
  throw new Error("Full BettaFish repo was not found. Set SYNC_BETTAFISH_FULL_LOCAL_REPO.");
}

function isBettaFishRepo(candidate: string) {
  return existsSync(path.join(candidate, "app.py")) && existsSync(path.join(candidate, "MindSpider", "main.py"));
}

async function resolveLocalRevisionFull(repoDir: string) {
  try {
    const result = await runLocalCapture("git", ["-C", repoDir, "rev-parse", "HEAD"]);
    return result.trim() || "local";
  } catch {
    return "local";
  }
}

function parseRemote(value: string) {
  const match = value.match(/^([^@]+)@(.+)$/);
  if (!match) throw new Error("SYNC_BETTAFISH_FULL_REMOTE must use user@host format.");
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
        readyTimeout: 15_000
      });
  });
}

function uploadFile(client: Client, localPath: string, remotePath: string) {
  return new Promise<void>((resolve, reject) => {
    client.sftp((sftpError, sftp) => {
      if (sftpError || !sftp) {
        reject(sftpError || new Error("SFTP session was not created."));
        return;
      }
      sftp.fastPut(localPath, remotePath, (uploadError) => {
        sftp.end();
        if (uploadError) reject(uploadError);
        else resolve();
      });
    });
  });
}

function runRemote(command: string) {
  return new Promise<void>((resolve, reject) => {
    const client = new Client();
    client
      .on("ready", () => {
        client.exec(`bash -lc ${shellQuote(command)}`, (execError, stream) => {
          if (execError) {
            client.end();
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
            client.end();
            if (stdout.trim()) console.log(stdout.trim());
            if (stderr.trim()) console.error(stderr.trim());
            if (code === 0) resolve();
            else reject(new Error(`remote command exited with code ${code}`));
          });
          stream.end();
        });
      })
      .on("error", reject)
      .connect({
        host: target.host,
        port: sshPort,
        username: target.username,
        password: sshPassword,
        readyTimeout: 15_000
      });
  });
}

function runLocal(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function runLocalCapture(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${command} exited with code ${code}`));
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

function parseBoolean(value: string) {
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function normalizeRemoteRoot(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed.startsWith("/")) throw new Error("SYNC_BETTAFISH_FULL_REMOTE_ROOT must be an absolute path.");
  return trimmed || "/opt/BettaFish";
}

function timestamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(1)} MiB`;
  return `${(mib / 1024).toFixed(1)} GiB`;
}
