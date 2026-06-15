#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/ss-monitor}"
CURRENT_DIR="${SS_MONITOR_CURRENT_DIR:-$APP_ROOT/current}"
ENV_FILE="${SS_MONITOR_ENV_FILE:-$APP_ROOT/.env}"
BETTAFISH_ROOT="${BETTAFISH_ROOT:-${DOUYIN_SERVER_BETTAFISH_ROOT:-/opt/BettaFish}}"
REMOTE_SERVICE_NAME="${DOUYIN_REMOTE_LOGIN_SERVICE:-ss-monitor-douyin-remote-login.service}"
SYSTEMD_UNIT_DIR="${SS_MONITOR_SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
SUDOERS_DIR="${SS_MONITOR_SUDOERS_DIR:-/etc/sudoers.d}"
INSTALL_PACKAGES=true
RESTART_MAIN_SERVICE=true
SMOKE_TEST=true

log() {
  printf '[douyin-remote-login] %s\n' "$*"
}

fail() {
  printf '[douyin-remote-login] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: sudo bash /opt/ss-monitor/current/scripts/setup-douyin-remote-login.sh [options]

Options:
  --no-install-packages  Do not install VNC/noVNC packages with apt-get.
  --no-restart          Do not restart ss-monitor.service after writing env.
  --no-smoke-test       Do not start/stop the remote-login unit for verification.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-install-packages) INSTALL_PACKAGES=false ;;
    --no-restart) RESTART_MAIN_SERVICE=false ;;
    --no-smoke-test) SMOKE_TEST=false ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

[ "$(id -u)" -eq 0 ] || fail "Run this script with sudo."
[[ "$REMOTE_SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+[.]service$ ]] || fail "Invalid service name: $REMOTE_SERVICE_NAME"
[ -d "$CURRENT_DIR" ] || fail "Current release directory not found: $CURRENT_DIR"
[ -f "$CURRENT_DIR/scripts/run-douyin-remote-login.sh" ] || fail "Remote-login runner missing from release: $CURRENT_DIR/scripts/run-douyin-remote-login.sh"

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

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  mkdir -p "$(dirname "$file")"
  touch "$file"
  tmp="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { done = 0 }
    $0 ~ "^[[:space:]]*" key "=" {
      print key "=" value
      done = 1
      next
    }
    { print }
    END {
      if (!done) print key "=" value
    }
  ' "$file" > "$tmp"
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 18 | tr -d '\n'
  elif command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(18), end="")
PY
  else
    date +%s%N | sha256sum | awk '{print substr($1,1,24)}'
  fi
}

detect_service_user() {
  local owner user
  user="${SS_MONITOR_SERVICE_USER:-}"
  if [ -z "$user" ] && command -v systemctl >/dev/null 2>&1; then
    user="$(systemctl show ss-monitor.service -p User --value 2>/dev/null || true)"
  fi
  if { [ -z "$user" ] || [ "$user" = "root" ]; } && [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER:-}" != "root" ]; then
    user="${SUDO_USER:-yq}"
  fi
  if [ -z "$user" ] || [ "$user" = "root" ]; then
    owner="$(stat -c %U "$CURRENT_DIR" 2>/dev/null || true)"
    if [ -n "$owner" ] && [ "$owner" != "root" ] && [ "$owner" != "UNKNOWN" ]; then
      user="$owner"
    fi
  fi
  if [ -z "$user" ] || [ "$user" = "root" ]; then
    user="yq"
  fi
  id "$user" >/dev/null 2>&1 || fail "Service user does not exist: $user. Set SS_MONITOR_SERVICE_USER first."
  printf '%s' "$user"
}

detect_host() {
  if [ -n "${DOUYIN_REMOTE_LOGIN_HOST:-}" ]; then
    printf '%s' "$DOUYIN_REMOTE_LOGIN_HOST"
    return
  fi
  hostname -I 2>/dev/null | tr ' ' '\n' | awk '$1 !~ /^127[.]/ && $1 !~ /^169[.]254[.]/ && $1 !~ /:/ { print $1; exit }'
}

