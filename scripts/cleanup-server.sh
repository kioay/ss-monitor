#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/ss-monitor}"
KEEP_RELEASES="${KEEP_RELEASES:-2}"
JOURNAL_MAX_SIZE="${JOURNAL_MAX_SIZE:-100M}"
JOURNAL_MAX_AGE="${JOURNAL_MAX_AGE:-7d}"

current_release=""
if [ -L "$APP_ROOT/current" ]; then
  current_release="$(readlink -f "$APP_ROOT/current" || true)"
fi

if [ -d "$APP_ROOT/releases" ]; then
  mapfile -t releases < <(find "$APP_ROOT/releases" -mindepth 1 -maxdepth 1 -type d | sort -r)
  kept=0
  for release in "${releases[@]}"; do
    release_real="$(readlink -f "$release" || true)"
    if [ -n "$current_release" ] && [ "$release_real" = "$current_release" ]; then
      continue
    fi
    kept=$((kept + 1))
    if [ "$kept" -gt "$KEEP_RELEASES" ]; then
      rm -rf -- "$release"
    fi
  done
fi

rm -f /home/yq/ss-monitor-deploy.tar.gz /tmp/ss-monitor-deploy.tar.gz
rm -f /tmp/node-v*-linux-x64-glibc-217.tar.xz

if command -v npm >/dev/null 2>&1; then
  npm cache clean --force >/dev/null 2>&1 || true
fi

if command -v journalctl >/dev/null 2>&1; then
  journalctl --vacuum-time="$JOURNAL_MAX_AGE" >/dev/null 2>&1 || true
  journalctl --vacuum-size="$JOURNAL_MAX_SIZE" >/dev/null 2>&1 || true
fi

if command -v find >/dev/null 2>&1; then
  find /tmp -maxdepth 1 -type f -name 'ss-monitor-*' -mtime +1 -delete 2>/dev/null || true
fi
