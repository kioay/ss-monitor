import assert from "node:assert/strict";
import {
  forum4399TextMatchesKeywords,
  parseForum4399Date,
  parseForum4399ListItems,
  parseForum4399ThreadPosts
} from "../server/collectors/forum4399";

const now = new Date(2026, 5, 16, 16, 30, 0);

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
      <div class="author"><a title="游戏小助手">游戏小助手</a></div>
      <div class="title">
        <a href="/forums/thread-63603125"><span class="totop s4">顶</span></a>
        <a href="/forums/thread-63603125" class="thread_link">游戏防诈骗提醒</a>
      </div>
    </div>
  </li>
</ul>`;

const candidates = parseForum4399ListItems(listHtml, "81899", now);
assert.equal(candidates.length, 1);
assert.equal(candidates[0]?.tid, "64548496");
assert.equal(candidates[0]?.author, "纯爱雾霭");
assert.equal(candidates[0]?.category, "[玩家交流]");
assert.equal(candidates[0]?.views, 102);
assert.equal(candidates[0]?.replyCount, 1);
assert.equal(candidates[0]?.heat, 4);
assert.equal(candidates[0]?.latestAt?.getTime(), now.getTime() - 8 * 60_000);

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
