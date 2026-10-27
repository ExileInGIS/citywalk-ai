# CityWalk AI 部署与运行指南

> 版本：v1.0 ｜ 日期：2026-10-26 ｜ 状态：本地 Mock 已实测；91 项自动化测试、评测与自检通过；**未部署到公网**
> 关联：`README.md`、`docs/PRODUCT-REQUIREMENTS.md` §10/§16、`docs/ARCHITECTURE.md` §6/§10、`.env.example`、`package.json`。
> 口径：本文命令以 `package.json` 为准；执行过的写「已执行」，没执行的写「未执行」；不把未验证写成已验证。

---

## 0. 先看状态（重要）

### 0.1 本次核对（2026-10-26 15:56，Asia/Shanghai）

| 项 | 核对结果 | 说明 |
| --- | --- | --- |
| Node.js | **v24.21.0（已执行）** | 本机 DSH 内置运行时；`node --version` 输出 v24.21.0 |
| pnpm | **11.28.5（已执行）** | 用内置 Node 运行 `pnpm.mjs --version` |
| 依赖锁 | `pnpm-lock.yaml`（lockfileVersion 9.0） | 已存在；`jsdom@30.1.3` 是唯一 devDependency |
| 依赖目录 | `node_modules/` 存在 | 运行时零依赖；jsdom 仅测试用 |
| `.env` | 不存在 | 默认 `AGENT_MODE=mock`，无需密钥 |
| 仓库数据库 | 无 | 收藏只存浏览器 `localStorage`；服务端事件只存内存 |
| Docker / CI | 无 `Dockerfile`、无 `.github/` | 未构建、未跑 CI |
| 服务端启动 | **已执行** | `node server/index.js` 监听 `127.0.0.1:3000`；health/config/静态页/plan 均 200 |
| 自动化测试 | **91/91 通过（已执行）** | `node tests/run.js`；含单元、API、jsdom 集成 |
| 评测 | **21/21 场景、12/12 调整（已执行）** | `node scripts/eval.js`；见 `docs/EVALUATION-REPORT.md` |
| 一致性自检 | **28/28 通过（已执行）** | `node scripts/check.js` |
| 一键 QA | **退出码 0（已执行）** | `node qa/run-all.js` |
| 单文件构建 | **已执行** | `node build.js` 生成 `CityWalk-AI.html`（约 1.1 MB，含 12 张内联图片） |
| 公网部署 | **未执行** | 无服务器/域名/凭据；不得写“已上线” |

**结论：** 本地 Mock 的完整链路（启动、health/config、静态页、plan/refine、测试、评测、自检、单文件构建）已实测通过。真实 LLM、Coze、真实地图瓦片与公网部署**未验证/未部署**；本文只描述可复现的本地步骤与未来部署方案。

### 0.2 部署状态

**未部署到公网，未上线。** 原因：没有服务器/域名/HTTPS 证书/云账号凭据；本仓库没有 CI 与镜像；PRD 明确本次不做公网部署（§1.3、§4.5、§15）。本文只提供可复现的本地运行与未来部署步骤，不声称“已上线”。

---

## 1. 前置条件

| 项 | 要求 | 本次核对 |
| --- | --- | --- |
| Node.js | **≥ 20**（`package.json` 的 `engines`） | 本机 v24.21.0；Node 20 未实测 |
| 包管理器 | pnpm 推荐（11.28.5 可选）；npm 也可跑脚本 | 本机 pnpm 11.28.5 |
| 数据库 | **不需要** | 无 SQLite/Postgres/Redis |
| 端口 | 默认 `3000`，可改 `PORT` | 未占用时可用 |
| 磁盘 | 依赖约 20 MB + 仓库 | 未精确统计 |
| 网络 | Mock 模式离线可用；真实 LLM/地图/安装依赖需要外网 | 本机 shell 访问外网受限（CODE-AUDIT） |
| 操作系统 | Windows / Linux / macOS 均可，命令示例覆盖 PowerShell 与 bash | 本机 Windows |

> **Node 版本提示：** 测试通过 `node tests/run.js` 在进程内加载测试文件，不依赖 `--test-isolation` 等较新 flag；本机只在 Node v24.21.0 上验证。Node 20 理论可用但**未实测**；如遇 `node:test` 行为差异，请升级到 Node 22+ 并记录。

---

## 2. 安装

```bash
# 推荐（仓库带 pnpm-lock.yaml）
pnpm install

# 或者
npm install
```

