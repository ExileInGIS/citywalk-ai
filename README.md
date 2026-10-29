# CityWalk AI · 个性化城市漫步路线规划

> 从高保真原型升级为**可运行、可接入真实服务、可测试**的城市漫步 MVP。
> 默认 Mock 模式无需任何密钥即可完整体验；Remote 模式支持 OpenAI 兼容接口与 Coze 适配。

**一句话**：用自然语言说清「什么时候、和谁、有多少时间、多少钱、想逛什么」，得到一条满足硬约束、顺序可执行、理由可解释、可继续用自然语言修改的城市漫步路线。

> 当前状态：**已部署到 Render**：<https://citywalk-ai-m01d.onrender.com>。线上默认 Mock 模式（不调用付费 LLM）；地图为 Leaflet + 高德栅格瓦片（非商用/自用）。真实 DeepSeek 的线上开启方法见第四节。

---

## 在线使用（Render）

**线上地址：** <https://citywalk-ai-m01d.onrender.com>

这是 Render 的免费 Web Service，第一次打开或长时间没人访问后，可能需要 **30–60 秒冷启动**；等页面出现即可，不需要刷新。

### 第一次使用

1. 打开线上地址；
2. 在首页输入兴趣、时间、预算、同行人，或点「填入示例需求」；
3. 点「生成我的 CityWalk 路线」；
4. 等待四步加载，进入结果页；
5. 在地图、时间线、约束清单之间切换查看；
6. 在 AI 助手输入调整指令，例如：
   - 「少走一点路」
   - 「把咖啡馆换成书店」
   - 「下雨了，尽量安排室内活动」
   - 「保留第一站和最后一站」
7. 点「收藏」保存到当前浏览器；点「导出」下载 Markdown 或 JSON。

线上版当前：

- 规划由本地确定性规则完成，不调用真实大模型；
- 地图会加载真实高德栅格底图，显示 67 个有坐标地点；
- 收藏只存在你的浏览器 `localStorage`，换浏览器/设备不会同步；
- 不需要注册账号。

健康检查：

```text
https://citywalk-ai-m01d.onrender.com/api/health
```

正常返回：

```json
{"status":"ok","mode":"mock","provider":"mock-rules"}
```

### 设置访问密码（可选，推荐）

线上默认没有登录限制。要加一个全站访问密码，在 Render 的 `Environment` 中添加：

```text
SITE_USER=citywalk
SITE_PASSWORD=你自己设置的密码
```

保存后 Render 自动重新部署。再次打开网站时，浏览器会弹出登录框：

- 用户名：`citywalk`，或你设置的 `SITE_USER`
- 密码：你设置的 `SITE_PASSWORD`

说明：

- `SITE_PASSWORD` 留空 = 不启用密码；
- 除 `/api/health` 外，页面、静态资源、API 都需要密码；
- `/api/health` 保持公开，供 Render 健康检查；
- 这是 HTTP Basic Auth，必须配合 HTTPS 使用（Render 默认提供 HTTPS）；
- 密码只放在 Render 环境变量里，不要提交到 Git 或 README；
- 这是共享密码，不是正式账号体系；如果要多人独立账号，需要另做登录系统。

---

## 一、现在能做什么

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 自然语言 + 结构化需求输入 | 已实现 | 城市、时长、时间窗、预算、同行人、步行强度、兴趣、餐饮、无障碍、天气、避开、必去 |
| 必填信息检查与追问 | 已实现 | 缺城市/时长不生成；最多 3 个问题，带快捷选项 |
| 约束规划与硬约束校验 | 已实现 | 时间、预算、必去、避开、步行上限、无障碍 unknown |
| 冲突解释与可执行选项 | 已实现 | 不静默放宽；选项执行后重新校验 |
| 结果页（地图/时间线/摘要） | 已实现 | 选中联动、约束清单、推荐理由、来源与估算提示 |
| 自然语言调整 | 已实现 | 少走路、换类型、加主题、预算、结束时间、保留首尾、下雨室内、去相似、删类型 |
| 调整前后差异 | 已实现 | 增/删/换/顺序/时长/预算 + 未解决项 |
| 保存 / 导出 / 复制 | 已实现 | localStorage 持久化；Markdown / JSON 导出 |
| 统一 Agent 接口 | 已实现 | `POST /api/agent/run`，Mock/Remote、超时、Schema 校验、降级 |
| 地图 Provider | 已实现 | 线上为 Leaflet + 高德栅格底图；离线/加载失败自动回退 SVG 示意 |
| 真实 AI 服务 | 适配器就绪；线上默认 Mock | OpenAI 兼容接口已做远程评测；Render 线上开启 DeepSeek 见第四节 |
| 测试与评测 | 已实现 | `pnpm test`、`pnpm eval`、`pnpm check` |

---

## 二、快速开始

前置：Node.js ≥ 20（本机在 v24.21.0 上验证）。不需要数据库，不需要任何 API Key。

```bash
pnpm install          # 或 npm install；只安装 jsdom（开发依赖）
pnpm start            # node server/index.js
# 打开 http://localhost:3000
```

自定义端口：

