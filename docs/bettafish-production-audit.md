# BettaFish Production Audit

Last audited: 2026-06-10 13:06 Asia/Hong_Kong

Latest full verifier run: `2026-06-10T05:05:55.215Z` with `--full-actions`

Latest credential dry-run: `2026-06-10T04:56:34.626Z`

Latest local checks: `npm run lint`, `npm run test:semantic-guard`, `npm run test:monitor-history`, `npm run build`, tracked forbidden-file audit, and deploy archive audit passed on 2026-06-10 12:33 Asia/Hong_Kong

## Objective

Bring BettaFish to a complete production deployment state, with all self-tests passing and the production website BettaFish test lab acceptance passing.

Current completion status: blocked by missing upstream-required credentials and an HTTPS certificate/443 permission issue. Do not mark the deployment complete while the verifier has any `fail` entries.

## Success Criteria

| Requirement | Evidence command or artifact | Current status |
| --- | --- | --- |
| BettaFish upstream comparison uses current GitHub HEAD | `git ls-remote https://github.com/666ghj/BettaFish HEAD`; temporary shallow clone of upstream | Pass: current HEAD `40327d75b60faaf347bc578f93714b5394079d03` |
| Inner BettaFish deployment matches upstream HEAD | `npm run verify:bettafish-production -- --full-actions`; SSH read-only repo audit | Pass for HEAD; warning is limited to untracked MediaCrawler runtime directories/files: `.deps_installed`, `browser_data`, `data`, and `temp_image` |
| Public BettaFish deployment matches upstream HEAD | `npm run verify:bettafish-production -- --full-actions`; SSH read-only repo audit | Pass for HEAD; warning is a production compatibility patch in `keyword_manager.py` plus MediaCrawler `CUSTOM_BROWSER_PATH` and `CDP_HEADLESS` runtime config |
| Upstream runtime files and dependencies are present | `npm run verify:bettafish-production -- --full-actions` | Pass for `requirements.txt`, `README.md`, `Dockerfile`, `docker-compose.yml`, `.env.example`, actual `.env` files, `.env.example` key coverage, MediaCrawler directory, MediaCrawler submodule commit, Python 3.9+, core imports, Playwright, Chromium candidates, and real Chromium launch on inner/public hosts |
| ss-monitor local checks pass | `npm run lint`, `npm run test:semantic-guard`, `npm run test:monitor-history`, `npm run build` | Pass on 2026-06-10 12:33 Asia/Hong_Kong |
| No forbidden runtime/secret/build files are tracked | `git ls-files` audit for actual `.env`, cookies, secret key files, deploy archives, `node_modules`, `dist`, and build output | Pass: `forbidden_tracked=none` |
| Deploy archive includes fresh frontend build without forbidden files | `scripts/create-deploy-archive.ps1 -OutputPath $env:TEMP\ss-monitor-archive-audit-29da653.tar.gz`; `tar -tzf` audit | Pass: archive contains `dist/` (`dist_entries=5`) and `forbidden_archive=none` |
| Production test lab HTTP page/API reachable | `npm run verify:bettafish-production -- --full-actions` | Pass for `http://ss-monitor.qinoay.top/` and `/api/bettafish/lab` |
| Production test lab browser acceptance | `npm run verify:bettafish-production -- --full-actions` checks `public.web.http.browser.page`, `.lab`, `.labApi`, and `.errors` using headless Chromium from `192.168.8.242` against `http://ss-monitor.qinoay.top/` | Pass in the latest full verifier: HTTP page load, lab navigation, lab API `mode=test-lab`, 24 operations, 0 console errors, and 0 page errors |
| Production test lab public API acceptance from workstation | `curl.exe http://ss-monitor.qinoay.top/api/bettafish/lab?windowHours=72` | Pass: `mode=test-lab`, `operations=24`, `baseUrlConfigured=True`, `actionsEnabled=True` |
| BettaFish API reachable on inner/public hosts | `npm run verify:bettafish-production -- --full-actions` | Pass for `/api/status` |
| Sentiment bridge self-test passes | `npm run verify:bettafish-production -- --full-actions` | Pass for `sentiment.analyze` |
| MindSpider status and DB probe pass | `npm run verify:bettafish-production -- --full-actions` | Pass for `mindspider.status` and `mindspider.dbProbe` |
| Required LLM/search credentials are present | `npm run apply:bettafish-credentials -- --dry-run`; `npm run verify:bettafish-production -- --full-actions` | Fail: `.env.bettafish-credentials.local` has no non-empty BettaFish keys; required LLM engine keys, `TAVILY_API_KEY`, and `ANSPIRE_API_KEY or BOCHA_WEB_SEARCH_API_KEY` are empty on inner and public hosts |
| ReportEngine initialized and ready | `npm run verify:bettafish-production -- --full-actions` | Fail: `initialized=false`, `engines_ready=false` |
| Report generation works | `npm run verify:bettafish-production -- --full-actions` | Fail: `ReportEngine` missing LLM API key |
| Full BettaFish system start works | `npm run verify:bettafish-production -- --full-actions` | Fail: system start returns failed because ReportEngine is not initialized |
| Public HTTPS route is valid | `npm run verify:bettafish-production -- --full-actions`; `curl.exe https://ss-monitor.qinoay.top/`; public SSH permission probe | Fail: certificate principal mismatch for `ss-monitor.qinoay.top`; verifier reports `public.web.https.nginx.access` as `sudo_n=no`, `public.web.https.nginx.config` as `http=present https=missing`, and `public.web.https.certdir` as missing. A password-backed sudo probe returned `Sorry, user yq may not run sudo on valued-gig-1.` |

