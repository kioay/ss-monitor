#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from wdcloud_worker_sdk import (
    WorkerClient,
    prepare_codex_home,
    redact_secrets,
    run_codex_streaming,
    sanitize_text,
)


AGENT_ID = "design-inspiration"
AGENT_NAME = "设计灵感素材库"
DEFAULT_CODEX_MODEL = "gpt-5.5"
DEFAULT_BASE_URL = "http://192.168.8.242:8788"
BUSINESS_MODES = {"inspiration.collect", "inspiration.health"}
CATEGORY_VALUES = {"all", "weapon_skin", "character_skin", "general_reference"}
SORT_VALUES = {"relevance", "heat", "latest"}


def main() -> int:
    worker = WorkerClient(required_artifacts=[])
    try:
        worker.status("running", phase_message="Preparing Design Inspiration Agent turn", progress=0.05, stage="preparing")
        uploaded = run(worker)
        worker.status(
            "succeeded",
            artifactFiles=uploaded,
            artifactRefs=[artifact["objectKey"] for artifact in uploaded if artifact.get("objectKey")],
            phaseMessage="Design Inspiration Agent turn completed",
            progress=1,
            progressSource="worker",
            stage="completed",
        )
        return 0
    except Exception as error:
        safe_error = redact_secrets(str(error))
        worker.status("failed", lastError=safe_error, message=safe_error, stage="failed")
        raise


def run(worker: WorkerClient) -> list[dict[str, Any]]:
    output_dir = required_path_env("WDCLAW_OUTPUT_DIR")
    output_dir.mkdir(parents=True, exist_ok=True)
    task_input = task_input_json()
    context = safe_session_context(worker)
    turn_input = current_turn_input(task_input, context)
    mode = str(turn_input.get("mode") or "").strip()
    if mode == "inspiration.health":
        return run_health_turn(worker, output_dir, mode, turn_input)
    if mode in BUSINESS_MODES:
        return run_collect_turn(worker, output_dir, mode, turn_input)
    return run_app_shell_turn(worker, output_dir, task_input)


def run_app_shell_turn(worker: WorkerClient, output_dir: Path, task_input: dict[str, Any]) -> list[dict[str, Any]]:
    logs: list[str] = []
    log = make_logger(worker, logs)
    worker.status("running", phase_message="Writing WebView manifest", progress=0.3, stage="manifest")

    manifest = {
        "agentId": os.environ.get("WDCLAW_AGENT_ID", AGENT_ID),
        "agentName": AGENT_NAME,
        "taskId": os.environ.get("WDCLAW_TASK_ID"),
        "sessionId": os.environ.get("WDCLAW_AGENT_SESSION_ID") or os.environ.get("WDCLAW_SESSION_ID"),
        "createdAt": iso_now(),
        "mode": "app-shell",
        "codexModel": os.environ.get("WDCLAW_CODEX_MODEL") or DEFAULT_CODEX_MODEL,
        "ui": {"mode": "web-view-app", "entryArtifactId": "webviewBundle", "entry": "index.html"},
        "webView": {
            "version": 1,
            "entryArtifactId": "webviewBundle",
            "entry": "index.html",
            "bootstrap": "app-scoped-token",
            "transport": "sdk",
        },
        "inputKeys": sorted(task_input.keys()),
    }
    manifest_path = write_json(output_dir / "manifest.json", manifest)
    log("Wrote app shell manifest")

    worker.status("running", phase_message="Bundling WebView App", progress=0.62, stage="bundling")
    bundle_path = output_dir / "webviewBundle.zip"
    bundle_webview(bundle_path, log)
    log("Created webviewBundle.zip")

    log_path = write_text(output_dir / "execution-log.md", build_log_file(logs, "app-shell"))
    worker.status("running", phase_message="Uploading App artifacts", progress=0.85, stage="publishing_artifacts")
    return upload_required_artifacts(
        worker,
        [
            ("webviewBundle", bundle_path),
            ("manifest", manifest_path),
            ("logs", log_path),
        ],
    )