- **不要混用** pnpm 与 npm：仓库已有 `pnpm-lock.yaml`，`npm install` 可能额外生成 `package-lock.json`，两套锁文件会漂移。
- `jsdom` 只是 **devDependency**，用于 DOM 集成测试；运行时零依赖，生产部署不需要 `node_modules` 里的业务包（本项目没有运行时依赖）。
- 本机已存在 `node_modules/` 与锁文件；本次**未重新执行安装**（避免在实现未完成时改动依赖状态）。

### 2.1 node 不在 PATH 时

本机 `node` 不在 PATH；可用绝对路径（示例为本机 DSH 运行时，换机器时换成自己的路径）：

```powershell
& "C:\Users\pcy\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" --version
```

更推荐的做法：安装 Node.js ≥ 20 并加入 PATH，之后所有命令用 `node` / `pnpm` 即可：

```powershell
where.exe node
node --version
```

---

## 3. 配置

```powershell
# PowerShell
Copy-Item .env.example .env
```

```bash
# bash
cp .env.example .env
```

`.env` 已被 `.gitignore` 排除；**不要把真实密钥提交到仓库**。服务端启动时读取仓库根目录的 `.env`，已存在的环境变量优先于文件值（`server/config.js` 的 `loadConfig`）。

### 3.1 变量说明

| 变量 | 默认/示例 | 作用 | 备注 |
| --- | --- | --- | --- |
| `PORT` | `3000` | HTTP 端口 | 0–65535；改后访问对应端口 |
| `NODE_ENV` | `development` | 运行环境 | 生产建议 `production` |
| `AGENT_MODE` | `mock` | `mock` 本地确定性规划；`remote` 调真实模型 | 无密钥时保持 `mock` |
| `AGENT_TIMEOUT_MS` | `18000` | 远程调用超时（毫秒） | 50–120000 |
| `AGENT_FALLBACK` | `mock` | 远程失败时回退本地并标 `degraded`；`error` 直接报错 | 建议 `mock` |
| `LLM_BASE_URL` | 空 | OpenAI 兼容接口地址 | 例：`https://api.deepseek.com/v1` |
| `LLM_API_KEY` | 空 | 服务端密钥 | **只在服务端**；不写前端、不提交 |
| `LLM_MODEL` | 空 | 模型名 | 例：`deepseek-chat` |
| `COZE_API_TOKEN` | 空 | Coze Token | 可选；未联调 |
| `COZE_BOT_ID` | 空 | Coze Bot ID | 可选；未联调 |
| `COZE_BASE_URL` | `https://api.coze.cn` | Coze API 地址 | 以官方最新文档为准 |
| `RATE_LIMIT_PER_MIN` | `30` | 每 IP 每分钟请求上限 | 0–100000；超限 429 |
| `CORS_ORIGINS` | 空 | 允许跨域来源，逗号分隔；空=只允许同源 | 生产按域名填写 |
| `LOG_LEVEL` | `info` | `debug/info/warn/error/silent` | 日志不记录用户原文 |
| `TELEMETRY_ENABLED` | `true` | 是否启用匿名事件接口 | 无 PII |

- **没有 `.env` 也能跑**：`server/config.js` 里默认端口 3000、`mock`、回退 `mock`、限流 30/分钟。完整 Mock 闭环不依赖任何密钥。
- **密钥只在服务端**：`/api/config` 只返回 `mode`、`remoteConfigured`、`mapProvider`、`telemetryEnabled`、`version` 等非敏感字段；不返回 `LLM_API_KEY` / `COZE_API_TOKEN` / `LLM_BASE_URL`。
- `.env` 的文件位置必须是**仓库根目录**；放在 `server/` 下不会被读取。

---

## 4. 启动

```bash
pnpm start
# 等价于
node server/index.js
```

```powershell
# PowerShell 临时改端口
$env:PORT=3000; pnpm start
```

- 默认地址：**http://localhost:3000**
- 健康检查：`GET /api/health`，返回 `{ status, version, mode, provider, uptimeMs, time }`。
- 客户端安全配置：`GET /api/config`（不含密钥）。
- 启动日志应显示监听端口与当前模式；若 3000 被占用，见第 11 节。

```powershell
# 健康检查（Windows 自带 curl.exe 可用）
curl.exe -s http://localhost:3000/api/health
# 或 PowerShell 原生
Invoke-RestMethod http://localhost:3000/api/health
```

**本次已执行（2026-10-26 15:56，直接运行 `node server/index.js`）：**

