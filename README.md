# SS Monitor 舆情监测平台

SS Monitor 是可部署在内网机上的项目舆情监测工作台。默认内置《生死狙击1》和《生死狙击2》模板，也可以通过服务器本地配置改成任意项目，例如《失控进化》。它把 B 站、贴吧、授权抖音数据、BettaFish / MindSpider 输出和可选的 Confluence 当前版本重点融合到一个 Web 页面里，供运营和项目成员在内网查看趋势、风险、话题和每日简报。

当前生产形态是内网机部署：Node 服务同时提供 API 和已经构建好的前端静态资源，公网入口不再承载完整平台。真实内网地址、机器人 webhook、站点 cookie、数据库密码、Confluence token、LLM key 等只保存在服务器本地环境文件或受控密钥系统中，不写入 Git、README、Issue、Release note 或部署归档。

## 功能概览

- 监控一个或多个自定义项目的 B 站视频、贴吧主题、授权抖音数据和 BettaFish / MindSpider 导入数据。
- 默认展示最近 72 小时，可切换 24 小时、7 天、14 天和 30 天窗口。
- 后端保留 30 天轻量历史池，长窗口统计不再只依赖当前抓取页。
- 日间默认每 60 分钟刷新，夜间默认每 240 分钟刷新；手动刷新会强制重新采集。
- Confluence 当前版本重点由生产服务器直接刷新，失败时使用本地缓存。
- 舆情判定返回前会自动执行风险回测；回测未完成时页面显示“回测中”，回测失败时不展示旧判定结果。
- 风险规则带 `analysisVersion`，升级后会丢弃旧版本快照和历史缓存，避免旧误判继续污染页面。
- BettaFish 语义结果只作为辅助信号，不替代 SS1 / SS2 领域规则，也不会单独制造高风险结论。
- DingTalk 只发送计划内每日简报；不会主动发送测试消息或新条目即时推送。

## 2026-06-15 功能修改清单

- [x] “关键词 / 范围”面板按看板独立配置，SS1、SS2 和自定义看板不会共享贴吧来源。
- [x] 页面展示当前看板默认全平台关键词；默认贴吧来源锁定，避免误删后影响默认贴吧采集。
- [x] 新增贴吧来源可配置多个吧名，并与补充来源匹配词分开填写。
- [x] 新增来源吧按“看板全平台默认关键词 + 补充来源匹配词”过滤；默认贴吧来源继续广泛读取，不会因补充匹配词被缩窄。
- [x] 范围标签超出时改为悬浮 / 聚焦展示全部内容，去掉含义不清的 `+1`。
- [x] 清理关键词面板里的测试数据、临时提示、冗余标题、未命中歧义提示和旧范围摘要。
- [x] 贴吧列表采集默认至少读取 4 页；遇到中间空页仍继续探测到最低页数。
- [x] 前端时间窗口支持 30 天，匹配后端 30 天采集与历史保留窗口。
- [x] 新增一键生产部署脚本，自动生成 fresh release 归档、上传、切换、同步 `.env`、重启并校验健康状态。

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

## 傻瓜式部署

下面按“第一次拿到服务器的人”来写。目标是在一台 Ubuntu / Debian Linux 服务器上部署一个监控《失控进化》的站点。其他项目只需要把示例里的项目名和关键词换掉。

### 第 1 步：准备服务器

登录服务器后，先安装基础工具和 Node.js 20+：

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates tar
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

node -v
npm -v
```

看到 Node 版本是 `v20`、`v22` 或更高即可继续。

### 第 2 步：下载 Release 包

这里用当前推荐版本 `v0.1.8`。以后升级时只改 `VERSION`。

```bash
VERSION=v0.1.8
curl -L -o /tmp/ss-monitor-${VERSION}.tar.gz \
  https://github.com/kioay/ss-monitor/releases/download/${VERSION}/ss-monitor-${VERSION}.tar.gz
