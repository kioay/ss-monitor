#!/usr/bin/env bash
set -Eeuo pipefail

log() {
  printf '%s %s\n' "$(date -Iseconds)" "$*"
}

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_env_file() {
  local file="$1"
  local line key value first last
  [ -f "$file" ] || return 0
  [ -r "$file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="$(trim "$line")"
    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue

    key="$(trim "${line%%=*}")"
    value="$(trim "${line#*=}")"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue

    if [ "${#value}" -ge 2 ]; then
      first="${value:0:1}"
      last="${value: -1}"
      if { [ "$first" = '"' ] && [ "$last" = '"' ]; } || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
        value="${value:1:${#value}-2}"
      fi
    fi

    if [ -z "${!key+x}" ]; then
      export "$key=$value"
    fi
  done < "$file"
}

int_or_default() {
  local value="${1:-}"
  local fallback="$2"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s' "$value"
  else
    printf '%s' "$fallback"
  fi
}

bool_or_default() {
  local value="${1:-}"
  local fallback="$2"
  case "$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|y|t) printf 'true' ;;
    0|false|no|off|n|f) printf 'false' ;;
    *) printf '%s' "$fallback" ;;
  esac
}

is_night_hour() {
  local hour="$1"
  local start="$2"
  local end="$3"
  if [ "$start" -eq "$end" ]; then
    return 1
  fi
  if [ "$start" -lt "$end" ]; then
    [ "$hour" -ge "$start" ] && [ "$hour" -lt "$end" ]
  else
    [ "$hour" -ge "$start" ] || [ "$hour" -lt "$end" ]
  fi
}

read_state_value() {
  local key="$1"
  [ -f "$STATE_FILE" ] || return 0
  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$STATE_FILE"
}

APP_ROOT="${APP_ROOT:-/opt/ss-monitor}"
BETTAFISH_ROOT="${BETTAFISH_ROOT:-${DOUYIN_SERVER_BETTAFISH_ROOT:-/opt/BettaFish}}"

load_env_file "$APP_ROOT/.env"
load_env_file "$BETTAFISH_ROOT/.env"
load_env_file "$BETTAFISH_ROOT/current/.env"

BETTAFISH_ROOT="${BETTAFISH_ROOT:-${DOUYIN_SERVER_BETTAFISH_ROOT:-/opt/BettaFish}}"
BETTAFISH_CURRENT="${BETTAFISH_REPO_DIR:-$BETTAFISH_ROOT/current}"
MEDIA_CRAWLER_DIR="${BETTAFISH_DOUYIN_MEDIA_CRAWLER_DIR:-$BETTAFISH_CURRENT/MindSpider/DeepSentimentCrawling/MediaCrawler}"
PYTHON="${BETTAFISH_PYTHON:-$BETTAFISH_ROOT/.venv/bin/python}"
STATE_DIR="${BETTAFISH_DOUYIN_STATE_DIR:-$BETTAFISH_ROOT/runtime/douyin-crawl-scheduler}"
STATE_FILE="$STATE_DIR/state.env"
LOCK_DIR="$STATE_DIR/run.lock"
FORCE_RUN="$(bool_or_default "${BETTAFISH_DOUYIN_FORCE:-false}" "false")"

DAY_INTERVAL_MINUTES="$(int_or_default "${BETTAFISH_DOUYIN_DAY_INTERVAL_MINUTES:-${DAY_UPDATE_INTERVAL_MINUTES:-60}}" 60)"
NIGHT_INTERVAL_MINUTES="$(int_or_default "${BETTAFISH_DOUYIN_NIGHT_INTERVAL_MINUTES:-${NIGHT_UPDATE_INTERVAL_MINUTES:-240}}" 240)"
NIGHT_START_HOUR="$(int_or_default "${BETTAFISH_DOUYIN_NIGHT_START_HOUR:-${NIGHT_START_HOUR:-0}}" 0)"
NIGHT_END_HOUR="$(int_or_default "${BETTAFISH_DOUYIN_NIGHT_END_HOUR:-${NIGHT_END_HOUR:-8}}" 8)"
LOCK_STALE_MINUTES="$(int_or_default "${BETTAFISH_DOUYIN_LOCK_STALE_MINUTES:-180}" 180)"
MAX_NOTES_COUNT="$(int_or_default "${BETTAFISH_DOUYIN_MAX_NOTES_COUNT:-15}" 15)"
MAX_COMMENTS_PER_ITEM="$(int_or_default "${BETTAFISH_DOUYIN_MAX_COMMENTS_PER_ITEM:-20}" 20)"
SLEEP_SECONDS="$(int_or_default "${BETTAFISH_DOUYIN_SLEEP_SECONDS:-2}" 2)"

