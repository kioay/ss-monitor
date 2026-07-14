(() => {
  function jsonHeaders() {
    return { "content-type": "application/json" };
  }

  // 同名但大小写不同的头(content-type vs Content-Type)在对象展开里会并存, fetch 转
  // Headers 时同名头被逗号拼接送出(网盘行 contentType 曾落库 "application/json, image/png",
  // 服务端 startsWith("image/") 判定全部失效)。统一经 Headers 归并: 调用方同名头覆盖默认值。
  function mergeJsonHeaders(extra) {
    const headers = new Headers(jsonHeaders());
    for (const [key, value] of new Headers(extra || {})) headers.set(key, value);
    return headers;
  }

  function authorizedJsonHeaders(accessToken, extra) {
    const headers = mergeJsonHeaders({ authorization: `Bearer ${accessToken}` });
    for (const [key, value] of new Headers(extra || {})) headers.set(key, value);
    return headers;
  }

  function trimTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function requireValue(value, name) {
    if (!value) throw new Error(`WDCloud Agent App ${name} is required.`);
    return value;
  }

  function clientEventId(prefix) {
    const random = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    return `${prefix}-${random}`;
  }

  async function readJson(response) {
    if (!response.ok) {
      throw new Error(`WDCloud Agent App API failed: ${response.status} ${await response.text()}`);
    }
    return response.json();
  }

  function isExpiredTokenErrorText(value) {
    return /expired WebView App token/i.test(String(value || ""));
  }

  function unwrapRecord(payload, key) {
    if (payload && typeof payload === "object" && !Array.isArray(payload) && key in payload) return payload[key];
    return payload;
  }

  function unwrapArray(payload, key) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object" && Array.isArray(payload[key])) return payload[key];
    if (payload && typeof payload === "object" && payload.data && typeof payload.data === "object") {
      if (Array.isArray(payload.data[key])) return payload.data[key];
      if (Array.isArray(payload.data.list)) return payload.data.list;
      if (Array.isArray(payload.data.items)) return payload.data.items;
    }
    if (payload && typeof payload === "object" && Array.isArray(payload.list)) return payload.list;
    if (payload && typeof payload === "object" && Array.isArray(payload.items)) return payload.items;
    throw new Error(`WDCloud Agent App API returned an invalid ${key} list.`);
  }

  function scheduledTaskIdOf(value) {
    return textValue(value && (value.scheduleId || value.id));
  }

  function resultMatches(result, options = {}) {
    if (typeof options.match === "function" && options.match(result)) return true;
    // turnId/taskRunId 精确认领优先: center AgentResult 自带两个 id, 等待器在 submit
    // 时也拿到了它们。只按 structuredMode 认领时, 同 mode 并发 turn 的第一个结果会被
    // 多个等待器同时认领(A 面板显示 B 的结果, B 的真实结果被丢弃)。
    // 结果对象缺 id(旧 center)才回落 mode 匹配, 向后兼容。
    if (result && typeof result === "object") {
      const wantTurnId = textValue(options.turnId);
      const wantTaskRunId = textValue(options.taskRunId);
      const resultTurnId = textValue(result.turnId);
      const resultTaskRunId = textValue(result.taskRunId);
      if (wantTurnId && resultTurnId) return resultTurnId === wantTurnId;
      if (wantTaskRunId && resultTaskRunId) return resultTaskRunId === wantTaskRunId;
    }
    if (options.structuredMode && result && typeof result === "object") {
      const structured = result.structuredResult;
      return structured && typeof structured === "object" && structured.mode === options.structuredMode;
    }
    return !options.match && !options.structuredMode;
  }

  function structuredResultOf(result) {
    return result && typeof result === "object" && "structuredResult" in result
      ? result.structuredResult
      : undefined;
  }

  function normalizeWaitTimeout(timeoutMs) {
    if (timeoutMs === undefined) return undefined;
    const numeric = Number(timeoutMs);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return Math.max(1, numeric);
  }

  function normalizeDrivePath(value) {
    return String(value == null ? "" : value)
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .join("/");
  }

  function splitDrivePath(path) {
    const segments = normalizeDrivePath(path).split("/").filter(Boolean);
    const name = segments.pop() || "";
    return { name, parentPath: segments.join("/") };
  }

  function isBlobValue(value) {
    return typeof Blob !== "undefined" && value instanceof Blob;
  }

  async function driveBytesOf(data) {
    if (typeof data === "string") return new TextEncoder().encode(data);
    if (isBlobValue(data)) return new Uint8Array(await data.arrayBuffer());
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    throw new Error("WDCloud Agent App drive.save data must be a Blob, ArrayBuffer, typed array, or string.");
  }

  async function driveSha256Hex(bytes) {
    // 秒传指纹; http 内网等非 secure context 下 crypto.subtle 缺失时跳过(退化为普通直传)。
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle || typeof subtle.digest !== "function") return "";
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function isSandboxNetworkError(error) {
    // fetch 网络层失败(含 CSP connect-src 拦截)统一表现为 TypeError("Failed to fetch" 等), 无 HTTP 状态。
    // 按 name 判断以跨 realm 生效(vm 沙箱/iframe 的 TypeError 构造器不同源)。
    return Boolean(error) && (error.name === "TypeError" || error.name === "NetworkError");
  }

  function nestedRecord(value, key) {
    return value && typeof value === "object" && !Array.isArray(value) && value[key] && typeof value[key] === "object"
      ? value[key]
      : undefined;
  }

  function taskRunIdOf(value) {
    if (!value || typeof value !== "object") return "";
    return String(
      value.taskRunId
      || nestedRecord(value, "taskRun")?.taskRunId
      || nestedRecord(value, "turn")?.taskRunId
      || nestedRecord(value, "agentTurn")?.taskRunId
      || ""
    );
  }

  function turnIdOf(value) {
    if (!value || typeof value !== "object") return "";
    return String(
      value.turnId
      || nestedRecord(value, "turn")?.turnId
      || nestedRecord(value, "agentTurn")?.turnId
      || ""
    );
  }

  function findSubmittedTurn(detail, options = {}) {
    const taskRunId = String(options.taskRunId || "");
    const turnId = String(options.turnId || "");
    if (!taskRunId && !turnId) return undefined;
    const turns = Array.isArray(detail && detail.turns) ? detail.turns : [];
    return turns.find((turn) => {
      if (!turn || typeof turn !== "object") return false;
      return (turnId && turn.turnId === turnId) || (taskRunId && turn.taskRunId === taskRunId);
    });
  }

  function assertSubmittedTurnStillRunning(detail, options = {}) {
    const turn = findSubmittedTurn(detail, options);
    if (!turn) return;
    const status = String(turn.status || "").toLowerCase();
    if (!["failed", "failed_to_schedule", "cancelled", "canceled", "timed_out", "rate_limited"].includes(status)) return;
    const title = turn.title || turn.content || "Agent App turn";
    const taskRunId = turn.taskRunId || options.taskRunId || "";
    const backendMessage = textValue(turn.lastError) || textValue(turn.phaseMessage);
    const statusLabel = status === "cancelled" || status === "canceled" ? "cancelled" : "failed";
    throw new Error("WDCloud Agent App turn " + statusLabel + ": " + title + (taskRunId ? " (" + taskRunId + ")" : "") + (backendMessage ? ": " + backendMessage : "."));
  }

  function textValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  function actionIdOfTurn(turn) {
    const input = isRecord(turn && turn.input) ? turn.input : {};
    return textValue(turn && turn.invocationAction)
      || textValue(turn && turn.actionId)
      || textValue(input.actionId)
      || textValue(input.mode);
  }

  function resultTurnIdOf(result) {
    if (!result || typeof result !== "object") return "";
    const structured = structuredResultOf(result);
    return textValue(result.turnId)
      || textValue(nestedRecord(result, "turn")?.turnId)
      || textValue(nestedRecord(result, "agentTurn")?.turnId)
      || textValue(isRecord(structured) ? structured.turnId : "");
  }

  function resultTaskRunIdOf(result) {
    if (!result || typeof result !== "object") return "";
    const structured = structuredResultOf(result);
    return textValue(result.taskRunId)
      || textValue(nestedRecord(result, "turn")?.taskRunId)
      || textValue(nestedRecord(result, "taskRun")?.taskRunId)
      || textValue(isRecord(structured) ? structured.taskRunId : "");
  }

  function timeMs(value) {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function newerResult(current, next) {
    if (!current) return next;
    const currentMs = timeMs(current.createdAt || current.updatedAt || current.completedAt);
    const nextMs = timeMs(next.createdAt || next.updatedAt || next.completedAt);
    return nextMs >= currentMs ? next : current;
  }

  function invocationHistoryFromSessionDetail(detail, options = {}) {
    const turns = Array.isArray(detail && detail.turns) ? detail.turns : [];
    const results = Array.isArray(detail && detail.results) ? detail.results : [];
    const resultsByTurnId = new Map();
    const resultsByTaskRunId = new Map();
    for (const result of results) {
      if (!result || typeof result !== "object") continue;
      const turnId = resultTurnIdOf(result);
      const taskRunId = resultTaskRunIdOf(result);
      if (turnId) resultsByTurnId.set(turnId, newerResult(resultsByTurnId.get(turnId), result));
      if (taskRunId) resultsByTaskRunId.set(taskRunId, newerResult(resultsByTaskRunId.get(taskRunId), result));
    }

    const actionId = textValue(options.actionId);
    const structuredMode = textValue(options.structuredMode || options.mode);
    const completedOnly = Boolean(options.completedOnly);
    return turns.map((turn) => {
      const input = isRecord(turn && turn.input) ? turn.input : {};
      const result = resultsByTurnId.get(textValue(turn && turn.turnId))
        || resultsByTaskRunId.get(textValue(turn && turn.taskRunId));
      const structuredResult = structuredResultOf(result);
      return {
        actionId: actionIdOfTurn(turn),
        completedAt: result && (result.completedAt || result.createdAt || result.updatedAt),
        content: typeof turn?.content === "string" ? turn.content : "",
        input: cloneJson(input),
        result: result ? cloneJson(result) : undefined,
        status: result ? "completed" : String(turn && turn.status || ""),
        structuredResult: cloneJson(structuredResult),
        summary: typeof result?.summary === "string" ? result.summary : "",
        taskRunId: textValue(turn && turn.taskRunId) || resultTaskRunIdOf(result),
        title: typeof turn?.title === "string" ? turn.title : "",
        turn: cloneJson(turn),
        turnId: textValue(turn && turn.turnId) || resultTurnIdOf(result),
      };
    }).filter((item) => {
      if (actionId && item.actionId !== actionId) return false;
      if (completedOnly && !item.result) return false;
      if (structuredMode) {
        const inputMode = isRecord(item.input) ? textValue(item.input.mode) : "";
        const outputMode = isRecord(item.structuredResult) ? textValue(item.structuredResult.mode) : "";
        if (inputMode !== structuredMode && outputMode !== structuredMode) return false;
      }
      return true;
    });
  }

  function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function parseSseEvent(text) {
    let event = "message";
    const dataLines = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim() || "message";
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
    const dataText = dataLines.join("\n");
    let data = dataText;
    if (dataText) {
      try {
        data = JSON.parse(dataText);
      } catch {
        data = dataText;
      }
    }
    return { data, event };
  }

  function abortError() {
    return typeof DOMException === "function"
      ? new DOMException("The operation was aborted.", "AbortError")
      : new Error("The operation was aborted.");
  }

  function sleep(ms, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener?.("abort", () => {
        clearTimeout(timer);
        reject(abortError());
      }, { once: true });
    });
  }

  function createAgentAppClient(options) {
    const origin = trimTrailingSlash(options.origin || globalThis.location?.origin || "");
    const fetcher = options.fetcher || globalThis.fetch.bind(globalThis);
    const targetWindow = options.targetWindow || globalThis.window;
    let bootstrapToken = options.bootstrapToken;
    let exchanged;
    let exchangePromise;
    let refreshPromise;
    let refreshResolve;
    let refreshReject;
    let refreshTimer;

    function resetExchange() {
      exchanged = undefined;
      exchangePromise = undefined;
    }

    function acceptBootstrapToken(nextBootstrapToken) {
      if (typeof nextBootstrapToken !== "string" || !nextBootstrapToken.trim()) return false;
      if (nextBootstrapToken !== bootstrapToken) {
        bootstrapToken = nextBootstrapToken;
        resetExchange();
      }
      if (refreshResolve) {
        const resolve = refreshResolve;
        clearRefreshWait();
        resolve();
      }
      return true;
    }

    function clearRefreshWait() {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = undefined;
      refreshPromise = undefined;
      refreshResolve = undefined;
      refreshReject = undefined;
    }

    function requestBootstrapRefresh(reason) {
      if (refreshPromise) return refreshPromise;
      if (!targetWindow || !targetWindow.parent || targetWindow.parent === targetWindow) {
        return Promise.reject(new Error("WDCloud Agent App token refresh requires an App Shell parent window."));
      }
      refreshPromise = new Promise((resolve, reject) => {
        refreshResolve = resolve;
        refreshReject = reject;
        const timeoutMs = Math.max(1000, Number(options.timeoutMs || 4000));
        refreshTimer = setTimeout(() => {
          const nextReject = refreshReject;
          clearRefreshWait();
          nextReject?.(new Error("Timed out waiting for WDCloud Agent App token refresh."));
        }, timeoutMs);
        targetWindow.parent.postMessage({
          reason: reason || "token-refresh",
          type: "wdcloud.bootstrap.request"
        }, origin || "*");
      });
      return refreshPromise;
    }

    targetWindow?.addEventListener?.("message", (event) => {
      const data = event.data;
      if (!data || data.type !== "wdcloud.bootstrap") return;
      acceptBootstrapToken(data.bootstrapToken);
    });

    async function exchange() {
      if (exchanged) return exchanged;
      exchangePromise ??= fetcher(`${origin}/portal/api/agent-app/bootstrap/exchange`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({ bootstrapToken }),
      }).then(readJson).catch(async (error) => {
        exchangePromise = undefined;
        if (isExpiredTokenErrorText(error?.message)) {
          await requestBootstrapRefresh("expired-bootstrap-token");
          return exchange();
        }
        throw error;
      });
      exchanged = await exchangePromise;
      if (!exchanged || typeof exchanged.accessToken !== "string" || !exchanged.accessToken.trim()) {
        exchanged = undefined;
        throw new Error("WDCloud Agent App bootstrap exchange returned an invalid access token.");
      }
      return exchanged;
    }

    async function authorizedFetch(path, init = {}) {
      const token = await exchange();
      const response = await fetcher(`${origin}${path}`, {
        ...init,
        headers: authorizedJsonHeaders(token.accessToken, init.headers),
      });
      if (response.status === 401) {
        const errorText = await response.text();
        if (isExpiredTokenErrorText(errorText)) {
          resetExchange();
          await requestBootstrapRefresh("expired-access-token");
          const refreshedToken = await exchange();
          return fetcher(`${origin}${path}`, {
            ...init,
            headers: authorizedJsonHeaders(refreshedToken.accessToken, init.headers),
          });
        }
        throw new Error(`WDCloud Agent App API failed: ${response.status} ${errorText}`);
      }
      return response;
    }

    async function appFetch(path, init = {}) {
      return readJson(await authorizedFetch(path, init));
    }

    async function appFetchBlob(path, init = {}) {
      const response = await authorizedFetch(path, init);
      if (!response.ok) {
        throw new Error(`WDCloud Agent App API failed: ${response.status} ${await response.text()}`);
      }
      return response.blob();
    }

    function taskArtifactContentQuery(artifact, disposition) {
      const name = requireValue(artifact?.name || artifact?.filename || artifact?.artifactId || artifact?.id, "artifact.name");
      const params = new URLSearchParams({
        disposition,
        kind: artifact.kind || "artifact",
        name,
      });
      if (artifact.contentType) params.set("contentType", artifact.contentType);
      if (typeof artifact.sizeBytes === "number") params.set("sizeBytes", String(artifact.sizeBytes));
      if (artifact.sha256) params.set("sha256", artifact.sha256);
      if (artifact.uploadId) params.set("uploadId", artifact.uploadId);
      if (artifact.url) params.set("url", artifact.url);
      return params;
    }

    function localFsQuery(path, options = {}, context = {}) {
      if (typeof path !== "string" || !path.trim()) {
        throw new Error("WDCloud Agent App fs path is required.");
      }
      const params = new URLSearchParams();
      params.set("path", path);
      const taskRunId = options.taskRunId || context.activeTaskRunId;
      const sessionId = options.sessionId || context.sessionId || context.studioSessionId;
      if (taskRunId) params.set("taskRunId", taskRunId);
      if (sessionId) params.set("sessionId", sessionId);
      return params;
    }

    async function portalFetch(path, init = {}) {
      await exchange();
      return readJson(await fetcher(`${origin}${path}`, {
        ...init,
        credentials: init.credentials || "same-origin",
        headers: mergeJsonHeaders(init.headers),
      }));
    }

    async function portalFetchRaw(path, init = {}) {
      await exchange();
      const response = await fetcher(`${origin}${path}`, {
        ...init,
        credentials: init.credentials || "same-origin",
      });
      if (!response.ok) {
        throw new Error(`WDCloud Agent App API failed: ${response.status} ${await response.text()}`);
      }
      return response;
    }

    async function listUserDriveFiles() {
      const payload = await portalFetch("/portal/api/drive/files");
      if (!payload || !Array.isArray(payload.files)) {
        throw new Error("WDCloud Agent App API returned an invalid drive file list.");
      }
      return payload.files;
    }

    async function resolveUserDriveFile(pathOrFile) {
      if (pathOrFile && typeof pathOrFile === "object" && pathOrFile.fileId) return pathOrFile;
      const drivePath = normalizeDrivePath(pathOrFile);
      if (!drivePath) throw new Error("WDCloud Agent App drive path is required.");
      const files = await listUserDriveFiles();
      const file = files.find((candidate) => candidate
        && candidate.kind !== "folder"
        && normalizeDrivePath(candidate.drivePath) === drivePath);
      if (!file) throw new Error(`WDCloud drive file was not found: ${drivePath}`);
      return file;
    }

    function driveContentPath(fileId) {
      return `/portal/api/drive/files/${encodeURIComponent(requireValue(fileId, "drive fileId"))}/content`;
    }

    async function sessionIdFromToken(inputSessionId) {
      const token = await exchange();
      return requireValue(inputSessionId || token.context?.sessionId || token.context?.studioSessionId, "sessionId");
    }

    async function getSessionDetail(sessionId) {
      const token = await exchange();
      const rawSessionId = requireValue(sessionId || token.context?.sessionId, "sessionId");
      const id = encodeURIComponent(rawSessionId);
      try {
        return await portalFetch(`/portal/api/agent-sessions/${id}`);
      } catch (error) {
        if (!isSharedSessionAccessError(error)) throw error;
        const snapshot = await sessionSnapshot({ sessionId: rawSessionId });
        return sessionDetailFromSnapshot(snapshot);
      }
    }

    function isSharedSessionAccessError(error) {
      return /\b(401|403|404)\b/.test(String(error && error.message || error || ""));
    }

    function sessionDetailFromSnapshot(snapshot) {
      const sessionId = requireValue(snapshot && snapshot.sessionId || snapshot && snapshot.session && snapshot.session.sessionId, "sessionId");
      return {
        session: {
          ...(isRecord(snapshot && snapshot.session) ? snapshot.session : {}),
          sessionId,
        },
        turns: Array.isArray(snapshot && snapshot.turns)
          ? snapshot.turns
          : Array.isArray(snapshot && snapshot.recentTurns)
            ? snapshot.recentTurns
            : [],
        results: Array.isArray(snapshot && snapshot.results)
          ? snapshot.results
          : Array.isArray(snapshot && snapshot.recentResults)
            ? snapshot.recentResults
            : snapshot && snapshot.latestResult
              ? [snapshot.latestResult]
              : [],
      };
    }

    async function submitTurn(input, sessionId) {
      const token = await exchange();
      const id = encodeURIComponent(requireValue(sessionId || token.context?.sessionId, "sessionId"));
      if (Array.isArray(token.scopes) && token.scopes.includes("session.turns.create")) {
        return appFetch(`/portal/api/agent-app/sessions/${id}/turns`, {
          method: "POST",
          body: JSON.stringify(input),
        });
      }
      return portalFetch(`/portal/api/agent-sessions/${id}/turns`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    }

    async function waitForResult(input = {}) {
      const timeoutMs = normalizeWaitTimeout(input.timeoutMs);
      const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
      const targetTurnId = textValue(input.turnId);
      const targetTaskRunId = textValue(input.taskRunId);
      if (targetTurnId || targetTaskRunId) {
        return waitForResultBySnapshot(input, { deadline, targetTaskRunId, targetTurnId, timeoutMs });
      }
      return waitForResultByDetail(input, { deadline, timeoutMs });
    }

    // 身份等待走 snapshot 定向轮询:
    // - ?turnId/taskRunId: 新 center 经 resolveActiveAgentAppTaskContext 直查目标结果
    //   (activeResult), 不受 results 最近 20 条投影限制, 消除高并发下目标被挤出投影的
    //   残余饿死窗口; 旧 center 忽略参数时 activeResult 是 token 上下文的结果(可能属于
    //   别的 turn), 故命中前必须客户端验身, 未命中回落投影内身份扫描(行为等同旧实现)。
    // - sinceRevision: 未变化时 center 只回 {unchanged} 小包(结果落库必经 turn.updated
    //   持久事件推高 revision, 快照开头的 reconcile 兜底); 防御未知 center 版本的
    //   revision 语义偏差, 连续 5 次 unchanged 后丢弃游标强制全量一次。
    // - snapshot 通道不可用(portal token 无 app scope 等 4xx): 回落 legacy 会话详情轮询。
    async function waitForResultBySnapshot(input, wait) {
      const intervalMs = Math.max(100, Number(input.intervalMs || 1800));
      let sinceRevision;
      let unchangedStreak = 0;
      while (wait.deadline === undefined || Date.now() < wait.deadline) {
        let snapshot;
        try {
          snapshot = await sessionSnapshot({
            sessionId: input.sessionId,
            ...(wait.targetTurnId ? { turnId: wait.targetTurnId } : {}),
            ...(wait.targetTaskRunId ? { taskRunId: wait.targetTaskRunId } : {}),
            ...(sinceRevision === undefined ? {} : { sinceRevision }),
          });
        } catch {
          return waitForResultByDetail(input, wait);
        }
        if (isRecord(snapshot) && typeof snapshot.revision === "number") sinceRevision = snapshot.revision;
        if (!isRecord(snapshot) || snapshot.unchanged) {
          unchangedStreak += 1;
          if (unchangedStreak >= 5) {
            sinceRevision = undefined;
            unchangedStreak = 0;
          }
        } else {
          unchangedStreak = 0;
          const detail = sessionDetailFromSnapshot(snapshot);
          if (isRecord(snapshot.activeTurn)) detail.turns = detail.turns.concat([snapshot.activeTurn]);
          await input.onPoll?.(detail);
          assertSubmittedTurnStillRunning(detail, input);
          const candidates = [];
          if (isRecord(snapshot.activeResult)) candidates.push(snapshot.activeResult);
          for (const result of detail.results.slice().reverse()) candidates.push(result);
          for (const result of candidates) {
            if ((wait.targetTurnId && resultTurnIdOf(result) === wait.targetTurnId)
              || (wait.targetTaskRunId && resultTaskRunIdOf(result) === wait.targetTaskRunId)) {
              return {
                detail,
                result,
                structuredResult: structuredResultOf(result),
              };
            }
          }
        }
        const sleepMs = wait.deadline === undefined ? intervalMs : Math.min(intervalMs, Math.max(1, wait.deadline - Date.now()));
        await sleep(sleepMs, input.signal);
      }
      throw new Error("Timed out waiting for WDCloud Agent App session result after " + wait.timeoutMs + "ms.");
    }

    async function waitForResultByDetail(input, wait) {
      const intervalMs = Math.max(100, Number(input.intervalMs || 1800));
      const afterResultCount = Math.max(0, Number(input.afterResultCount || 0));
      const targetTurnId = textValue(input.turnId);
      const targetTaskRunId = textValue(input.taskRunId);
      while (wait.deadline === undefined || Date.now() < wait.deadline) {
        const detail = await getSessionDetail(input.sessionId);
        await input.onPoll?.(detail);
        assertSubmittedTurnStillRunning(detail, input);
        const results = Array.isArray(detail && detail.results) ? detail.results : [];
        if (targetTurnId || targetTaskRunId) {
          // 身份匹配:快照 results 是投影(仅最近 N 条), 位置游标(afterResultCount)在
          // 长会话(累计结果数 ≥ 投影上限)下 slice 恒为空 → 永久空等(实测: 会话满 20 个
          // result 后所有 submitTurnAndWaitForResult 卡死)。锁定本次提交的 turnId/
          // taskRunId 后, 该 turn 的结果即唯一目标, 命中直接返回。
          for (const result of results.slice().reverse()) {
            if ((targetTurnId && resultTurnIdOf(result) === targetTurnId)
              || (targetTaskRunId && resultTaskRunIdOf(result) === targetTaskRunId)) {
              return {
                detail,
                result,
                structuredResult: structuredResultOf(result),
              };
            }
          }
        } else {
          const candidates = results.slice(afterResultCount).reverse();
          for (const result of candidates) {
            if (!resultMatches(result, input)) continue;
            return {
              detail,
              result,
              structuredResult: structuredResultOf(result),
            };
          }
        }
        const sleepMs = wait.deadline === undefined ? intervalMs : Math.min(intervalMs, Math.max(1, wait.deadline - Date.now()));
        await sleep(sleepMs, input.signal);
      }
      throw new Error("Timed out waiting for WDCloud Agent App session result after " + wait.timeoutMs + "ms.");
    }

    async function sessionSnapshot(input = {}) {
      const sessionId = typeof input === "string" ? input : input.sessionId;
      const id = encodeURIComponent(await sessionIdFromToken(sessionId));
      const params = new URLSearchParams();
      if (typeof input.sinceRevision === "number") params.set("sinceRevision", String(input.sinceRevision));
      if (input.taskRunId) params.set("taskRunId", String(input.taskRunId));
      if (input.turnId) params.set("turnId", String(input.turnId));
      if (input.resultId) params.set("resultId", String(input.resultId));
      const suffix = params.toString() ? `?${params}` : "";
      return appFetch(`/portal/api/agent-app/sessions/${id}/snapshot${suffix}`);
    }

    async function pumpLiveStream(response, input) {
      if (!response.ok) {
        throw new Error(`WDCloud Agent App live stream failed: ${response.status} ${await response.text()}`);
      }
      const reader = response.body?.getReader?.();
      if (!reader) throw new Error("WDCloud Agent App live stream is not readable in this browser.");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split(/\n\n/);
        buffer = parts.pop() || "";
        for (const part of parts) {
          const parsed = parseSseEvent(part);
          if (!parsed.event || parsed.event === "message") continue;
          await input.onEvent?.(parsed);
          if (isRevisionEvent(parsed)) {
            await input.onRevision?.({ event: parsed.event, ...parsed.data });
          }
        }
      }
    }

    function isRevisionEvent(parsed) {
      if (!parsed || !parsed.data || typeof parsed.data !== "object") return false;
      if (parsed.event === "resync.required") return true;
      return typeof parsed.data.revision === "number" || typeof parsed.data.latestSeq === "number";
    }

    async function connectLive(input = {}) {
      const sessionId = await sessionIdFromToken(input.sessionId);
      let closed = false;
      let currentRevision = typeof input.cursor === "number" ? input.cursor : typeof input.afterRevision === "number" ? input.afterRevision : 0;
      let targetRevision = currentRevision;
      let lastSnapshotRevision = typeof input.lastSnapshotRevision === "number" ? input.lastSnapshotRevision : currentRevision;
      let snapshotFetchScheduled = false;
      let snapshotFetchInFlight = false;
      let activeController;
      const reconnectMs = Math.max(500, Number(input.reconnectMs || 2000));
      const visibleSnapshotDelayMs = Math.max(0, Number(input.visibleSnapshotDelayMs ?? 150));
      const hiddenSnapshotDelayMs = Math.max(0, Number(input.hiddenSnapshotDelayMs ?? 1000));
      const snapshotOnEvent = input.snapshotOnEvent !== false && typeof input.onSnapshot === "function";

      async function fetchSnapshot(force = false) {
        if (!snapshotOnEvent || closed) return;
        if (snapshotFetchInFlight) {
          if (force) targetRevision = Math.max(targetRevision, currentRevision + 1);
          return;
        }
        if (!force && targetRevision <= lastSnapshotRevision) return;
        snapshotFetchInFlight = true;
        try {
          const snapshot = await sessionSnapshot({ sessionId, sinceRevision: force ? undefined : lastSnapshotRevision });
          if (!snapshot.unchanged && typeof snapshot.revision === "number") {
            lastSnapshotRevision = snapshot.revision;
            targetRevision = Math.max(targetRevision, snapshot.revision);
            await input.onSnapshot?.(snapshot);
          }
        } finally {
          snapshotFetchInFlight = false;
          if (!closed && targetRevision > lastSnapshotRevision) scheduleSnapshotFetch();
        }
      }

      function scheduleSnapshotFetch(options = {}) {
        if (!snapshotOnEvent || closed || snapshotFetchScheduled) return;
        snapshotFetchScheduled = true;
        const visibility = typeof document !== "undefined" ? document.visibilityState : "visible";
        const delayMs = options.force ? 0 : visibility === "hidden" ? hiddenSnapshotDelayMs : visibleSnapshotDelayMs;
        setTimeout(async () => {
          snapshotFetchScheduled = false;
          try {
            await fetchSnapshot(Boolean(options.force));
          } catch (error) {
            await input.onError?.(error);
          }
        }, delayMs);
      }

      const run = (async () => {
        if (input.initialSnapshot !== false && snapshotOnEvent) {
          targetRevision = Math.max(targetRevision, lastSnapshotRevision + 1);
          scheduleSnapshotFetch({ force: true });
        }
        while (!closed) {
          activeController = new AbortController();
          const params = new URLSearchParams();
          if (currentRevision > 0) params.set("cursor", String(currentRevision));
          const suffix = params.toString() ? `?${params}` : "";
          try {
            const response = await authorizedFetch(`/portal/api/agent-app/sessions/${encodeURIComponent(sessionId)}/live${suffix}`, {
              headers: { accept: "text/event-stream" },
              signal: activeController.signal,
            });
            await input.onOpen?.();
            await pumpLiveStream(response, {
              onEvent: input.onEvent,
              onRevision: async (payload) => {
                if (typeof payload.seq === "number") currentRevision = Math.max(currentRevision, payload.seq);
                if (typeof payload.revision === "number") {
                  currentRevision = Math.max(currentRevision, payload.revision);
                  targetRevision = Math.max(targetRevision, payload.revision);
                }
                await input.onRevision?.(payload);
                if (payload.type === "resync.required" || payload.event === "resync.required") {
                  if (typeof payload.latestSeq === "number") currentRevision = Math.max(currentRevision, payload.latestSeq);
                  scheduleSnapshotFetch({ force: true });
                } else if (snapshotOnEvent) {
                  scheduleSnapshotFetch();
                }
              },
            });
          } catch (error) {
            if (closed || activeController.signal.aborted) break;
            await input.onError?.(error);
          }
          if (!closed) {
            try {
              await sleep(reconnectMs, input.signal);
            } catch (error) {
              if (!closed && !input.signal?.aborted) throw error;
              closed = true;
            }
          }
        }
      })();

      input.signal?.addEventListener?.("abort", () => {
        closed = true;
        activeController?.abort();
      }, { once: true });

      return {
        close() {
          closed = true;
          activeController?.abort();
        },
        closed: run,
      };
    }

    async function createSyncedState(input = {}) {
      const defaults = isRecord(input.defaults) ? cloneJson(input.defaults) : {};
      const fields = isRecord(input.fields) ? input.fields : {};
      const subscribers = new Set();
      const dirtyPersistentKeys = new Set();
      const dirtyPersistentVersions = new Map();
      const dirtyPersistentSince = new Map();
      let mutationVersion = 0;
      let destroyed = false;
      let saveTimer;
      let saveInFlight;
      let live;
      let lastError;
      const permissions = await api.permissions.load();
      const readOnly = Boolean(permissions.readOnly);
      const saveDebounceMs = Math.max(0, Number(input.saveDebounceMs ?? 300));
      const storageKey = typeof input.storageKey === "string" && input.storageKey.trim()
        ? `wdcloud-agent-app:${input.storageKey.trim()}`
        : "";

      function fieldConfig(key) {
        return isRecord(fields[key]) ? fields[key] : {};
      }

      function fieldSync(key) {
        const sync = fieldConfig(key).sync;
        return sync === "local" || sync === "ephemeral" || sync === "derived" ? sync : "persistent";
      }

      function fieldDebounceMs(key) {
        const value = Number(fieldConfig(key).debounceMs);
        return Number.isFinite(value) && value >= 0 ? value : saveDebounceMs;
      }

      function conflictStrategy(key) {
        const value = fieldConfig(key).conflict;
        return value === "remote-wins" || value === "last-write-wins" || value === "local-dirty-wins"
          ? value
          : "local-dirty-wins";
      }

      function markDirty(key) {
        dirtyPersistentKeys.add(key);
        mutationVersion += 1;
        dirtyPersistentVersions.set(key, mutationVersion);
        dirtyPersistentSince.set(key, Date.now());
      }

      function clearDirty(key) {
        dirtyPersistentKeys.delete(key);
        dirtyPersistentVersions.delete(key);
        dirtyPersistentSince.delete(key);
      }

      function localStorageAvailable() {
        return Boolean(storageKey && globalThis.localStorage);
      }

      function readLocalFields() {
        if (!localStorageAvailable()) return {};
        try {
          const parsed = JSON.parse(globalThis.localStorage.getItem(storageKey) || "{}");
          return isRecord(parsed) ? parsed : {};
        } catch {
          return {};
        }
      }

      function writeLocalFields() {
        if (!localStorageAvailable()) return;
        const local = {};
        for (const key of Object.keys(current)) {
          if (fieldSync(key) === "local") local[key] = current[key];
        }
        try {
          globalThis.localStorage.setItem(storageKey, JSON.stringify(local));
        } catch {
          // localStorage is optional; quota or privacy failures should not break the app.
        }
      }

      function persistentState() {
        const next = {};
        for (const key of Object.keys(current)) {
          if (fieldSync(key) === "persistent") next[key] = current[key];
        }
        return next;
      }

      function emit(meta = {}) {
        const snapshot = apiState.get();
        for (const subscriber of subscribers) {
          subscriber(snapshot, {
            dirtyKeys: [...dirtyPersistentKeys],
            error: lastError,
            readOnly,
            ...meta,
          });
        }
      }

      function clearSaveTimer() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = undefined;
      }

      async function flush() {
        clearSaveTimer();
        if (destroyed || dirtyPersistentKeys.size === 0) return { saved: false, readOnly };
        if (readOnly) {
          lastError = new Error("WDCloud Agent App state is read-only.");
          emit({ error: lastError, source: "write-denied", saved: false });
          throw lastError;
        }
        if (saveInFlight) return saveInFlight;
        const keys = [...dirtyPersistentKeys];
        const versions = new Map(keys.map((key) => [key, dirtyPersistentVersions.get(key)]));
        const stateToSave = persistentState();
        saveInFlight = api.session.saveState(stateToSave, input.sessionId)
          .then((response) => {
            for (const key of keys) {
              if (dirtyPersistentVersions.get(key) === versions.get(key)) clearDirty(key);
            }
            const responseState = isRecord(response?.state) ? response.state : stateToSave;
            if (isRecord(responseState)) {
              current = { ...current };
              for (const [key, value] of Object.entries(responseState)) {
                if (fieldSync(key) === "persistent" && !dirtyPersistentKeys.has(key)) current[key] = cloneJson(value);
              }
            }
            lastError = undefined;
            emit({ source: "save", saved: true });
            if (dirtyPersistentKeys.size > 0 && !destroyed) scheduleSave([...dirtyPersistentKeys]);
            return response;
          })
          .catch((error) => {
            lastError = error;
            emit({ error, source: "save", saved: false });
            throw error;
          })
          .finally(() => {
            saveInFlight = undefined;
          });
        return saveInFlight;
      }

      function scheduleSave(keys) {
        if (destroyed || !keys.length) return;
        if (readOnly) {
          lastError = new Error("WDCloud Agent App state is read-only.");
          emit({ error: lastError, source: "write-denied" });
          throw lastError;
        }
        const delayMs = Math.max(...keys.map(fieldDebounceMs));
        clearSaveTimer();
        saveTimer = setTimeout(() => {
          flush().catch(() => undefined);
        }, delayMs);
      }

      function mergeRemoteState(remoteState, meta = {}) {
        if (!isRecord(remoteState)) return;
        const next = { ...current };
        const remoteTime = Date.parse(meta.stateUpdatedAt || meta.updatedAt || "");
        for (const [key, value] of Object.entries(remoteState)) {
          if (fieldSync(key) !== "persistent") continue;
          if (dirtyPersistentKeys.has(key)) {
            const strategy = conflictStrategy(key);
            if (strategy === "local-dirty-wins") continue;
            if (strategy === "last-write-wins") {
              const localTime = dirtyPersistentSince.get(key) || 0;
              if (!Number.isFinite(remoteTime) || remoteTime < localTime) continue;
            }
            clearDirty(key);
          }
          next[key] = cloneJson(value);
        }
        current = next;
        emit({ source: meta.source || "remote" });
      }

      const remote = await api.session.getState(input.sessionId).catch((error) => {
        lastError = error;
        return null;
      });
      const remoteState = isRecord(remote?.state) ? remote.state : {};
      let current = {
        ...cloneJson(defaults),
        ...cloneJson(remoteState),
        ...readLocalFields(),
      };

      const apiState = {
        get(key) {
          if (typeof key === "string") return cloneJson(current[key]);
          return cloneJson(current);
        },
        patch(values, options = {}) {
          if (!isRecord(values)) throw new Error("WDCloud Agent App state.patch expects an object.");
          const persistentKeys = [];
          for (const key of Object.keys(values)) {
            if (fieldSync(key) === "persistent") persistentKeys.push(key);
          }
          if (readOnly && persistentKeys.length > 0 && options.save !== false) {
            lastError = new Error("WDCloud Agent App state is read-only.");
            emit({ error: lastError, source: "write-denied" });
            throw lastError;
          }
          current = { ...current };
          for (const [key, value] of Object.entries(values)) {
            if (fieldSync(key) === "derived") continue;
            current[key] = cloneJson(value);
            if (fieldSync(key) === "persistent") {
              markDirty(key);
            }
          }
          writeLocalFields();
          emit({ source: options.source || "local" });
          if (options.save !== false) scheduleSave(persistentKeys);
          return apiState.get();
        },
        set(key, value, options = {}) {
          if (typeof key !== "string" || !key) throw new Error("WDCloud Agent App state key is required.");
          return apiState.patch({ [key]: value }, options);
        },
        subscribe(callback, options = {}) {
          if (typeof callback !== "function") throw new Error("WDCloud Agent App state subscriber must be a function.");
          subscribers.add(callback);
          if (options.immediate !== false) {
            callback(apiState.get(), {
              dirtyKeys: [...dirtyPersistentKeys],
              error: lastError,
              readOnly,
              source: "subscribe",
            });
          }
          return () => subscribers.delete(callback);
        },
        async flush() {
          return flush();
        },
        reset(options = {}) {
          current = {
            ...cloneJson(defaults),
            ...(options.keepLocal === false ? {} : readLocalFields()),
          };
          dirtyPersistentKeys.clear();
          dirtyPersistentVersions.clear();
          dirtyPersistentSince.clear();
          writeLocalFields();
          emit({ source: "reset" });
          if (options.save) scheduleSave(Object.keys(current).filter((key) => fieldSync(key) === "persistent"));
          return apiState.get();
        },
        destroy() {
          destroyed = true;
          clearSaveTimer();
          subscribers.clear();
          live?.close?.();
        },
        canWrite() {
          return !readOnly;
        },
        get readOnly() {
          return readOnly;
        },
      };

      if (input.live !== false && typeof api.session.connectLive === "function") {
        live = await api.session.connectLive({
          initialSnapshot: false,
          sessionId: input.sessionId,
          snapshotOnEvent: true,
          onSnapshot(snapshot) {
            if (isRecord(snapshot?.state)) mergeRemoteState(snapshot.state, {
              source: "remote",
              stateUpdatedAt: snapshot.stateUpdatedAt || snapshot.updatedAt,
            });
            input.onSnapshot?.(snapshot);
          },
          onError(error) {
            lastError = error;
            emit({ error, source: "live" });
            input.onError?.(error);
          },
        });
      }

      return apiState;
    }

    async function createPresence(input = {}) {
      const sessionId = await sessionIdFromToken(input.sessionId);
      const fields = isRecord(input.fields) ? input.fields : {};
      const subscribers = new Set();
      const pendingFieldPublishes = new Map();
      const channelName = input.channelName || `wdcloud-agent-app-presence:${sessionId}`;
      const channel = typeof BroadcastChannel === "function" && input.broadcast !== false
        ? new BroadcastChannel(channelName)
        : null;
      let live;
      let closed = false;

      function emit(event) {
        if (!event || typeof event !== "object") return;
        for (const subscriber of subscribers) subscriber(cloneJson(event));
      }

      function fieldConfig(key) {
        return isRecord(fields[key]) ? fields[key] : {};
      }

      function fieldThrottleMs(key) {
        const value = Number(fieldConfig(key).throttleMs);
        return Number.isFinite(value) && value >= 0 ? value : 0;
      }

      async function buildEvent(type, payload, options) {
        const token = await exchange();
        const fieldName = String(type || "");
        const isFieldUpdate = Boolean(fieldName && isRecord(fields[fieldName]) && options.raw !== true);
        return {
          actor: token.context?.userEmail,
          clientEventId: options.clientEventId || clientEventId(input.clientEventIdPrefix || "wdcloud-presence"),
          createdAt: nowIso(),
          ephemeral: true,
          ...(isFieldUpdate
            ? {
                field: fieldName,
                payload: { field: fieldName, value: cloneJson(payload) },
                type: "presence.field.updated",
                value: cloneJson(payload),
              }
            : {
                payload: cloneJson(payload),
                type: String(type || "presence.event"),
              }),
          sessionId,
        };
      }

      async function deliver(event, options = {}) {
        channel?.postMessage?.({ __wdcloudPresence: channelName, event });
        if (options.echo === true) emit(event);
        if (options.server === false) return { delivered: false, event, local: Boolean(channel), server: false };
        try {
          const response = await appFetch(`/portal/api/agent-app/sessions/${encodeURIComponent(sessionId)}/ephemeral`, {
            method: "POST",
            body: JSON.stringify({ event }),
          });
          return { delivered: true, event, response, server: true };
        } catch (error) {
          if (options.requireServer) throw error;
          input.onError?.(error);
          return { delivered: false, error, event, local: Boolean(channel), server: false };
        }
      }

      channel?.addEventListener?.("message", (event) => {
        const data = event.data;
        if (data && data.__wdcloudPresence === channelName && isRecord(data.event)) emit(data.event);
      });

      if (input.live !== false && typeof connectLive === "function") {
        live = await connectLive({
          initialSnapshot: false,
          sessionId,
          snapshotOnEvent: false,
          onEvent(parsed) {
            const data = parsed?.data;
            if (data && typeof data === "object" && data.ephemeral === true) emit(data);
            input.onEvent?.(parsed);
          },
          onError: input.onError,
        }).catch((error) => {
          input.onError?.(error);
          return null;
        });
      }

      return {
        subscribe(callback) {
          if (typeof callback !== "function") throw new Error("WDCloud Agent App presence subscriber must be a function.");
          subscribers.add(callback);
          return () => subscribers.delete(callback);
        },
        async publish(type, payload = {}, options = {}) {
          if (closed) throw new Error("WDCloud Agent App presence channel is closed.");
          const fieldName = String(type || "");
          const throttleMs = fieldName && isRecord(fields[fieldName]) && options.throttle !== false && options.immediate !== true
            ? fieldThrottleMs(fieldName)
            : 0;
          if (throttleMs > 0) {
            const existing = pendingFieldPublishes.get(fieldName);
            if (existing) {
              clearTimeout(existing.timer);
              existing.resolve({ delivered: false, replaced: true, server: false });
            }
            return new Promise((resolve, reject) => {
              const timer = setTimeout(async () => {
                pendingFieldPublishes.delete(fieldName);
                try {
                  const event = await buildEvent(type, payload, options);
                  resolve(await deliver(event, options));
                } catch (error) {
                  reject(error);
                }
              }, throttleMs);
              pendingFieldPublishes.set(fieldName, { reject, resolve, timer });
            });
          }
          const event = await buildEvent(type, payload, options);
          return deliver(event, options);
        },
        close() {
          closed = true;
          for (const pending of pendingFieldPublishes.values()) {
            clearTimeout(pending.timer);
            pending.resolve({ delivered: false, closed: true, server: false });
          }
          pendingFieldPublishes.clear();
          channel?.close?.();
          live?.close?.();
          subscribers.clear();
        },
      };
    }

    const api = {
      actions: {
        async list(sessionId) {
          const id = encodeURIComponent(await sessionIdFromToken(sessionId));
          return unwrapArray(await appFetch(`/portal/api/agent-app/sessions/${id}/actions`), "actions");
        },
        async submit(actionId, payload, input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          return appFetch(`/portal/api/agent-app/sessions/${id}/actions/${encodeURIComponent(actionId)}/submit`, {
            method: "POST",
            body: JSON.stringify({
              clientEventId: input.clientEventId || clientEventId(options.clientEventIdPrefix || "wdcloud-agent-app"),
              payload,
            }),
          });
        },
      },
      agentData: {
        // Agent Data Store 只读展示通道: 打开即读, 不为看数据起 worker。
        // 默认 all(能打开该 agent session 即可读); agent.yaml 声明
        // storage.agentData.read: owner 时非 owner 会得到 403。
        // get 直接返回 entry({key, value, taskRunId?, userEmail?, writtenAt?})或 null——
        // 端点的 {item, provisioned} 包裹对调用方零信息量, 曾造成 .value 直读必错的坑。
        async get(key, input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          const payload = await appFetch(`/portal/api/agent-app/sessions/${id}/agent-data?key=${encodeURIComponent(requireValue(key, "key"))}`);
          return (payload && payload.item) || null;
        },
        async list(input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          const params = new URLSearchParams();
          if (input.prefix) params.set("prefix", String(input.prefix));
          if (input.limit !== undefined) params.set("limit", String(input.limit));
          if (input.cursor) params.set("cursor", String(input.cursor));
          const suffix = params.toString() ? `?${params.toString()}` : "";
          return appFetch(`/portal/api/agent-app/sessions/${id}/agent-data${suffix}`);
        },
        // 写通道: 默认开放(内网审计可追责); owner 可用 storage.agentData.write/webWriteDenyPrefixes 收紧;
        // 只读分享页与缺 session.turns.create 的 token 会被 center 拒绝
        async set(key, value, input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          return appFetch(`/portal/api/agent-app/sessions/${id}/agent-data`, {
            body: JSON.stringify({ key: requireValue(key, "key"), value }),
            method: "POST"
          });
        },
        async delete(key, input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          return appFetch(`/portal/api/agent-app/sessions/${id}/agent-data?key=${encodeURIComponent(requireValue(key, "key"))}`, {
            method: "DELETE"
          });
        },
      },
      // @deprecated 名称: 新代码用 agentOssDrive(同一对象, 见文件尾别名挂载)。
      agentDrive: {
        // Agent Drive web 通道: 字节直连 OSS(CSP 已放行自家桶), center 只签名与登记。
        // 读=open∪writeOpen 前缀(agent owner 全量); 写=storage.drive.writeOpen 目录级开放(owner 全量);
        // 删=更窄一档: 自己创建的 ∩ writeOpen(owner/admin 全量), 404=不可见/不存在, 409=文件夹非空。
        async list(input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          return appFetch(`/portal/api/agent-app/sessions/${id}/agent-drive/files`);
        },
        async contentUrl(fileId, input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          const params = new URLSearchParams({ fileId: requireValue(fileId, "fileId") });
          if (input.thumb) params.set("thumb", String(input.thumb));
          const payload = await appFetch(`/portal/api/agent-app/sessions/${id}/agent-drive/content-url?${params.toString()}`);
          return payload.url;
        },
        async readBlob(fileId, input = {}) {
          const url = await this.contentUrl(fileId, input);
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Agent drive content fetch failed: ${response.status}`);
          return response.blob();
        },
        async readText(fileId, input = {}) {
          return (await this.readBlob(fileId, input)).text();
        },
        async upload(name, content, input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          const blob = content instanceof Blob ? content : new Blob([content], { type: input.contentType || "application/octet-stream" });
          const contentType = input.contentType || blob.type || "application/octet-stream";
          let sha256;
          try {
            if (globalThis.crypto && globalThis.crypto.subtle) {
              const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
              sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
            }
          } catch (error) {
            sha256 = undefined; // 秒传是优化, 摘要失败继续普通直传
          }
          const intent = await appFetch(`/portal/api/agent-app/sessions/${id}/agent-drive/upload-intent`, {
            body: JSON.stringify({
              contentType,
              name: requireValue(name, "name"),
              ...(input.parentPath ? { parentPath: String(input.parentPath) } : {}),
              ...(sha256 ? { sha256 } : {})
            }),
            method: "POST"
          });
          if (intent && intent.instant) return intent.file;
          const put = await fetch(intent.uploadUrl, { body: blob, headers: { "content-type": contentType }, method: "PUT" });
          if (!put.ok) throw new Error(`Agent drive upload failed: ${put.status}`);
          const committed = await appFetch(`/portal/api/agent-app/sessions/${id}/agent-drive/commit`, {
            body: JSON.stringify({
              contentType,
              fileId: intent.fileId,
              name: intent.name,
              ...(input.parentPath ? { parentPath: String(input.parentPath) } : {}),
              ...(sha256 ? { sha256 } : {}),
              sizeBytes: blob.size,
              storageKey: intent.storageKey
            }),
            method: "POST"
          });
          return committed.file;
        },
        async delete(fileId, input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          const payload = await appFetch(`/portal/api/agent-app/sessions/${id}/agent-drive/delete`, {
            body: JSON.stringify({ fileId: requireValue(fileId, "fileId") }),
            method: "POST"
          });
          return payload.file;
        },
        async mkdir(name, input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          const payload = await appFetch(`/portal/api/agent-app/sessions/${id}/agent-drive/folders`, {
            body: JSON.stringify({
              name: requireValue(name, "name"),
              ...(input.parentPath ? { parentPath: String(input.parentPath) } : {})
            }),
            method: "POST"
          });
          return payload.file;
        },
        async move(fileIdOrIds, input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          const fileIds = (Array.isArray(fileIdOrIds) ? fileIdOrIds : [fileIdOrIds])
            .map((fileId) => requireValue(fileId, "fileId"));
          return appFetch(`/portal/api/agent-app/sessions/${id}/agent-drive/move`, {
            body: JSON.stringify({
              conflict: input.conflict === "skip" ? "skip" : "rename",
              fileIds,
              ...(input.parentPath ? { parentPath: String(input.parentPath) } : {})
            }),
            method: "POST"
          });
        },
        async rename(fileId, name, input = {}) {
          const id = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          const payload = await appFetch(`/portal/api/agent-app/sessions/${id}/agent-drive/rename`, {
            body: JSON.stringify({
              fileId: requireValue(fileId, "fileId"),
              name: requireValue(name, "name")
            }),
            method: "POST"
          });
          return payload.file;
        },
      },
      artifacts: {
        async list(taskRunId) {
          const token = await exchange();
          const id = encodeURIComponent(requireValue(taskRunId || token.context?.activeTaskRunId, "taskRunId"));
          return unwrapArray(await appFetch(`/portal/api/agent-app/tasks/${id}/artifacts`), "artifacts");
        },
        async blob(taskRunId, artifact, options = {}) {
          const token = await exchange();
          const id = encodeURIComponent(requireValue(taskRunId || artifact?.taskRunId || token.context?.activeTaskRunId, "taskRunId"));
          const disposition = options.disposition === "attachment" ? "attachment" : "inline";
          const query = taskArtifactContentQuery(artifact || {}, disposition);
          return appFetchBlob(`/portal/api/my-tasks/${id}/files/content?${query.toString()}`);
        },
        async blobUrl(taskRunId, artifact, options = {}) {
          const blob = await this.blob(taskRunId, artifact, options);
          if (!globalThis.URL || typeof globalThis.URL.createObjectURL !== "function") {
            throw new Error("WDCloud Agent App artifact preview requires URL.createObjectURL.");
          }
          return globalThis.URL.createObjectURL(blob);
        },
      },
      async context() {
        return unwrapRecord(await appFetch("/portal/api/agent-app/context"), "context");
      },
      // 用户个人网盘四动词(存/取/列/分享)。
      // @deprecated 名称: 新代码用 userOssDrive(同一对象, 见文件尾别名挂载)。
      // 判别口诀: 需要 open()/随机改写/跑 git 的放 workspace(sdk.fs); 整个文件进出的放 drive。
      // Agent App 沙箱 CSP 为 connect-src 'self': 直传/直取被拦时自动回落同源通道
      // (save→旧 /upload, share→portal 直链); get 的字节在沙箱内无同源路由, 报可读错误。
      drive: {
        async get(path) {
          const file = await resolveUserDriveFile(path);
          try {
            const response = await portalFetchRaw(driveContentPath(file.fileId));
            return response.blob();
          } catch (error) {
            if (!isSandboxNetworkError(error)) throw error;
            throw new Error(
              "WDCloud drive.get is blocked by the Agent App sandbox (connect-src 'self'). "
              + "Use drive.share(path).url in a new tab for user-facing download, or run this flow outside the sandboxed WebView."
            );
          }
        },
        async list(dir = "", options = {}) {
          const prefix = normalizeDrivePath(dir);
          const files = await listUserDriveFiles();
          if (options.recursive) {
            return files.filter((file) => !prefix || normalizeDrivePath(file && file.drivePath).startsWith(`${prefix}/`));
          }
          return files.filter((file) => normalizeDrivePath(file && file.parentPath) === prefix);
        },
        async save(path, data, options = {}) {
          const target = splitDrivePath(path);
          const name = target.name || (isBlobValue(data) && typeof data.name === "string" ? data.name : "");
          if (!name) throw new Error("WDCloud Agent App drive.save path must include a file name.");
          const bytes = await driveBytesOf(data);
          const contentType = options.contentType
            || (isBlobValue(data) && data.type ? data.type : "")
            || "application/octet-stream";
          const sha256 = await driveSha256Hex(bytes);
          const parentPathBody = target.parentPath ? { parentPath: target.parentPath } : {};
          const intent = await portalFetch("/portal/api/drive/files/upload-intent", {
            method: "POST",
            body: JSON.stringify({
              contentType,
              name,
              ...parentPathBody,
              ...(sha256 ? { sha256 } : {}),
            }),
          });
          // sha256 命中同 owner 已有文件 → 秒传(零上传, 引用同一不可变 key)。
          if (intent && intent.instant === true && intent.file) return { file: intent.file, instant: true };
          if (!intent || typeof intent.uploadUrl !== "string" || !intent.uploadUrl) {
            throw new Error("WDCloud drive upload intent did not return an upload URL.");
          }
          let putResponse;
          try {
            putResponse = await fetcher(intent.uploadUrl, {
              method: "PUT",
              headers: { "content-type": intent.contentType || contentType },
              body: bytes,
            });
          } catch (error) {
            if (!isSandboxNetworkError(error)) throw error;
            // 沙箱 WebView 直传被 CSP 拦截 → 回落 MR2 明文保留的同源 /upload 通道(字节经 center, 适合小文件)。
            const params = new URLSearchParams({ name });
            if (target.parentPath) params.set("parentPath", target.parentPath);
            const uploaded = await portalFetch(`/portal/api/drive/files/upload?${params.toString()}`, {
              method: "POST",
              headers: { "content-type": intent.contentType || contentType },
              body: bytes,
            });
            return { file: unwrapRecord(uploaded, "file"), fallback: "same-origin-upload", instant: false };
          }
          if (!putResponse.ok) {
            throw new Error(`WDCloud drive upload PUT failed: ${putResponse.status} ${await putResponse.text()}`);
          }
          const committed = await portalFetch("/portal/api/drive/files/commit", {
            method: "POST",
            body: JSON.stringify({
              contentType: intent.contentType || contentType,
              fileId: requireValue(intent.fileId, "drive upload fileId"),
              name: intent.name || name,
              ...parentPathBody,
              ...(sha256 ? { sha256 } : {}),
              sizeBytes: bytes.byteLength,
              storageKey: requireValue(intent.storageKey, "drive upload storageKey"),
            }),
          });
          return { file: unwrapRecord(committed, "file"), instant: false };
        },
        async share(path) {
          const file = await resolveUserDriveFile(path);
          const contentPath = driveContentPath(file.fileId);
          const portalUrl = `${origin}${contentPath}`;
          const shareRecord = (url, signed) => ({
            contentType: file.contentType,
            drivePath: file.drivePath,
            fileId: file.fileId,
            name: file.name,
            signed,
            url,
          });
          try {
            // 跟随 302 后 response.url = 签名直链(24h 桶对齐, TTL 内内网可转发);
            // Range 只取 1 字节避免整文件下载; 无 302(本地降级)时回落 portal 直链(仅本人可用)。
            const response = await portalFetchRaw(contentPath, { headers: { Range: "bytes=0-0" } });
            const signed = Boolean(response.url && response.url !== portalUrl);
            return shareRecord(signed ? response.url : portalUrl, signed);
          } catch (error) {
            if (!isSandboxNetworkError(error)) throw error;
            // 沙箱 CSP 拦截跟随直链 → 返回 portal 直链(新标签页导航可用, 仅限本人会话)。
            return shareRecord(portalUrl, false);
          }
        },
      },
      events: {
        async list(input = {}) {
          const sessionId = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          const params = new URLSearchParams();
          if (typeof input.afterSeq === "number") params.set("afterSeq", String(input.afterSeq));
          const suffix = params.toString() ? `?${params}` : "";
          return unwrapArray(await appFetch(`/portal/api/agent-app/sessions/${sessionId}/events${suffix}`), "events");
        },
      },
      // 复合文件输入的数据协议层(文件输入合同): 三来源统一归一为可直接放进
      // turn 顶层 inputFiles 的 ref({fileId, name, contentType?, sizeBytes?, source})。
      // 选择器 UI/缩略图留给应用层, 本层不碰 DOM; 拼键规则(drive: 前缀、
      // taskRunId:kind:name)收敛在此, 不再让每个 agent 手搓。
      files: {
        // 本地 File/Blob → 个人网盘, 返回 drive: 前缀 ref
        async upload(file, input = {}) {
          if (!file || typeof file.arrayBuffer !== "function") {
            throw new Error("WDCloud Agent App files.upload requires a File or Blob.");
          }
          const name = textValue(input.name) || textValue(file.name) || "file";
          const params = new URLSearchParams({ name });
          const parentPath = textValue(input.parentPath);
          if (parentPath) params.set("parentPath", parentPath);
          const payload = await appFetch(`/portal/api/drive/files/upload?${params.toString()}`, {
            body: file,
            headers: { "Content-Type": file.type || "application/octet-stream" },
            method: "POST",
          });
          const uploaded = (payload && payload.file) || payload || {};
          const fileId = textValue(uploaded.fileId || uploaded.id);
          if (!fileId) throw new Error("WDCloud Agent App files.upload got no fileId from the drive API.");
          return {
            contentType: uploaded.contentType || file.type || undefined,
            fileId: fileId.includes(":") ? fileId : `drive:${fileId}`,
            name: uploaded.name || name,
            sizeBytes: uploaded.sizeBytes ?? file.size,
            source: "local-upload",
          };
        },
        // 最近任务的临时文件/历史产物(dashboard.files) → `${taskRunId}:${kind}:${name}` ref
        async listTemporary(input = {}) {
          const dashboard = await appFetch("/portal/api/dashboard");
          const files = Array.isArray(dashboard && dashboard.files) ? dashboard.files : [];
          return files
            .filter((file) => textValue(file && file.name) && textValue(file && file.taskRunId))
            .filter((file) => !input.imageOnly || String(file.contentType || "").startsWith("image/"))
            .map((file) => ({
              contentType: file.contentType || undefined,
              fileId: `${file.taskRunId}:${file.kind === "input" ? "input" : "artifact"}:${file.name}`,
              name: file.name,
              sizeBytes: file.sizeBytes,
              source: "temporary-file",
            }));
        },
        // 个人网盘文件 → drive: 前缀 ref; accept 为 contentType 前缀过滤(如 "image/")
        async listDrive(input = {}) {
          const payload = await appFetch("/portal/api/drive/files");
          const files = Array.isArray(payload && payload.files) ? payload.files : [];
          return files
            .filter((file) => textValue(file && file.fileId) && (file.kind === undefined || file.kind === "file"))
            .filter((file) => !input.accept || String(file.contentType || "").startsWith(String(input.accept)))
            .map((file) => ({
              contentType: file.contentType || undefined,
              drivePath: file.drivePath,
              fileId: `drive:${file.fileId}`,
              name: file.name,
              sizeBytes: file.sizeBytes,
              source: "drive-file",
            }));
        },
      },
      fs: {
        async delete(path, options = {}) {
          const token = await exchange();
          return appFetch("/portal/api/agent-app/fs/delete", {
            method: "POST",
            body: JSON.stringify({
              path,
              sessionId: options.sessionId || token.context?.sessionId || token.context?.studioSessionId,
              taskRunId: options.taskRunId || token.context?.activeTaskRunId,
            }),
          });
        },
        async list(path, options = {}) {
          const token = await exchange();
          const params = localFsQuery(path, options, token.context || {});
          if (options.recursive) params.set("recursive", "1");
          const payload = await appFetch(`/portal/api/agent-app/fs/list?${params.toString()}`);
          if (!Array.isArray(payload.items)) throw new Error("WDCloud Agent App API returned an invalid LocalFS item list.");
          return payload.items;
        },
        async mkdir(path, options = {}) {
          const token = await exchange();
          return appFetch("/portal/api/agent-app/fs/mkdir", {
            method: "POST",
            body: JSON.stringify({
              path,
              sessionId: options.sessionId || token.context?.sessionId || token.context?.studioSessionId,
              taskRunId: options.taskRunId || token.context?.activeTaskRunId,
            }),
          });
        },
        async move(fromPath, toPath, options = {}) {
          const token = await exchange();
          return appFetch("/portal/api/agent-app/fs/move", {
            method: "POST",
            body: JSON.stringify({
              fromPath,
              sessionId: options.sessionId || token.context?.sessionId || token.context?.studioSessionId,
              taskRunId: options.taskRunId || token.context?.activeTaskRunId,
              toPath,
            }),
          });
        },
        async readBlob(path, options = {}) {
          const token = await exchange();
          const params = localFsQuery(path, options, token.context || {});
          return appFetchBlob(`/portal/api/agent-app/fs/file?${params.toString()}`);
        },
        async readJson(path, options = {}) {
          return JSON.parse(await this.readText(path, options));
        },
        async readText(path, options = {}) {
          const token = await exchange();
          const params = localFsQuery(path, options, token.context || {});
          const response = await authorizedFetch(`/portal/api/agent-app/fs/file?${params.toString()}`);
          if (!response.ok) {
            throw new Error(`WDCloud Agent App API failed: ${response.status} ${await response.text()}`);
          }
          return response.text();
        },
        async stat(path, options = {}) {
          const token = await exchange();
          const params = localFsQuery(path, options, token.context || {});
          return appFetch(`/portal/api/agent-app/fs/stat?${params.toString()}`);
        },
        async url(path, options = {}) {
          const token = await exchange();
          const params = localFsQuery(path, options, token.context || {});
          return `${origin}/portal/api/agent-app/fs/file?${params.toString()}`;
        },
        async writeFile(path, body, options = {}) {
          const token = await exchange();
          const params = localFsQuery(path, options, token.context || {});
          const headers = {
            "content-type": options.contentType || "application/octet-stream",
          };
          if (options.ifMatch) headers["If-Match"] = options.ifMatch;
          if (options.ifNoneMatch) headers["If-None-Match"] = options.ifNoneMatch;
          const response = await authorizedFetch(`/portal/api/agent-app/fs/file?${params.toString()}`, {
            method: "PUT",
            headers,
            body,
          });
          if (!response.ok) {
            throw new Error(`WDCloud Agent App API failed: ${response.status} ${await response.text()}`);
          }
          return response.json();
        },
      },
      invocation: {
        async history(input = {}) {
          return api.session.getInvocationHistory(input);
        },
        async submit(actionId, input = {}, options = {}) {
          const id = requireValue(actionId, "invocation actionId");
          const payload = isRecord(input) ? cloneJson(input) : { value: input };
          const mode = options.mode || payload.mode || id;
          const turnInput = {
            ...payload,
            actionId: id,
            mode,
          };
          return api.session.submitTurnAndWaitForResult({
            content: options.content || payload.message || payload.prompt || id,
            idempotencyKey: options.idempotencyKey,
            input: turnInput,
            inputFiles: Array.isArray(options.inputFiles) ? options.inputFiles : [],
            title: options.title || id,
            workspaceRef: options.workspaceRef,
          }, {
            intervalMs: options.intervalMs,
            match: options.match,
            onPoll: options.onPoll,
            onSubmitted: options.onSubmitted,
            signal: options.signal,
            structuredMode: options.structuredMode || mode,
            taskRunId: options.taskRunId,
            timeoutMs: options.timeoutMs,
            turnId: options.turnId,
          }, options.sessionId);
        },
      },
      permissions: {
        can(scope) {
          return Array.isArray(exchanged?.scopes) && exchanged.scopes.includes(scope);
        },
        async load() {
          const token = await exchange();
          return {
            readOnly: Boolean(token.context?.readOnly),
            scopes: Array.isArray(token.scopes) ? [...token.scopes] : [],
          };
        },
        get readOnly() {
          return Boolean(exchanged?.context?.readOnly);
        },
      },
      presence: {
        async create(input = {}) {
          return createPresence(input);
        },
      },
      request: appFetch,
      schedules: {
        async list() {
          return unwrapArray(await appFetch("/portal/api/agent-app/schedules"), "schedules");
        },
        async create(input = {}) {
          const source = isRecord(input) ? cloneJson(input) : {};
          const token = await exchange();
          const context = token.context || {};
          const action = textValue(source.action || source.actionId || source.agentInvocation?.action);
          const payload = {
            ...source,
            targetType: source.targetType || "agent",
            targetId: source.targetId || context.agentId,
            targetEnv: source.targetEnv || context.env || "test",
            timeZone: source.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
            status: source.status || "active",
            agentInvocation: {
              ...(isRecord(source.agentInvocation) ? source.agentInvocation : {}),
              action,
              sessionId: source.agentInvocation?.sessionId || context.sessionId,
              sessionPolicy: source.agentInvocation?.sessionPolicy || source.sessionPolicy || "persistent",
            },
          };
          if (!payload.action && action) payload.action = action;
          delete payload.sessionPolicy;
          return unwrapRecord(await appFetch("/portal/api/agent-app/schedules", {
            method: "POST",
            body: JSON.stringify(payload),
          }), "schedule");
        },
        async runNow(scheduleId) {
          const id = encodeURIComponent(requireValue(scheduledTaskIdOf(scheduleId) || scheduleId, "scheduleId"));
          return appFetch(`/portal/api/agent-app/schedules/${id}/run-now`, { method: "POST" });
        },
        async pause(scheduleId) {
          const id = encodeURIComponent(requireValue(scheduledTaskIdOf(scheduleId) || scheduleId, "scheduleId"));
          return unwrapRecord(await appFetch(`/portal/api/agent-app/schedules/${id}/pause`, { method: "POST" }), "schedule");
        },
        async resume(scheduleId) {
          const id = encodeURIComponent(requireValue(scheduledTaskIdOf(scheduleId) || scheduleId, "scheduleId"));
          return unwrapRecord(await appFetch(`/portal/api/agent-app/schedules/${id}/resume`, { method: "POST" }), "schedule");
        },
        async delete(scheduleId) {
          const id = encodeURIComponent(requireValue(scheduledTaskIdOf(scheduleId) || scheduleId, "scheduleId"));
          return unwrapRecord(await appFetch(`/portal/api/agent-app/schedules/${id}`, { method: "DELETE" }), "schedule");
        },
        async runs(scheduleId) {
          const id = encodeURIComponent(requireValue(scheduledTaskIdOf(scheduleId) || scheduleId, "scheduleId"));
          return unwrapArray(await appFetch(`/portal/api/agent-app/schedules/${id}/runs`), "runs");
        },
      },
      session: {
        async get(sessionId) {
          return getSessionDetail(sessionId);
        },
        async getInvocationHistory(input = {}) {
          const options = typeof input === "string" ? { sessionId: input } : input;
          const detail = await getSessionDetail(options.sessionId);
          return invocationHistoryFromSessionDetail(detail, options);
        },
        async history(input = {}) {
          return this.getInvocationHistory(input);
        },
        async getState(sessionId) {
          const id = encodeURIComponent(await sessionIdFromToken(sessionId));
          return appFetch(`/portal/api/agent-app/sessions/${id}/state`);
        },
        async saveState(state, sessionId) {
          const id = encodeURIComponent(await sessionIdFromToken(sessionId));
          return appFetch(`/portal/api/agent-app/sessions/${id}/state`, {
            method: "POST",
            body: JSON.stringify({ state }),
          });
        },
        async snapshot(input = {}) {
          return sessionSnapshot(input);
        },
        async connectLive(input = {}) {
          return connectLive(input);
        },
        async submitTurn(input, sessionId) {
          return submitTurn(input, sessionId);
        },
        async submitTurnAndWaitForResult(input, options = {}, sessionId) {
          const before = await getSessionDetail(sessionId);
          const afterResultCount = Array.isArray(before && before.results) ? before.results.length : 0;
          const submitResponse = await submitTurn(input, sessionId);
          await options.onSubmitted?.(submitResponse);
          const taskRunId = taskRunIdOf(submitResponse);
          const turnId = turnIdOf(submitResponse);
          const waited = await waitForResult({
            ...options,
            afterResultCount,
            sessionId: options.sessionId || sessionId,
            taskRunId: options.taskRunId || taskRunId,
            turnId: options.turnId || turnId,
          });
          return { ...waited, submitResponse };
        },
        async waitForResult(options = {}) {
          return waitForResult(options);
        },
      },
      state: {
        async create(input = {}) {
          return createSyncedState(input);
        },
      },
    };
    // drive 命名统一(2026-07-08, 归属+后端双轴): userOssDrive=用户个人网盘(portal cookie 会话,
    // 仅本人, 沙箱内静默失灵) / agentOssDrive=agent 业务盘(app token, 沙箱唯一可用)。
    // 旧名 drive/agentDrive 保留为兼容别名(@deprecated), 与新名指向同一对象, 新代码一律用新名。
    // 三概念对照防混: sdk.userOssDrive=用户盘; sdk.agentOssDrive=agent 盘(OSS, 清单总闸
    // storage.drive→将更名 agentOssDrive); 清单 storage.agentDrive(→agentNasDrive)=NAS 挂载
    // 声明(退役路上, 无外链形态), 与本 SDK 两个盘访问器都不是一回事。
    api.userOssDrive = api.drive;
    api.agentOssDrive = api.agentDrive;
    return api;
  }

  function connectAgentApp(options = {}) {
    if (typeof options.bootstrapToken === "string" && options.bootstrapToken.trim()) {
      return Promise.resolve(createAgentAppClient({
        bootstrapToken: options.bootstrapToken,
        clientEventIdPrefix: options.clientEventIdPrefix,
        fetcher: options.fetcher,
        origin: options.origin || options.context?.centerOrigin,
        targetWindow: options.targetWindow || globalThis.window,
        timeoutMs: options.timeoutMs,
      }));
    }
    if (typeof options.bootstrap === "function") {
      return Promise.resolve(options.bootstrap()).then((payload) => {
        if (!payload || typeof payload.bootstrapToken !== "string" || !payload.bootstrapToken.trim()) {
          throw new Error("WDCloud Agent App bootstrap provider did not return a bootstrap token.");
        }
        return createAgentAppClient({
          bootstrapToken: payload.bootstrapToken,
          clientEventIdPrefix: options.clientEventIdPrefix,
          fetcher: options.fetcher,
          origin: options.origin || payload.context?.centerOrigin,
          targetWindow: options.targetWindow || globalThis.window,
          timeoutMs: options.timeoutMs,
        });
      });
    }
    const targetWindow = options.targetWindow || globalThis.window;
    if (!targetWindow) return Promise.reject(new Error("WDCloud Agent App bootstrap requires a browser window."));
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        targetWindow.removeEventListener("message", onMessage);
        if (timer) clearTimeout(timer);
      };
      const onMessage = (event) => {
        const data = event.data;
        if (!data || data.type !== "wdcloud.bootstrap") return;
        if (typeof data.bootstrapToken !== "string" || !data.bootstrapToken.trim()) {
          cleanup();
          reject(new Error("WDCloud Agent App bootstrap message did not include a bootstrap token."));
          return;
        }
        cleanup();
        resolve(createAgentAppClient({
          bootstrapToken: data.bootstrapToken,
          clientEventIdPrefix: options.clientEventIdPrefix,
          fetcher: options.fetcher,
          origin: options.origin || data.context?.centerOrigin,
          targetWindow,
          timeoutMs: options.timeoutMs,
        }));
      };
      targetWindow.addEventListener("message", onMessage);
      if (options.timeoutMs && options.timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup();
          reject(new Error("Timed out waiting for WDCloud Agent App bootstrap."));
        }, options.timeoutMs);
      }
    });
  }

  globalThis.WDCloudAgentApp = {
    connectAgentApp,
    createAgentAppClient,
  };
})();
