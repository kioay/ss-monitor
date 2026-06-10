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

- 外网提示页：http://ss-monitor.qinoay.top/
- 内网平台：http://192.168.8.242:8787/

内网机上的 Node 服务监听 `0.0.0.0:8787`，便于内网用户直接访问。外网机不再承载舆情平台，只保留跳转提示。

## 数据源

- B站视频：按发布时间排序搜索，补充视频详情、简介、评论、弹幕和可用字幕。
- 百度贴吧：读取对应吧最新主题，并按最新回复时间过滤。

## Confluence current-version focus

Internal production on `192.168.8.242` can reach Confluence directly. Set `CONFLUENCE_TOKEN`, `CONFLUENCE_PAGE_ID`, and a persistent `CURRENT_VERSION_FOCUS_CACHE_PATH` such as `/opt/ss-monitor/state/current-version-focus.json` in `/opt/ss-monitor/.env` and mirror them into `/opt/ss-monitor/current/.env` before restarting.

The monitor refresh path calls Confluence from the server, so a daily local-workstation `npm run sync:confluence` job is no longer part of normal production operation. Keep `npm run sync:confluence` only as an explicit manual fallback for environments where the server cannot reach Confluence.

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
- `GET /api/monitor?games=ss1,ss2&windowHours=72&limit=1000&force=1`
- `GET /api/bettafish/lab?windowHours=72`：BettaFish 测试台状态、能力覆盖、导入预览和只读探测。
- `POST /api/bettafish/lab/action`：BettaFish 测试台固定研究操作代理。默认启用；设置 `BETTAFISH_LAB_ACTIONS_ENABLED=false` 可关闭。

## Monitor history retention

The monitor now keeps a lightweight local history file at `data/monitor-history.json` by default. Every refresh merges the latest Bilibili, Tieba, Douyin, and BettaFish items into that history pool, then 7-day and 14-day windows are calculated from the retained pool instead of only the current fetch page.

Relevant configuration:

```bash
MONITOR_HISTORY_PATH=data/monitor-history.json
MONITOR_HISTORY_RETENTION_HOURS=720
MONITOR_HISTORY_MAX_ITEMS=5000
MAX_BILIBILI_SEARCH_PAGES=5
MAX_BILIBILI_VIDEOS_PER_GAME=120
MAX_TIEBA_LIST_PAGES=5
TIEBA_THREADS_PER_PAGE=30
MAX_TIEBA_THREADS_PER_BAR=150
MAX_DOUYIN_ITEMS_PER_GAME=300
MAX_DOUYIN_IMPORTED_ITEMS_PER_GAME=300
MAX_BETTAFISH_IMPORTED_ITEMS_PER_GAME=300
MINDSPIDER_DB_LIMIT=1000
```

`limit` on `/api/monitor` now controls only how many newest rows are returned in `items`; stats, trends, topics, and alerts are calculated from the full selected time window.

## Douyin authorized import

Use this path for Douyin data that you have exported or received through an authorized channel. The importer does not log in to Douyin, bypass anti-bot checks, solve captchas, or call private signed endpoints.

1. Put `.csv` or `.json` files under `data/douyin-imports/` on the machine that runs the monitor. The whole `data/` directory is ignored by Git.
2. Set `DOUYIN_IMPORT_DIR` if the files live elsewhere.
3. Refresh `/api/monitor?...&force=1` or use the frontend refresh button. Imported rows are merged with MindSpider experimental rows and analyzed as `douyin` items.

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

## Douyin experimental crawler takeover

The main Douyin monitor now prefers experimental and authorized sources in this order:

1. MindSpider / MediaCrawler experimental output from `MINDSPIDER_DOUYIN_IMPORT_DIR`. Multiple directories are supported; without an explicit value the monitor also checks BettaFish `MindSpider/DeepSentimentCrawling/MediaCrawler/data` when the repo is detected.
2. MindSpider DB direct reads from `douyin_aweme` and `douyin_aweme_comment` when `MINDSPIDER_DB_*` or `DB_*` is configured. MySQL, PostgreSQL, and SQLite are supported.
3. Douyin authorized API sources.
4. Douyin authorized local imports.

Public Sogou discovery is disabled by default. Set `DOUYIN_PUBLIC_SEARCH_ENABLED=true` only when you explicitly want that fallback.

For DB takeover, configure either `MINDSPIDER_ENV_FILE=/home/yq/BettaFish/MindSpider/.env` or these values in the monitor environment:

```bash
MINDSPIDER_DOUYIN_ENABLED=true
MINDSPIDER_DB_DIALECT=mysql
MINDSPIDER_DB_HOST=127.0.0.1
MINDSPIDER_DB_PORT=3306
MINDSPIDER_DB_USER=...
MINDSPIDER_DB_PASSWORD=...
MINDSPIDER_DB_NAME=mindspider
MINDSPIDER_DOUYIN_TABLE=douyin_aweme
MINDSPIDER_DOUYIN_COMMENTS_TABLE=douyin_aweme_comment
```