- `GET /api/health` → **200**：`{"status":"ok","version":"1.0.0","mode":"mock","provider":"mock-rules","uptimeMs":…}`（uptime 随时间变化）。
- `GET /api/config` → **200**：`{"mode":"mock","remoteConfigured":false,"mapProvider":"mock","telemetryEnabled":true,"version":"1.0.0"}`。
- `GET /` → **200**，静态首页可访问。
- `POST /api/agent/run`（plan：南京、4 小时、咖啡+历史、预算 150）→ **200**，`code=0`、`mode=mock`、`degraded=false`；4 个地点（`p_yihe,p_cafe_sh,p_laomendong,p_bailuzhou`），`actualMin=210`、`distanceKm=5.07`、`budget=35–130`、`conflict=null`、4 条约束、2 个来源。
- `POST /api/agent/run`（refine：「少走一点路」）→ **200**，`changed=true`，移除绕路最多的一站并重算；返回 3 条变更。
- 非法请求体 → **400 INVALID_INPUT**；安全响应头（CSP 等）已检查。

**未执行/未验证：** 真实 LLM（无密钥）、Coze（未联调）、真实地图瓦片（无浏览器/网络条件）、公网部署。以上不写入“已通过”。

---

## 5. 真实 AI 接入（可选，未联调）

### 5.1 方案 A：OpenAI 兼容接口

在 `.env` 中设置（示例值来自 `.env.example` 注释；密钥用你自己的）：

```ini
AGENT_MODE=remote
AGENT_FALLBACK=mock
AGENT_TIMEOUT_MS=18000
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=<你的服务端密钥>
LLM_MODEL=deepseek-chat
```

重启服务后，`GET /api/health` 应显示 `mode=remote`、`provider=openai-compatible`（字段名以实现为准）；`GET /api/config` 的 `remoteConfigured` 应为 `true`。请求 `POST /api/agent/run` 时：

- 正常：200 + `{ code: 0, mode: "remote", data: Route }`；
- 缺配置：`REMOTE_NOT_CONFIGURED`（503）；
- 超时：`UPSTREAM_TIMEOUT`（504）；上游 5xx/网络错误：`UPSTREAM_ERROR`（502）；
- `AGENT_FALLBACK=mock` 时失败回退本地，结果带 `degraded: true` 与原因。

**未验证**：本次没有真实密钥，没有发起任何真实 LLM 调用；上述状态码来自 ARCHITECTURE §6.3 的契约，不是实测结果。

### 5.2 方案 B：Coze（可选）

```ini
AGENT_MODE=remote
COZE_API_TOKEN=<服务端 Token>
COZE_BOT_ID=<Bot ID>
COZE_BASE_URL=https://api.coze.cn
```

- 适配器与配置项已预留，但**未联调、未验证**；接入前按 Coze 官方最新文档核对 API 版本与字段。
- 同时配置 LLM 与 Coze 时，以 `remoteProvider` 显式指定或代码的优先级为准（`server/config.js` 先看显式 provider，再按 LLM → Coze 顺序推断）；不要依赖猜测，联调时明确写 `provider`。

### 5.3 安全注意

1. 密钥只放服务端环境变量或 `.env`；前端代码、日志、错误响应里都不能出现。
2. 不要把 `.env` 打进 Docker 镜像或提交仓库；`.dockerignore` 也应排除（当前无 Dockerfile）。
3. 生产必须 HTTPS；反向代理层再加一层请求体大小与超时限制（第 8 节）。
4. 用户输入按数据处理，不拼进系统指令；远程返回必须过 Schema 校验与数字重算（ARCHITECTURE §6.2）。

---

## 6. 真实地图（可选，未联调）

### 6.1 默认：Mock SVG

默认 `js/config.js` 的 `map.provider = 'svg'`，完全离线；地图是示意，不含真实坐标。界面上标注“示意地图 · 不含真实坐标”，不要把它当导航结果。

### 6.2 Leaflet + OSM CDN

当前仓库已有正式适配器 `js/adapters/map-leaflet.js`（8,405 字节，本次核对）与参考样例 `js/adapters/map-leaflet.example.js`；`index.html` 第 41–52 行是注释块，默认不加载任何 CDN。启用步骤：