```

### 第 3 步：解压到固定目录

```bash
VERSION=v0.1.8
sudo mkdir -p /opt/ss-monitor/releases/ss-monitor-${VERSION}
sudo mkdir -p /opt/ss-monitor/state /opt/ss-monitor/data
sudo tar -xzf /tmp/ss-monitor-${VERSION}.tar.gz -C /opt/ss-monitor/releases/ss-monitor-${VERSION}
sudo ln -sfn /opt/ss-monitor/releases/ss-monitor-${VERSION} /opt/ss-monitor/current
```

目录含义：

- `/opt/ss-monitor/current`：当前正在运行的版本。
- `/opt/ss-monitor/.env`：服务器本地真实配置，升级时继续沿用。
- `/opt/ss-monitor/data`：导入数据和自定义项目配置，不进 Git。
- `/opt/ss-monitor/state`：运行状态文件，不进 Git。

### 第 4 步：安装运行依赖

```bash
cd /opt/ss-monitor/current
npm ci --omit=dev
```

### 第 5 步：写入最小配置

先复制配置模板：

```bash
sudo cp /opt/ss-monitor/current/.env.example /opt/ss-monitor/.env
```

写入“失控进化”监控项目配置：

```bash
sudo tee /opt/ss-monitor/data/monitor-games.json >/dev/null <<'JSON'
{
  "games": [
    {
      "id": "out-of-control",
      "name": "失控进化",
      "shortName": "失控进化",
      "bilibiliKeywords": ["失控进化"],
      "douyinKeywords": ["失控进化"],
      "tiebaBars": ["失控进化"],
      "tiebaKeywords": ["失控进化"]
    }
  ]
}
JSON
```

把服务改成内网可访问，并关闭可选增强项，保证先跑起来：

```bash
sudo sed -i 's#^HOST=.*#HOST=0.0.0.0#' /opt/ss-monitor/.env
sudo sed -i 's#^MONITOR_GAMES_PATH=.*#MONITOR_GAMES_PATH=/opt/ss-monitor/data/monitor-games.json#' /opt/ss-monitor/.env
sudo sed -i 's#^BETTAFISH_SEMANTIC_ENABLED=.*#BETTAFISH_SEMANTIC_ENABLED=false#' /opt/ss-monitor/.env
sudo sed -i 's#^MINDSPIDER_DOUYIN_ENABLED=.*#MINDSPIDER_DOUYIN_ENABLED=false#' /opt/ss-monitor/.env
```

同步配置到当前 release：

```bash
sudo cp /opt/ss-monitor/.env /opt/ss-monitor/current/.env
```

### 第 6 步：先手动启动一次

```bash
cd /opt/ss-monitor/current
npm run start
```

看到类似下面的输出就说明服务启动了：

```text
Sentiment monitor listening on http://0.0.0.0:8787
```

这时打开浏览器访问：

```text
http://服务器IP:8787/
```

如果能看到页面，就按 `Ctrl+C` 停掉手动进程，然后继续下一步设置后台常驻。

### 第 7 步：设置开机自启

创建 systemd 服务：

```bash
sudo tee /etc/systemd/system/ss-monitor.service >/dev/null <<'SERVICE'
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
SERVICE
```

启动并设为开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ss-monitor
sudo systemctl status ss-monitor --no-pager
```

### 第 8 步：确认部署成功

检查健康接口：

```bash
curl http://127.0.0.1:8787/api/health
```

检查项目配置是否已经变成“失控进化”：

```bash
curl http://127.0.0.1:8787/api/config
```

浏览器访问：

```text
http://服务器IP:8787/
```

页面标题应显示“失控进化舆情监测”，项目筛选按钮也应显示“失控进化”。

### 可选：抖音远程登录入口

只有部署了完整 BettaFish / MediaCrawler 抖音采集的生产机才需要这一步。Release 包里自带 `scripts/setup-douyin-remote-login.sh`，默认会安装 VNC/noVNC 依赖、生成服务器本地 VNC 密码、写入 `/opt/ss-monitor/.env`、同步 `/opt/ss-monitor/current/.env`、安装远程登录 systemd unit 和 sudoers 授权，并做一次 noVNC 启动烟测。

使用方式：

1. 先按前面的部署步骤把主站启动起来。
2. 打开网页；如果顶部提示远程登录入口未就绪，点击“复制命令”。
3. SSH 登录到这台生产服务器，把复制的命令粘贴执行。网页不会直接安装系统依赖，因为安装 VNC/noVNC、写 systemd unit 和 sudoers 都需要 root 权限。
4. 命令执行成功后刷新网页；登录态异常时顶部会显示“远程登录”，点击后会启动临时 noVNC 桌面。