if [ "$NIGHT_START_HOUR" -gt 23 ]; then NIGHT_START_HOUR=0; fi
if [ "$NIGHT_END_HOUR" -gt 23 ]; then NIGHT_END_HOUR=8; fi

mkdir -p "$STATE_DIR"
now_epoch="$(date +%s)"
current_hour="$((10#$(date +%H)))"
if is_night_hour "$current_hour" "$NIGHT_START_HOUR" "$NIGHT_END_HOUR"; then
  mode="night"
  interval_minutes="$NIGHT_INTERVAL_MINUTES"
else
  mode="day"
  interval_minutes="$DAY_INTERVAL_MINUTES"
fi
interval_seconds="$((interval_minutes * 60))"

last_completed_epoch="$(read_state_value last_completed_epoch || true)"
if [ "$FORCE_RUN" != "true" ] && [[ "$last_completed_epoch" =~ ^[0-9]+$ ]]; then
  elapsed_seconds="$((now_epoch - last_completed_epoch))"
  if [ "$elapsed_seconds" -ge 0 ] && [ "$elapsed_seconds" -lt "$interval_seconds" ]; then
    next_epoch="$((last_completed_epoch + interval_seconds))"
    log "Skip BettaFish Douyin crawl: ${mode} interval not elapsed; next eligible at $(date -d "@$next_epoch" -Iseconds)."
    exit 0
  fi
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  lock_mtime="$(stat -c %Y "$LOCK_DIR" 2>/dev/null || printf '%s' "$now_epoch")"
  lock_age_seconds="$((now_epoch - lock_mtime))"
  if [ "$lock_age_seconds" -lt "$((LOCK_STALE_MINUTES * 60))" ]; then
    log "Skip BettaFish Douyin crawl: another run is still active."
    exit 0
  fi
  log "Removing stale BettaFish Douyin crawl lock."
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

if [ ! -d "$MEDIA_CRAWLER_DIR" ]; then
  log "MediaCrawler directory missing: $MEDIA_CRAWLER_DIR"
  exit 1
fi
if [ ! -x "$PYTHON" ]; then
  log "BettaFish Python is not executable: $PYTHON"
  exit 1
fi

login_type="${BETTAFISH_DOUYIN_LOGIN_TYPE:-${SERVER_DOUYIN_LOGIN_TYPE:-cookie}}"
login_type="$(printf '%s' "$login_type" | tr '[:upper:]' '[:lower:]')"
case "$login_type" in
  qrcode|phone|cookie) ;;
  *)
    log "Unsupported BETTAFISH_DOUYIN_LOGIN_TYPE=$login_type"
    exit 1
    ;;
esac

db_dialect="$(printf '%s' "${MINDSPIDER_DB_DIALECT:-${DB_DIALECT:-mysql}}" | tr '[:upper:]' '[:lower:]')"
if [ -n "${BETTAFISH_DOUYIN_SAVE_DATA_OPTION:-}" ]; then
  save_data_option="$BETTAFISH_DOUYIN_SAVE_DATA_OPTION"
elif [ "$db_dialect" = "postgresql" ] || [ "$db_dialect" = "postgres" ]; then
  save_data_option="postgres"
else
  save_data_option="db"
fi

headless="$(bool_or_default "${BETTAFISH_DOUYIN_HEADLESS:-${SERVER_DOUYIN_HEADLESS:-true}}" "true")"
get_comment="$(bool_or_default "${BETTAFISH_DOUYIN_GET_COMMENT:-true}" "true")"
get_sub_comment="$(bool_or_default "${BETTAFISH_DOUYIN_GET_SUB_COMMENT:-false}" "false")"

export BETTAFISH_DOUYIN_LOGIN_TYPE="$login_type"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$BETTAFISH_ROOT/playwright-browsers}"
export PYTHONIOENCODING="${PYTHONIOENCODING:-utf-8}"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"

cd "$MEDIA_CRAWLER_DIR"