For a production machine without a user-managed MySQL/PostgreSQL service, use the SQLite bridge instead:

```bash
MINDSPIDER_DOUYIN_ENABLED=true
MINDSPIDER_DB_DIALECT=sqlite
MINDSPIDER_SQLITE_PATH=/opt/ss-monitor/data/mindspider.sqlite
MINDSPIDER_SQLITE_COMMAND=sqlite3
MINDSPIDER_DOUYIN_TABLE=douyin_aweme
MINDSPIDER_DOUYIN_COMMENTS_TABLE=douyin_aweme_comment
```

If neither DB nor export files are available, the source-health card says that MindSpider has not produced data yet instead of silently falling back to public collection.

## BettaFish / MindSpider integration

BettaFish is a full Python public-opinion system with its own Flask app, Streamlit agents, MindSpider crawler, database, and GPL-2.0 licensing. This platform integrates it as an optional external data source instead of vendoring its code.

1. Run and maintain BettaFish separately, with its own database, LLM keys, cookies, and crawler login state.
2. Export authorized BettaFish or MindSpider rows as `.json` or `.csv` into `data/bettafish-imports/`, or set `BETTAFISH_IMPORT_DIR` to another ignored directory.
3. Optionally set `BETTAFISH_BASE_URL=http://127.0.0.1:5000` so the monitor can show BettaFish `/api/status` health. If a sibling BettaFish repo is present, the test lab auto-detects the repo and defaults the base URL to local port `5000`.
4. Refresh `/api/monitor?...&force=1`. Rows matching SS1/SS2 terms are merged as `bettafish` items and passed through the same sentiment/risk analyzer.

See `examples/bettafish-import.example.json` for supported fields. Common MindSpider tables such as `douyin_aweme`, `bilibili_video`, `xhs_note`, `weibo_note`, `tieba_note`, and `zhihu_content` are mapped by alias.

### BettaFish semantic fusion

The main monitor can now use BettaFish local sentiment models as an auxiliary semantic signal. This is a conservative fusion, not a replacement:

- Existing SS1/SS2 domain rules still make the primary call for player skill shares, help posts, routine player sharing, player-behavior complaints, illegal cheat context, SS1 weapon names, and current-version focus.
- BettaFish models are batch-run after collection through `scripts/bettafish-semantic-bridge.py`, so the model loads once per refresh instead of once per item.
- BettaFish high-confidence positive/negative output can adjust sentiment score and add a supporting reason, but it cannot create high risk by itself.
- If BettaFish, Python, or model dependencies are unavailable, the monitor logs the issue and falls back to the existing analyzer.

Configuration:

```bash
BETTAFISH_SEMANTIC_ENABLED=true
BETTAFISH_SEMANTIC_MODELS=bayes
BETTAFISH_SEMANTIC_MAX_ITEMS=80
BETTAFISH_SEMANTIC_TIMEOUT_MS=15000
```

`svm` and `xgboost` can be added to `BETTAFISH_SEMANTIC_MODELS` when the BettaFish Python environment has compatible `scikit-learn` / `xgboost` versions. Full BettaFish production deployments set this to `svm,bayes,xgboost`.

For production, deploy the full BettaFish runtime tree:

```bash
npm run sync:bettafish-full
```

Configure `SYNC_BETTAFISH_FULL_REMOTE`, `SYNC_BETTAFISH_FULL_SSH_PORT`, `SYNC_BETTAFISH_FULL_PASSWORD`, and `SYNC_BETTAFISH_FULL_LOCAL_REPO` in `.env.local` or the shell. The sync installs BettaFish under `/opt/BettaFish/current`, creates `bettafish-full.service`, installs Python dependencies into `/opt/BettaFish/.venv`, starts the Flask API on `127.0.0.1:5000`, and updates `/opt/ss-monitor/.env` so the monitor uses the full runtime via `BETTAFISH_BASE_URL`, `BETTAFISH_REPO_DIR`, and `BETTAFISH_PYTHON`. By default it clones the exact upstream Git revision with MediaCrawler submodules on the production server, leaving `.git`, `.github`, and tracked training datasets available for completeness checks. It then installs `SYNC_BETTAFISH_FULL_SEMANTIC_DEP_PACKAGES` so the legacy `svm,bayes,xgboost` pickle models load with their compatible `numpy` / `scikit-learn` / `xgboost` versions.

The full sync includes BettaFish app code, Agent engines, ReportEngine, MindSpider, MediaCrawler code, templates, static assets, tracked training datasets, and model weights. It still keeps `.env`, browser profiles, cookies, crawler output, downloaded media, generated runtime reports, and caches out of deployment archives/state by default. Only set `SYNC_BETTAFISH_FULL_INCLUDE_RUNTIME_STATE=true` when intentionally moving runtime state.

