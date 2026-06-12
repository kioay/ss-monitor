# SS Monitor 舆情监测平台

SS Monitor 是可部署在内网机上的项目舆情监测工作台。默认内置《生死狙击1》和《生死狙击2》模板，也可以通过服务器本地配置改成任意项目，例如《失控进化》。它把 B 站、贴吧、授权抖音数据、BettaFish / MindSpider 输出和可选的 Confluence 当前版本重点融合到一个 Web 页面里，供运营和项目成员在内网查看趋势、风险、话题和每日简报。

当前生产形态是内网机部署：Node 服务同时提供 API 和已经构建好的前端静态资源，公网入口不再承载完整平台。真实内网地址、机器人 webhook、站点 cookie、数据库密码、Confluence token、LLM key 等只保存在服务器本地环境文件或受控密钥系统中，不写入 Git、README、Issue、Release note 或部署归档。

## 功能概览

- 监控一个或多个自定义项目的 B 站视频、贴吧主题、授权抖音数据和 BettaFish / MindSpider 导入数据。
- 默认展示最近 72 小时，可切换 24 小时、7 天和 14 天窗口。
- 后端保留轻量历史池，7 天和 14 天统计不再只依赖当前抓取页。
- 日间默认每 60 分钟刷新，夜间默认每 240 分钟刷新；手动刷新会强制重新采集。
- Confluence 当前版本重点由生产服务器直接刷新，失败时使用本地缓存。
- BettaFish 语义结果只作为辅助信号，不替代 SS1 / SS2 领域规则，也不会单独制造高风险结论。
- DingTalk 只发送计划内每日简报；不会主动发送测试消息或新条目即时推送。

## 本地开发

要求 Node.js 20+。

```bash
npm ci
cp .env.example .env
npm run dev
```

开发地址：

- 前端：`http://127.0.0.1:5173/`
- 后端：`http://127.0.0.1:8787/`

`.env.example` 只包含空占位和安全默认值。复制为 `.env` 后按需填入本机 cookie、授权 API、Confluence、DingTalk、BettaFish 或数据库配置；不要把真实值提交到 Git。

## Release 快速部署

GitHub Release 应附带由 `scripts/create-deploy-archive.ps1` 生成的 `ss-monitor-<version>.tar.gz`。这个归档包含 Git 源码快照和最新 `dist/`，目标服务器不需要安装前端构建依赖来生成页面资源。

在一台新的 Linux 内网机上部署类似站点：

```bash
sudo mkdir -p /opt/ss-monitor/releases/ss-monitor-<version>
sudo mkdir -p /opt/ss-monitor/state /opt/ss-monitor/data
sudo tar -xzf ss-monitor-<version>.tar.gz -C /opt/ss-monitor/releases/ss-monitor-<version>
sudo ln -sfn /opt/ss-monitor/releases/ss-monitor-<version> /opt/ss-monitor/current

cd /opt/ss-monitor/current
npm ci --omit=dev
sudo cp .env.example /opt/ss-monitor/.env
sudo cp /opt/ss-monitor/.env /opt/ss-monitor/current/.env
```

编辑 `/opt/ss-monitor/.env`，填入本机允许使用的真实配置；然后再次镜像到当前 release：

```bash
sudo cp /opt/ss-monitor/.env /opt/ss-monitor/current/.env
```

如果直接给内网用户访问，可把 `HOST` 设为 `0.0.0.0`；如果前面有 nginx 或其他反向代理，建议让应用监听 `127.0.0.1`，由代理暴露站点。生产默认端口是 `8787`。

### 自定义监控项目

不配置时，系统使用内置 SS1 / SS2 默认项目。其他人部署自己的站点时，不需要改源码，可以在 `/opt/ss-monitor/.env` 中写入 `MONITOR_GAMES_JSON`，或把同样的 JSON 保存为服务器本地文件并设置 `MONITOR_GAMES_PATH`。

最小可运行配置示例：

```env
PORT=8787
HOST=0.0.0.0
BETTAFISH_SEMANTIC_ENABLED=false
MINDSPIDER_DOUYIN_ENABLED=false
MONITOR_GAMES_JSON=[{"id":"out-of-control","name":"失控进化","shortName":"失控进化","bilibiliKeywords":["失控进化"],"douyinKeywords":["失控进化"],"tiebaBars":["失控进化"]}]
```

也可以使用文件形式：

```bash
sudo cp /opt/ss-monitor/current/examples/monitor-games.example.json /opt/ss-monitor/data/monitor-games.json
sudo sed -i 's#^MONITOR_GAMES_PATH=.*#MONITOR_GAMES_PATH=/opt/ss-monitor/data/monitor-games.json#' /opt/ss-monitor/.env
sudo cp /opt/ss-monitor/.env /opt/ss-monitor/current/.env
sudo systemctl restart ss-monitor
```

项目配置字段：

- `id`：API 使用的稳定项目 id，只使用英文字母、数字、`-` 或 `_`，例如 `out-of-control`。
- `name`：页面展示名，例如 `失控进化`。
- `shortName`：筛选按钮和日报里使用的短名。
- `bilibiliKeywords`：B 站搜索关键词。
- `douyinKeywords`：抖音授权数据、MindSpider 数据和公开搜索的匹配关键词。
- `tiebaBars`：贴吧吧名，不带“吧”字。