"$PYTHON" - "$MAX_NOTES_COUNT" "$MAX_COMMENTS_PER_ITEM" "$SLEEP_SECONDS" <<'PY'
import re
import sys
from pathlib import Path

config_path = Path("config/base_config.py")
updates = {
    "CRAWLER_MAX_NOTES_COUNT": int(sys.argv[1]),
    "CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES": int(sys.argv[2]),
    "CRAWLER_MAX_SLEEP_SEC": int(sys.argv[3]),
}
text = config_path.read_text(encoding="utf-8")
for key, value in updates.items():
    text, count = re.subn(rf"^{key}\s*=\s*.*$", f"{key} = {value}", text, flags=re.MULTILINE)
    if count != 1:
        raise SystemExit(f"Could not update {key} in {config_path}")
config_path.write_text(text, encoding="utf-8")
PY

keywords="$("$PYTHON" - <<'PY'
import base64
import json
import os
import sys

raw = os.environ.get("BETTAFISH_DOUYIN_KEYWORDS", "").strip()
encoded = os.environ.get("BETTAFISH_DOUYIN_KEYWORDS_B64", "").strip()
default_json = '["\\u751f\\u6b7b\\u72d9\\u51fb","\\u751f\\u6b7b\\u72d9\\u51fb1","4399\\u751f\\u6b7b\\u72d9\\u51fb","\\u751f\\u6b7b\\u72d9\\u51fb2","\\u751f\\u6b7b\\u72d9\\u51fb2\\u70ed\\u6cb9"]'

if encoded:
    data = json.loads(base64.b64decode(encoded).decode("utf-8"))
elif raw:
    print(raw)
    raise SystemExit(0)
else:
    data = json.loads(default_json)

if isinstance(data, str):
    print(data)
elif isinstance(data, list):
    print(",".join(str(item).strip() for item in data if str(item).strip()))
else:
    raise SystemExit("BETTAFISH_DOUYIN_KEYWORDS_B64 must decode to a JSON string or list")
PY
)"

if [ -z "$keywords" ]; then
  log "No Douyin keywords configured."
  exit 1
fi

preflight_json="$("$PYTHON" - <<'PY'
import json
import os
import sys

import config

login_type = os.environ.get("BETTAFISH_DOUYIN_LOGIN_TYPE", "cookie").strip().lower()
cookie_configured = bool(getattr(config, "COOKIES", ""))
data = {
    "platform": "dy",
    "loginType": login_type,
    "cookieConfigured": cookie_configured,
    "saveLoginState": bool(getattr(config, "SAVE_LOGIN_STATE", False)),
    "enableCdpMode": bool(getattr(config, "ENABLE_CDP_MODE", False)),
    "sleepSeconds": getattr(config, "CRAWLER_MAX_SLEEP_SEC", None),
    "maxNotes": getattr(config, "CRAWLER_MAX_NOTES_COUNT", None),
    "maxCommentsPerItem": getattr(config, "CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES", None),
}
print(json.dumps(data, ensure_ascii=False))
if not data["saveLoginState"]:
    raise SystemExit("MediaCrawler SAVE_LOGIN_STATE must remain enabled")
if login_type == "cookie" and not cookie_configured:
    raise SystemExit("Cookie login requested but no Douyin cookie is configured")
PY
)"

log "Starting BettaFish Douyin crawl: mode=$mode interval=${interval_minutes}m save=$save_data_option headless=$headless maxNotes=$MAX_NOTES_COUNT commentsPerItem=$MAX_COMMENTS_PER_ITEM sleepSeconds=$SLEEP_SECONDS preflight=$preflight_json"

"$PYTHON" main.py \
  --platform dy \
  --lt "$login_type" \
  --type search \
  --keywords "$keywords" \
  --save_data_option "$save_data_option" \
  --headless "$headless" \
  --get_comment "$get_comment" \
  --get_sub_comment "$get_sub_comment"

completed_epoch="$(date +%s)"
completed_at="$(date -Iseconds)"
cat > "$STATE_FILE" <<STATE
last_completed_epoch=$completed_epoch
last_completed_at=$completed_at
mode=$mode
interval_minutes=$interval_minutes
login_type=$login_type
save_data_option=$save_data_option
headless=$headless
STATE

log "BettaFish Douyin crawl completed at $completed_at."
