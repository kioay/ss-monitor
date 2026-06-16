import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GameConfig } from "../src/shared";

const credentialFile = path.join(os.tmpdir(), `forum4399-test-${Date.now()}.txt`);
await fs.writeFile(credentialFile, "账号: auto-login-user\n密码: auto-login-password\n", "utf-8");

process.env.FORUM_4399_COOKIE = "Pauth=stale";
process.env.FORUM_4399_CREDENTIAL_FILE = credentialFile;
process.env.MAX_4399_FORUM_LIST_PAGES = "1";
process.env.MAX_4399_FORUM_THREADS_PER_GAME = "1";
process.env.MAX_4399_FORUM_THREADS_TO_DEEP_PARSE = "1";

let loginCount = 0;
let staleCookieUsed = false;
let freshCookieUsed = false;
let relogged = false;

const listHtml = `
<ul>
  <li>
    <div class="listtitle">
      <div class="author"><a title="自动重登测试">自动重登测试</a></div>
      <div class="title">
        <a class="type">[玩家交流]</a>
        <a href="/forums/thread-64549999" class="thread_link">自动重登后采集成功</a>
      </div>
    </div>
    <div class="content clearfix">
      <div class="rtime"><span class="date">刚刚</span></div>
      <p class="text">登录态失效后自动重登。</p>
    </div>
    <div class="lastline"><div class="about"><span class="hot">热度(4)</span><span class="view">102</span><span class="comment">1</span></div></div>
  </li>
</ul>`;

const threadHtml = `
<div class="single_post j-single-post mainPost">
  <div class="post_author"><a class="post_author_name_text">自动重登测试</a></div>
  <div class="post_content">
    <div class="post_title">楼主 发表于 刚刚</div>
    <div class="host_content user_content j-thread-content">自动重登后的帖子正文</div>
  </div>
</div>`;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const cookie = new Headers(init?.headers || {}).get("cookie") || "";

  if (url.includes("/forums/thread-64549999")) {
    assert.match(cookie, /Pauth=fresh/);
    return new Response(threadHtml, { status: 200 });
  }

  if (url.includes("/forums/mtag-81899")) {
    if (cookie.includes("Pauth=stale")) staleCookieUsed = true;
    if (cookie.includes("Pauth=fresh")) freshCookieUsed = true;
    return new Response(relogged ? listHtml : '<form id="login_form"></form>', { status: 200 });
  }

  if (url.includes("/ptlogin/loginFrame.do")) {
    return new Response("", { status: 200, headers: { "set-cookie": "frame=1; Path=/;" } });
  }

  if (url.includes("/ptlogin/verify.do")) {
    return new Response("0", { status: 200 });
  }

  if (url.includes("/ptlogin/login.do")) {
    loginCount += 1;
    relogged = true;
    return new Response("", { status: 200, headers: { "set-cookie": "Pauth=fresh; Path=/;" } });
  }

  throw new Error(`Unexpected fetch: ${url}`);
};

try {
  const { collectForum4399 } = await import("../server/collectors/forum4399");
  const game: GameConfig = {
    id: "ss1",
    name: "生死狙击1",
    shortName: "SS1",
    bilibiliKeywords: [],
    douyinKeywords: [],
    tiebaBars: [],
    tiebaKeywords: [],
    forum4399Tags: ["81899"],
    forum4399Keywords: []
  };

  const result = await collectForum4399(game, new Date(Date.now() - 72 * 3_600_000));
  assert.equal(result.health.ok, true);
  assert.equal(result.health.blocked, false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.source, "forum4399");
  assert.equal(loginCount, 1);
  assert.equal(staleCookieUsed, true);
  assert.equal(freshCookieUsed, true);
} finally {
  globalThis.fetch = originalFetch;
  await fs.rm(credentialFile, { force: true });
}
