#!/usr/bin/env bash
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

DOMAIN="${DOMAIN:-ss-monitor.qinoay.top}"
UPSTREAM="${UPSTREAM:-http://127.0.0.1:8787}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/nginx.conf}"
CERT_DIR="${CERT_DIR:-/etc/letsencrypt/live/${DOMAIN}}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must be run as root or through sudo." >&2
  exit 1
fi

if [ ! -r "$NGINX_CONF" ] || [ ! -w "$NGINX_CONF" ]; then
  echo "Cannot read/write nginx config: $NGINX_CONF" >&2
  exit 1
fi

if ! curl -fsS --max-time 5 "$UPSTREAM/" >/dev/null; then
  echo "Upstream app is not reachable at $UPSTREAM/" >&2
  exit 1
fi

if [ ! -d "$CERT_DIR" ]; then
  if ! command -v certbot >/dev/null 2>&1; then
    echo "Certificate directory is missing and certbot is not installed: $CERT_DIR" >&2
    echo "Install certbot or provision the certificate before rerunning this script." >&2
    exit 1
  fi
  if [ -z "$LETSENCRYPT_EMAIL" ]; then
    echo "Set LETSENCRYPT_EMAIL before requesting a new Let's Encrypt certificate." >&2
    exit 1
  fi
  certbot certonly --nginx \
    --non-interactive \
    --agree-tos \
    --email "$LETSENCRYPT_EMAIL" \
    -d "$DOMAIN"
fi

if [ ! -r "$CERT_DIR/fullchain.pem" ] || [ ! -r "$CERT_DIR/privkey.pem" ]; then
  echo "Certificate files are missing under $CERT_DIR" >&2
  exit 1
fi

backup="${NGINX_CONF}.bak.$(date +%Y%m%d%H%M%S)"
cp -a "$NGINX_CONF" "$backup"

python3 - "$NGINX_CONF" "$DOMAIN" "$UPSTREAM" "$CERT_DIR" <<'PY'
import re
import sys
from pathlib import Path

conf_path = Path(sys.argv[1])
domain = sys.argv[2]
upstream = sys.argv[3]
cert_dir = sys.argv[4]
text = conf_path.read_text()

http_match = re.search(r"http\s*\{", text)
if not http_match:
    raise SystemExit("nginx config does not contain an http block")

def block_end(open_brace_index):
    depth = 0
    for index in range(open_brace_index, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    return None

http_open = text.find("{", http_match.start())
insert_at = block_end(http_open)
if insert_at is None:
    raise SystemExit("could not find the closing brace for the http block")

for match in re.finditer(r"server\s*\{", text[http_open:insert_at]):
    server_open = http_open + match.end() - 1
    server_close = block_end(server_open)
    if server_close is None or server_close > insert_at:
        continue
    block_text = text[server_open:server_close]
    has_domain = re.search(r"server_name\s+" + re.escape(domain) + r"\s*;", block_text)
    has_https = re.search(r"listen\s+[^;]*443[^;]*;", block_text)
    if has_domain and has_https:
        print(f"HTTPS server block already present for {domain}")
        raise SystemExit(0)

block = f"""

    server {{
        listen 0.0.0.0:443 ssl http2;
        server_name {domain};

        ssl_certificate {cert_dir}/fullchain.pem;
        ssl_certificate_key {cert_dir}/privkey.pem;

        location / {{
            proxy_pass {upstream};
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto https;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_read_timeout 120s;
            proxy_send_timeout 120s;
        }}
    }}
"""

conf_path.write_text(text[:insert_at].rstrip() + block + "\n" + text[insert_at:])
print(f"Inserted HTTPS server block for {domain}")
PY

nginx -t

if command -v systemctl >/dev/null 2>&1; then
  systemctl reload nginx
else
  nginx -s reload
fi

curl -fsS --max-time 10 "https://${DOMAIN}/" >/dev/null
curl -fsS --max-time 10 "https://${DOMAIN}/api/bettafish/lab?windowHours=72" >/dev/null

echo "HTTPS configured and verified for ${DOMAIN}. Backup: ${backup}"
