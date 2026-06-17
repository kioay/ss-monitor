import assert from "node:assert/strict";
import {
  forum4399TextMatchesGameContext,
  forum4399TextMatchesKeywords,
  parseForum4399Date,
  parseForum4399ListItems,
  parseForum4399ThreadPosts
} from "../server/collectors/forum4399";
import type { GameConfig } from "../src/shared";

const now = new Date(2026, 5, 16, 16, 30, 0);
const ss1Game: Pick<GameConfig, "id" | "name" | "shortName"> = {
  id: "ss1",
  name: "生死狙击1",
  shortName: "SS1"
};

const listHtml = `
<ul>
  <li>
    <div class="listtitle ">
      <div class="author"><a href="/3508457097" title="纯爱雾霭">纯爱雾霭</a></div>
      <div class="title">
        <a href="/forums/thread-64548496"><i class="light"></i></a>
        <a class="type" href="/forums/mtag-81899-1042">[玩家交流]</a>
        <a href="/forums/thread-64548496" class="thread_link">滚利这块。。。。。。但感觉还不够还清未来商城的...</a>
      </div>
    </div>
    <div class="content clearfix">
      <div class="rtime"><span class="date">8分钟前</span><a class="comment" title="娃哈哈12">娃哈哈12</a></div>
      <p class="text">从不常玩开始，我就只是签到滚利了，可是感觉还不够。</p>
    </div>
    <div class="imglist j-img"><img src="https://fs.img4399.com/bbs/202606/16/sample.png~340x240"></div>
    <div class="lastline"><div class="about"><span class="hot">热度(4)</span><span class="view">102</span><span class="comment">1</span></div></div>
  </li>
  <li>
    <div class="listtitle ">
      <div class="author"><a title="生死狙击版务">生死狙击版务</a></div>
      <div class="title">
        <a class="type" href="/forums/mtag-81899-1001">[公告]</a>
        <a href="/forums/thread-64548555" class="thread_link">4399生死狙击 官方水楼&群组水贴管理说明</a>
      </div>
    </div>
    <div class="content clearfix">
      <div class="rtime"><span class="date">4分钟前</span><a class="comment" title="玩家A">玩家A</a></div>
      <p class="text">主题集中在匹配平衡和群组管理。</p>
    </div>
    <div class="lastline"><div class="about"><span class="hot">热度(8)</span><span class="view">299</span><span class="comment">6</span></div></div>
  </li>
  <li>
    <div class="listtitle ">
      <div class="author"><a title="玩家甲">玩家甲</a></div>
      <div class="title">
        <a class="type" href="/forums/mtag-81899-1042">[玩家交流]</a>
        <a href="/forums/thread-64548666" class="thread_link">官方能不能处理一下外挂</a>
      </div>
    </div>
    <div class="content clearfix">
      <div class="rtime"><span class="date">12分钟前</span><a class="comment" title="玩家B">玩家B</a></div>
      <p class="text">举报了几次都没反馈。</p>
    </div>
    <div class="lastline"><div class="about"><span class="hot">热度(3)</span><span class="view">45</span><span class="comment">2</span></div></div>
  </li>
  <li>
    <div class="listtitle ">
      <div class="author"><a title="游戏小助手">游戏小助手</a></div>
      <div class="title">
        <a href="/forums/thread-64548777" class="thread_link">游戏防诈骗提醒</a>
      </div>
    </div>
    <div class="content clearfix">
      <div class="rtime"><span class="date">15分钟前</span></div>
      <p class="text">请注意账号安全。</p>
    </div>
  </li>
  <li>
    <div class="listtitle ">
      <div class="author"><a title="游戏小助手">游戏小助手</a></div>
      <div class="title">
        <a href="/forums/thread-63603125"><span class="totop s4">顶</span></a>
        <a href="/forums/thread-63603125" class="thread_link">游戏防诈骗提醒</a>
      </div>
    </div>
  </li>
</ul>`;

const candidates = parseForum4399ListItems(listHtml, "81899", now);
assert.equal(candidates.length, 2);
assert.deepEqual(candidates.map((candidate) => candidate.tid), ["64548496", "64548666"]);
assert.equal(candidates[0]?.tid, "64548496");
assert.equal(candidates[0]?.author, "纯爱雾霭");
assert.equal(candidates[0]?.category, "[玩家交流]");
assert.equal(candidates[0]?.views, 102);
assert.equal(candidates[0]?.replyCount, 1);
assert.equal(candidates[0]?.heat, 4);
assert.equal(candidates[0]?.latestAt?.getTime(), now.getTime() - 8 * 60_000);
assert.equal(candidates[1]?.author, "玩家甲");
assert.equal(candidates[1]?.title, "官方能不能处理一下外挂");

const threadHtml = `
<div class="single_post j-single-post mainPost">
  <div class="post_author"><a class="post_author_name_text">1382957619</a></div>
  <div class="post_content">
    <div class="post_title">这个游戏现在怎么玩 楼主 发表于 21小时前 江西</div>
    <div class="host_content user_content j-thread-content">听说怀旧服上了，咋全是宏狗</div>
  </div>
</div>
<div class="single_post j-single-post">
  <div class="post_author"><a class="post_author_name_text">泛清波摘遍</a></div>
  <div class="post_content">
    <div class="post_title">发表于 2026-06-15 03:05:45 福建 沙发</div>
    <div class="main_content user_content">开挂的太多了现在</div>
    <ul class="post_replies">
      <li class="comment_li">浙江的希望 ： 强烈要求削弱破鸿 (2026-06-15 11:28:11) 浙江 回复 | 举报</li>
    </ul>
  </div>
</div>`;

const posts = parseForum4399ThreadPosts(threadHtml, now);
assert.equal(posts.length, 3);
assert.equal(posts[0]?.floor, 1);
assert.equal(posts[0]?.publishedAt?.getTime(), now.getTime() - 21 * 3_600_000);
assert.equal(posts[1]?.floor, 2);
assert.equal(posts[1]?.publishedAt?.getFullYear(), 2026);
assert.equal(posts[2]?.text.includes("强烈要求削弱破鸿"), true);

assert.equal(parseForum4399Date("刚刚", now)?.getTime(), now.getTime());
assert.equal(parseForum4399Date("昨天 12:00", now)?.getDate(), 15);
assert.equal(forum4399TextMatchesKeywords("逆战吧里提到生死狙击", ["生死狙击"]), true);
assert.equal(forum4399TextMatchesKeywords("普通论坛日常", ["生死狙击"]), false);
assert.equal(
  forum4399TextMatchesGameContext("空悲切，小号五把定级赛输4把\n简介：最后就定了个b+\n正文：高手", ss1Game),
  false
);
assert.equal(forum4399TextMatchesGameContext("滚利这块但感觉还不够还清未来商城的，从不常玩开始只是签到滚利", ss1Game), true);
assert.equal(forum4399TextMatchesGameContext("生死狙击高手\n直播切片", ss1Game), true);
assert.equal(forum4399TextMatchesGameContext("排位定级赛输4把，破鸿怎么打", ss1Game), true);