def run_collect_turn(worker: WorkerClient, output_dir: Path, mode: str, turn_input: dict[str, Any]) -> list[dict[str, Any]]:
    logs: list[str] = []
    log = make_logger(worker, logs)
    request_summary = build_request_summary(turn_input)

    worker.status("running", phase_message="Collecting inspiration assets", progress=0.18, stage="collecting")
    inspiration_snapshot = collect_inspiration_snapshot(turn_input, log)
    report_path = write_json(output_dir / "inspiration-report.json", inspiration_snapshot)

    question = sanitize_text(
        str(turn_input.get("question") or turn_input.get("message") or "").strip()
        or "请根据当前素材列表归纳最值得参考的 FPS/TPS 竞品武器和角色皮肤设计方向。"
    )
    work_dir = Path(os.environ.get("WDCLAW_WORK_DIR", "/tmp/design-inspiration-agent")).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    codex_prompt = build_codex_prompt(
        skill_text=read_agent_skill(),
        mode=mode,
        turn_input=turn_input,
        question=question,
        inspiration_snapshot=inspiration_snapshot,
        output_dir=output_dir,
    )
    (work_dir / "codex-prompt.md").write_text(codex_prompt, encoding="utf-8")

    worker.status("running", phase_message="Running Codex design analysis", progress=0.42, stage="codex")
    prepare_codex_home()
    codex_result = run_codex_streaming(
        codex_prompt,
        work_dir,
        worker,
        timeout_seconds=int(os.environ.get("WDCLAW_CODEX_TIMEOUT_SECONDS", "900")),
        progress_start=0.42,
        progress_end=0.78,
        progress_message="Codex is summarizing design references",
        progress_stage="codex",
        heartbeat_seconds=20,
    )
    final_message = sanitize_text(str(codex_result.get("finalMessage") or "")).strip()
    if not final_message:
        raise RuntimeError("Codex produced an empty final message")

    result_markdown = "\n".join(
        [
            "# 设计灵感素材报告",
            "",
            final_message,
            "",
            "## Runtime",
            "",
            f"- mode: {mode}",
            f"- inspirationStatus: {inspiration_snapshot.get('status') or 'unknown'}",
            f"- requestedSort: {request_summary.get('sort')}",
            f"- finalMessageSource: {codex_result.get('finalMessageSource') or 'unknown'}",
            "",
            f"_Generated at {iso_now()}_",
        ]
    )
    result_path = write_text(output_dir / "result.md", result_markdown)
    manifest_path = write_json(
        output_dir / "manifest.json",
        {
            "agentId": os.environ.get("WDCLAW_AGENT_ID", AGENT_ID),
            "taskId": os.environ.get("WDCLAW_TASK_ID"),
            "mode": mode,
            "codexModel": os.environ.get("WDCLAW_CODEX_MODEL") or DEFAULT_CODEX_MODEL,
            "request": request_summary,
            "inspiration": summarize_inspiration_for_manifest(inspiration_snapshot),
            "codex": {
                "model": os.environ.get("WDCLAW_CODEX_MODEL", DEFAULT_CODEX_MODEL),
                "finalMessageSource": codex_result.get("finalMessageSource"),
                "usage": codex_result.get("usage"),
            },
            "createdAt": iso_now(),
        },
    )
    log_path = write_text(output_dir / "execution-log.md", build_log_file(logs, mode))

    worker.status("running", phase_message="Uploading inspiration artifacts", progress=0.86, stage="publishing_artifacts")
    uploaded = upload_turn_artifacts(
        worker,
        [
            ("result", result_path),
            ("inspirationReport", report_path),
            ("manifest", manifest_path),
            ("logs", log_path),
        ],
    )
    structured_result = {
        "mode": mode,
        "inspirationStatus": inspiration_snapshot.get("status"),
        "stats": inspiration_snapshot.get("stats"),
        "totalMatched": inspiration_snapshot.get("totalMatched"),
        "assets": compact_assets_for_result(inspiration_snapshot.get("assets"), 24),
        "resultMarkdown": result_markdown,
        "finalMessage": final_message,
        "usage": codex_result.get("usage"),
        "artifactCount": len(uploaded),
    }
    write_result_optional(
        worker,
        artifact_files=uploaded,
        structured_result=sanitize_for_manifest(structured_result),
        summary="Design inspiration collection completed.",
    )
    return uploaded


