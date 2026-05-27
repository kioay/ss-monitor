# 生死狙击舆情监测平台

面向《生死狙击1》和《生死狙击2》的本地网络舆情监测工作台。

## 运行

```bash
npm install
npm run dev
```

前端：http://127.0.0.1:5173/

后端：http://127.0.0.1:8787/

## 生产访问

生产环境使用域名访问：

- http://ss-monitor.qinoay.top/

服务器上 Node 服务只监听 `127.0.0.1:8787`，由 Nginx 按域名反向代理。不要把生产访问地址写成裸 IP 或 `:8787` 端口。

Nginx 规则模板见 `scripts/ss-monitor.nginx.conf`：未知 Host / 裸 IP 默认返回 `444`，避免把平台暴露在 IP 入口上。

## 数据源

- B站视频：按发布时间排序搜索，补充视频详情、简介、评论、弹幕和可用字幕。
- 百度贴吧：读取对应吧最新主题，并按最新回复时间过滤。

## 更新与新鲜度策略

- 默认只展示最近 72 小时信息，前端可切换到 24 小时、7 天或 14 天。
- 日间每 1 小时自动更新 1 次。
- 夜间 `00:00-08:00` 降低为每 4 小时自动更新 1 次。
- 平台顶部会标注当前更新频率、夜间时段和下次自动更新时间。
- 后端会按 `freshnessCutoff` 丢弃窗口外内容。
- 刷新按钮会强制重新采集，不受自动更新频率限制。
- 采集失败不会用旧数据或假数据补位，来源健康卡会显示异常原因。

## 风控配置

复制 `.env.example` 为 `.env` 后可配置：

```bash
DAY_UPDATE_INTERVAL_MINUTES=60
NIGHT_UPDATE_INTERVAL_MINUTES=240
NIGHT_START_HOUR=0
NIGHT_END_HOUR=8
BILIBILI_COOKIE=
BAIDU_COOKIE=
```

B站或贴吧触发风控时，把浏览器中对应站点的 Cookie 放入 `.env`，然后重启后端。

## 接口

- `GET /api/config`
- `GET /api/health`
- `GET /api/monitor?games=ss1,ss2&windowHours=72&limit=120&force=1`

## Douyin authorized import

Use this path for Douyin data that you have exported or received through an authorized channel. The importer does not log in to Douyin, bypass anti-bot checks, solve captchas, or call private signed endpoints.

1. Put `.csv` or `.json` files under `data/douyin-imports/` on the machine that runs the monitor. The whole `data/` directory is ignored by Git.
2. Set `DOUYIN_IMPORT_DIR` if the files live elsewhere.
3. Refresh `/api/monitor?...&force=1` or use the frontend refresh button. Imported rows are merged with public search results and analyzed as `douyin` items.

Recommended CSV headers:

```csv
gameId,title,url,author,publishedAt,description,comments,likes,commentsCount,shares,views
ss1,Example title,https://www.douyin.com/video/123456,Creator,2026-05-23T10:00:00+08:00,Caption text,"comment one|comment two",120,18,5,3000
```

JSON can be either an array or `{ "items": [...] }`. Supported aliases include `awemeId`, `videoId`, `caption`, `desc`, `nickname`, `createTime`, `likeCount`, `commentCount`, `shareCount`, `playCount`, `tags`, `comments`, `danmaku`, `subtitles`, and `contentParts`.

## Douyin authorized API sources

Use `DOUYIN_AUTHORIZED_SOURCES_PATH` for APIs from Douyin Open Platform, 巨量算数, or an authorized data vendor. Copy `examples/douyin-authorized-sources.example.json` to `data/douyin-authorized-sources.json`, enable the relevant source, and keep real endpoints/tokens in `.env` or another ignored server-side secret store.

Each source fetches JSON and maps rows into the same Douyin sentiment shape used by file imports:

```json
{
  "sources": [
    {
      "id": "vendor-feed",
      "enabled": true,
      "urlEnv": "DOUYIN_VENDOR_ENDPOINT",
      "tokenEnv": "DOUYIN_VENDOR_TOKEN",
      "rowsPath": "items",
      "fieldMap": {
        "gameId": "game_id",
        "sourceItemId": "aweme_id",
        "title": "title",
        "description": "summary",
        "url": "url",
        "publishedAt": "publish_time",
        "comments": "comments",
        "likes": "like_count"
      }
    }
  ]
}
```

Notes:
- Douyin Open Platform access requires app approval, user authorization, and the relevant scopes such as comment/data permissions.
- 巨量算数 and third-party vendors should provide an authorized API or export endpoint; map their response fields through `fieldMap`.
- The monitor only reads authorized JSON endpoints. It does not perform login automation, captcha handling, private signature generation, or anti-bot bypass.

## BettaFish / MindSpider integration

BettaFish is a full Python public-opinion system with its own Flask app, Streamlit agents, MindSpider crawler, database, and GPL-2.0 licensing. This platform integrates it as an optional external data source instead of vendoring its code.

1. Run and maintain BettaFish separately, with its own database, LLM keys, cookies, and crawler login state.
2. Export authorized BettaFish or MindSpider rows as `.json` or `.csv` into `data/bettafish-imports/`, or set `BETTAFISH_IMPORT_DIR` to another ignored directory.
3. Optionally set `BETTAFISH_BASE_URL=http://127.0.0.1:5000` so the monitor can show BettaFish `/api/status` health. The monitor does not start BettaFish or trigger crawlers.
4. Refresh `/api/monitor?...&force=1`. Rows matching SS1/SS2 terms are merged as `bettafish` items and passed through the same sentiment/risk analyzer.

See `examples/bettafish-import.example.json` for supported fields. Common MindSpider tables such as `douyin_aweme`, `bilibili_video`, `xhs_note`, `weibo_note`, `tieba_note`, and `zhihu_content` are mapped by alias.
