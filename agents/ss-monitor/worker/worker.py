#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
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


AGENT_ID = "ss-monitor"
AGENT_NAME = "SS Monitor"
DEFAULT_CODEX_MODEL = "gpt-5.4-mini"
BUSINESS_MODES = {"monitor.summary", "monitor.health"}
SOURCE_ID_RE = re.compile(r"\b(?:tieba|forum4399|bilibili|douyin):[A-Za-z0-9_-]+\b", re.IGNORECASE)
SUPPORTED_SOURCE_IDS = {"tieba", "forum4399", "bilibili", "douyin"}


def main() -> int:
    worker = WorkerClient(required_artifacts=[])
    try:
        worker.status("running", phase_message="Preparing SS Monitor Agent turn", progress=0.05, stage="preparing")
        uploaded = run(worker)
        worker.status(
            "succeeded",
            artifactFiles=uploaded,
            artifactRefs=[artifact["objectKey"] for artifact in uploaded if artifact.get("objectKey")],
            phaseMessage="SS Monitor Agent turn completed",
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
    if mode == "monitor.health":
        return run_health_turn(worker, output_dir, mode, turn_input)
    if mode in BUSINESS_MODES:
        return run_business_turn(worker, output_dir, mode, turn_input)
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


def run_business_turn(worker: WorkerClient, output_dir: Path, mode: str, turn_input: dict[str, Any]) -> list[dict[str, Any]]:
    logs: list[str] = []
    log = make_logger(worker, logs)
    question = sanitize_text(str(turn_input.get("question") or "").strip() or "请生成当前舆情摘要。")

    worker.status("running", phase_message="Collecting monitor snapshot", progress=0.18, stage="collecting")
    monitor_snapshot = collect_monitor_snapshot(turn_input, mode, log)
    snapshot_path = write_json(output_dir / "monitor-snapshot.json", monitor_snapshot)

    work_dir = Path(os.environ.get("WDCLAW_WORK_DIR", "/tmp/ss-monitor-agent")).resolve()
    work_dir.mkdir(parents=True, exist_ok=True)
    codex_prompt = build_codex_prompt(
        skill_text=read_agent_skill(),
        mode=mode,
        turn_input=turn_input,
        question=question,
        monitor_snapshot=monitor_snapshot,
        output_dir=output_dir,
    )
    (work_dir / "codex-prompt.md").write_text(codex_prompt, encoding="utf-8")

    worker.status("running", phase_message="Running Codex analysis", progress=0.42, stage="codex")
    prepare_codex_home()
    codex_result = run_codex_streaming(
        codex_prompt,
        work_dir,
        worker,
        timeout_seconds=int(os.environ.get("WDCLAW_CODEX_TIMEOUT_SECONDS", "900")),
        progress_start=0.42,
        progress_end=0.78,
        progress_message="Codex is analyzing SS Monitor data",
        progress_stage="codex",
        heartbeat_seconds=20,
    )
    final_message = sanitize_text(str(codex_result.get("finalMessage") or "")).strip()
    if not final_message:
        raise RuntimeError("Codex produced an empty final message")
    annotated_final_message = annotate_summary_source_ids(final_message, monitor_snapshot)
    if annotated_final_message != final_message:
        log("Annotated source ids in summary output")
        final_message = annotated_final_message

    result_markdown = "\n".join(
        [
            "# SS Monitor Result",
            "",
            final_message,
            "",
            "## Runtime",
            "",
            f"- mode: {mode}",
            f"- monitorStatus: {monitor_snapshot.get('status') or 'unknown'}",
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
            "monitor": summarize_monitor_for_manifest(monitor_snapshot),
            "codex": {
                "model": os.environ.get("WDCLAW_CODEX_MODEL", DEFAULT_CODEX_MODEL),
                "finalMessageSource": codex_result.get("finalMessageSource"),
                "usage": codex_result.get("usage"),
            },
            "createdAt": iso_now(),
        },
    )
    log_path = write_text(output_dir / "execution-log.md", build_log_file(logs, mode))

    worker.status("running", phase_message="Uploading result artifacts", progress=0.86, stage="publishing_artifacts")
    uploaded = upload_turn_artifacts(
        worker,
        [
            ("result", result_path),
            ("monitorSnapshot", snapshot_path),
            ("manifest", manifest_path),
            ("logs", log_path),
        ],
    )
    structured_result = {
        "mode": mode,
        "monitorStatus": monitor_snapshot.get("status"),
        "stats": monitor_snapshot.get("monitor", {}).get("stats") if isinstance(monitor_snapshot.get("monitor"), dict) else None,
        "riskBacktest": monitor_snapshot.get("monitor", {}).get("riskBacktest") if isinstance(monitor_snapshot.get("monitor"), dict) else None,
        "resultMarkdown": result_markdown,
        "finalMessage": final_message,
        "usage": codex_result.get("usage"),
        "artifactCount": len(uploaded),
    }
    write_result_optional(
        worker,
        artifact_files=uploaded,
        structured_result=sanitize_for_manifest(structured_result),
        summary="SS Monitor analysis completed.",
    )
    return uploaded


def run_health_turn(worker: WorkerClient, output_dir: Path, mode: str, turn_input: dict[str, Any]) -> list[dict[str, Any]]:
    logs: list[str] = []
    log = make_logger(worker, logs)
    worker.status("running", phase_message="Collecting monitor health", progress=0.2, stage="collecting")
    monitor_snapshot = collect_monitor_snapshot(turn_input, mode, log)
    snapshot_path = write_json(output_dir / "monitor-snapshot.json", monitor_snapshot)

    result_markdown = build_health_result_markdown(monitor_snapshot)
    result_path = write_text(output_dir / "result.md", result_markdown)
    manifest_path = write_json(
        output_dir / "manifest.json",
        {
            "agentId": os.environ.get("WDCLAW_AGENT_ID", AGENT_ID),
            "taskId": os.environ.get("WDCLAW_TASK_ID"),
            "mode": mode,
            "codexModel": os.environ.get("WDCLAW_CODEX_MODEL") or DEFAULT_CODEX_MODEL,
            "monitor": summarize_monitor_for_manifest(monitor_snapshot),
            "createdAt": iso_now(),
        },
    )
    log_path = write_text(output_dir / "execution-log.md", build_log_file(logs, mode))

    worker.status("running", phase_message="Uploading health artifacts", progress=0.82, stage="publishing_artifacts")
    uploaded = upload_turn_artifacts(
        worker,
        [
            ("result", result_path),
            ("monitorSnapshot", snapshot_path),
            ("manifest", manifest_path),
            ("logs", log_path),
        ],
    )
    structured_result = {
        "mode": mode,
        "monitorStatus": monitor_snapshot.get("status"),
        "healthAvailable": bool(monitor_snapshot.get("health")),
        "configAvailable": bool(monitor_snapshot.get("config")),
        "resultMarkdown": result_markdown,
        "finalMessage": result_markdown,
        "artifactCount": len(uploaded),
    }
    write_result_optional(
        worker,
        artifact_files=uploaded,
        structured_result=sanitize_for_manifest(structured_result),
        summary="SS Monitor health check completed.",
    )
    return uploaded


def build_health_result_markdown(snapshot: dict[str, Any]) -> str:
    request = snapshot.get("request") if isinstance(snapshot.get("request"), dict) else {}
    status = str(snapshot.get("status") or "unknown")
    health_ok = bool(snapshot.get("health"))
    config_ok = bool(snapshot.get("config"))
    health_error = str(snapshot.get("healthError") or "").strip()
    config_error = str(snapshot.get("configError") or "").strip()
    origin = str(request.get("baseOrigin") or "").strip() or "未配置"
    games = str(request.get("games") or "ss1,ss2")
    window_hours = request.get("windowHours") or 72
    conclusion = "监控服务可访问，健康接口和配置接口均已返回。" if health_ok and config_ok else (
        "监控服务部分可访问，但仍有接口失败。" if health_ok or config_ok else "监控服务当前不可验证。"
    )
    lines = [
        "结论",
        conclusion,
        "",
        "检查结果",
        f"- 状态: {status}",
        f"- 监控地址: {origin}",
        f"- 项目: {games}",
        f"- 窗口: {window_hours} 小时",
        f"- /api/health: {'可用' if health_ok else '不可用'}",
        f"- /api/config: {'可用' if config_ok else '不可用'}",
    ]
    if health_error:
        lines.append(f"- health 错误: {health_error}")
    if config_error:
        lines.append(f"- config 错误: {config_error}")
    lines.extend(
        [
            "",
            "建议",
            "- 如果两个接口均可用，可以继续点击“生成摘要”读取监控窗口内的风险数据。",
            "- 如果任一接口不可用，先确认 WDCloud runtime 能访问该监控地址，再检查服务是否监听内网地址。",
            "",
            f"_Generated at {iso_now()}_",
        ]
    )
    return "\n".join(lines)


def collect_monitor_snapshot(turn_input: dict[str, Any], mode: str, log) -> dict[str, Any]:
    base_url = normalize_monitor_base_url(str(turn_input.get("monitorBaseUrl") or "").strip())
    snapshot: dict[str, Any] = {
        "status": "manual" if not base_url else "collecting",
        "mode": mode,
        "createdAt": iso_now(),
        "request": build_monitor_request_summary(turn_input, base_url),
    }
    if not base_url:
        snapshot["message"] = "No monitorBaseUrl was provided; Codex will analyze the user's prompt only."
        log("No monitorBaseUrl provided")
        return snapshot

    try:
        health = fetch_json(url_join(base_url, "/api/health"), timeout_seconds=15)
        snapshot["health"] = compact_json_value(health)
        log("Fetched /api/health")
    except Exception as error:
        snapshot["healthError"] = redact_secrets(str(error))
        log("Health fetch failed")

    try:
        config = fetch_json(url_join(base_url, "/api/config"), timeout_seconds=15)
        snapshot["config"] = compact_config_payload(config)
        log("Fetched /api/config")
    except Exception as error:
        snapshot["configError"] = redact_secrets(str(error))
        log("Config fetch failed")

    if mode == "monitor.health":
        snapshot["status"] = "ok" if snapshot.get("health") or snapshot.get("config") else "unreachable"
        return snapshot

    monitor_url = build_monitor_url(base_url, turn_input)
    try:
        monitor = fetch_json(monitor_url, timeout_seconds=45)
        snapshot["monitor"] = compact_monitor_payload(monitor)
        snapshot["status"] = "ok"
        log("Fetched /api/monitor")
    except Exception as error:
        snapshot["monitorError"] = redact_secrets(str(error))
        snapshot["status"] = "partial" if snapshot.get("health") or snapshot.get("config") else "unreachable"
        log("Monitor fetch failed")
    return snapshot


def normalize_monitor_base_url(value: str) -> str:
    if not value:
        return ""
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise RuntimeError("monitorBaseUrl must use http or https")
    if parsed.username or parsed.password:
        raise RuntimeError("monitorBaseUrl must not include credentials")
    if not parsed.netloc:
        raise RuntimeError("monitorBaseUrl must include a host")
    clean = parsed._replace(path="", params="", query="", fragment="")
    return urllib.parse.urlunparse(clean).rstrip("/")


def build_monitor_url(base_url: str, turn_input: dict[str, Any]) -> str:
    params = {
        "games": sanitize_text(str(turn_input.get("games") or "ss1,ss2")).replace(" ", ""),
        "windowHours": str(clamp_int(turn_input.get("windowHours"), 1, 720, 72)),
        "limit": str(clamp_int(turn_input.get("limit"), 1, 1000, 200)),
        "notify": "0",
    }
    if truthy(turn_input.get("force")):
        params["force"] = "1"
    extra_keywords = sanitize_text(str(turn_input.get("extraKeywords") or "")).strip()
    if extra_keywords:
        params["extraKeywords"] = extra_keywords[:500]
    return url_join(base_url, "/api/monitor") + "?" + urllib.parse.urlencode(params)


def build_monitor_request_summary(turn_input: dict[str, Any], base_url: str) -> dict[str, Any]:
    return {
        "baseOrigin": url_origin(base_url) if base_url else "",
        "games": sanitize_text(str(turn_input.get("games") or "ss1,ss2")).replace(" ", ""),
        "windowHours": clamp_int(turn_input.get("windowHours"), 1, 720, 72),
        "limit": clamp_int(turn_input.get("limit"), 1, 1000, 200),
        "force": truthy(turn_input.get("force")),
        "hasExtraKeywords": bool(str(turn_input.get("extraKeywords") or "").strip()),
    }


def fetch_json(url: str, timeout_seconds: int) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "ss-monitor-wdcloud-agent/0.1",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read(4 * 1024 * 1024)
    except urllib.error.HTTPError as error:
        body = error.read(512).decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {body or error.reason}") from None
    return json.loads(raw.decode("utf-8"))


def compact_monitor_payload(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"raw": compact_json_value(value)}
    return {
        "generatedAt": value.get("generatedAt"),
        "windowHours": value.get("windowHours"),
        "freshnessCutoff": value.get("freshnessCutoff"),
        "analysisVersion": value.get("analysisVersion"),
        "stats": value.get("stats"),
        "cache": value.get("cache"),
        "riskBacktest": value.get("riskBacktest"),
        "updatePolicy": value.get("updatePolicy"),
        "health": compact_list(value.get("health"), 20),
        "topicStats": compact_list(value.get("topicStats"), 12),
        "alerts": compact_list(value.get("alerts"), 20),
        "keywordEffectiveness": compact_list(value.get("keywordEffectiveness"), 20),
        "items": [compact_monitor_item(item) for item in list_or_empty(value.get("items"))[:60]],
    }


def compact_monitor_item(item: Any) -> Any:
    if not isinstance(item, dict):
        return compact_json_value(item)
    return {
        "id": item.get("id"),
        "title": item.get("title"),
        "source": item.get("source"),
        "sourceLabel": item.get("sourceLabel"),
        "gameName": item.get("gameName"),
        "publishedAt": item.get("publishedAt"),
        "sentiment": item.get("sentiment"),
        "riskLevel": item.get("riskLevel"),
        "riskSignalSource": item.get("riskSignalSource"),
        "topics": item.get("topics"),
        "riskReasons": item.get("riskReasons"),
        "summary": item.get("summary"),
        "metrics": item.get("metrics"),
        "url": item.get("url"),
    }


def annotate_summary_source_ids(markdown: str, monitor_snapshot: dict[str, Any]) -> str:
    items = monitor_snapshot.get("monitor", {}).get("items") if isinstance(monitor_snapshot.get("monitor"), dict) else []
    source_items = source_item_matchers(items)
    if not source_items:
        return markdown

    lines: list[str] = []
    for line in markdown.splitlines():
        if SOURCE_ID_RE.search(line):
            lines.append(line)
            continue
        source_code = source_code_for_summary_line(line, source_items)
        lines.append(prefix_source_code(line, source_code) if source_code else line)
    return "\n".join(lines)


def source_item_matchers(items: Any) -> list[dict[str, str]]:
    matchers: list[dict[str, str]] = []
    for item in list_or_empty(items):
        if not isinstance(item, dict):
            continue
        source_code = source_code_for_item(item)
        title = sanitize_text(str(item.get("title") or "")).strip()
        if source_code and len(title) >= 4:
            matchers.append({"title": title, "sourceCode": source_code})
    return sorted(matchers, key=lambda entry: len(entry["title"]), reverse=True)


def source_code_for_summary_line(line: str, source_items: list[dict[str, str]]) -> str:
    for item in source_items:
        if item["title"] in line:
            return item["sourceCode"]
    return ""


def prefix_source_code(line: str, source_code: str) -> str:
    marker = f"`{source_code}`"
    bullet_match = re.match(r"^(\s*(?:[-*+]\s+|\d+[.)]\s+))(.*)$", line)
    if bullet_match:
        return f"{bullet_match.group(1)}{marker} {bullet_match.group(2)}"
    return f"{marker} {line}"


def source_code_for_item(item: Any) -> str:
    if not isinstance(item, dict):
        return ""
    raw_id = sanitize_text(str(item.get("id") or "")).strip()
    existing = SOURCE_ID_RE.search(raw_id)
    if existing:
        return existing.group(0)
    source = sanitize_text(str(item.get("source") or "")).strip().lower()
    if source not in SUPPORTED_SOURCE_IDS or not raw_id or not re.fullmatch(r"[A-Za-z0-9_-]+", raw_id):
        return ""
    return f"{source}:{raw_id}"


def compact_config_payload(value: Any) -> Any:
    if not isinstance(value, dict):
        return compact_json_value(value)
    return {
        "games": compact_list(value.get("games"), 20),
        "runtime": sanitize_for_manifest(value.get("runtime") or {}),
    }


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


def build_codex_prompt(
    *,
    skill_text: str,
    mode: str,
    turn_input: dict[str, Any],
    question: str,
    monitor_snapshot: dict[str, Any],
    output_dir: Path,
) -> str:
    return "\n".join(
        [
            "You are the business execution Codex for the SS Monitor WDCloud Agent App.",
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
            "## Monitor Snapshot",
            json.dumps(sanitize_for_manifest(monitor_snapshot), ensure_ascii=False, indent=2),
            "",
            "## Output Directory",
            str(output_dir),
            "",
            "## Requirements",
            "- Return the user-facing answer as the final assistant message.",
            "- Use concise Chinese operational language.",
            "- Do not output tokens, credentials, cookies, signed URLs, webhook URLs, or private environment values.",
            "- Do not suggest DingTalk test messages unless explicitly asked.",
            "- If monitor data is unavailable, explain the missing precondition instead of inventing metrics.",
            "- In `重点条目`, every item derived from `monitor.items` must include the exact backticked source id from that item's `id`, such as `tieba:10816032913`, `forum4399:64551176`, `bilibili:BV...`, or `douyin:...`; do not invent ids.",
        ]
    )


def read_agent_skill() -> str:
    for path in (Path("/agent/SKILL.md"), Path(__file__).resolve().parents[1] / "SKILL.md"):
        if path.is_file():
            return path.read_text(encoding="utf-8")
    raise RuntimeError("SKILL.md is required for business turns")


def summarize_monitor_for_manifest(snapshot: dict[str, Any]) -> dict[str, Any]:
    monitor = snapshot.get("monitor") if isinstance(snapshot.get("monitor"), dict) else {}
    return {
        "status": snapshot.get("status"),
        "request": snapshot.get("request"),
        "generatedAt": monitor.get("generatedAt"),
        "stats": monitor.get("stats"),
        "healthCount": len(list_or_empty(monitor.get("health"))),
        "alertCount": len(list_or_empty(monitor.get("alerts"))),
        "itemCount": len(list_or_empty(monitor.get("items"))),
    }


def sanitize_for_manifest(value: Any) -> Any:
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            lower = str(key).lower()
            if lower in {
                "url",
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
        return [sanitize_for_manifest(item) for item in value[:100]]
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
        local_dist = Path(__file__).resolve().parents[1] / "webview" / "dist"
        dist_dir = local_dist
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
    return "# SS Monitor Agent execution log\n\n" + f"- mode: {mode}\n" + "\n".join(logs) + "\n"


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