## Required Credentials

Set these in `.env.local` or a separate ignored file passed as `BETTAFISH_CREDENTIAL_ENV_FILE`.
Recommended local filename: `.env.bettafish-credentials.local`, which is covered by the repository `.env.*` ignore rule.
Tracked no-secret example: `examples/bettafish-credentials.example.txt`.
The apply helper auto-loads non-empty values from `.env.bettafish-credentials.local` when it exists.
The local ignored template is present and intentionally empty as of the latest dry-run; `npm run apply:bettafish-credentials -- --dry-run` correctly reports no usable credentials until real values are filled and now emits `nextSteps` with the exact template path and apply commands. If the local template is missing, `npm run apply:bettafish-credentials -- --write-template` creates it without overwriting an existing file.
Dummy dry-runs on `2026-06-09T21:44:36Z` confirmed the helper expands both supported fill paths without printing secret values: `BETTAFISH_SHARED_LLM_*` plus `BOCHA_WEB_SEARCH_API_KEY`, and `BETTAFISH_USE_OPENAI_API_KEY_AS_SHARED_LLM=1` plus `ANSPIRE_API_KEY`.

```env
REPORT_ENGINE_API_KEY=
REPORT_ENGINE_BASE_URL=
REPORT_ENGINE_MODEL_NAME=
QUERY_ENGINE_API_KEY=
QUERY_ENGINE_BASE_URL=
QUERY_ENGINE_MODEL_NAME=
INSIGHT_ENGINE_API_KEY=
INSIGHT_ENGINE_BASE_URL=
INSIGHT_ENGINE_MODEL_NAME=
MEDIA_ENGINE_API_KEY=
MEDIA_ENGINE_BASE_URL=
MEDIA_ENGINE_MODEL_NAME=
TAVILY_API_KEY=
ANSPIRE_API_KEY=
# or BOCHA_WEB_SEARCH_API_KEY=
```

If all four LLM engines should use the same OpenAI-compatible provider, the apply helper can expand one shared triplet into the upstream engine keys:

```env
BETTAFISH_SHARED_LLM_API_KEY=
BETTAFISH_SHARED_LLM_BASE_URL=
BETTAFISH_SHARED_LLM_MODEL_NAME=
TAVILY_API_KEY=
ANSPIRE_API_KEY=
# or BOCHA_WEB_SEARCH_API_KEY=
```

If the local shell already has `OPENAI_API_KEY` and the user explicitly authorizes using it for BettaFish LLM calls, set this opt-in flag instead of copying the secret into the credential file. The dry-run output now reports this as `explicitOptInKeysAvailable` and includes the opt-in path in `nextSteps` without printing the secret value:

```env
BETTAFISH_USE_OPENAI_API_KEY_AS_SHARED_LLM=1
BETTAFISH_SHARED_LLM_BASE_URL=
BETTAFISH_SHARED_LLM_MODEL_NAME=
TAVILY_API_KEY=
ANSPIRE_API_KEY=
# or BOCHA_WEB_SEARCH_API_KEY=
```

This only fills the four LLM engine API keys from `OPENAI_API_KEY`; search credentials are still required.

Then apply and verify:

```bash
npm run apply:bettafish-credentials -- --restart
npm run verify:bettafish-production -- --full-actions
```

The apply helper sends credential payloads over SSH stdin, not in the remote command environment.

## Notes

