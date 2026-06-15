# SS Monitor {{TAG}} 部署包

这个包适合部署到内网 Linux 服务器。包里已经包含源码快照和本次新生成的 `dist/` 前端目录，所以服务器上只需要安装生产依赖并启动服务，不需要再执行前端构建。

## 先看懂这 4 件事

1. 服务器建议用 Ubuntu / Debian，Node.js 需要 20 或更高版本。
2. release 附件里下载 `ss-monitor-{{TAG}}.tar.gz`，不要下载 GitHub 自动生成的 Source code zip / tar.gz 来部署。
3. 真实配置只放服务器本地 `/opt/ss-monitor/.env`，不要写进 Git、聊天记录、Issue 或 Release note。
4. 升级时保留 `/opt/ss-monitor/.env`、`/opt/ss-monitor/data` 和 `/opt/ss-monitor/state`，只替换 `/opt/ss-monitor/current` 指向的新版本。

## 第一次部署：照抄命令版

### 1. 安装系统工具和 Node.js

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates tar
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
```

看到 `node -v` 是 `v20`、`v22` 或更高，就可以继续。

### 2. 下载本次部署包

```bash
VERSION={{TAG}}
curl -L -o /tmp/ss-monitor-${VERSION}.tar.gz \
  https://github.com/kioay/ss-monitor/releases/download/${VERSION}/ss-monitor-${VERSION}.tar.gz
```

### 3. 解压到固定目录

```bash
VERSION={{TAG}}
sudo mkdir -p /opt/ss-monitor/releases/ss-monitor-${VERSION}
sudo mkdir -p /opt/ss-monitor/state /opt/ss-monitor/data
sudo tar -xzf /tmp/ss-monitor-${VERSION}.tar.gz -C /opt/ss-monitor/releases/ss-monitor-${VERSION}
sudo ln -sfn /opt/ss-monitor/releases/ss-monitor-${VERSION} /opt/ss-monitor/current
```

目录含义：

- `/opt/ss-monitor/current`：当前运行版本。
- `/opt/ss-monitor/.env`：服务器真实配置，升级时继续沿用。
- `/opt/ss-monitor/data`：导入数据、自定义项目配置，不能进 Git。
- `/opt/ss-monitor/state`：运行状态文件，不能进 Git。

### 4. 安装生产依赖

```bash
cd /opt/ss-monitor/current
npm ci --omit=dev
```

### 5. 创建最小配置

```bash
sudo cp /opt/ss-monitor/current/.env.example /opt/ss-monitor/.env
sudo sed -i 's#^HOST=.*#HOST=0.0.0.0#' /opt/ss-monitor/.env
sudo sed -i 's#^MONITOR_GAMES_PATH=.*#MONITOR_GAMES_PATH=/opt/ss-monitor/data/monitor-games.json#' /opt/ss-monitor/.env
sudo sed -i 's#^BETTAFISH_SEMANTIC_ENABLED=.*#BETTAFISH_SEMANTIC_ENABLED=false#' /opt/ss-monitor/.env
sudo sed -i 's#^MINDSPIDER_DOUYIN_ENABLED=.*#MINDSPIDER_DOUYIN_ENABLED=false#' /opt/ss-monitor/.env
```

如果只是先确认页面能跑，可以写一个单项目配置：

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
      "tiebaBars": ["失控进化"]
    }
  ]
}
JSON
```

同步配置到当前 release 目录：

```bash
sudo cp /opt/ss-monitor/.env /opt/ss-monitor/current/.env
```

### 6. 先手动启动一次

```bash
cd /opt/ss-monitor/current
npm run start
```

看到类似下面的输出就说明服务启动了：

```text
Sentiment monitor listening on http://0.0.0.0:8787
```

浏览器访问：

```text
http://服务器IP:8787/
```

页面能打开后，回到终端按 `Ctrl+C` 停掉手动进程，再继续设置后台服务。

### 7. 设置 systemd 后台服务

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