def run_health_turn(worker: WorkerClient, output_dir: Path, mode: str, turn_input: dict[str, Any]) -> list[dict[str, Any]]:
    logs: list[str] = []
    log = make_logger(worker, logs)
    worker.status("running", phase_message="Checking inspiration service health", progress=0.2, stage="collecting")
    health_snapshot = collect_health_snapshot(turn_input, log)
    report_path = write_json(output_dir / "inspiration-health.json", health_snapshot)

    result_markdown = build_health_result_markdown(health_snapshot)
    result_path = write_text(output_dir / "result.md", result_markdown)
    manifest_path = write_json(
        output_dir / "manifest.json",
        {
            "agentId": os.environ.get("WDCLAW_AGENT_ID", AGENT_ID),
            "taskId": os.environ.get("WDCLAW_TASK_ID"),
            "mode": mode,
            "codexModel": os.environ.get("WDCLAW_CODEX_MODEL") or DEFAULT_CODEX_MODEL,
            "health": sanitize_for_manifest(health_snapshot),
            "createdAt": iso_now(),
        },
    )
    log_path = write_text(output_dir / "execution-log.md", build_log_file(logs, mode))

    worker.status("running", phase_message="Uploading health artifacts", progress=0.82, stage="publishing_artifacts")
    uploaded = upload_turn_artifacts(
        worker,
        [
            ("result", result_path),
            ("inspirationReport", report_path),
            ("manifest", manifest_path),
            ("logs", log_path),
        ],
    )
    structured_result = {
        "mode": mode,
        "healthStatus": health_snapshot.get("status"),
        "resultMarkdown": result_markdown,
        "finalMessage": result_markdown,
        "artifactCount": len(uploaded),
    }
    write_result_optional(
        worker,
        artifact_files=uploaded,
        structured_result=sanitize_for_manifest(structured_result),
        summary="Design inspiration health check completed.",
    )
    return uploaded


def collect_inspiration_snapshot(turn_input: dict[str, Any], log) -> dict[str, Any]:
    base_url = normalize_base_url(str(turn_input.get("inspirationBaseUrl") or DEFAULT_BASE_URL).strip())
    request_summary = build_request_summary(turn_input)
    snapshot: dict[str, Any] = {
        "status": "collecting",
        "createdAt": iso_now(),
        "request": request_summary,
    }
    try:
        response = fetch_json(build_inspiration_url(base_url, turn_input), timeout_seconds=90)
        snapshot.update(compact_inspiration_payload(response))
        snapshot["status"] = "ok"
        log("Fetched /api/inspiration")
    except Exception as error:
        snapshot["status"] = "unreachable"
        snapshot["error"] = redact_secrets(str(error))
        log("Inspiration fetch failed")
    return snapshot


def collect_health_snapshot(turn_input: dict[str, Any], log) -> dict[str, Any]:
    base_url = normalize_base_url(str(turn_input.get("inspirationBaseUrl") or DEFAULT_BASE_URL).strip())
    snapshot: dict[str, Any] = {
        "status": "collecting",
        "createdAt": iso_now(),
        "request": {"baseOrigin": url_origin(base_url)},
    }
    try:
        health = fetch_json(url_join(base_url, "/api/health"), timeout_seconds=20)
        snapshot["health"] = compact_json_value(health)
        snapshot["status"] = "ok"
        log("Fetched /api/health")
    except Exception as error:
        snapshot["status"] = "unreachable"
        snapshot["error"] = redact_secrets(str(error))
        log("Health fetch failed")
    return snapshot


def build_health_result_markdown(snapshot: dict[str, Any]) -> str:
    request = snapshot.get("request") if isinstance(snapshot.get("request"), dict) else {}
    health = snapshot.get("health") if isinstance(snapshot.get("health"), dict) else {}
    status = str(snapshot.get("status") or "unknown")
    update_policy = health.get("updatePolicy") if isinstance(health.get("updatePolicy"), dict) else {}
    lines = [
        "结论",
        "灵感素材库服务可访问。" if status == "ok" else "灵感素材库服务当前不可验证。",
        "",
        "检查结果",
        f"- 状态: {status}",
        f"- 服务地址: {request.get('baseOrigin') or '未配置'}",
        f"- health.ok: {health.get('ok') if health else 'unknown'}",
    ]
    if update_policy:
        lines.append(f"- 更新策略: {update_policy.get('label') or update_policy.get('mode') or 'unknown'}")
        lines.append(f"- 下次更新: {update_policy.get('nextUpdateAt') or 'unknown'}")
    if snapshot.get("error"):
        lines.append(f"- 错误: {snapshot.get('error')}")
    lines.extend(
        [
            "",
            "建议",
            "- 如果 health 正常，可以继续点击“采集素材”读取素材索引。",
            "- 如果接口不可达，先确认 WDCloud runtime 能访问生产机 192.168.8.242:8788。",
            "",
            f"_Generated at {iso_now()}_",
        ]
    )
    return "\n".join(lines)