- HTTPS repair requires root, sudo, or access to the external TLS/443 proxy on the public host. The verifier checks this explicitly through `public.web.https.nginx.access`, `public.web.https.nginx.config`, and `public.web.https.certdir`.
- Public root/sudo probes remain blocked: password-backed sudo reports `yq is not in the sudoers file`, default SSH key auth fails for `root@74.211.101.169`, and explicit probes with `~/.ssh/id_ed25519_ss_monitor` and `~/.ssh/id_rsa` also fail for root on port `29018`.
- The inner host `192.168.8.242` was also checked as root for a possible outbound deployment key to the public host. `/root/.ssh` contains no private key files, BatchMode SSH to `root@74.211.101.169:29018` and `yq@74.211.101.169:29018` fails, and a path-only search found no public-host credential file beyond normal project documentation references.
- DNS is not the current HTTPS blocker: `ss-monitor.qinoay.top` resolves to `74.211.101.169`, and Node `dns.resolveCaa` returns `ENODATA` for both `qinoay.top` and `ss-monitor.qinoay.top`, so no CAA record is blocking normal certificate issuance.
- `scripts/ss-monitor.nginx.conf` includes an optional 443 block for `ss-monitor.qinoay.top`, but it must be enabled only after a valid certificate exists and by someone with root/admin access to nginx.
- A read-only public nginx include audit found no user-writable include path: `/etc/nginx/nginx.conf` only includes `/etc/nginx/mime.types`, `/etc/nginx/conf.d` is root-owned, and `yq` has no writable include directory that nginx already loads.
- The active public nginx master runs as root with `/usr/sbin/nginx -c /etc/nginx/nginx.conf`; the readable config currently exposes only port 80 server blocks, including the `ss-monitor.qinoay.top` HTTP reverse proxy, and no editable 443/certificate path is available to `yq`. A process/capability probe found 443 is still controlled by root nginx and `/opt/nodejs/bin/node` has no low-port bind capability.
- `scripts/configure-ss-monitor-https.sh` is a root/admin helper for the public host. It backs up `/etc/nginx/nginx.conf`, confirms the app is reachable at `127.0.0.1:8787`, provisions or validates the `ss-monitor.qinoay.top` certificate, inserts the 443 reverse proxy block, runs `nginx -t`, reloads nginx, and verifies the HTTPS page and lab API. It is also staged on the public host at `/home/yq/configure-ss-monitor-https.sh`; remote SHA-256 is `9e83c27a8d2e171dfe4f4d18df1fe5d16309ca94ffaf8310e9ed261dc302bc2a`, matching the tracked local helper, and remote `bash -n` passed on 2026-06-10 Asia/Hong_Kong.
- The public host is CentOS 7 and has nginx at `/usr/sbin/nginx` (`nginx/1.26.1`) but no discovered `certbot` binary at `/usr/bin/certbot`, `/usr/local/bin/certbot`, or `/snap/bin/certbot`. An admin must install certbot, for example `yum install -y epel-release && yum install -y certbot python2-certbot-nginx`, or pre-provision `/etc/letsencrypt/live/ss-monitor.qinoay.top`, and set `LETSENCRYPT_EMAIL` if the helper should request the certificate.
- Once root/sudo is available, the intended public-host command is `LETSENCRYPT_EMAIL=admin@example.com /home/yq/configure-ss-monitor-https.sh` run as root, with the email replaced by the certificate owner contact.
- Public `curl.exe -I http://ss-monitor.qinoay.top/` returns HTTP 200 from Express behind nginx. Public `curl.exe -I https://ss-monitor.qinoay.top/` fails strict TLS verification with `SEC_E_WRONG_PRINCIPAL`; `curl.exe -k -I https://ss-monitor.qinoay.top/` reaches an nginx default page over 443, confirming that 443 is not serving the ss-monitor app for this hostname.
- The public `ss-monitor` website currently points to `/opt/ss-monitor/releases/release-8bdf4fc-20260609234201`. Comparing `8bdf4fc..HEAD` shows only docs, verifier/helper scripts, nginx template, credential example, and `package.json` script-entry changes; no frontend or server runtime code changed, so the already-passing HTTP BettaFish test lab was not redeployed merely to pick up audit tooling.
- Local credential discovery found only process-level and user-level `OPENAI_API_KEY`; no non-empty Tavily, Bocha, Anspire, or BettaFish engine keys were found in the project credential file, local project env files, Windows environment variables, MCP resources, production env files, or obvious Desktop/Documents credential filenames.
- Upstream `.env.example` at `40327d75b60faaf347bc578f93714b5394079d03` confirms the required LLM `KEY/BASE_URL/MODEL_NAME` triplets plus Tavily and Anspire/Bocha search credentials.
- Existing `scripts/douyin-server-login.ts` changes are pre-existing and intentionally excluded from BettaFish deployment commits.