改完 `/opt/ss-monitor/.env` 后，记得同步到 `/opt/ss-monitor/current/.env` 并重启服务。

一个最小 systemd 服务示例：

```ini
[Unit]
Description=SS Monitor
After=network.target

[Service]
WorkingDirectory=/opt/ss-monitor/current
EnvironmentFile=/opt/ss-monitor/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

部署更新时保持 `/opt/ss-monitor/.env` 作为配置基线，并在重启前同步到 `/opt/ss-monitor/current/.env`。不要只改 release 目录里的 `.env`，否则下次切换版本时容易丢失配置。

## 生成 Release 归档

维护者在发布前应先完成本地检查，再生成归档：

```powershell
npm ci
npm run lint
npm run test:search
npm run test:topic-bars
npm run test:monitor-history
npm run test:custom-games-config
npm run test:douyin-game-routing
npm run test:risk-alerts
npm run test:dingtalk-daily-markdown
npm run test:semantic-guard
.\scripts\create-deploy-archive.ps1 -OutputPath "$env:TEMP\ss-monitor-<version>.tar.gz"
```

`create-deploy-archive.ps1` 会先执行 `npm run build`，再把 Git 归档和新生成的 `dist/` 打进压缩包。归档文件本身、`.env*`、`data/`、`node_modules/`、浏览器 profile、cookie、缓存、媒体下载和报告输出都不应进入 Git。

## 关键配置

常用配置在 `.env.example` 中维护。部署时通常只需要关注这些类别：

- 服务监听：端口、监听地址、日夜刷新频率、默认时间窗口。
- 监控项目：`MONITOR_GAMES_JSON` 或 `MONITOR_GAMES_PATH`，用于替换默认 SS1 / SS2 项目。
- 基础采集：B 站和贴吧 cookie，可留空；被风控时再在服务器本地配置。
- 当前版本重点：Confluence 页面和访问凭证，只放在服务器本地。
- 抖音数据：优先使用授权导出、授权 API、MindSpider / MediaCrawler 输出或数据库读取。
- BettaFish：完整运行时独立维护在本项目之外，本项目只读取它的状态、导出数据或本地语义模型结果。
- DingTalk：只配置每日简报机器人；测试接口仅允许本机访问。
- 状态文件：建议放在 `/opt/ss-monitor/state` 或 `/opt/ss-monitor/data`，并保持目录不入 Git。

## 数据源说明

### B 站和贴吧

默认尝试公开页面和接口。若触发安全验证，可在服务器本地 `.env` 中配置对应站点 cookie 后重启服务。cookie 是敏感信息，不要写进文档、代码、Release note 或聊天记录。

### Confluence 当前版本重点

内网生产机可以直接访问 Confluence 时，由服务端刷新当前版本重点并写入缓存。无法直连 Confluence 的环境可以手动运行同步脚本作为备用方案。

### 抖音

主流程只读取授权来源或 BettaFish / MindSpider 产物，不实现验证码绕过、私有签名生成或未授权反爬规避。可用来源顺序：

1. MindSpider / MediaCrawler 导出的 JSON、CSV 或 JSONL。
2. MindSpider 数据库中的抖音作品和评论表。
3. 授权 API 源，配置文件可参考 `examples/douyin-authorized-sources.example.json`。
4. 本地授权导入目录中的 CSV 或 JSON。

### BettaFish / MindSpider

BettaFish 是独立的上游系统，部署时应按上游 README、依赖、Docker / Python 要求和 MediaCrawler 子模块维护。本项目不要复制 BettaFish 的 `.env`、浏览器 profile、cookie、爬虫输出、下载媒体、报告、缓存或训练数据到 Git 或 release 归档中。

## API

- `GET /api/config`
- `GET /api/health`
- `GET /api/monitor?games=out-of-control&windowHours=72&limit=1000&force=1`
- `GET /api/search`
- `GET /api/bettafish/lab?windowHours=72`
- `POST /api/bettafish/lab/action`

`/api/bettafish/lab/action` 只暴露服务端定义好的固定研究操作。若一个部署应完全只读，把测试台操作开关设为关闭。

## 适配到类似网站

要把 release 用作类似舆情站点的起点，优先通过配置调整：

- `/opt/ss-monitor/.env` 中的 `MONITOR_GAMES_JSON` 或 `MONITOR_GAMES_PATH`。
- `examples/monitor-games.example.json` 可作为“失控进化”单项目模板。

如果需要深度定制领域判断，再改源码：

- `server/analyze.ts`、`server/domainSafeTerms.ts` 和 `src/topicBars.ts` 中的领域词、保护语境和话题分类。
- `.env.example` 中的授权来源、刷新频率、状态文件路径和机器人配置模板。
- 页面文案和视觉样式：`src/main.tsx`、`src/styles.css`。

改完后重新运行检查并生成新的 release 归档。

## 安全边界

- 不提交 `.env`、`.env.local`、任何真实凭证、cookie、浏览器 profile、爬虫输出、下载媒体、生成报告、缓存、`node_modules/`、`dist/` 或部署归档。
- Release 归档可以包含 `dist/`，但不包含运行时状态和密钥。
- 生产配置以服务器本地 `/opt/ss-monitor/.env` 为准，切换 release 前同步到 `/opt/ss-monitor/current/.env`。
- 不主动发送 DingTalk 测试消息。
- 不把 BettaFish 情绪分析当成硬替代，SS1 / SS2 领域分析仍是主判定。