1. 在 `index.html` 取消第 49–51 行注释（Leaflet CSS/JS + 本项目适配器）；若用 `build.js` 打包，把适配器加进 `JS_ORDER`。
2. 在 `js/config.js` 设置 `CW_CONFIG.MAP.provider = 'leaflet'`（本地可用 `?map=leaflet` 手测），并确认服务端 CSP 放行 `unpkg.com` 与瓦片域名。
3. 坐标：`js/data.js` 已有 8 个地点真实经纬度（OSM，ODbL 1.0）；4 个泛化地点（上海路街角咖啡馆、陶谷新村旧书店、老门东本地小馆、城市露台市集）没有坐标，适配器会跳过，不画到错误位置。
4. 说明：路线只是**直线连接示意**，不是步行路径；真实路线要另接 OSRM/高德/腾讯步行路径服务（未实现）；适配器会展示 OSM 归属。
5. OSM 瓦片有使用政策（署名、流量限制）；生产/高流量应自建瓦片或换商用供应商，**本次未核验具体条款**。

**未验证**：本机未在浏览器加载 Leaflet/瓦片，未验证网络可达性与实际渲染。

### 6.3 高德 / 腾讯（未实现）

- `js/config.js` 有 `amap` / `tencent` 的 key 字段与适配器占位，但没有可用实现；需要申请 Key、配置域名白名单、核对商用条款。
- 中国地图厂商使用 GCJ-02 坐标系；OSM/Leaflet 使用 WGS-84。直接混用会偏移，**本仓库未实现坐标转换**（未验证，接厂商时必须按官方文档处理）。
- 不要把“填了 key”写成“已接入”；本仓库没有任何高德/腾讯的真实调用记录。

### 6.4 服务端配置提示

`server/config.js` 的 `publicConfig()` 目前固定返回 `mapProvider: 'mock'`；如果前端已切 Leaflet，`/api/config` 仍可能显示 `mock`。这是**已知的配置不一致点（截至核对）**，接真实地图时以页面实际配置为准，并建议后续把地图模式并入服务端配置。

---

## 7. Docker（可选；未创建、未构建）

**本仓库没有 Dockerfile**（本次核对确认）。不要把下面的命令当“已构建验证”。

```powershell
# 需要 Docker Desktop 已启动、能拉取镜像
docker run --rm -p 3000:3000 --env-file .env `
  -v "${PWD}:/app" -w /app `
  node:24-alpine node server/index.js
```

注意事项：

- `node:24-alpine` 只提供 Node，不安装依赖；本项目运行时零依赖，Mock 模式可直接跑。
- 挂载整个仓库会暴露 `.env` 给容器（运行时需要）；不要把镜像做成包含 `.env` 的产物。
- Windows 路径挂载需要 Docker Desktop 的文件共享许可；`${PWD}` 在 PowerShell 中可用，cmd 用 `%cd%`。
- 端口映射 `-p 3000:3000` 与容器内 `PORT` 必须一致；容器内监听 `0.0.0.0` 才能被外部访问（以 `server/index.js` 实现为准，未验证）。
- 生产镜像应使用非 root 用户、固定版本标签、加 `HEALTHCHECK`；这些都需要另行实现，当前**未做**。
- **状态：未执行 `docker build` / `docker run`，未构建验证。**

---

## 8. 反向代理 / HTTPS / 进程管理（建议，未验证）

以下配置均**未创建、未验证**；上线前需按实际域名/路径调整。

### 8.1 Nginx（HTTPS + 反代）

```nginx
server {
  listen 443 ssl http2;
  server_name example.com;

  ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

  client_max_body_size 64k;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}
```

**注意**：如果服务端限流按 socket IP 统计，反代后所有请求可能都来自 `127.0.0.1`，限流会误伤/失效；需要服务端信任 `X-Forwarded-For` 或由反代做限流。当前服务端是否处理该头**未验证**。

### 8.2 Caddy（自动 HTTPS，更省事）

```caddyfile
example.com {
  reverse_proxy 127.0.0.1:3000
}
```

### 8.3 systemd

```ini
# /etc/systemd/system/citywalk-ai.service
[Unit]
Description=CityWalk AI
After=network.target

[Service]
WorkingDirectory=/opt/citywalk-ai
EnvironmentFile=/opt/citywalk-ai/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
User=citywalk
Group=citywalk

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now citywalk-ai
sudo systemctl status citywalk-ai
```

### 8.4 pm2

```bash
pm2 start server/index.js --name citywalk-ai --update-env
pm2 save
pm2 startup
```

