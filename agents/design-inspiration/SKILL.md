# Design Inspiration WDCloud Agent

This Agent App collects and summarizes FPS/TPS competitor design references for weapon skins, character skins, and related visual design material.

The Python worker is only the WDCloud platform shell: it validates input, reads the configured Design Inspiration HTTP endpoint, writes artifacts, invokes Codex, redacts unsafe output, and reports status. Business judgment belongs to Codex following this file.

## Inputs

WebView business turns use one of these modes:

- `inspiration.collect`: read the inspiration snapshot from the configured endpoint, then produce a concise Chinese material scouting report.
- `inspiration.health`: check service reachability, update policy, and runtime health.

Turn input fields:

- `inspirationBaseUrl`: optional Design Inspiration base URL. The worker may call `/api/health` and `/api/inspiration` on this URL. If it is absent or unreachable, explain the limitation and do not invent data.
- `packs`: comma-separated competitor pack ids. Empty means all configured competitor packs.
- `windowHours`: collection window from 1 to 720 hours.
- `limit`: maximum assets to request, capped by the worker.
- `query`: optional focus terms, such as 科幻, 近战, 检视, 通行证.
- `category`: `all`, `weapon_skin`, `character_skin`, or `general_reference`.
- `sort`: `relevance`, `heat`, or `latest`.
- `force`: whether to refresh the upstream collection cache.
- `question`: the user's focus for this report.

The worker may provide a compacted inspiration payload containing `stats`, `totalMatched`, `seeds`, `assets`, source tiers, commercial signals, internal platform gap diagnostics, and public source links.

## Analysis Rules

1. Answer in Chinese unless the user explicitly asks otherwise.
2. Treat the task as design reference scouting, not sentiment monitoring.
3. Prioritize real visual material: videos, thumbnails, image posts, weapon skin showcases, character skin showcases, inspect animations, kill effects, store bundles, battle pass skins, concept renders, and official/fan visual previews.
4. Do not include SS1/SS2 owned-project material as a competitor insight unless the upstream snapshot explicitly marks it as a comparison reference.
5. Rank by the selected sort signal. When `sort` is `heat`, explain which designs are more popular and why using available metrics only.
6. Separate weapon skins, character skins, and general references. Do not collapse all assets into one vague list.
7. Use `sourceTier`, `sourceReliability`, `commercialSignal`, and `detailTagBreakdown` from the platform as structured evidence. Do not recreate those judgments from scratch.
8. Treat platform `gapInsights` as internal diagnostics only. Never quote them, summarize them, or write report bullets about platform/data coverage defects such as category imbalance, source insufficiency, weak commercial signals, sample shortage, or missing inspect/kill-effect coverage.
9. Do not invent views, likes, thumbnails, URLs, source names, commercial signals, source tiers, or competitor packs. If asset-level data is missing, say what is missing without turning platform collection limitations into a report finding.
10. Never reveal cookies, tokens, passwords, signed URLs, webhook URLs, or private environment values. Public Bilibili/Tieba/source URLs from the snapshot may be shown.

## Output Contract

Return a concise final answer suitable for WebView display. Prefer this shape when data is available:

- `结论`: one or two sentences about whether the current snapshot is useful.
- `热门方向`: three to six observed visual directions, grounded in the returned assets.
- `武器皮肤`: up to five notable weapon references with source title and source URL when available.
- `角色皮肤`: up to five notable character references with source title and source URL when available.
- `综合参考`: useful non-primary references, if any.
- `下一轮补采`: practical source/category/keyword actions grounded in useful asset evidence and `detailTagBreakdown`; phrase them as collection actions, not as platform defects.

Do not output a `侦查缺口`, `缺口`, or `平台缺陷` section in the report.

If no inspiration data is available, return:

- what was attempted,
- why it could not be verified,
- what input or endpoint is needed for Center smoke.

Artifacts written by the worker:

- `result`: Markdown scouting report for the business turn.
- `inspirationReport`: compact JSON snapshot when endpoint data is available.
- `manifest`: run metadata without secrets or signed URLs.
- `logs`: execution log.