install_vnc_packages() {
  local need_packages=false
  local novnc_dir="${BETTAFISH_DOUYIN_REMOTE_NOVNC_DIR:-}"
  local novnc_proxy="${BETTAFISH_DOUYIN_REMOTE_NOVNC_PROXY:-}"
  command -v Xvnc >/dev/null 2>&1 || need_packages=true
  command -v vncpasswd >/dev/null 2>&1 || need_packages=true

  if [ -n "$novnc_proxy" ]; then
    [ -x "$novnc_proxy" ] || need_packages=true
  elif [ -n "$novnc_dir" ]; then
    [ -x "$novnc_dir/utils/novnc_proxy" ] || need_packages=true
  elif [ ! -x /usr/share/novnc/utils/novnc_proxy ] && [ ! -x /opt/novnc/utils/novnc_proxy ]; then
    need_packages=true
  fi

  if [ "$need_packages" != "true" ]; then
    return
  fi

  if [ "$INSTALL_PACKAGES" != "true" ]; then
    fail "VNC/noVNC packages are missing. Re-run without --no-install-packages or install tigervnc-standalone-server tigervnc-tools novnc websockify."
  fi
  command -v apt-get >/dev/null 2>&1 || fail "VNC/noVNC packages are missing and apt-get is unavailable."

  log "Installing VNC/noVNC packages with apt-get."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y tigervnc-standalone-server tigervnc-tools novnc websockify
}

detect_novnc_dir() {
  local candidate
  for candidate in "${BETTAFISH_DOUYIN_REMOTE_NOVNC_DIR:-}" /usr/share/novnc /opt/novnc; do
    [ -n "$candidate" ] || continue
    if [ -x "$candidate/utils/novnc_proxy" ]; then
      printf '%s' "$candidate"
      return
    fi
  done
}

write_remote_unit() {
  local service_user="$1"
  local home_dir
  local unit_path="$SYSTEMD_UNIT_DIR/$REMOTE_SERVICE_NAME"
  home_dir="$(getent passwd "$service_user" | cut -d: -f6)"
  [ -n "$home_dir" ] || home_dir="/home/$service_user"
  mkdir -p "$SYSTEMD_UNIT_DIR"

  cat > "$unit_path" <<UNIT
[Unit]
Description=SS Monitor Douyin remote login noVNC session
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$service_user
WorkingDirectory=$CURRENT_DIR
Environment=APP_ROOT=$APP_ROOT
Environment=BETTAFISH_ROOT=$BETTAFISH_ROOT
Environment=HOME=$home_dir
EnvironmentFile=-$ENV_FILE
EnvironmentFile=-$BETTAFISH_ROOT/.env
EnvironmentFile=-$BETTAFISH_ROOT/current/.env
ExecStart=/usr/bin/bash $CURRENT_DIR/scripts/run-douyin-remote-login.sh
Restart=on-failure
RestartSec=5
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
UNIT
  chmod 0644 "$unit_path"
}

write_sudoers() {
  local service_user="$1"
  local systemctl_bin
  local sudoers_path="$SUDOERS_DIR/ss-monitor-douyin-remote-login"
  [ "$service_user" != "root" ] || return 0
  mkdir -p "$SUDOERS_DIR"
  systemctl_bin="$(command -v systemctl || printf '/usr/bin/systemctl')"
  cat > "$sudoers_path" <<SUDOERS
$service_user ALL=(root) NOPASSWD: $systemctl_bin start $REMOTE_SERVICE_NAME, $systemctl_bin stop $REMOTE_SERVICE_NAME, $systemctl_bin is-active $REMOTE_SERVICE_NAME, $systemctl_bin status $REMOTE_SERVICE_NAME
SUDOERS
  chmod 0440 "$sudoers_path"
  visudo -cf "$sudoers_path" >/dev/null
}

mirror_env_to_current() {
  local service_user="$1"
  local current_env="$CURRENT_DIR/.env"
  chown root:"$service_user" "$ENV_FILE" 2>/dev/null || true
  chmod 0640 "$ENV_FILE" 2>/dev/null || true
  cp -f "$ENV_FILE" "$current_env"
  chown root:"$service_user" "$current_env" 2>/dev/null || true
  chmod 0640 "$current_env" 2>/dev/null || true
}