def normalize_base_url(value: str) -> str:
    if not value:
        return DEFAULT_BASE_URL
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise RuntimeError("inspirationBaseUrl must use http or https")
    if parsed.username or parsed.password:
        raise RuntimeError("inspirationBaseUrl must not include credentials")
    if not parsed.netloc:
        raise RuntimeError("inspirationBaseUrl must include a host")
    clean = parsed._replace(path="", params="", query="", fragment="")
    return urllib.parse.urlunparse(clean).rstrip("/")


def build_inspiration_url(base_url: str, turn_input: dict[str, Any]) -> str:
    params: dict[str, str] = {
        "windowHours": str(clamp_int(turn_input.get("windowHours"), 1, 720, 720)),
        "limit": str(clamp_int(turn_input.get("limit"), 1, 120, 80)),
        "category": normalize_choice(turn_input.get("category"), CATEGORY_VALUES, "all"),
        "sort": normalize_choice(turn_input.get("sort"), SORT_VALUES, "heat"),
    }
    packs = sanitize_csv_text(str(turn_input.get("packs") or ""))
    query = sanitize_text(str(turn_input.get("query") or "")).strip()
    if packs:
        params["packs"] = packs
    if query:
        params["q"] = query[:120]
    if truthy(turn_input.get("force")):
        params["refresh"] = "1"
        params["force"] = "1"
    return url_join(base_url, "/api/inspiration") + "?" + urllib.parse.urlencode(params)


def build_request_summary(turn_input: dict[str, Any]) -> dict[str, Any]:
    base_url = normalize_base_url(str(turn_input.get("inspirationBaseUrl") or DEFAULT_BASE_URL).strip())
    return {
        "baseOrigin": url_origin(base_url),
        "packs": sanitize_csv_text(str(turn_input.get("packs") or "")) or "all",
        "windowHours": clamp_int(turn_input.get("windowHours"), 1, 720, 720),
        "limit": clamp_int(turn_input.get("limit"), 1, 120, 80),
        "query": sanitize_text(str(turn_input.get("query") or "")).strip()[:120],
        "category": normalize_choice(turn_input.get("category"), CATEGORY_VALUES, "all"),
        "sort": normalize_choice(turn_input.get("sort"), SORT_VALUES, "heat"),
        "force": truthy(turn_input.get("force")),
    }


def fetch_json(url: str, timeout_seconds: int) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "design-inspiration-wdcloud-agent/0.1",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read(6 * 1024 * 1024)
    except urllib.error.HTTPError as error:
        body = error.read(512).decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {body or error.reason}") from None
    return json.loads(raw.decode("utf-8"))


def compact_inspiration_payload(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"raw": compact_json_value(value)}
    return {
        "generatedAt": value.get("generatedAt"),
        "windowHours": value.get("windowHours"),
        "query": sanitize_text(str(value.get("query") or "")),
        "category": value.get("category"),
        "sort": value.get("sort"),
        "totalMatched": value.get("totalMatched"),
        "stats": compact_json_value(value.get("stats")),
        "seeds": [
            {
                "id": seed.get("id"),
                "label": seed.get("label"),
                "category": seed.get("category"),
            }
            for seed in list_or_empty(value.get("seeds"))[:40]
            if isinstance(seed, dict)
        ],
        "assets": compact_assets_for_result(value.get("assets"), 60),
    }


def compact_assets_for_result(value: Any, limit: int) -> list[dict[str, Any]]:
    assets: list[dict[str, Any]] = []
    for asset in list_or_empty(value)[:limit]:
        if not isinstance(asset, dict):
            continue
        item = asset.get("item") if isinstance(asset.get("item"), dict) else {}
        metrics = item.get("metrics") if isinstance(item.get("metrics"), dict) else {}
        assets.append(
            {
                "id": asset.get("id") or item.get("id"),
                "kind": asset.get("kind"),
                "category": asset.get("category"),
                "score": asset.get("score"),
                "reason": sanitize_text(str(asset.get("reason") or "")),
                "matchedSeeds": compact_list(asset.get("matchedSeeds"), 8),
                "visualTags": compact_list(asset.get("visualTags"), 8),
                "title": sanitize_text(str(item.get("title") or ""))[:240],
                "summary": sanitize_text(str(item.get("summary") or ""))[:600],
                "source": item.get("source"),
                "sourceLabel": item.get("sourceLabel"),
                "author": sanitize_text(str(item.get("author") or ""))[:120],
                "publishedAt": item.get("publishedAt"),
                "sourceUrl": item.get("url"),
                "thumbnailUrl": item.get("thumbnail"),
                "metrics": {
                    "views": metrics.get("views"),
                    "likes": metrics.get("likes"),
                    "comments": metrics.get("comments") or metrics.get("replies"),
                    "favorites": metrics.get("favorites"),
                    "shares": metrics.get("shares"),
                    "danmaku": metrics.get("danmaku"),
                },
            }
        )
    return assets