- 生产必须设置 `NODE_ENV=production`，并确认 `PORT`、`CORS_ORIGINS`、日志级别。
- `pm2`/`systemd` 都会把 `.env` 里的密钥带入进程；限制文件权限（如 `chmod 600 .env`）。
- **以上均未在本机执行。**

---

## 9. 部署状态（如实记录）

- **未部署到公网，未上线。**
- 原因：
  1. 没有服务器、域名、HTTPS 证书、云账号/部署凭据；
  2. 仓库没有 CI（无 `.github/workflows/`），也没有 Dockerfile/镜像；
  3. 本机 shell 访问 GitHub 失败（CODE-AUDIT：`Failed to connect to github.com:443`），推送/拉取网络条件不具备；
  4. PRD 明确本次不做公网部署（§1.3、§4.5、§15），真实 LLM/地图密钥也没有。
- 因此：README、汇报、作品集里都不能写“已上线/已部署/公网可访问”；只能写“本地可运行（待验收）/部署方案已给出（未执行）”。

---

## 10. 回滚

### 10.1 代码回滚（本地）

```bash
git log --oneline -10
git switch --detach <上一个稳定 commit>
# 验证后可切回分支
git switch -
```

或保留历史地撤销某次提交：

```bash
git revert <commit>
```

- 本机 git 目前报 `dubious ownership`（`D:/PM/Citywalk_Agent` 所在文件系统不记录 owner）。git 自己给出的修复是：
  ```powershell
  git config --global --add safe.directory D:/PM/Citywalk_Agent
  ```
  这是本机环境问题，**本次未执行**；执行前确认这是你要信任的仓库路径。
- 回滚后重跑第 12 节；不要只回滚代码而保留不兼容的 `.env`。

### 10.2 数据

- **无数据库，无数据库迁移。** 服务端不持久化用户偏好；收藏/草稿在浏览器 `localStorage`，回滚服务端不会删除用户本地数据。
- 事件只存内存（重启清空），无需迁移。
- 若未来加了数据库，本节必须重写成“备份 → 迁移 → 验证 → 回滚”的步骤。

### 10.3 配置回滚

- 远程 AI/地图出问题：把 `AGENT_MODE` 改回 `mock`、`AGENT_FALLBACK=mock`，或清空 `LLM_*` / `COZE_*` 并重启。
- 不要在生产直接改 `.env` 后不重启；配置在进程启动时读取。

---

## 11. 故障排查

| 现象 | 可能原因 | 怎么查 | 处理 |
| --- | --- | --- | --- |
| `EADDRINUSE` / 端口占用 | 3000 被别的进程占用 | `netstat -ano \| findstr :3000` | 换 `PORT`，或 `taskkill /PID <pid> /F`（确认是自己的进程） |
| `node` 不是内部或外部命令 | PATH 无 Node | `where.exe node` | 安装 Node ≥20 并加入 PATH；或先用绝对路径 |
| 启动后浏览器打不开 | 端口/绑定地址不对；静态文件 404 | 看启动日志；`curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/` | 确认端口、`index.html` 路径、反向代理 |
| `GET /api/health` 404 | 服务端入口未实现/路由未注册 | 看 `server/index.js` 是否存在且非空 | 先完成服务端任务；不要用前端静态服务器冒充 API |
| `.env` 不生效 | 文件不在仓库根目录；格式 `KEY=VALUE` 写错 | 打印配置时只看非敏感字段；检查 `server/config.js` 的读取路径 | 放到根目录、去掉多余空格/引号、重启 |
| 远程 AI 502/504 | Base URL/Key/模型名错；网络不通；超时太短 | 看返回 `code`；`UPSTREAM_ERROR`/`UPSTREAM_TIMEOUT` | 核对 `LLM_*`；调大 `AGENT_TIMEOUT_MS`；必要时 `AGENT_FALLBACK=mock` |
| 远程 AI 503 `REMOTE_NOT_CONFIGURED` | `AGENT_MODE=remote` 但缺配置 | 看 `/api/config` 的 `remoteConfigured` | 补齐 `LLM_*` 或 `COZE_*`；或改回 `mock` |
| 429 限流 | 本机限流或上游限流 | 看响应头/日志；确认 `RATE_LIMIT_PER_MIN` | 调高本机限流；上游 429 需退避/换配额 |
| 地图瓦片失败/灰块 | 无网络、CDN 不可达、OSM 政策限制 | 浏览器 Network；适配器 `tileerror` | 回退 SVG；换瓦片源/自建；不要伪造地图 |
| 地图点位偏移 | 坐标系混用（WGS-84 vs GCJ-02） | 对照已知 POI | 按厂商文档做坐标转换；未实现前不要接高德/腾讯 |
| 白屏/样式丢失 | 静态资源路径错；CSP 拦截 | 浏览器 Console/Network | 修正路径；核对 CSP 与内联脚本 |
| 反向代理后全部 429 | 服务端只看到代理 IP | 看服务端日志的客户端 IP | 配置可信代理头或由代理层限流（未验证） |
| `pnpm test` 无输出/进程被杀 | 测试 runner 在受限环境 spawn 被拒 | 直接运行 `node tests/run.js` | 本项目已改为进程内 runner；仍失败看 Node 版本与权限 |

