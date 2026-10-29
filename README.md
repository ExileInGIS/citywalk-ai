# CityWalk AI · 个性化城市漫步路线规划

> 从高保真原型升级为**可运行、可接入真实服务、可测试**的城市漫步 MVP。
> 默认 Mock 模式无需任何密钥即可完整体验；Remote 模式支持 OpenAI 兼容接口与 Coze 适配。

**一句话**：用自然语言说清「什么时候、和谁、有多少时间、多少钱、想逛什么」，得到一条满足硬约束、顺序可执行、理由可解释、可继续用自然语言修改的城市漫步路线。

> 当前状态：本地可运行 MVP。**未部署到公网；真实地图为 Leaflet + 高德栅格瓦片（非商用/自用），真实 LLM 已做远程评测**；生产部署仍需按 `docs/DEPLOYMENT.md` 与 `docs/EVALUATION-REPORT.md` 核验。

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
| 地图 Provider | 已实现 | 默认 SVG 示意；Leaflet 适配器（真实坐标，需网络） |
| 真实 AI 服务 | 适配器就绪，未联调 | OpenAI 兼容 + Coze 骨架；无密钥，标注未验证 |
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

## 四、接入真实 AI 服务

复制 `.env.example` 为 `.env`（已被 gitignore）：

```bash
AGENT_MODE=remote
LLM_BASE_URL=https://api.deepseek.com/v1   # 任意 OpenAI 兼容服务
LLM_API_KEY=你的服务端密钥
LLM_MODEL=deepseek-chat
AGENT_FALLBACK=mock
```

重启 `pnpm start` 后：

```bash
curl -s -X POST http://localhost:3000/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"task":"plan","payload":{"conditions":{"city":"nanjing","durationMin":240,"interests":["coffee","history"],"budgetMax":150}}}'
```

- 密钥只存在于服务端；前端通过 `/api/config` 只能看到是否已配置；
- 模型只提供候选与解释，时间/预算/距离由服务端重算并过 Schema；
- 失败按 `AGENT_FALLBACK` 降级，界面显示「已切换本地模拟」+ 原因；
- **未提供真实密钥，因此本仓库没有“真实 LLM 已跑通”的记录**；接入步骤见 `docs/API-INTEGRATION.md`。

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

评测只跑 Mock；**远程 LLM、真实地图、公网部署均未验证**，报告不会把 Mock 成绩写成真实服务成绩。

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
- 真实 LLM/地图 Key 只放在本地 `.env`，未提交；生产环境需要代理/授权与域名白名单；
- 没有真实用户数据：不报告转化率、留存率或增长；所有用户偏好结论均为待验证假设；
- **未部署公网**：README 不写“已上线”。

---

## 九、已知限制

- 真实 LLM 质量、Coze 兼容性未验证；
- 真实地图需要网络与 CDN/CSP 配置，本次未在自动化中加载瓦片；
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
