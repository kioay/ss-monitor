#!/usr/bin/env bash
set -Eeuo pipefail

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

APP_ROOT="${APP_ROOT:-/opt/ss-monitor}"
BETTAFISH_ROOT="${BETTAFISH_ROOT:-${DOUYIN_SERVER_BETTAFISH_ROOT:-/opt/BettaFish}}"

load_env_file "$APP_ROOT/.env"
load_env_file "$BETTAFISH_ROOT/.env"
load_env_file "$BETTAFISH_ROOT/current/.env"

BETTAFISH_CURRENT="${BETTAFISH_REPO_DIR:-$BETTAFISH_ROOT/current}"
MEDIA_CRAWLER_DIR="${BETTAFISH_DOUYIN_MEDIA_CRAWLER_DIR:-$BETTAFISH_CURRENT/MindSpider/DeepSentimentCrawling/MediaCrawler}"
PROFILE_DIR="${BETTAFISH_DOUYIN_REMOTE_PROFILE_DIR:-$MEDIA_CRAWLER_DIR/browser_data/cdp_dy_user_data_dir}"
BROWSER="${DOUYIN_SERVER_BROWSER:-$BETTAFISH_ROOT/playwright-browsers/chromium-1124/chrome-linux/chrome}"
if [ ! -x "$BROWSER" ] && command -v google-chrome >/dev/null 2>&1; then
  BROWSER="$(command -v google-chrome)"
fi

RUNTIME_DIR="${BETTAFISH_DOUYIN_REMOTE_RUNTIME_DIR:-$BETTAFISH_ROOT/runtime/douyin-remote-login}"
DISPLAY_NUM="${BETTAFISH_DOUYIN_REMOTE_DISPLAY:-88}"
VNC_PORT="${BETTAFISH_DOUYIN_REMOTE_VNC_PORT:-5988}"
NOVNC_PORT="${BETTAFISH_DOUYIN_REMOTE_NOVNC_PORT:-6088}"
GEOMETRY="${BETTAFISH_DOUYIN_REMOTE_GEOMETRY:-1920x1080}"
VNC_PASSWORD="${BETTAFISH_DOUYIN_REMOTE_PASSWORD:-${DOUYIN_REMOTE_LOGIN_PASSWORD:-}}"
VNC_PASSWD_FILE="$RUNTIME_DIR/vnc.passwd"

mkdir -p "$RUNTIME_DIR" "$PROFILE_DIR"
chmod 700 "$RUNTIME_DIR"

if [ -n "$VNC_PASSWORD" ]; then
  printf '%s\n' "$VNC_PASSWORD" | vncpasswd -f > "$VNC_PASSWD_FILE"
  chmod 600 "$VNC_PASSWD_FILE"
fi

if [ ! -s "$VNC_PASSWD_FILE" ]; then
  echo "Missing BETTAFISH_DOUYIN_REMOTE_PASSWORD or DOUYIN_REMOTE_LOGIN_PASSWORD." >&2
  exit 1
fi

if [ ! -x "$BROWSER" ]; then
  echo "Browser executable not found: $BROWSER" >&2
  exit 1
fi
if [ ! -x /usr/bin/Xvnc ]; then
  echo "Xvnc is required for Douyin remote login." >&2
  exit 1
fi
if [ ! -x /opt/novnc/utils/novnc_proxy ]; then
  echo "noVNC is required at /opt/novnc." >&2
  exit 1
fi

cleanup() {
  jobs -pr | xargs -r kill 2>/dev/null || true
}
trap cleanup EXIT
trap 'cleanup; exit 0' INT TERM

rm -f "/tmp/.X${DISPLAY_NUM}-lock"
Xvnc ":$DISPLAY_NUM" \
  -geometry "$GEOMETRY" \
  -depth 24 \
  -rfbport "$VNC_PORT" \
  -localhost \
  -SecurityTypes VncAuth \
  -PasswordFile "$VNC_PASSWD_FILE" \
  -AlwaysShared \
  > "$RUNTIME_DIR/xvnc.log" 2>&1 &

for _ in $(seq 1 30); do
  if bash -c "</dev/tcp/127.0.0.1/$VNC_PORT" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

/opt/novnc/utils/novnc_proxy \
  --listen "0.0.0.0:$NOVNC_PORT" \
  --vnc "127.0.0.1:$VNC_PORT" \
  --web /opt/novnc \
  > "$RUNTIME_DIR/novnc.log" 2>&1 &

export DISPLAY=":$DISPLAY_NUM"
export HOME="${HOME:-/home/yq}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-$(id -u)}"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

"$BROWSER" \
  --no-first-run \
  --no-default-browser-check \
  --disable-dev-shm-usage \
  --no-sandbox \
  --disable-blink-features=AutomationControlled \
  --exclude-switches=enable-automation \
  --disable-infobars \
  --user-data-dir="$PROFILE_DIR" \
  --window-size="$GEOMETRY" \
  --start-maximized \
  "https://www.douyin.com/" \
  > "$RUNTIME_DIR/chrome.log" 2>&1 &

wait -n