def build_codex_prompt(
    *,
    skill_text: str,
    mode: str,
    turn_input: dict[str, Any],
    question: str,
    inspiration_snapshot: dict[str, Any],
    output_dir: Path,
) -> str:
    return "\n".join(
        [
            "You are the business execution Codex for the Design Inspiration WDCloud Agent App.",
            "Follow the SKILL.md exactly. The Python worker is only the platform shell.",
            "",
            "## SKILL.md",
            skill_text,
            "",
            "## Current Mode",
            mode,
            "",
            "## User Question",
            question,
            "",
            "## Current WebView Turn Input",
            json.dumps(sanitize_for_manifest(turn_input), ensure_ascii=False, indent=2),
            "",
            "## Inspiration Snapshot",
            json.dumps(sanitize_for_manifest(inspiration_snapshot), ensure_ascii=False, indent=2),
            "",
            "## Output Directory",
            str(output_dir),
            "",
            "## Requirements",
            "- Return the user-facing answer as the final assistant message.",
            "- Use concise Chinese design-review language.",
            "- Start with whether the current material snapshot is useful for design inspiration.",
            "- Highlight popular designs when the sort is heat, using only available metrics.",
            "- Keep weapon skins, character skins, and general references separated.",
            "- Do not output tokens, credentials, cookies, signed URLs, webhook URLs, or private environment values.",
            "- Public source URLs in the snapshot may be shown. Do not invent missing URLs.",
            "- If inspiration data is unavailable or empty, explain the missing precondition instead of inventing examples.",
        ]
    )


def read_agent_skill() -> str:
    for path in (Path("/agent/SKILL.md"), Path(__file__).resolve().parents[1] / "SKILL.md"):
        if path.is_file():
            return path.read_text(encoding="utf-8")
    raise RuntimeError("SKILL.md is required for business turns")


def summarize_inspiration_for_manifest(snapshot: dict[str, Any]) -> dict[str, Any]:
    assets = list_or_empty(snapshot.get("assets"))
    return {
        "status": snapshot.get("status"),
        "request": snapshot.get("request"),
        "generatedAt": snapshot.get("generatedAt"),
        "totalMatched": snapshot.get("totalMatched"),
        "stats": snapshot.get("stats"),
        "assetCount": len(assets),
    }