```bash
sudo bash /opt/ss-monitor/current/scripts/setup-douyin-remote-login.sh
```

脚本会自动探测 `ss-monitor.service` 的运行用户；如果服务用户无法自动判断，可先设置 `SS_MONITOR_SERVICE_USER`。默认不固定写入 noVNC URL，后端会按访问主站时的 Host 跳转；如果必须固定域名或 IP，可先设置 `DOUYIN_REMOTE_LOGIN_HOST=服务器域名或IP`。如果不想让脚本安装依赖、重启主站或做烟测，可以分别加 `--no-install-packages`、`--no-restart`、`--no-smoke-test`。`BETTAFISH_DOUYIN_REMOTE_PASSWORD` 只会保存在服务器本地 `.env`，不要写进 Git、聊天记录或 Release note。

验证入口：

```bash
curl http://127.0.0.1:8787/api/douyin/status
curl -I http://127.0.0.1:8787/api/douyin/remote-login
curl -I http://服务器IP:6088/vnc.html
sudo systemctl stop ss-monitor-douyin-remote-login
sudo systemctl show ss-monitor-douyin-remote-login.service -p ActiveState -p Result --no-pager
```

正常情况下，第一次请求会让 `/api/douyin/remote-login` 返回 302 到 noVNC 页面；手动停止后 unit 应为 `inactive` / `success`。远程登录会复用服务器上的 MediaCrawler profile，不要复制本地工作站 cookie 到生产机。

### 第 9 步：换成自己的项目

编辑这个文件：

```bash
sudo nano /opt/ss-monitor/data/monitor-games.json
```

把 `失控进化` 换成自己的项目名和关键词。字段说明：

- `id`：稳定项目 id，只用英文字母、数字、`-` 或 `_`，例如 `my-game`。
- `name`：页面展示名，例如 `失控进化`。
- `shortName`：筛选按钮和日报里使用的短名。
- `bilibiliKeywords`：B 站搜索关键词。
- `douyinKeywords`：抖音授权数据、MindSpider 数据和公开搜索的匹配关键词。
- `tiebaBars`：贴吧来源吧名，不带“吧”字；可填多个相关吧名，服务会逐个采集。
- `tiebaKeywords`：项目配置层面的贴吧内容过滤关键词；配置后只保留来源吧里命中这些词的帖子。不配置时保留来源吧最新主题。默认 SS1 / SS2 为空，页面新增的补充来源会单独使用“默认全平台关键词 + 补充来源匹配词”过滤。

改完重启：

```bash
sudo cp /opt/ss-monitor/.env /opt/ss-monitor/current/.env
sudo systemctl restart ss-monitor
```

### 第 10 步：常见问题

