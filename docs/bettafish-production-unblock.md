# BettaFish Production Unblock

Use this short handoff to finish the BettaFish production deployment once the missing secrets and admin access are available. Do not paste real API keys into Git, chat, tickets, or deployment archives.

## 1. Fill Local Credential File

Recommended ignored file:

```text
C:\Users\yq\Documents\New project 2\.env.bettafish-credentials.local
```

Use either one shared OpenAI-compatible LLM provider:

```env
BETTAFISH_SHARED_LLM_API_KEY=
BETTAFISH_SHARED_LLM_BASE_URL=
BETTAFISH_SHARED_LLM_MODEL_NAME=
TAVILY_API_KEY=
ANSPIRE_API_KEY=
# or BOCHA_WEB_SEARCH_API_KEY=
```

Or fill all upstream engine triplets explicitly:

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

If the process `OPENAI_API_KEY` should be reused for BettaFish LLM calls, the user must explicitly approve that reuse, then use:

```env
BETTAFISH_USE_OPENAI_API_KEY_AS_SHARED_LLM=1
BETTAFISH_SHARED_LLM_BASE_URL=
BETTAFISH_SHARED_LLM_MODEL_NAME=
TAVILY_API_KEY=
ANSPIRE_API_KEY=
# or BOCHA_WEB_SEARCH_API_KEY=
```

## 2. Apply Credentials And Restart

Run locally from the repository root:

```powershell
npm run apply:bettafish-credentials -- --dry-run
npm run apply:bettafish-credentials -- --restart
```

The dry-run must report an empty `missingRequiredKeys` list before restart.

## 3. Fix Public HTTPS As Root/Admin

On public host `74.211.101.169:29018`, run as root or via sudo:

```bash
LETSENCRYPT_EMAIL=admin@example.com /home/yq/configure-ss-monitor-https.sh
```

Replace `admin@example.com` with the certificate owner contact. The current `yq` account cannot run sudo and cannot write nginx config, so this step requires admin access.

## 4. Final Verification

Run locally:

```powershell
npm run verify:bettafish-production -- --full-actions
```

Completion requires no `fail` checks. In particular, these must pass:

- `inner.credentials.required`
- `inner.report.status`
- `inner.action.report.generate`
- `inner.action.runtime.systemStart`
- `public.credentials.required`
- `public.report.status`
- `public.action.report.generate`
- `public.action.runtime.systemStart`
- `public.web.https.page`
- `public.web.https.nginx.access`
- `public.web.https.nginx.config`
- `public.web.https.certdir`
- `public.web.http.browser.errors`
