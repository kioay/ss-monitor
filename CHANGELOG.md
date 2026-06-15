# 更新日志

## 2026-06-15

- Released `v0.1.8` with supplemental keyword management for production monitor operators.
- Added manual supplemental keyword add/remove/clear controls and URL persistence for shared views.
- Added keyword effectiveness summaries based on actual fetched public-opinion hits, including effective, weak, no-match, and pending states.
- Refined the keyword UI into an independent entry button with an external summary and a dedicated management panel.
- Hardened Douyin noVNC remote-login setup so release deployments can better adapt service users, systemd paths, sudoers paths, and dynamic host routing.

## 2026-06-12

- Released `v0.1.7` with the runtime risk-backtest gate enabled before monitor judgements are returned.
- Expanded risk backtests to 12 cases, including playful “不准！我们一起继续刷” reply false-positive guards.
- Fixed the short “准” praise-token path so `不准` / `瞄准` / `标准` contexts do not become negative sentiment.
- Added `analysisVersion=3` response/cache gating so stale v2 monitor snapshots, history, and browser cache do not keep old risk judgements alive.
- Added a production Douyin status API and topbar warning for login-state or crawl failures.
- Added a server-side noVNC remote-login path so operators can open the production MediaCrawler browser profile when Douyin login needs manual verification.
- Added a release-bundled Douyin noVNC setup script and topbar guidance so operators can generate the default remote-login entry from the deployed package.
- Added deployment documentation for the Douyin remote-login unit, sudoers boundary, noVNC paths, and verification commands.
- Hardened release archive generation so deploy archives require a clean Git working tree and always bundle a freshly generated `dist/`.
- Expanded generated GitHub Release notes with copy-paste deployment, upgrade, verification, and troubleshooting steps.
- Added Douyin login-state and noVNC remote-login setup instructions to generated GitHub Release notes.
- Added Confluence current-version focus and keyword refresh setup instructions to generated GitHub Release notes.
- Added DingTalk daily-report robot setup instructions and no-test-message guardrails to generated GitHub Release notes.

## 2026-06-08

- Added a monitor history pool so 7-day and 14-day Bilibili, Tieba, Douyin, and BettaFish windows are calculated from retained seen items instead of only the current fetch page.
- Added bounded Bilibili and Tieba pagination so forced refreshes can backfill more of the selected 7-day and 14-day windows.
- Changed `/api/monitor` list limits so stats, trends, topics, and alerts use the full selected window; `limit` now only caps returned latest-feed rows.

## 2026-05-22

### 数据采集与新鲜度

- 接入抖音公开来源舆情采集，补充 B站、贴吧之外的信息来源。
- 优化 B站相关性过滤，减少 CF 等非《生死狙击》内容误入。
- 新增 Confluence 当前版本重点同步机制：
  - 本机每日从内网 Confluence 获取最新版本计划及下级页面内容。
  - 重点识别当前版本武器、皮肤、玩法等内容。
  - 生产服务器不直连内网，只接收本机同步的轻量 JSON 缓存。
- 新增 SS1 武器名称学习与保护词机制，避免把武器名误判为外挂或风险词，例如“命运透视”。

### 语义与情绪判定

- 优化评论区语义参与情绪判断，避免只看标题或互动量误判。
- 识别 UP 主技术展示、炫技语境，避免把高互动技术视频误判为负面。
- 加强外挂、内存宏、脚本、QQ群引流、外挂演示等非法行为识别。
- 优化“游戏环境询问”语境，玩家询问环境或回游不再直接判为官方负面舆情。
- 新增“玩家行为争议”识别：玩家骂其他玩家堵人、扔武器、报复等，不再按官方负面舆情提级。
- SS1 专用武器名和当前版本重点仅作用于 SS1，不同步到 SS2；通用语义优化同时应用到 SS1 和 SS2。

### 钉钉机器人推送

- 新增 SS1 钉钉机器人推送。
- 新增 SS2 钉钉机器人推送，并保持与 SS1 一致的格式。
- 新增 15 分钟批量推送机制，避免新增舆情立即刷屏。
- 新增高风险持续预警机制，并调整为仅白天 10:00、16:00 推送。
- 高风险内容始终保留预警，但排除了低风险内容进入 72 小时列表。
- 优化推送排序：高风险优先，其次按时间排序。
- 优化推送排版：
  - 使用表格展示。
  - 高风险、中风险、正负面等使用颜色标注。
  - 简报精简，只保留“高风险”和“情绪”两行。
  - 暂时移除 72 小时舆情简报，降低信息密度。
- 降低测试消息频率，并明确规则：未要求时不主动发送钉钉测试消息。

### 前端体验与图表

- 优化页面视觉表现，提升高级感，同时避免大量黑色。
- 修复折线图显示异常、趋势线显示不全、底部被截断等问题。
- 修复趋势线进入白底区域的问题。
- 折线图支持负面、中性、正面，而不只是总声量。
- 图表顶部颜色标签支持点击筛选。
- 筛选按钮出画时自动转为悬浮操作区。
- 优化 7 天、14 天窗口下的图表展示。
- 降低来源状态信息的视觉权重，避免次要信息占据过大篇幅。
- 点击顶部数字指标可快速跳转到对应列表或筛选结果。
- 修复图片裂开问题，使用代理流式加载，不在服务器存储大量图片。

### 性能与稳定性

- 优化前端筛选和刷新速度。
- 首次打开网页提速：
  - 前端增加本地缓存，跨标签页保留短期数据。
  - 后端新增舆情快照缓存，冷启动时先返回上次采集结果，再后台刷新。
  - 生产预热后首屏 API 响应约 0.76 秒。
- 修复网页打不开问题，部署流程改为包含前端构建产物，避免生产缺少 `dist`。
- 新增部署归档脚本，确保每次发布包含最新前端资源。

### 部署、运维与规则

- 项目已部署到 `ss-monitor.qinoay.top`，避免在平台中暴露服务器 IP。
- 针对 20G 硬盘新增清理机制：
  - 清理旧发布包。
  - 清理临时部署文件。
  - 控制日志和 npm 缓存。
  - 不落盘存储大量图片。
- 项目已同步到 GitHub：`https://github.com/kioay/ss-monitor.git`。
- 项目规则已补充：
  - 每次迭代完成后必须检查、提交、推送 Git。
  - 敏感信息不得提交。
  - 不主动发送钉钉测试消息。
  - Confluence 内容由本机同步到生产。