smoke_test_entry() {
  local port="$1"
  local ok=false
  log "Starting $REMOTE_SERVICE_NAME for a noVNC smoke test."
  systemctl start "$REMOTE_SERVICE_NAME"
  for _ in $(seq 1 40); do
    if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$port/vnc.html" >/dev/null; then
      ok=true
      break
    fi
    if ! command -v curl >/dev/null 2>&1 && bash -c "</dev/tcp/127.0.0.1/$port" >/dev/null 2>&1; then
      ok=true
      break
    fi
    sleep 0.5
  done
  systemctl stop "$REMOTE_SERVICE_NAME" >/dev/null 2>&1 || true
  [ "$ok" = "true" ] || fail "noVNC did not answer on 127.0.0.1:$port during smoke test. Check journalctl -u $REMOTE_SERVICE_NAME."
}

load_env_file "$ENV_FILE"
load_env_file "$CURRENT_DIR/.env"
REMOTE_SERVICE_NAME="${DOUYIN_REMOTE_LOGIN_SERVICE:-$REMOTE_SERVICE_NAME}"
[[ "$REMOTE_SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+[.]service$ ]] || fail "Invalid service name: $REMOTE_SERVICE_NAME"

SERVICE_USER="$(detect_service_user)"
install_vnc_packages

NOVNC_PORT="${BETTAFISH_DOUYIN_REMOTE_NOVNC_PORT:-6088}"
VNC_PORT="${BETTAFISH_DOUYIN_REMOTE_VNC_PORT:-5988}"
NOVNC_DIR="$(detect_novnc_dir)"
[ -n "$NOVNC_DIR" ] || fail "Could not find noVNC web root. Set BETTAFISH_DOUYIN_REMOTE_NOVNC_DIR."
PUBLIC_HOST="$(detect_host)"
[ -n "$PUBLIC_HOST" ] || PUBLIC_HOST="127.0.0.1"
REMOTE_URL="${DOUYIN_REMOTE_LOGIN_URL:-http://$PUBLIC_HOST:$NOVNC_PORT/vnc.html?autoconnect=true&resize=scale}"
REMOTE_PASSWORD="${BETTAFISH_DOUYIN_REMOTE_PASSWORD:-${DOUYIN_REMOTE_LOGIN_PASSWORD:-}}"
if [ -z "$REMOTE_PASSWORD" ]; then
  REMOTE_PASSWORD="$(random_secret)"
  log "Generated a local VNC password and saved it in $ENV_FILE."
fi

if [ -n "${DOUYIN_REMOTE_LOGIN_URL:-}" ] || [ -n "${DOUYIN_REMOTE_LOGIN_HOST:-}" ]; then
  upsert_env "$ENV_FILE" "DOUYIN_REMOTE_LOGIN_URL" "$REMOTE_URL"
fi
upsert_env "$ENV_FILE" "DOUYIN_REMOTE_LOGIN_SERVICE" "$REMOTE_SERVICE_NAME"
upsert_env "$ENV_FILE" "BETTAFISH_DOUYIN_REMOTE_NOVNC_PORT" "$NOVNC_PORT"
upsert_env "$ENV_FILE" "BETTAFISH_DOUYIN_REMOTE_VNC_PORT" "$VNC_PORT"
upsert_env "$ENV_FILE" "BETTAFISH_DOUYIN_REMOTE_PASSWORD" "$REMOTE_PASSWORD"
upsert_env "$ENV_FILE" "BETTAFISH_DOUYIN_REMOTE_NOVNC_DIR" "$NOVNC_DIR"

write_remote_unit "$SERVICE_USER"
write_sudoers "$SERVICE_USER"
mirror_env_to_current "$SERVICE_USER"
systemctl daemon-reload

if [ "$RESTART_MAIN_SERVICE" = "true" ] && systemctl cat ss-monitor.service >/dev/null 2>&1; then
  log "Restarting ss-monitor.service so it reads the remote-login configuration."
  systemctl restart ss-monitor.service
fi

if [ "$SMOKE_TEST" = "true" ]; then
  smoke_test_entry "$NOVNC_PORT"
fi

log "Remote login entry is ready: $REMOTE_URL"
log "The VNC password is stored only in $ENV_FILE and mirrored to $CURRENT_DIR/.env."
