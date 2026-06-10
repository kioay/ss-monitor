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

## 3. Public And Announcement Surfaces

The public website and announcement surfaces are intentionally retired. Keep these defaults so the verifier records those checks as skipped instead of failing the deployment:

```env
BETTAFISH_PUBLIC_RETIRED=true
BETTAFISH_ANNOUNCEMENT_RETIRED=true
```

Only if the public website is restored, rerun the verifier with `--check-public` or `BETTAFISH_PUBLIC_RETIRED=false`. Public HTTPS repair still requires root/admin access to the public host nginx and certificate paths.

## 4. Final Verification

Run locally:

```powershell
npm run verify:bettafish-production -- --full-actions
```

Completion requires no `fail` checks. With public and announcement surfaces retired, the required passing checks are the internal BettaFish checks:

- `inner.credentials.required`
- `inner.report.status`
- `inner.action.report.generate`
- `inner.action.runtime.systemStart`

The expected retired checks are reported as `skip`, including `public.credentials.required`, `public.report.status`, `public.web.*`, and `announcement.retired`.
