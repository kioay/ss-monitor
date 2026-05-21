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