```bash
PORT=8080 pnpm start
```

健康检查：

```bash
curl -s http://localhost:3000/api/health
```

首次启动：没有 `.env` 也能运行，默认 `AGENT_MODE=mock`。

---

## 三、Mock 演示（推荐先看这个）

1. 首页输入示例需求，或点「填入示例需求」；
2. 点「生成我的 CityWalk 路线」→ 四步加载 → 结果页；
3. 点地图标记/时间线卡片，观察双向联动；
4. 在 AI 助手输入「把咖啡馆换成书店」「保留第一站和最后一站」「下雨了，尽量安排室内活动」；
5. 查看「调整前后」差异与约束清单；
6. 收藏 → 刷新页面 → 我的收藏仍在；导出 Markdown。

Mock 模式下所有规划由 `shared/core.js` 确定性完成；界面明确标注「本地模拟」，不会冒充真实 AI。

---

## 四、接入真实 AI（DeepSeek）

线上默认是 `AGENT_MODE=mock`，不会产生模型费用。要启用 DeepSeek，需要把 API Key 配到 **Render 的环境变量**里，不要写进 README 或提交到 Git。

### 方式 A：本地 `.env`

复制 `.env.example` 为 `.env`（已被 gitignore）：

```bash
AGENT_MODE=remote
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=你的服务端密钥
LLM_MODEL=deepseek-chat
AGENT_TIMEOUT_MS=60000
AGENT_FALLBACK=mock
```

重启：

```bash
pnpm start
```

### 方式 B：Render 线上开启 DeepSeek

1. 打开 Render Dashboard，进入 `citywalk-ai` 服务；
2. 点 **Environment**；
3. 新增或修改以下变量：

```text
AGENT_MODE=remote
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-你的DeepSeekKey
LLM_MODEL=deepseek-chat
AGENT_TIMEOUT_MS=60000
AGENT_FALLBACK=mock
```

4. 点 **Save Changes**，Render 会自动重新部署；等部署完成；
5. 打开：

```text
https://citywalk-ai-m01d.onrender.com/api/config
```

成功时应该看到：

```json
{"mode":"remote","remoteConfigured":true}
```

健康检查中的 `mode` 也会从 `mock` 变成 `remote`。

### 线上测试

```bash
curl -s -X POST https://citywalk-ai-m01d.onrender.com/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"task":"plan","payload":{"conditions":{"city":"nanjing","durationMin":240,"interests":["coffee","history"],"budgetMax":150}}}'
```

注意：

- `LLM_API_KEY` 只在服务端使用，前端永远看不到；
- 每次生成/调整都可能调用 DeepSeek，**会产生 API 费用**；
- `AGENT_FALLBACK=mock` 表示 DeepSeek 失败/超时时自动回退本地规则；
- 线上服务没有登录体系，公开的 `/api/agent/run` 可能被他人调用；请观察 Render 用量和 DeepSeek 账单，必要时关闭远程模式；
- 先保持 `AGENT_MODE=mock` 验证网站，再开启 `remote`，这样出问题容易判断是部署还是模型；
- 仓库不保存任何真实密钥；不要把 Key 写进 README、代码或聊天记录。

Coze：`server/agent/providers/coze.js` 为最小适配器，**未联调**，接入前必须按官方最新文档核对。

---

## 五、接入真实地图（Leaflet + 高德栅格瓦片）

默认 `MAP.provider='mock'`（SVG 示意，离线可用）。启用真实底图：

1. 在 `.env` 写入：

```text
MAP_PROVIDER=amap
```

这个模式用 Leaflet 加载高德栅格瓦片，不需要高德 JS API Key；`AMAP_JS_KEY` / `AMAP_SECURITY_CODE` 可以保留但当前不使用。

2. 重启服务端，打开 `http://127.0.0.1:3000`；
3. 页面先从 mock 示意地图启动，拿到 `/api/config` 后切换到 Leaflet + 高德栅格底图；
4. Leaflet CDN 或地图初始化失败时，会回退到 SVG 示意地图并显示提示，列表与时间线不受影响。

坐标来源仍是 OpenStreetMap（ODbL 1.0）：**67 个地点全部有坐标**。数据层保持 WGS84，Leaflet 适配器只在显示时转换为 GCJ-02，不改 `js/data.js`，也不改规划逻辑。

> 高德栅格瓦片不是高德官方 JS API，本接入仅按项目非商用/自用场景使用；公开部署前需核对高德条款。
> 真实地图上的连线仍是**直线示意**，不是导航路径；距离为估算。

---

## 六、测试与评测

```bash
pnpm test       # node:test：单元 / API / jsdom 集成
pnpm eval       # 固定 24 场景 + 12 条调整指令，输出 docs/EVALUATION-REPORT.md
pnpm check      # 文档/数据/密钥/脚本一致性自检
```

本机若 PATH 没有 node，可用 DSH 内置 Node 的绝对路径运行同一命令；测试报告会写明实际环境。

评测只跑 Mock；**线上部署和真实高德底图已人工验证，远程 LLM 未在线上开启**；报告不会把 Mock 成绩写成真实服务成绩。