---

## 12. 验收命令清单（复制即用）

> 以下命令与 `package.json` 一致；`pnpm <script>` 可替换为 `npm run <script>`。
> **本次执行状态（2026-10-26 16:05，Windows / Node v24.21.0）：** `node tests/run.js` 91/91 通过；`node scripts/eval.js` 21/21 场景、12/12 调整；`node scripts/check.js` 28/28；`node qa/run-all.js` 退出码 0；`node build.js` 生成单文件版；`node server/index.js` 的 health/config/静态页/plan/refine 均已实测。

```bash
# 1) 环境
node --version                 # 期望 ≥ v20；本机 v24.21.0
pnpm --version                 # 本机 11.28.5（可选）

# 2) 安装
pnpm install

# 3) 启动（前台）
pnpm start                     # = node server/index.js；默认 http://localhost:3000

# 4) 另一个终端：健康检查
curl -s http://localhost:3000/api/health
curl -s http://localhost:3000/api/config

# 5) 测试与评测
pnpm test                      # = node tests/run.js（单元 + API + jsdom 集成）
pnpm test:unit                 # 只跑单元
pnpm test:api                  # 只跑 API/安全
pnpm test:ui                   # 只跑 jsdom 集成
pnpm eval                      # = node scripts/eval.js；写 docs/EVALUATION-REPORT.md 与 qa/eval/last-run.json
pnpm check                     # = node scripts/check.js
pnpm qa                        # = node qa/run-all.js：测试 + 评测 + 自检

# 6) 可选：单文件构建
pnpm build                     # = node build.js；产物 CityWalk-AI.html 被 .gitignore 忽略
```

**关于 pnpm 的两个环境提示：**

1. 本机 `node` 不在 PATH 时，pnpm 脚本会报 `'node' is not recognized`；把 Node 目录加进 PATH（或用绝对路径直接运行 `node <script>`）。
2. pnpm 11 在运行脚本前会校验 `node_modules`，某些环境会尝试交互式清理；设置 `CI=true` 或 `pnpm --config.verify-deps-before-run=false <script>` 可跳过（只影响本地流程，不影响产品代码）。

**通过标准（全部满足才算本地验收）：**

1. `GET /api/health` 返回 200，`status` 为预期值，`mode` 与 `.env` 一致；
2. `GET /api/config` 不含任何密钥/Token/Base URL；
3. `pnpm test` 失败数为 0；`pnpm qa` 退出码 0；
4. `pnpm eval` 能生成报告，且报告数字可重跑；
5. 浏览器完成“输入 → 生成 → 调整 → 保存/导出”闭环，界面明确标 Mock/降级/未验证（**本环境无 GUI 浏览器，此项由 jsdom 集成测试 + 手工清单覆盖，未做真实浏览器视觉验收**）；
6. 日志不出现用户原文、预算、同行人等个人信息；429/502/504 状态可复现。

---

## 13. 与 README / 其它文档的一致性

- README 将引用本文；**命令以 `package.json` 为准**：`start`、`test`、`test:unit`、`test:api`、`test:ui`、`eval`、`check`、`qa`、`build`。
- 本版本已把测试命令统一为 `node tests/run.js`；不再使用 `node --test <目录>`（受限环境会因测试 runner spawn 报 EPERM）。
- README 旧版的 `node tests/smoke.js` / `node tests/checks.js` 是原型自检，**不是**新测试命令；新 README 已改为 `pnpm test` / `pnpm qa`，并保留“未验证”标注。
- 本文不替代 `docs/EVALUATION-REPORT.md` 的指标报告；评测数字以实际运行结果为准。
- 本文日期 2026-10-26；实现、依赖、截图与命令变化后，需同步更新本文并重跑第 12 节。
