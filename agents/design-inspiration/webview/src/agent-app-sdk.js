(() => {
  function jsonHeaders() {
    return { "content-type": "application/json" };
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
    const turnId = textValue(options.turnId);
    const taskRunId = textValue(options.taskRunId);
    if (turnId || taskRunId) {
      const resultTurnId = resultTurnIdOf(result);
      const resultTaskRunId = resultTaskRunIdOf(result);
      if ((turnId && resultTurnId !== turnId) || (taskRunId && resultTaskRunId !== taskRunId)) return false;
    }
    if (typeof options.match === "function" && options.match(result)) return true;
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
        headers: {
          ...jsonHeaders(),
          Authorization: `Bearer ${token.accessToken}`,
          ...(init.headers || {}),
        },
      });
      if (response.status === 401) {
        const errorText = await response.text();
        if (isExpiredTokenErrorText(errorText)) {
          resetExchange();
          await requestBootstrapRefresh("expired-access-token");
          const refreshedToken = await exchange();
          return fetcher(`${origin}${path}`, {
            ...init,
            headers: {
              ...jsonHeaders(),
              Authorization: `Bearer ${refreshedToken.accessToken}`,
              ...(init.headers || {}),
            },
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

    async function portalFetch(path, init = {}) {
      await exchange();
      return readJson(await fetcher(`${origin}${path}`, {
        ...init,
        credentials: init.credentials || "same-origin",
        headers: {
          ...jsonHeaders(),
          ...(init.headers || {}),
        },
      }));
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
      const intervalMs = Math.max(100, Number(input.intervalMs || 1800));
      const deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
      while (deadline === undefined || Date.now() < deadline) {
        const detail = await getSessionDetail(input.sessionId);
        await input.onPoll?.(detail);
        assertSubmittedTurnStillRunning(detail, input);
        const results = Array.isArray(detail && detail.results) ? detail.results : [];
        const candidates = results.slice().reverse();
        for (const result of candidates) {
          if (!resultMatches(result, input)) continue;
          return {
            detail,
            result,
            structuredResult: structuredResultOf(result),
          };
        }
        const sleepMs = deadline === undefined ? intervalMs : Math.min(intervalMs, Math.max(1, deadline - Date.now()));
        await sleep(sleepMs, input.signal);
      }
      throw new Error("Timed out waiting for WDCloud Agent App session result after " + timeoutMs + "ms.");
    }

    async function sessionSnapshot(input = {}) {
      const sessionId = typeof input === "string" ? input : input.sessionId;
      const id = encodeURIComponent(await sessionIdFromToken(sessionId));
      const params = new URLSearchParams();
      if (typeof input.sinceRevision === "number") params.set("sinceRevision", String(input.sinceRevision));
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
      events: {
        async list(input = {}) {
          const sessionId = encodeURIComponent(await sessionIdFromToken(input.sessionId));
          const params = new URLSearchParams();
          if (typeof input.afterSeq === "number") params.set("afterSeq", String(input.afterSeq));
          const suffix = params.toString() ? `?${params}` : "";
          return unwrapArray(await appFetch(`/portal/api/agent-app/sessions/${sessionId}/events${suffix}`), "events");
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
          const submitResponse = await submitTurn(input, sessionId);
          await options.onSubmitted?.(submitResponse);
          const taskRunId = taskRunIdOf(submitResponse);
          const turnId = turnIdOf(submitResponse);
          const waited = await waitForResult({
            ...options,
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
