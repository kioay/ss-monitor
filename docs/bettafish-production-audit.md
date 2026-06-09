# BettaFish Production Audit

Last audited: 2026-06-10 Asia/Hong_Kong

Latest full verifier run: `2026-06-09T19:23:00.365Z` with `--skip-https`

## Objective

Bring BettaFish to a complete production deployment state, with all self-tests passing and the production website BettaFish test lab acceptance passing.

## Success Criteria

| Requirement | Evidence command or artifact | Current status |
| --- | --- | --- |
| BettaFish upstream comparison uses current GitHub HEAD | `git ls-remote https://github.com/666ghj/BettaFish HEAD` | Pass: current HEAD `40327d75b60faaf347bc578f93714b5394079d03` |
| Inner BettaFish deployment matches upstream HEAD | `npm run verify:bettafish-production -- --full-actions` | Pass for HEAD; warning for MediaCrawler runtime state |
| Public BettaFish deployment matches upstream HEAD | `npm run verify:bettafish-production -- --full-actions` | Pass for HEAD; warning for runtime patches in `keyword_manager.py` and MediaCrawler config |
| Upstream runtime files and dependencies are present | `npm run verify:bettafish-production -- --full-actions --skip-https` | Pass for `requirements.txt`, `.env.example`, MediaCrawler, Python 3.9+, core imports, Playwright, Chromium candidates, and real Chromium launch on inner/public hosts |
| ss-monitor local checks pass | `npm run lint`, `npm run test:semantic-guard`, `npm run test:monitor-history`, `npm run build` | Pass on 2026-06-10 Asia/Hong_Kong |
| Production test lab HTTP page/API reachable | `npm run verify:bettafish-production -- --full-actions` | Pass for `http://ss-monitor.qinoay.top/` and `/api/bettafish/lab` |
| Production test lab browser acceptance | Headless Chromium from `192.168.8.242` against `http://ss-monitor.qinoay.top/` | Pass for HTTP page load, `BettaFish 测试台` navigation, 0 console errors, 0 page errors, `MindSpider 状态`, and `情感模型/LLM 分析`; ReportEngine buttons remain disabled because credentials are missing |
| BettaFish API reachable on inner/public hosts | `npm run verify:bettafish-production -- --full-actions` | Pass for `/api/status` |
| Sentiment bridge self-test passes | `npm run verify:bettafish-production -- --full-actions` | Pass for `sentiment.analyze` |
| MindSpider status and DB probe pass | `npm run verify:bettafish-production -- --full-actions` | Pass for `mindspider.status` and `mindspider.dbProbe` |
| Required LLM/search credentials are present | `npm run verify:bettafish-production -- --full-actions` | Fail: required LLM engine keys, `TAVILY_API_KEY`, and `ANSPIRE_API_KEY or BOCHA_WEB_SEARCH_API_KEY` are empty on inner and public hosts |
| ReportEngine initialized and ready | `npm run verify:bettafish-production -- --full-actions` | Fail: `initialized=false`, `engines_ready=false` |
| Report generation works | `npm run verify:bettafish-production -- --full-actions` | Fail: `ReportEngine` missing LLM API key |
| Full BettaFish system start works | `npm run verify:bettafish-production -- --full-actions` | Fail: system start returns failed because ReportEngine is not initialized |
| Public HTTPS route is valid | `curl.exe https://ss-monitor.qinoay.top/`; public SSH permission probe | Fail: certificate principal mismatch for `ss-monitor.qinoay.top`; public user `yq` has no sudo and `/etc/nginx`, `/etc/nginx/conf.d`, and cert locations are root-owned |

## Required Credentials

Set these in `.env.local` or a separate ignored file passed as `BETTAFISH_CREDENTIAL_ENV_FILE`.
Recommended local filename: `.env.bettafish-credentials.local`, which is covered by the repository `.env.*` ignore rule.
The apply helper auto-loads non-empty values from `.env.bettafish-credentials.local` when it exists.

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

Then apply and verify:

```bash
npm run apply:bettafish-credentials -- --restart
npm run verify:bettafish-production -- --full-actions
```

The apply helper sends credential payloads over SSH stdin, not in the remote command environment.

## Notes

- Do not mark the deployment complete while the verifier has any `fail` entries.
- HTTPS repair requires root or sudo on the public host because nginx listens on 443, nginx config is root-owned, and the current user is not in sudoers.
- Local credential discovery found only a process-level `OPENAI_API_KEY`; no non-empty Tavily, Bocha, Anspire, or BettaFish engine keys were found in the project credential file, local project env files, or production env files.
- Existing `scripts/douyin-server-login.ts` changes are pre-existing and intentionally excluded from BettaFish deployment commits.