- 页面打不开：先执行 `sudo systemctl status ss-monitor --no-pager`，确认服务是不是 running。
- 本机能访问、其他电脑不能访问：确认 `.env` 里是 `HOST=0.0.0.0`，并检查服务器防火墙是否放行 `8787`。
- 页面打开但没有数据：先看页面里的“来源健康”；B 站或贴吧被风控时，可在服务器本地 `.env` 配置对应 cookie。
- 改了项目但页面还是旧的：执行 `sudo systemctl restart ss-monitor`，然后强制刷新浏览器页面。
- 升级新版本：重复第 2、3、4 步，然后执行 `sudo cp /opt/ss-monitor/.env /opt/ss-monitor/current/.env && sudo systemctl restart ss-monitor`。

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
npm run test:risk-backtest
npm run test:dingtalk-daily-markdown
npm run test:semantic-guard
.\scripts\create-deploy-archive.ps1 -OutputPath "$env:TEMP\ss-monitor-<version>.tar.gz"
```

`create-deploy-archive.ps1` 要求工作区干净，避免源码来自 `HEAD`、前端 `dist/` 却来自未提交工作区的混合产物。脚本会先执行 `npm run test:risk-backtest` 和 `npm run build`，再把 Git 归档和新生成的 `dist/` 打进压缩包。归档文件本身、`.env*`、`data/`、`node_modules/`、浏览器 profile、cookie、缓存、媒体下载和报告输出都不应进入 Git。

内部生产机日常更新可使用 `.\scripts\deploy-ss-monitor-production.ps1`。脚本会调用归档脚本生成 fresh release 包，上传到生产机，安装生产依赖，切换 `/opt/ss-monitor/current`，把服务器本地 `/opt/ss-monitor/.env` 同步到当前 release，重启 `ss-monitor` 并校验 `/api/health`。SSH 登录信息只从本地忽略的凭据来源读取，不要写入 Git、README、Release note 或聊天记录。

### 风险判定回测

`npm run test:risk-backtest` 使用 `scripts/fixtures/risk-backtest-cases.json` 中的黄金样本回测风险判定。样本同时覆盖误伤保护、真实风险召回和 BettaFish 融合场景；脚本会固定读取 `scripts/fixtures/risk-backtest-current-version-focus.json`，不依赖生产 Confluence 或本地 `data/` 缓存。新增或修正错判后，应把最小复现样本加入回测集，再调整规则。

当前回测集包含 12 条样本，其中 6 条是误伤保护。`v0.1.7` 新增了“终于到达这里了 / 不准！我们一起继续刷”这类玩家玩笑式回复的回测保护，避免把“不准继续刷”误判成负面或中风险。

生产服务的 `/api/monitor` 会先执行同一套风险回测，回测通过后才返回舆情判定。网页等待期间会显示“回测中”；如果回测失败，接口会返回错误，前端会清空旧判定，避免继续展示可能错误的缓存结果。

风险分析规则使用 `currentAnalysisVersion` 标记。改动规则并提升版本后，后端只复用同版本的 `monitor-snapshot.json`、`monitor-history.json` 和前端本地缓存；部署时如需立刻清掉旧误判，可以备份并移走 `/opt/ss-monitor/data/monitor-snapshot.json` 与 `/opt/ss-monitor/data/monitor-history.json`，服务会按新规则重新生成。

## 关键配置

常用配置在 `.env.example` 中维护。部署时通常只需要关注这些类别：

- 服务监听：端口、监听地址、日夜刷新频率、默认时间窗口。
- 监控项目：`MONITOR_GAMES_JSON` 或 `MONITOR_GAMES_PATH`，用于替换默认 SS1 / SS2 项目。
- 基础采集：B 站和贴吧 cookie，可留空；被风控时再在服务器本地配置。
- 当前版本重点：Confluence 页面和访问凭证，只放在服务器本地。
- 抖音数据：优先使用授权导出、授权 API、MindSpider / MediaCrawler 输出或数据库读取。
- 抖音状态：生产机可通过 `/api/douyin/status` 暴露登录态和采集状态；登录态异常时可配置 noVNC 远程登录入口。
- BettaFish：完整运行时独立维护在本项目之外，本项目只读取它的状态、导出数据或本地语义模型结果。
- DingTalk：只配置每日简报机器人；测试接口仅允许本机访问。
- 状态文件：建议放在 `/opt/ss-monitor/state` 或 `/opt/ss-monitor/data`，并保持目录不入 Git。

## 数据源说明

### B 站和贴吧

默认尝试公开页面和接口。若触发安全验证，可在服务器本地 `.env` 中配置对应站点 cookie 后重启服务。cookie 是敏感信息，不要写进文档、代码、Release note 或聊天记录。

贴吧来源和关键词是分开的：`tiebaBars` 控制去哪些吧抓，`tiebaKeywords` 控制在这些吧里保留哪些帖子。每个看板都有独立配置；例如 SS1、SS2 或自定义“失控进化”看板会分别维护自己的贴吧来源，避免不同项目的舆情混在一起。

默认贴吧来源会保持广泛读取，再交给系统做舆情分析；新增补充来源时才会启用来源内过滤。例如看板默认全平台关键词是“失控进化”，再给这个看板补充 `rust` 吧和来源匹配词“手游、rust手游”，服务会在 `rust` 吧里保留命中“失控进化 / 手游 / rust手游”的主题。这样可以去相邻贴吧找本项目讨论，但不会把相邻贴吧自己的泛舆情全部带进来。

页面里的“补充全平台关注词”会影响 B 站、抖音等全平台搜索，不会自动新增贴吧来源；贴吧来源需要在“贴吧采集范围”里单独添加。分享链接和接口也支持按看板传参，例如 `tiebaBars.ss1=逆战`、`tiebaKeywords.ss1=生死狙击`。

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