During full sync, the deployment applies a small set of production compatibility patches after cloning upstream: `/api/config` responses redact secret-like values, ForumEngine status is refreshed from its in-process monitor thread, Streamlit Agent apps bind to `127.0.0.1`, MindSpider generates MediaCrawler DB config from runtime environment variables instead of embedding credentials, and MediaCrawler's default DB config reads the same environment variables. MediaCrawler profile/data/temp directories remain runtime state and are not part of the reproducible code patch set.

The older semantic-only sync remains available for emergency rollback or very small servers:

```bash
npm run sync:bettafish-semantic
```

Configure `SYNC_BETTAFISH_REMOTE`, `SYNC_BETTAFISH_SSH_PORT`, `SYNC_BETTAFISH_PASSWORD`, and `SYNC_BETTAFISH_ROOT_PASSWORD` in `.env.local`. The sync uploads `utils.py`, `data/stopwords.txt`, and the selected pickle model files under `/opt/BettaFish/SentimentAnalysisModel/WeiboSentiment_MachineLearning/`; it does not upload browser profiles, cookies, crawler media, or training data. By default it installs a small Python venv at `/opt/BettaFish/.venv` with `numpy<2`, `scipy<1.14`, `scikit-learn==0.24.2`, and `jieba==0.42.1`.

The frontend also has a separate `BettaFish 测试台` tab. It keeps BettaFish outside the main monitor pipeline, but can now test every major integration surface:

- SS1/SS2 game monitoring snapshots that reuse the current collector, semantic analysis, risk classification, source health, topics, alerts, and latest-feed logic without sending notifications.
- Query / Media / Insight Agent start, stop, output probing, and `/api/search`.
- ForumEngine start, stop, and log reading.
- ReportEngine status, template/log probing, report generation, progress, result JSON, and cancellation.
- MindSpider export import, login-state directory inspection, CLI status, database table/stat probing, DB initialization, and test-mode crawler scheduling.
- BettaFish sentiment model or LLM analysis through `BETTAFISH_SENTIMENT_COMMAND` or the running Agent stack.
- Local BettaFish start/stop, full-system start/shutdown, and an optional fixed deploy command.

The test lab exposes only fixed research operations defined by the server, such as log/progress/status probes, Agent start/search, MindSpider test crawling, report generation, and optional deployment. These operations are enabled by default for the academic research test bench; set `BETTAFISH_LAB_ACTIONS_ENABLED=false` to close the operation surface on a deployment that should be read-only.

## Local Douyin CDP sync

Douyin collection can run in two supported modes. The default mode still runs on the local workstation with BettaFish / MediaCrawler CDP profile persistence and uploads only lightweight JSON exports. When explicitly authorized, `npm run douyin:server-login -- sync-cookie` copies the local Douyin login cookie string into the internal server's ignored BettaFish `.env` files as `DOUYIN_COOKIES_B64`, matching MediaCrawler's upstream `--lt cookie` login path without copying browser profiles, downloaded media, or crawler caches.

One manual sync:

```powershell
.\scripts\sync-local-douyin-cdp.ps1 -InstallDependencies -Force
```

By default this sync exports the last 14 days and up to 300 rows per game. Override with `-RetentionDays` or `-MaxItemsPerGame` only when you intentionally want a smaller export.

After the first successful run, omit `-InstallDependencies`; the script will reuse `BettaFish\.venv-mediacrawler` when it exists.

Run the sync manually when Douyin data needs to be refreshed. The project no longer registers a local Windows scheduled task because hidden workstation tasks are hard to maintain. `sync-local-douyin-cdp.ps1` still includes daytime/night throttling for manual or explicitly managed external schedulers. It writes the local export to `data/mindspider-douyin-imports/local-cdp/latest.json` and uploads the same file to:

```text
/opt/ss-monitor/data/mindspider-douyin-imports/local-cdp/latest.json
```

Production already reads `/opt/ss-monitor/data/mindspider-douyin-imports` through `MINDSPIDER_DOUYIN_IMPORT_DIR`.

The sync script preflights BettaFish / MediaCrawler before every crawl:

- `ENABLE_CDP_MODE=True` so Douyin runs through the local Chrome/Edge CDP session.
- `SAVE_LOGIN_STATE=True` so the profile under `MediaCrawler/browser_data/cdp_dy_user_data_dir` keeps the login state across runs.
- `ENABLE_GET_MEIDAS=False` so large images/videos are not downloaded or synced.

Only the normalized JSON export is uploaded in local-CDP mode. In server-cookie mode, only the compact cookie string is stored in `/opt/BettaFish/.env` and `/opt/BettaFish/current/.env`; browser profiles, raw crawler state, images, and videos remain out of Git and deployment archives.