sudo systemctl daemon-reload
sudo systemctl enable --now ss-monitor
sudo systemctl status ss-monitor --no-pager
```

### 8. 验证部署成功

```bash
curl http://127.0.0.1:8787/api/health
curl http://127.0.0.1:8787/api/config
```

然后用浏览器打开：

```text
http://服务器IP:8787/
```

能看到页面，并且项目筛选里出现你配置的项目名，就算主流程部署完成。

## 可选：Confluence 当前版本重点和关键词同步

内网生产机如果能访问 Confluence，可以让主站服务端自己刷新“当前版本重点”。刷新后会写入本地缓存，并把当前版本相关词、武器名和子页面关键词融合进 SS1 分析结果；命中后页面里会出现“当前版本重点”话题，条目的关键词也会带上这些版本词。

配置只写在服务器本地 `/opt/ss-monitor/.env`，不要把真实 token 写进 Git、Issue、Release note 或聊天记录：

```bash
sudo mkdir -p /opt/ss-monitor/data
sudo sed -i 's#^CONFLUENCE_PAGE_ID=.*#CONFLUENCE_PAGE_ID=231710712#' /opt/ss-monitor/.env
sudo sed -i 's#^CURRENT_VERSION_FOCUS_CACHE_PATH=.*#CURRENT_VERSION_FOCUS_CACHE_PATH=/opt/ss-monitor/data/current-version-focus.json#' /opt/ss-monitor/.env
sudo nano /opt/ss-monitor/.env
```

在编辑器里填入真实 token：

```env
CONFLUENCE_TOKEN=换成服务器本地真实Token
```

保存后同步配置并重启：

```bash
sudo cp /opt/ss-monitor/.env /opt/ss-monitor/current/.env
sudo systemctl restart ss-monitor
```

触发一次监控刷新，让服务端立即去拉 Confluence：

```bash
curl 'http://127.0.0.1:8787/api/monitor?games=ss1&windowHours=72&force=1' >/tmp/ss-monitor-refresh.json
```

检查缓存文件是否生成，并查看识别到了多少关键词：

```bash
sudo test -s /opt/ss-monitor/data/current-version-focus.json
node -e "const f=require('/opt/ss-monitor/data/current-version-focus.json'); console.log({version:f.version, versionPageId:f.versionPageId, terms:f.terms?.length||0, weaponTerms:f.weaponTerms?.length||0})"
```

正常情况下，服务端会每 24 小时刷新一次；Confluence 临时失败时会继续使用上一次缓存。现在生产机可以直接访问 Confluence 时，优先使用这种服务端自动刷新方式，不要依赖本地工作站每天同步。`npm run sync:confluence` 只作为“服务器无法直连 Confluence”时的手动 fallback。

## 可选：钉钉每日简报机器人

钉钉机器人只用于计划内每日简报。服务会在服务器本地时间每个工作日 09:30 发送“昨日舆情日报”；新条目即时推送、baseline 推送、15 分钟批量推送都保持关闭。部署验证时不要主动发送钉钉测试消息，除非当前任务明确要求测试。

先确认状态目录存在：

```bash
sudo mkdir -p /opt/ss-monitor/state
```

如果使用默认 SS1 / SS2 项目，在服务器本地 `/opt/ss-monitor/.env` 填这些变量。真实 webhook 和 secret 只能放服务器本地：

```bash
sudo tee -a /opt/ss-monitor/.env >/dev/null <<'ENV'
DINGTALK_MONITOR_URL=http://服务器IP:8787/

# SS1 每日简报机器人
DINGTALK_WEBHOOK=换成SS1钉钉机器人Webhook
DINGTALK_SECRET=换成SS1钉钉机器人加签Secret
DINGTALK_STATE_PATH=/opt/ss-monitor/state/dingtalk-ss1-state.json