---

## 七、项目结构

```
citywalk-ai/
├── index.html                 # 前端入口
├── css/style.css              # 设计系统与页面样式
├── js/
│   ├── config.js              # 唯一客户端配置入口（AGENT / MAP / STORAGE / TELEMETRY）
│   ├── data.js                # UMD 数据目录（浏览器与 Node 共用）
│   ├── schema.js              # Conditions / Route / RefineResult 校验
│   ├── agent.js               # 统一 Agent 入口（mock/remote、超时、降级）
│   ├── map.js                 # MapEngine：Provider 注册与统一渲染
│   ├── storage.js             # localStorage 持久化
│   ├── telemetry.js           # 匿名事件
│   ├── adapters/map-leaflet.js
│   └── pages/                 # 首页 / 发现 / 收藏
├── shared/core.js             # 确定性规划/调整/约束/评分（浏览器与 Node 共用）
├── server/
│   ├── index.js               # HTTP 服务（静态 + API + 安全 + 限流 + 日志）
│   ├── config.js              # .env 读取与默认值
│   ├── agent/                 # 编排、Provider、Prompt
│   └── data/poi-coords.json   # 可追溯坐标（OSM）
├── tests/                     # unit / api / integration
├── qa/eval/                   # 固定评测集与结果
├── scripts/                   # eval.js / check.js
├── docs/                      # 12 份产品与工程文档
└── product-context/           # 设计系统知识库（product-design-system skill）
```

---

## 八、数据与真实性声明（重要）

- 地点名称取自南京真实地标；**停留时长、消费区间、步行时间、距离均为估算或示例数据**；
- 67 个地点全部有 OpenStreetMap 坐标；部分为区域中心（湖面/公园面/道路），不是入口门牌；
- 4 个泛化地点已替换为具体地点；没有单一实体的泛化点不再出现在数据中；
- 营业时间：22 个来自高德 POI 字段，其余为 `null` → 界面显示「信息待确认」；不虚构实时状态；
- 图片：29 个使用高德 POI 图片，其余为本地类别图；版权与平台条款仍需上线前核对；
- 真实 LLM Key 只放在本地 `.env` 或 Render 环境变量，不提交；高德栅格底图不需要 JS Key；生产环境仍建议代理/授权与条款核对；
- 没有真实用户数据：不报告转化率、留存率或增长；所有用户偏好结论均为待验证假设；
- **已部署公网**：线上地址 <https://citywalk-ai-m01d.onrender.com>；免费实例会休眠，首次访问可能较慢。

---

## 九、已知限制

- 真实 LLM 质量在线上尚未启用（本地远程评测已跑）；Coze 兼容性未验证；
- 真实高德底图已在线上 Chrome 人工验证；自动化测试本身不加载外部瓦片，仍可能受 CDN/网络影响；
- 路线不是导航路径，距离为直线 × 1.25 的估算；
- 仅南京有完整示例数据；其他城市会返回空状态；
- 无账号体系、无云端同步；收藏只在本浏览器；
- jsdom 不等于真实浏览器，布局/滚动/屏幕阅读器需手工验收。

---

## 十、文档

| 文档 | 内容 |
| --- | --- |
| `docs/CODE-AUDIT.md` | 升级前现状审计（31 项能力、P0/P1/P2） |
| `docs/COMPETITIVE-ANALYSIS.md` | 5 个竞品、12 维对比、来源与局限 |
| `docs/PRODUCT-REQUIREMENTS.md` | PRD：范围、功能优先级、数据模型、接口、指标、DoD |
| `docs/USER-FLOWS.md` | 规划/澄清/冲突/调整/降级流程 |
| `docs/PRODUCT-METRICS.md` | 指标口径、事件表、离线评测方案 |
| `docs/ARCHITECTURE.md` | 架构、Schema、模块边界、安全 |
| `docs/AGENT-WORKFLOW.md` | 13 节点工作流、算法、Prompt、工具 |
| `docs/RAG-DESIGN.md` | 为什么本期不做 RAG + 未来方案 |
| `docs/API-INTEGRATION.md` | Agent/地图/配置/错误/联调 |
| `docs/TEST-PLAN.md` | 测试策略、20 类场景、手工清单 |
| `docs/EVALUATION-REPORT.md` | 真实执行的评测结果 |
| `docs/DEPLOYMENT.md` | 本地运行、Docker、部署状态与回滚 |
| `docs/PROJECT-RETROSPECTIVE.md` | 复盘、作品集说明、局限 |

设计系统：`docs/DESIGN-SYSTEM.md` 与 `product-context/`（按 `product-design-system` skill 初始化）。

---

## 十一、上游与许可

- 上游原型：`https://github.com/ExileInGIS/citywalk-ai`（本项目在其基础上升级）；
- 地图数据：© OpenStreetMap contributors，ODbL 1.0；
- 本仓库代码未声明开源许可证（上游未提供），默认保留所有权利；
- 图片素材版权状态未知，不随代码授权。

---

## 十二、English

A short English overview is in [`README-en.md`](./README-en.md). The product UI and docs are in Chinese.