def sanitize_for_manifest(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            lower = str(key).lower()
            if lower in {
                "downloadurl",
                "uploadurl",
                "signedurl",
                "token",
                "authorization",
                "apikey",
                "api_key",
                "cookie",
                "password",
                "secret",
                "signature",
                "webhook",
            }:
                continue
            sanitized[key] = sanitize_for_manifest(item)
        return sanitized
    if isinstance(value, list):
        return [sanitize_for_manifest(item) for item in value[:120]]
    if isinstance(value, str):
        return redact_secrets(sanitize_text(value[:20000]))
    return value


def current_turn_input(task_input: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    if task_input.get("mode"):
        return task_input
    current_turn = context.get("currentTurn")
    if not isinstance(current_turn, dict):
        return task_input
    turn_input = current_turn.get("input")
    if not isinstance(turn_input, dict):
        return task_input
    nested = turn_input.get("input")
    if isinstance(nested, dict):
        return nested
    return turn_input


def bundle_webview(bundle_path: Path, log) -> None:
    dist_dir = Path("/agent/webview/dist")
    if not dist_dir.is_dir():
        dist_dir = Path(__file__).resolve().parents[1] / "webview" / "dist"
    if not dist_dir.is_dir():
        raise RuntimeError("webview/dist is required")
    validate_webview_dist(dist_dir)
    log("Validated WebView bundle entry and SDK bootstrap")
    with zipfile.ZipFile(bundle_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(dist_dir.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(dist_dir).as_posix())


def validate_webview_dist(dist_dir: Path) -> None:
    index_path = dist_dir / "index.html"
    sdk_path = dist_dir / "agent-app-sdk.js"
    if not index_path.is_file():
        raise RuntimeError("webview/dist/index.html is required")
    if not sdk_path.is_file():
        raise RuntimeError("webview/dist/agent-app-sdk.js is required")
    index = index_path.read_text(encoding="utf-8")
    sdk = sdk_path.read_text(encoding="utf-8")
    if "WDCloudAgentApp.connectAgentApp" not in index:
        raise RuntimeError("webview/dist/index.html must bootstrap the Agent App SDK")
    if "createAgentAppClient" not in sdk or "submitTurnAndWaitForResult" not in sdk:
        raise RuntimeError("webview/dist/agent-app-sdk.js must contain the real Agent App SDK")


def upload_turn_artifacts(worker: WorkerClient, artifacts: list[tuple[str, Path]]) -> list[dict[str, Any]]:
    if not os.environ.get("WDCLAW_TASK_STATUS_URL") or not os.environ.get("WDCLAW_TASK_TOKEN"):
        return []
    return worker.upload_artifacts(artifacts)


def upload_required_artifacts(worker: WorkerClient, artifacts: list[tuple[str, Path]]) -> list[dict[str, Any]]:
    if os.environ.get("WDCLAW_TASK_STATUS_URL") and os.environ.get("WDCLAW_TASK_TOKEN"):
        return worker.upload_artifacts(artifacts)
    return [
        {
            "artifactId": artifact_id,
            "name": path.name,
            "contentType": content_type_for(path),
            "sizeBytes": path.stat().st_size,
        }
        for artifact_id, path in artifacts
    ]


def write_result_optional(
    worker: WorkerClient,
    *,
    summary: str,
    structured_result: dict[str, Any],
    artifact_files: list[dict[str, Any]],
) -> None:
    if not os.environ.get("WDCLAW_AGENT_RESULT_URL") or not os.environ.get("WDCLAW_TASK_TOKEN"):
        return
    worker.write_result(
        artifact_files=artifact_files,
        structured_result=structured_result,
        summary=summary,
    )


def safe_session_context(worker: WorkerClient) -> dict[str, Any]:
    try:
        return worker.get_session_context()
    except Exception as error:
        worker.log(f"Session context unavailable; continuing without history: {error}")
        return {"artifacts": [], "previousResults": [], "previousTurns": []}


def make_logger(worker: WorkerClient, logs: list[str]):
    def log(message: str) -> None:
        logs.append(f"- {time.strftime('%H:%M:%S')} {message}")
        worker.log(message)

    return log


def build_log_file(logs: list[str], mode: str) -> str:
    return "# Design Inspiration Agent execution log\n\n" + f"- mode: {mode}\n" + "\n".join(logs) + "\n"


def content_type_for(path: Path) -> str:
    if path.suffix == ".zip":
        return "application/zip"
    if path.suffix == ".json":
        return "application/json"
    if path.suffix == ".md":
        return "text/markdown"
    return "text/plain"


def write_json(path: Path, payload: Any) -> Path:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def write_text(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def required_path_env(name: str) -> Path:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return Path(value).expanduser().resolve()


def task_input_json() -> dict[str, Any]:
    raw = os.environ.get("WDCLAW_TASK_INPUT_JSON", "").strip()
    if not raw:
        return {}
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, dict) else {}


def compact_json_value(value: Any, *, max_text: int = 4000) -> Any:
    if isinstance(value, dict):
        return {str(key): compact_json_value(item, max_text=max_text) for key, item in list(value.items())[:80]}
    if isinstance(value, list):
        return [compact_json_value(item, max_text=max_text) for item in value[:80]]
    if isinstance(value, str):
        return sanitize_text(value[:max_text])
    return value


def compact_list(value: Any, limit: int) -> list[Any]:
    return [compact_json_value(item) for item in list_or_empty(value)[:limit]]


def sanitize_csv_text(value: str) -> str:
    items = [sanitize_text(item.strip()) for item in value.replace("，", ",").replace("、", ",").split(",")]
    return ",".join([item for item in items if item][:80])


def normalize_choice(value: Any, choices: set[str], fallback: str) -> str:
    text = str(value or "").strip()
    return text if text in choices else fallback


def url_join(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + "/" + path.lstrip("/")


def url_origin(value: str) -> str:
    parsed = urllib.parse.urlparse(value)
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))


def clamp_int(value: Any, minimum: int, maximum: int, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def truthy(value: Any) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def list_or_empty(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


if __name__ == "__main__":
    raise SystemExit(main())