# SS2 每日简报机器人；不需要 SS2 就留空
DINGTALK_SS2_WEBHOOK=
DINGTALK_SS2_SECRET=
DINGTALK_SS2_STATE_PATH=/opt/ss-monitor/state/dingtalk-ss2-state.json
ENV
```

如果部署的是自定义项目，例如 `out-of-control`，优先用通用机器人配置。`webhookEnv` 和 `secretEnv` 写的是变量名，真实值仍然放在同一个 `.env` 文件里：

```bash
sudo tee -a /opt/ss-monitor/.env >/dev/null <<'ENV'
DINGTALK_MONITOR_URL=http://服务器IP:8787/
DINGTALK_OUT_OF_CONTROL_WEBHOOK=换成失控进化钉钉机器人Webhook
DINGTALK_OUT_OF_CONTROL_SECRET=换成失控进化钉钉机器人加签Secret
DINGTALK_ROBOTS_JSON=[{"gameId":"out-of-control","shortName":"失控进化","webhookEnv":"DINGTALK_OUT_OF_CONTROL_WEBHOOK","secretEnv":"DINGTALK_OUT_OF_CONTROL_SECRET","statePath":"/opt/ss-monitor/state/dingtalk-out-of-control-state.json"}]
ENV
```

同步配置并重启主站：

```bash
sudo cp /opt/ss-monitor/.env /opt/ss-monitor/current/.env
sudo systemctl restart ss-monitor
sudo systemctl status ss-monitor --no-pager
```

不要用测试接口做常规验收。`POST /api/notify/dingtalk/test` 只允许本机访问，并且只在明确要求“发一条测试消息”时才调用。平时只检查服务是否正常，等下一个工作日 09:30 后确认状态文件被写入：

```bash
sudo journalctl -u ss-monitor -n 100 --no-pager
sudo ls -l /opt/ss-monitor/state/dingtalk-*.json
```

如果到了发送时间没有收到简报，先检查 `.env` 是否同步到了 `/opt/ss-monitor/current/.env`，再看 `journalctl` 里是否有 `Daily DingTalk report failed`。机器人安全设置里如果开启了“加签”，必须同时配置对应 `DINGTALK_*_SECRET`；如果没有加签，secret 可以留空。

## 可选：抖音登录态和远程登录入口

只有已经部署完整 BettaFish / MediaCrawler 抖音采集的生产机才需要这一段。Release 包里已经带了默认引导脚本，会安装 VNC/noVNC 依赖、生成服务器本地 VNC 密码、写入 `/opt/ss-monitor/.env`、同步 `/opt/ss-monitor/current/.env`、安装远程登录 systemd unit 和 sudoers 授权，并做一次 noVNC 启动烟测。

```bash
sudo bash /opt/ss-monitor/current/scripts/setup-douyin-remote-login.sh
```

脚本会自动探测 `ss-monitor.service` 的运行用户；如果服务用户无法自动判断，可先设置 `SS_MONITOR_SERVICE_USER`。如果不想让脚本安装依赖、重启主站或做烟测，可以分别加 `--no-install-packages`、`--no-restart`、`--no-smoke-test`。真实 noVNC/VNC 密码只保存在服务器本地 `.env`，不要写进 Git、Issue、Release note 或聊天记录。

验证入口：

```bash
curl http://127.0.0.1:8787/api/douyin/status
curl -I http://127.0.0.1:8787/api/douyin/remote-login
curl -I http://服务器IP:6088/vnc.html
sudo systemctl stop ss-monitor-douyin-remote-login
sudo systemctl show ss-monitor-douyin-remote-login.service -p ActiveState -p Result --no-pager
```

正常情况下，`/api/douyin/remote-login` 会返回 302 到 noVNC 页面；手动停止后 unit 应该是 `inactive` / `success`。远程登录复用服务器上的 MediaCrawler profile，不要复制本地工作站 cookie 到生产机，也不要把 noVNC 密码写进 Git、Issue、Release note 或聊天记录。

## 以后升级怎么做

只需要重复下载、解压、安装依赖、同步配置、重启服务：

```bash
VERSION={{TAG}}
curl -L -o /tmp/ss-monitor-${VERSION}.tar.gz \
  https://github.com/kioay/ss-monitor/releases/download/${VERSION}/ss-monitor-${VERSION}.tar.gz
sudo mkdir -p /opt/ss-monitor/releases/ss-monitor-${VERSION}
sudo tar -xzf /tmp/ss-monitor-${VERSION}.tar.gz -C /opt/ss-monitor/releases/ss-monitor-${VERSION}
sudo ln -sfn /opt/ss-monitor/releases/ss-monitor-${VERSION} /opt/ss-monitor/current
cd /opt/ss-monitor/current
npm ci --omit=dev
sudo cp /opt/ss-monitor/.env /opt/ss-monitor/current/.env
sudo systemctl restart ss-monitor
sudo systemctl status ss-monitor --no-pager
```

## 常见问题

- 页面打不开：先看 `sudo systemctl status ss-monitor --no-pager`，确认服务是不是 running。
- 本机能访问，其他电脑不能访问：确认 `/opt/ss-monitor/.env` 里是 `HOST=0.0.0.0`，并检查服务器防火墙是否放行 `8787`。
- 页面打开但没有数据：先看页面里的来源健康状态；B 站或贴吧被风控时，再在服务器本地 `.env` 配置对应 cookie。
- 改了 `.env` 但没有生效：执行 `sudo cp /opt/ss-monitor/.env /opt/ss-monitor/current/.env && sudo systemctl restart ss-monitor`。
- 当前版本重点没有出现：确认 `/opt/ss-monitor/.env` 里有 `CONFLUENCE_TOKEN`、`CONFLUENCE_PAGE_ID` 和 `CURRENT_VERSION_FOCUS_CACHE_PATH`，执行一次 `force=1` 刷新，再看 `/opt/ss-monitor/data/current-version-focus.json` 是否生成。
- 钉钉没有收到每日简报：确认 `DINGTALK_MONITOR_URL`、webhook、secret 和 statePath 已写入 `/opt/ss-monitor/.env` 并同步到 `/opt/ss-monitor/current/.env`；再看 `journalctl` 是否出现 `Daily DingTalk report failed`。
- 需要接入 DingTalk、Confluence、BettaFish、MindSpider 或抖音远程登录：先完成上面的最小部署，再按 README 里的对应章节补配置。

## 这个包包含什么、不包含什么

包含：

- Git 源码快照。
- 本次 release 新生成的 `dist/` 前端静态文件。

不包含：

- `.env`、真实凭据、cookies、浏览器 profile。
- 运行时数据、缓存、下载媒体、生成报告。
- `node_modules` 和部署归档本身。

维护者发布新包时应使用 `scripts/create-deploy-archive.ps1` 或等价流程，确保归档包含 fresh `dist/`，并继续把密钥和运行时状态留在服务器本地。
