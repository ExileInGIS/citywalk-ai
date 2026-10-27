# CityWalk AI 系统架构（Architecture）

> 版本：v1.0 · 2026-10-26
> 状态：设计已定，随实现同步更新
> 关联：`docs/PRODUCT-REQUIREMENTS.md`、`docs/AGENT-WORKFLOW.md`、`docs/API-INTEGRATION.md`

---

## 1. 架构目标

1. **保留已验证的前端资产**：不迁移框架，不重写视觉；在现有 `index.html + css + js/pages` 上增量升级。
2. **一个确定性核心，两处复用**：浏览器 Mock 与 Node 服务端调用同一份规划/调整/校验代码，避免行为漂移。
3. **服务端是唯一可信边界**：密钥、远程调用、Schema 校验、限流、日志在服务端；浏览器不持有密钥。
4. **可替换的 Provider**：Agent 与地图都通过契约适配，Mock 是默认实现，真实服务是可插拔实现。
5. **可测试**：核心函数纯函数化；HTTP 层可注入；UI 用 jsdom 驱动。

---

## 2. 系统上下文

```
┌──────────────────────────── 浏览器（静态前端） ────────────────────────────┐
│ index.html                                                                 │
│  ├─ css/style.css（既有设计系统 + 增量）                                    │
│  ├─ js/data.js（UMD：地点/路线目录，浏览器与 Node 共用）                    │
│  ├─ js/schema.js（UMD：Conditions/Route/RefineResult 校验）                 │
│  ├─ shared/core.js（UMD：规划/调整/约束/评分，确定性）                       │
│  ├─ js/agent.js（统一 Agent 入口 run/status：mock 走 core，remote 走 HTTP）  │
│  ├─ js/map.js（Provider 注册 + 统一 render）                                 │
│  ├─ js/storage.js（localStorage 持久化，可关闭）                             │
│  ├─ js/telemetry.js（匿名事件队列）                                          │
│  ├─ js/pages/*.js（首页/发现/收藏）                                          │
│  └─ js/app.js（路由/状态）                                                   │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ POST /api/agent/run（JSON，requestId/traceId）
                                ▼
┌──────────────────────── 服务端 Node（零运行时依赖） ────────────────────────┐
│ server/index.js                                                             │
│  ├─ 静态资源 + 安全响应头 + 请求体限制 + 限流 + 访问日志                      │
│  ├─ POST /api/agent/run → agent/run.js（编排）                              │
│  ├─ GET  /api/health、/api/config                                           │
│  └─ POST /api/events（可选，匿名事件）                                      │
│                                                                             │
│ agent/run.js                                                                │
│  ├─ validate Input（schema.js）                                             │
│  ├─ task=plan  → extract → clarify? → plan → validate → explain              │
│  ├─ task=refine→ parse instruction → refine → validate → explain             │
│  ├─ provider: mock（shared/core.js）| openai-compatible | coze               │
│  ├─ repair retry ≤2（远程非法输出）                                          │
│  └─ fallback: mock（degraded=true）| error                                   │
│                                                                             │
│ 数据：js/data.js（UMD：地点/坐标/路线）+ server/data/poi-coords.json      │
│ 配置：server/config.js（env）+ server/config/scoring.json                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 模块边界与文件所有权

| 模块 | 文件 | 职责 | 只读依赖 |
| --- | --- | --- | --- |
| 目录数据 | `js/data.js` | 城市/类别/兴趣/12 地点/6 精选路线；UMD 导出 | 无 |
| Schema | `js/schema.js` | 校验 Conditions/Route/RefineResult；错误列表 | 无 |
| 确定性核心 | `shared/core.js` | 解析、规划、约束、评分、调整、解释 | `js/data.js`、`js/schema.js` |
| 前端 Agent 适配 | `js/agent.js` | `run/status`；mock 调用 core；remote 调 `/api/agent/run`；超时/降级/二次校验 | core、config |
| 地图层 | `js/map.js` | Provider 注册/渲染；Mock SVG；失败回退 | data、ui |
| 地图适配器 | `js/adapters/map-leaflet.js` | Leaflet + OSM 实现契约 | Leaflet（CDN） |
| 持久化 | `js/storage.js` | 收藏/草稿/会话 id；可清除；容量保护 | localStorage |
| 埋点 | `js/telemetry.js` | 匿名事件、批量上报、失败静默 | config |
| 页面 | `js/pages/*.js` | 渲染与交互；不直接调第三方 AI | agent、map、ui |
| 服务端 | `server/index.js` | HTTP、静态、路由、安全、限流、日志 | node:http |
| 编排 | `server/agent/run.js` | 计划/调整/澄清/降级/重试 | core、schema、providers |
| Provider | `server/agent/providers/*.js` | mock / OpenAI 兼容 / Coze | fetch（Node 内置） |
| Prompt | `server/agent/prompts/*.md` | 系统提示词与输出契约 | 无 |
| RAG | `server/agent/rag.js` | 可选：TF-IDF 检索 + 引用 | 知识库 JSON |
| 评测 | `scripts/eval.js` | 固定集、基线、指标、报告 | core、schema |
| 测试 | `tests/**` | 单测/API/集成 | node:test、jsdom |

**禁止**：页面直接 `fetch` 第三方 AI；服务端把密钥写进响应；浏览器端写入未校验的远程数据。

---

## 4. 数据模型（v1）

### 4.1 Conditions

```ts
type Conditions = {
  city: 'nanjing' | string;           // 必填；其他城市无完整数据
  startLocation?: string;             // 起点/区域，文本，不参与精确计算
  durationMin: number;                // 必填*；60–720
  startTime?: string;                 // HH:mm，默认 14:00
  endTime?: string;                   // HH:mm；给定则 durationMin 由它推导
  interests: string[];                // coffee|history|photo|book|park|local
  budgetMax?: number | null;          // 0–10000；null=未指定
  budgetBasis?: 'total' | 'per_person';
  party?: 'solo'|'friends'|'couple'|'family';
  walkingTolerance?: 'light'|'mid'|'deep';
  transport?: 'walk'|'mix'|'bike';
  pace?: 'light'|'mid'|'deep';
  foodPreferences?: string[];
  accessibility?: string[];
  weather?: 'any'|'rain'|'sunny'|'hot'|'cold';
  avoid?: string[];                   // 地点 id 或类别
  mustVisit?: string[];               // 地点 id 或名称
  additionalRequirements?: string;    // ≤200 字
};
```

\* `durationMin` 与 `endTime` 至少一个；缺失触发澄清。

### 4.2 Route

```ts
type Route = {
  schemaVersion: 'route.v1';
  id: string;
  city: string;
  name: string;
  source: 'mock'|'remote'|'curated';
  createdAt: string;                  // ISO
  conditions: Conditions;             // 归一化后的条件（含默认值）
  places: string[];                   // 1..8，唯一
  segments: Segment[];                // 与 places 等长
  durationMin: number;                // 用户预算
  actualMin: number;                  // 停留+步行
  stayTotalMin: number;
  walkTotalMin: number;
  distanceKm: number;
  budget: { min: number; max: number; currency: 'CNY'; basis: string };
  style: string[];
  scores: {
    overall: number; interest: number; timeFit: number;
    efficiency: number; budgetFit: number; diversity: number;
    weights: Record<string, number>;
    method: 'heuristic-v1';
  };
  constraints: ConstraintCheck[];
  conflict: Conflict | null;
  explanations: { placeId: string; why: string; evidence: SourceRef[] }[];
  sources: SourceRef[];
  notes: string[];
  dataQuality: {
    placesTotal: number; placesWithCoords: number;
    placesWithHours: number; placesVerified: number;
    disclaimer: string;
  };
  degraded?: boolean;
  degradeReason?: string;
};

type Segment = {
  placeId: string; stayMin: number; walkFromPrevMin: number;
  distanceFromPrevKm: number; arriveAt?: string; departAt?: string;
  indoor?: boolean | null;            // null=未知
};

type ConstraintCheck = {
  id: string; label: string; kind: 'hard'|'soft';
  status: 'met'|'partial'|'violated'|'unknown';
  detail: string; actual?: number|string; expected?: number|string;
};

type Conflict = {
  type: 'time'|'budget'|'must_visit'|'walking'|'accessibility'|'no_candidates';
  title: string; detail: string;
  options: { id: string; label: string; action: Record<string, unknown> }[];
};

type SourceRef = { title: string; url: string; accessedAt: string; license?: string; note?: string };
```

### 4.3 RefineResult

```ts
type RefineResult = {
  schemaVersion: 'refine.v1';
  changed: boolean;
  reply: string;
  bullets: string[];
  changes: { type: 'add'|'remove'|'replace'|'reorder'|'duration'|'budget';
             label: string; from?: string; to?: string; placeId?: string }[];
  constraintsAfter: ConstraintCheck[];
  unresolved: string[];
  conflict: Conflict | null;
  route: Route;
  degraded?: boolean;
  degradeReason?: string;
};
```

### 4.4 API envelope

```ts
type Ok<T> = { code: 0; requestId: string; traceId: string; task: 'plan'|'refine';
               mode: 'mock'|'remote'; degraded: boolean; data: T;
               meta: { durationMs: number; provider: string; schemaVersion: string } };
type Err = { code: ErrorCode; message: string; details?: unknown;
             requestId: string; traceId: string };
type ErrorCode = 'INVALID_INPUT'|'NOT_FOUND'|'RATE_LIMITED'|'UPSTREAM_TIMEOUT'
               |'UPSTREAM_ERROR'|'INVALID_OUTPUT'|'REMOTE_NOT_CONFIGURED'|'INTERNAL';
```

---

## 5. 统一 Agent 契约（前端）

`js/agent.js` 暴露：

```js
CW.agent.run(task, payload, opts) -> Promise<Route | RefineResult>
CW.agent.status() -> { mode, connected, endpoint, fallback, lastLatencyMs?, lastError? }
CW.agent.configure(config)      // 测试注入
```

行为：
- `mode='mock'` 或 `endpoint` 为空 → `CW.core` 本地执行（离线可用），返回结果标 `source:'mock'`；
- `mode='remote'` → `POST endpoint`，携带 `requestId`/`traceId`/`Authorization`（仅本地联调）；
- 响应先过 `CW.schema.validateRoute/validateRefine`；非法 → 抛 `INVALID_OUTPUT` 或降级；
- 超时用 `AbortController`；失败按 `fallback` 降级，结果 `degraded:true` + `degradeReason`；
- **不把远程返回直接渲染**。

---

## 6. 服务端契约

### 6.1 请求生命周期

```
HTTP 请求
 → 生成/继承 requestId、traceId（X-Request-Id / X-Trace-Id）
 → 限流（内存令牌桶，按 IP）
 → 读取 body（≤64KB，超限 413）
 → Content-Type 校验（application/json）
 → 路由
 → 输入校验（schema）
 → 编排（provider）
 → 输出校验（schema）
 → 统一 envelope
 → 日志（结构化、脱敏）
```

### 6.2 远程 Provider

- **OpenAI 兼容**：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`；`POST /chat/completions`；`response_format:{type:'json_object'}`（若不支持则解析文本中的 JSON）；temperature 0.2；超时 18s。
- **Coze**：`COZE_API_TOKEN`、`COZE_BOT_ID`、`COZE_BASE_URL`；按 Coze v3 Chat API 实现；**未联调，标注未验证**。
- **工具调用**：远程模型只能通过 `getCandidates` / `validateRoute` 工具获得事实；最终路线仍由服务端校验并重算时间/预算。
- **修复重试**：把校验错误作为追加消息回传，≤2 次；仍失败 `INVALID_OUTPUT`。
- **降级**：`AGENT_FALLBACK=mock` 时返回 Mock 结果 + `degraded:true`；`error` 时返回标准错误。

### 6.3 错误与状态码

| code | HTTP | 触发 |
| --- | --- | --- |
| `INVALID_INPUT` | 400 | Schema/枚举/长度不合法 |
| `NOT_FOUND` | 404 | 未知路由 |
| `RATE_LIMITED` | 429 | 超限 |
| `UPSTREAM_TIMEOUT` | 504 | 远程超时 |
| `UPSTREAM_ERROR` | 502 | 远程 5xx/网络 |
| `INVALID_OUTPUT` | 502 | 远程输出无法修复 |
| `REMOTE_NOT_CONFIGURED` | 503 | mode=remote 但缺配置 |
| `INTERNAL` | 500 | 未捕获异常（不泄露堆栈） |

---

## 7. 地图 Provider 契约

```js
CW.MapEngine.registerProvider({ id, init });
CW.MapEngine.render(container, route, opts) -> {
  update(route), select(id), setLayer(name, on), fit(), destroy(), provider
}
```

- `init(container, opts)` 返回实例方法；失败抛错，由 `render` 捕获并回退；
- 无有效坐标的点跳过，并在容器内显示 `N 个地点缺少坐标`；
- Mock Provider 保留现有 SVG 交互（缩放/拖动/图层/图例）；
- Leaflet Provider：校验 `lat/lng` 数值范围；瓦片失败监听 `tileerror`；销毁 `map.remove()`；归属标注必须展示；
- 任何 Provider 不得把示意坐标画到真实地图。

---

## 8. 状态与持久化

- 前端全局状态沿用 `CW.state`（`nav/city/draft/route/...`），新增 `service`（mode/connected/degraded）、`lastDiff`、`storageEnabled`；
- `js/storage.js` 键：`cw.favorites.v1`、`cw.draft.v1`、`cw.sessionId`；写入加 try/catch（配额/隐私模式）；
- 服务端无数据库；事件仅内存聚合（重启清空），符合隐私最小化。

---

## 9. 安全边界

| 边界 | 控制 |
| --- | --- |
| 浏览器 ↔ 服务端 | 同源、CSP、请求体限制、限流、CORS 白名单（默认关闭跨域） |
| 服务端 ↔ LLM | 密钥仅环境变量；出站超时；不把用户原文写入日志；错误码脱敏 |
| 服务端 ↔ 数据 | 只读 JSON；不执行用户输入；JSON 解析限制深度/大小 |
| 渲染 | 所有动态文本经 `esc`；禁止 `innerHTML` 拼接未转义远程字段；CSP 禁止内联脚本（需移除/改造内联事件） |
| 文件系统 | 静态服务只允许白名单目录；路径规范化，拒绝 `..` |

---

## 10. 部署拓扑（本地与可选）

```
本机：node server/index.js → http://localhost:3000（静态 + API 同源）
可选：反向代理（Nginx/Caddy）→ HTTPS + 域名；Node 进程由 systemd/pm2 管理
可选：Docker（node:24-alpine）→ 单容器；环境变量注入密钥
公网：本次未部署（无凭据/网络），部署步骤见 docs/DEPLOYMENT.md
```

---

## 11. 关键设计决策（ADR 摘要）

| 决策 | 选项 | 选择与理由 |
| --- | --- | --- |
| 前端是否迁移 React/Vite | 迁移 / 保留原生 | **保留原生**：现有交互已验证，迁移重写成本高、收益低；本次目标是服务链路而非框架 |
| 后端框架 | Express / 内置 http | **内置 http**：零运行时依赖、攻击面小、足够支撑 4 个接口；用自建中间件保持可控 |
| 数据共享方式 | 复制 JSON / UMD 单源 | **UMD 单源**：浏览器与 Node 共用 `js/data.js` 与 `shared/core.js`，避免两套规划逻辑漂移 |
| 结构化校验 | 引入 Ajv / 自写 | **自写轻量校验**：避免运行时依赖；覆盖本项目的固定 Schema；后续可替换 Ajv |
| 持久化 | SQLite / localStorage | **localStorage**：无账号需求、隐私最小；局限（单浏览器/可清除）写入文档 |
| RAG | 立即上 / 先验证 | **先验证语料**：有来源与许可才做最小检索；否则不做并说明（见 RAG-DESIGN） |
| 远程 LLM | SDK / HTTP | **HTTP**：零依赖、可替换任意 OpenAI 兼容服务；Coze 单独适配并标注未验证 |
| 测试 | Jest/Vitest / node:test | **node:test**：内置；仅 jsdom 作为 DOM 环境 |

> 以上「如何做」的决策已在 `docs/decisions/` 留档（实现阶段补齐编号 ADR）。

---

## 12. 风险与未决

- 真实 LLM/地图凭据缺失 → 无法证明真实链路，报告必须标注未验证；
- jsdom 与真实浏览器存在差异（布局/滚动/焦点）→ 手测清单补足；
- 图片版权状态不明 → 文档标注、上线前替换；
- 单文件构建产物与多文件版同步 → 构建脚本纳入测试，README 说明主版本；
- 中文 NL 解析规则覆盖有限 → 评测集量化，远程模式交给 LLM，Mock 明确边界。
