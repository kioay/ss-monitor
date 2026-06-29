import { readFileSync } from "node:fs";
import vm from "node:vm";

const sdkSource = readFileSync("dist/agent-app-sdk.js", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLocalStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function loadSdk(localStorage = createLocalStorage()) {
  const sandbox = {
    BroadcastChannel: undefined,
    DOMException,
    Response,
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    crypto: { randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` },
    fetch: () => Promise.reject(new Error("unexpected global fetch")),
    localStorage,
    location: { origin: "http://center.test" },
    Math,
    setTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(sdkSource, sandbox, { filename: "agent-app-sdk.js" });
  return sandbox.WDCloudAgentApp;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function makeClient({ activeContext = false, readOnly = false, saveDelayMs = 0 } = {}) {
  let remoteState = {
    activeTab: "remote",
    includeBotMessages: true,
    messageLimit: 100,
  };
  const saveCalls = [];
  const presenceCalls = [];
  const seenPaths = [];
  const sdk = loadSdk();
  const fetcher = async (url, options = {}) => {
    const path = new URL(url).pathname;
    seenPaths.push(`${options.method || "GET"} ${path}`);
    if (path === "/portal/api/agent-app/bootstrap/exchange") {
      return jsonResponse({
        accessToken: "app-token",
        context: {
          ...(activeContext ? { activeTaskRunId: "task-active", activeTurnId: "turn-active" } : {}),
          readOnly,
          sessionId: "sess-1",
          userEmail: "tester@example.com",
        },
        scopes: readOnly
          ? ["session.state.read"]
          : ["session.state.read", "session.state.write", "session.presence.read", "session.presence.write", "session.actions.submit"],
      });
    }
    if (path === "/portal/api/agent-app/sessions/sess-1/state" && options.method !== "POST") {
      return jsonResponse({ state: remoteState, stateUpdatedAt: "2026-06-21T00:00:00.000Z" });
    }
    if (path === "/portal/api/agent-app/sessions/sess-1/state" && options.method === "POST") {
      const body = JSON.parse(options.body || "{}");
      saveCalls.push(body.state);
      if (saveDelayMs > 0) await delay(saveDelayMs);
      remoteState = { ...body.state };
      return jsonResponse({ state: remoteState, stateUpdatedAt: new Date().toISOString() });
    }
    if (path === "/portal/api/agent-app/sessions/sess-1/ephemeral" && options.method === "POST") {
      const body = JSON.parse(options.body || "{}");
      presenceCalls.push(body.event);
      return jsonResponse({ ok: true });
    }
    if (path === "/portal/api/agent-app/sessions/sess-1/snapshot") {
      return jsonResponse({
        activeResult: {
          resultId: "result-active",
          structuredResult: { resultMarkdown: "active markdown" },
          taskRunId: "task-active",
          turnId: "turn-active",
        },
        activeTaskRunId: "task-active",
        activeTurnId: "turn-active",
        latestResult: {
          resultId: "result-latest",
          structuredResult: { resultMarkdown: "latest markdown" },
          taskRunId: "task-latest",
          turnId: "turn-latest",
        },
        recentResults: [],
        recentTurns: [],
        revision: 7,
        session: { sessionId: "sess-1" },
        sessionId: "sess-1",
      });
    }
    if (path === "/portal/api/agent-sessions/sess-1") {
      return jsonResponse({
        results: [{ resultId: "legacy-result", taskRunId: "legacy-task" }],
        session: { sessionId: "sess-1" },
        turns: [],
      });
    }
    return jsonResponse({ error: `unexpected ${options.method || "GET"} ${path}` }, 404);
  };
  const client = sdk.createAgentAppClient({
    bootstrapToken: "bootstrap-token",
    fetcher,
    origin: "http://center.test",
  });
  return { client, presenceCalls, saveCalls, seenPaths };
}

async function createUiState(client, overrides = {}) {
  return client.state.create({
    defaults: {
      activeTab: "messages",
      includeBotMessages: false,
      messageLimit: 50,
      promptDraft: "",
    },
    fields: {
      activeTab: { sync: "persistent" },
      includeBotMessages: { sync: "persistent" },
      messageLimit: { sync: "persistent", debounceMs: 25 },
      promptDraft: { sync: "local" },
    },
    live: false,
    saveDebounceMs: 25,
    storageKey: `state-layer-smoke-${Math.random()}`,
    ...overrides,
  });
}

{
  const { client, saveCalls } = makeClient();
  const state = await createUiState(client);
  assert(state.get("activeTab") === "remote", "remote persistent state should win over defaults on init");
  state.set("promptDraft", "typing");
  await delay(40);
  assert(saveCalls.length === 0, "local draft must not save on every input");
  state.set("messageLimit", 200);
  state.set("messageLimit", 300);
  await delay(80);
  assert(saveCalls.length === 1, "persistent controls should debounce into one save");
  assert(saveCalls[0].messageLimit === 300, "debounced save should keep latest value");
  state.destroy();
}

{
  const { client } = makeClient({ readOnly: true });
  const state = await createUiState(client);
  state.set("promptDraft", "local preview");
  assert(state.get("promptDraft") === "local preview", "read-only pages should still allow local state");
  let denied = false;
  try {
    state.set("activeTab", "report");
  } catch (error) {
    denied = /read-only/i.test(String(error?.message || ""));
  }
  assert(denied, "read-only pages must reject persistent writes");
  state.destroy();
}

{
  const { client, saveCalls } = makeClient({ saveDelayMs: 40 });
  const state = await createUiState(client);
  state.set("messageLimit", 101, { save: false });
  const firstSave = state.flush();
  state.set("messageLimit", 202, { save: false });
  await firstSave;
  await delay(80);
  assert(saveCalls.length === 2, "state changed during in-flight save must be saved again");
  assert(saveCalls[0].messageLimit === 101, "first save should contain the first value");
  assert(saveCalls[1].messageLimit === 202, "second save should contain the later dirty value");
  state.destroy();
}

{
  const { client, presenceCalls } = makeClient();
  const presence = await client.presence.create({
    broadcast: false,
    fields: {
      promptDraft: { throttleMs: 10 },
    },
    live: false,
  });
  await presence.publish("promptDraft", "hello");
  assert(presenceCalls.length === 1, "presence field update should be delivered once");
  assert(presenceCalls[0].ephemeral === true, "presence event must be ephemeral");
  assert(presenceCalls[0].type === "presence.field.updated", "field publish should use presence.field.updated type");
  assert(presenceCalls[0].field === "promptDraft", "field publish should include top-level field");
  assert(presenceCalls[0].value === "hello", "field publish should include top-level value");
  presence.close();
}

{
  const { client, seenPaths } = makeClient({ activeContext: true });
  const detail = await client.session.get();
  assert(
    seenPaths.includes("GET /portal/api/agent-app/sessions/sess-1/snapshot"),
    "active context session.get must read app snapshot"
  );
  assert(
    !seenPaths.includes("GET /portal/api/agent-sessions/sess-1"),
    "active context session.get must not fall back to legacy portal session detail"
  );
  assert(
    detail.results.some((result) => result.resultId === "result-active"),
    "snapshot activeResult should be included in session detail results"
  );
  assert(
    detail.results.some((result) => result.resultId === "result-latest"),
    "snapshot latestResult should be included in session detail results"
  );
}

console.log("state-layer smoke passed");
