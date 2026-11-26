# 夏延热度 / CHEYENNE HEAT

多人文字犯罪跑团：管理员导入玩家，玩家提交一句话行动，判官裁定结果；每个账号看到的地图与情报都不一样。

## 架构

- **前端**：React + Vite，静态文件（可发 GitHub Pages）
- **服务端**：Node 原生 HTTP + JSON 数据库，负责账号、会话、玩家状态、行动裁定、管理员接口
- **地图**：真实 OpenStreetMap 夏延数据（13,896 条道路 / 9,621 栋建筑 / 346 个地点），按玩家知识过滤显示

> GitHub Pages 只能托管静态文件，账号与共享状态必须有服务端。线上页面在连不到服务端时会提示，这是正常的。

## 本地运行（推荐）

```bash
node node_modules/vite/bin/vite.js build   # 构建前端
node server/index.mjs                     # 启动服务端（默认 8788）
```

打开 http://localhost:8788 —— 服务端同时托管前端与 API，同源，无跨域问题。

初始管理员：`admin` / `cheyenne`（可用环境变量覆盖），管理员令牌：`cheyenne-admin`。

## 部署到公网

1. **Render / Railway / Fly.io**：仓库里有 `Dockerfile` 和 `render.yaml`，新建 Web Service 指向本目录即可，端口 8788。
2. **任意 VPS**：`docker build -t cheyenne . && docker run -p 8788:8788 cheyenne`
3. **反向代理**：Nginx/Caddy 把 80/443 转到 8788；前端用相对地址，天然同源。

部署后把站点地址发给玩家，玩家登录页「服务器地址」留空即同源可用。

## 管理员怎么用

1. 登录页切到「管理员」，令牌 `cheyenne-admin`
2. 「导入玩家」粘贴 JSON 数组：
   ```json
   [{"username":"mike","password":"pass123","name":"迈克","cash":800}]
   ```
3. 玩家列表里可以：推送情报（可含虚假信息）、改现金、改通缉度
4. 「世界时间」推进 30 分钟 / 3 小时 / 12 小时

## 判官能识别

移动（按距离算时间）、抢劫便利店/银行（看有没有枪、通缉度）、买枪、销赃、打听情报、接联系人任务、躲藏降通缉、睡觉、观察踩点；触发警察盘查时挂起三选一事件（配合/逃跑/塞钱）。

无法识别的行动会返回可执行建议。

## 信息不对等

玩家档案里存 `knowledge`：

- `places`：已知地点（开局 4 个，去过的附近会解锁，打听会新增）
- `rumors` / `notes`：传闻与笔记，管理员推送的情报也混在这里
- 地图只渲染已知地点，其余是空白

## 数据

- `server/db.json`：账号、玩家、会话、世界时间（首次运行自动创建）
- `server/map.json`：城市数据副本
- 重新拉取地图：`node tools/fetch-map.mjs`（Overpass 公共服务器较慢，可重试）

地图数据 © OpenStreetMap contributors，ODbL。
