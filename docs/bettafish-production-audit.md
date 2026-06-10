# BettaFish Production Audit

Last audited: 2026-06-10 Asia/Hong_Kong

Latest full verifier run: `2026-06-10T01:54:24.983Z` with `--full-actions`

Latest credential dry-run: `2026-06-10T01:58:45.123Z`

## Objective

Bring BettaFish to a complete production deployment state, with all self-tests passing and the production website BettaFish test lab acceptance passing.

Current completion status: blocked by missing upstream-required credentials and an HTTPS certificate/443 permission issue. Do not mark the deployment complete while the verifier has any `fail` entries.

## Success Criteria

| Requirement | Evidence command or artifact | Current status |
| --- | --- | --- |
| BettaFish upstream comparison uses current GitHub HEAD | `git ls-remote https://github.com/666ghj/BettaFish HEAD`; temporary shallow clone of upstream | Pass: current HEAD `40327d75b60faaf347bc578f93714b5394079d03` |
| Inner BettaFish deployment matches upstream HEAD | `npm run verify:bettafish-production -- --full-actions`; SSH read-only repo audit | Pass for HEAD; warning is limited to untracked MediaCrawler runtime directories/files: `.deps_installed`, `browser_data`, `data`, and `temp_image` |
| Public BettaFish deployment matches upstream HEAD | `npm run verify:bettafish-production -- --full-actions`; SSH read-only repo audit | Pass for HEAD; warning is a production compatibility patch in `keyword_manager.py` plus MediaCrawler `CUSTOM_BROWSER_PATH` and `CDP_HEADLESS` runtime config |
| Upstream runtime files and dependencies are present | `npm run verify:bettafish-production -- --full-actions` | Pass for `requirements.txt`, `.env.example`, MediaCrawler, Python 3.9+, core imports, Playwright, Chromium candidates, and real Chromium launch on inner/public hosts |
| ss-monitor local checks pass | `npm run lint`, `npm run test:semantic-guard`, `npm run test:monitor-history`, `npm run build` | Pass on 2026-06-10 Asia/Hong_Kong |
| Production test lab HTTP page/API reachable | `npm run verify:bettafish-production -- --full-actions` | Pass for `http://ss-monitor.qinoay.top/` and `/api/bettafish/lab` |
| Production test lab browser acceptance | `npm run verify:bettafish-production -- --full-actions` checks `public.web.http.browser.page`, `.lab`, `.labApi`, and `.errors` using headless Chromium from `192.168.8.242` against `http://ss-monitor.qinoay.top/` | Pass for HTTP page load, lab navigation, lab API `mode=test-lab`, 24 operations, 0 console errors, and 0 page errors; ReportEngine actions remain unavailable because credentials are missing |
| BettaFish API reachable on inner/public hosts | `npm run verify:bettafish-production -- --full-actions` | Pass for `/api/status` |
| Sentiment bridge self-test passes | `npm run verify:bettafish-production -- --full-actions` | Pass for `sentiment.analyze` |
| MindSpider status and DB probe pass | `npm run verify:bettafish-production -- --full-actions` | Pass for `mindspider.status` and `mindspider.dbProbe` |
| Required LLM/search credentials are present | `npm run apply:bettafish-credentials -- --dry-run`; `npm run verify:bettafish-production -- --full-actions` | Fail: `.env.bettafish-credentials.local` has no non-empty BettaFish keys; required LLM engine keys, `TAVILY_API_KEY`, and `ANSPIRE_API_KEY or BOCHA_WEB_SEARCH_API_KEY` are empty on inner and public hosts |
| ReportEngine initialized and ready | `npm run verify:bettafish-production -- --full-actions` | Fail: `initialized=false`, `engines_ready=false` |
| Report generation works | `npm run verify:bettafish-production -- --full-actions` | Fail: `ReportEngine` missing LLM API key |
| Full BettaFish system start works | `npm run verify:bettafish-production -- --full-actions` | Fail: system start returns failed because ReportEngine is not initialized |
| Public HTTPS route is valid | `npm run verify:bettafish-production -- --full-actions`; `curl.exe https://ss-monitor.qinoay.top/`; public SSH permission probe | Fail: certificate principal mismatch for `ss-monitor.qinoay.top`; verifier now reports `public.web.https.nginx.access` as `sudo_n=no`, `public.web.https.nginx.config` as `http=present https=missing`, and `public.web.https.certdir` as missing. A password-backed sudo probe returned `Sorry, user yq may not run sudo on valued-gig-1.` |

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

If the local shell already has `OPENAI_API_KEY` and the user explicitly authorizes using it for BettaFish LLM calls, set this opt-in flag instead of copying the secret into the credential file:

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
- `scripts/ss-monitor.nginx.conf` includes an optional 443 block for `ss-monitor.qinoay.top`, but it must be enabled only after a valid certificate exists and by someone with root/admin access to nginx.
- `scripts/configure-ss-monitor-https.sh` is a root/admin helper for the public host. It backs up `/etc/nginx/nginx.conf`, confirms the app is reachable at `127.0.0.1:8787`, provisions or validates the `ss-monitor.qinoay.top` certificate, inserts the 443 reverse proxy block, runs `nginx -t`, reloads nginx, and verifies the HTTPS page and lab API.
- Public `curl -k https://ss-monitor.qinoay.top/` reaches an nginx default page over 443, while verified TLS fails because the served certificate is for `yaoqian7777.qinoay.top`, not `ss-monitor.qinoay.top`.
- Local credential discovery found only process-level and user-level `OPENAI_API_KEY`; no non-empty Tavily, Bocha, Anspire, or BettaFish engine keys were found in the project credential file, local project env files, Windows environment variables, MCP resources, or production env files.
- Upstream `.env.example` at `40327d75b60faaf347bc578f93714b5394079d03` confirms the required LLM `KEY/BASE_URL/MODEL_NAME` triplets plus Tavily and Anspire/Bocha search credentials.
- Existing `scripts/douyin-server-login.ts` changes are pre-existing and intentionally excluded from BettaFish deployment commits.
