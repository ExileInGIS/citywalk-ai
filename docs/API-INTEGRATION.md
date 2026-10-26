# CityWalk AI 服务接入指南（Agent API / 地图 API）

> 版本：v1.0 · 2026-10-26
> 适用代码：`server/`（Node 零运行时依赖）、`js/config.js`、`js/agent.js`、`js/map.js`、`js/adapters/map-leaflet.js`
> 原则：**密钥只在服务端；前端只拿非敏感配置；所有远程输出先校验再渲染。**

---

## 1. 两种运行模式

| 模式 | 触发 | 行为 | 是否需要密钥 |
| --- | --- | --- | --- |
| `mock`（默认） | `.env` 的 `AGENT_MODE=mock`，或前端 `AGENT.mode='mock'` | 服务端/浏览器用同一份确定性核心规划 | 否 |
| `remote` | `AGENT_MODE=remote` + 配置 LLM 或 Coze | 服务端调用真实模型，服务端重算并校验 | 是 |

前端 `js/config.js` 只决定**浏览器到自家服务端**的调用方式，不直接调用大模型：

```js
window.CW_CONFIG = {
  AGENT: {
    mode: 'remote',                    // 'mock' | 'remote'
    endpoint: '/api/agent/run',        // 自家服务端
    timeoutMs: 20000,
    fallback: 'mock',                  // 'mock' | 'error'
    headers: {},                       // 不放手牌/密钥
    requestIdHeader: 'X-Request-Id'
  },
  MAP: { provider: 'mock' }            // 'mock' | 'leaflet'
};
```

> 旧字段 `CW_CONFIG.agent` / `CW_CONFIG.map` 作为兼容别名保留，指向同一对象；新代码只用 `AGENT` / `MAP`。

---

## 2. Agent 统一入口（前端）

`js/agent.js`：

```js
const route = await CW.agent.run('plan',  { conditions });
const refine = await CW.agent.run('refine', { text: '少走一点路', route });
const status = CW.agent.status();
```

行为：

1. `mode='mock'` 或 `endpoint` 为空 → 调用 `CW.core` 本地执行，结果标 `source:'mock'`；
2. `mode='remote'` → `POST {endpoint}`，带 `requestId`/`traceId`；
3. 响应先过 `CW.schema.validateRoute` / `validateRefine`，非法不渲染；
4. 超时用 `AbortController`；失败按 `fallback`：
   - `mock`：本地生成 + `degraded:true` + `degradeReason`；
   - `error`：抛错，页面展示错误与重试；
5. `plan` 可能返回 `{ clarification: { missing, questions, note }, conditions }`，前端展示追问卡，不生成路线。

`status()` 返回：

```json
{ "mode": "mock", "connected": false, "endpoint": "/api/agent/run",
  "fallback": "mock", "provider": "mock-rules", "mapProvider": "mock",
  "lastLatencyMs": null, "lastError": null }
```

---

## 3. `POST /api/agent/run`

### 3.1 请求

Header：

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | 是 | `application/json`，否则 415 |
| `X-Request-Id` | 否 | 客户端请求 id；缺省服务端生成 |
| `X-Trace-Id` | 否 | 链路 id；缺省服务端生成 |
| `Authorization` | 否 | 仅当自建网关需要；**不得**在前端放模型密钥 |

Body（≤64KB）：

```json
{
  "requestId": "可选",
  "traceId": "可选",
  "task": "plan",
  "payload": {
    "conditions": {
      "city": "nanjing",
      "durationMin": 240,
      "startTime": "14:00",
      "interests": ["coffee", "history", "photo"],
      "budgetMax": 150,
      "budgetBasis": "total",
      "party": "friends",
      "walkingTolerance": "mid",
      "transport": "walk",
      "pace": "mid",
      "foodPreferences": [],
      "accessibility": [],
      "weather": "any",
      "avoid": [],
      "mustVisit": [],
      "additionalRequirements": ""
    }
  }
}
```

`refine`：

```json
{
  "task": "refine",
  "payload": { "text": "把咖啡馆换成书店", "route": { "...": "Route v1" } }
}
```

### 3.2 成功响应（200）

```json
{
  "code": 0,
  "requestId": "…",
  "traceId": "…",
  "task": "plan",
  "mode": "mock",
  "degraded": false,
  "data": { "...": "Route v1 或 RefineResult v1" },
  "meta": { "durationMs": 42, "provider": "mock-rules", "schemaVersion": "route.v1" }
}
```

澄清（仍是 200）：

```json
{
  "code": 0, "task": "plan", "mode": "mock", "degraded": false,
  "data": {
    "clarification": {
      "missing": ["city", "durationMin"],
      "questions": [
        { "id": "city", "text": "你想在哪座城市漫步？",
          "options": [{ "value": "nanjing", "label": "南京" }] },
        { "id": "durationMin", "text": "大概有多少时间？",
          "options": [{ "value": 120, "label": "2 小时" }] }
      ],
      "note": "先确认城市与时长，其他条件可以用默认值。"
    },
    "conditions": { "...": "归一化后的条件" }
  }
}
```

### 3.3 错误

```json
{
  "code": "INVALID_INPUT",
  "message": "请求不合法",
  "details": [{ "path": "payload.conditions.city", "message": "城市必填" }],
  "requestId": "…",
  "traceId": "…"
}
```

| code | HTTP | 触发 |
| --- | --- | --- |
| `INVALID_INPUT` | 400 | Schema/枚举/长度不合法 |
| `NOT_FOUND` | 404 | 未知 API 路由 |
| `RATE_LIMITED` | 429 | 超过 `RATE_LIMIT_PER_MIN`，带 `Retry-After` |
| `UPSTREAM_TIMEOUT` | 504 | 远程模型超时 |
| `UPSTREAM_ERROR` | 502 | 远程 5xx/网络 |
| `INVALID_OUTPUT` | 502 | 远程输出修复 2 次后仍不合法 |
| `REMOTE_NOT_CONFIGURED` | 503 | mode=remote 但缺少 LLM/Coze 配置 |
| `INTERNAL` | 500 | 未捕获异常（不返回堆栈） |

---

## 4. 数据结构

### 4.1 Conditions

完整字段与默认值见 `docs/ARCHITECTURE.md` 第 4.1 节。要点：

- 必填：`city`；`durationMin` 与 `endTime` 至少一个；
- 硬约束：时长、预算、必去、避开、步行上限、无障碍（可验证部分）；
- 软偏好：兴趣、节奏、同行人、天气、餐饮、多样性；
- 未指定预算不设默认上限，结果页标「未指定」。

### 4.2 Route v1

必含：`schemaVersion/id/city/name/source/createdAt/conditions/places/segments/durationMin/actualMin/stayTotalMin/walkTotalMin/distanceKm/budget/scores/constraints/conflict/explanations/sources/notes/dataQuality`。

- `segments` 与 `places` 等长；
- `scores` 六项均 0–1，`method:'heuristic-v1'`；
- `constraints[].status` ∈ `met/partial/violated/unknown`；
- `conflict.options[].action` 可被服务端执行；
- `dataQuality` 说明坐标/营业时间核验情况；
- `sources` 只放真实 URL（OSM 版权页、项目仓库等）。

### 4.3 RefineResult v1

`changed/reply/bullets/changes/constraintsAfter/unresolved/conflict/route`；`changes[].type` ∈ `add/remove/replace/reorder/duration/budget`。

---

## 5. 服务端配置（`.env`）

复制 `.env.example` 为 `.env`（已 gitignore）：

```bash
AGENT_MODE=mock            # mock | remote
AGENT_TIMEOUT_MS=18000
AGENT_FALLBACK=mock        # mock | error
# OpenAI 兼容（DeepSeek/OpenAI/本地 vLLM 等）
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
# Coze（未联调）
COZE_API_TOKEN=
COZE_BOT_ID=
COZE_BASE_URL=https://api.coze.cn
RATE_LIMIT_PER_MIN=30
CORS_ORIGINS=
TELEMETRY_ENABLED=true
```

**安全**：`.env` 不进仓库；`/api/config` 只返回 `mode/remoteConfigured/telemetryEnabled/version`，不返回任何密钥；日志不记录条件、文本与坐标。

---

## 6. 真实 Agent 接入

### 6.1 OpenAI 兼容（推荐先接这个）

1. 服务端 `.env` 填 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`；
2. `AGENT_MODE=remote`；
3. `pnpm start`；
4. `curl` 验证（见第 9 节）；
5. 失败时按 `AGENT_FALLBACK`：`mock` 会返回 `degraded:true`，UI 显示「已切换本地模拟」。

服务端行为（不依赖模型 SDK）：

- Prompt 要求只输出 JSON，并禁止编造地点/坐标/营业时间；
- 模型只给 `places` 与解释；**所有时间/预算/距离由服务端重算**；
- 输出过 `js/schema.js` 校验；失败修复 ≤2 次；仍失败 → `INVALID_OUTPUT` 或降级。

### 6.2 Coze（未联调）

`server/agent/providers/coze.js` 为最小适配器（v3 Chat API）。**接入前必须**：

- 按 Coze 当前官方文档核对 endpoint、鉴权、请求体与响应字段；
- 在 Coze 控制台配置 Bot 与发布渠道；
- 用真实 token 联调并记录结果；
- 未完成上述步骤前，不得声称「已接入 Coze」。

### 6.3 流式输出

本期**未实现** SSE/流式。原因：非流式已能满足路线级结果，流式协议（分块 JSON、完成事件、取消、断线）需要额外测试与真实服务联调。扩展方案：

- 服务端新增 `POST /api/agent/stream`，`text/event-stream`；
- 事件：`start` / `delta` / `tool` / `done` / `error`；
- 前端用 `AbortController` 取消；
- 不支持时回退非流式。

---

## 7. 地图 Provider

### 7.1 统一契约

```js
CW.MapEngine.registerProvider({ id, init });
const inst = CW.MapEngine.render(container, route, opts);
inst.update(route); inst.select(placeId);
inst.setLayer('pins'|'route'|'base', true); inst.fit(); inst.destroy();
```

- `mock`：现有 SVG 示意地图，离线可用；
- `leaflet`：`js/adapters/map-leaflet.js`，需要 `window.L` 与网络；
- `amap` / `tencent`：**未实现**，只有文档建议；接入前需核对许可、Key 与商用条款。

### 7.2 启用 Leaflet

1. 在 `index.html` 取消 Leaflet CDN 注释（CSS/JS/适配器）；
2. `CW_CONFIG.MAP.provider = 'leaflet'`；
3. 服务端 CSP 需允许 `unpkg.com`（脚本/样式）与瓦片域名（图片），否则浏览器会拦截；
4. 只有 8 个地点有真实坐标（OSM）；4 个泛化地点会被跳过并提示；
5. 路线连线是**直线示意**，不是导航路径；必须显示 OSM 归属。

### 7.3 坐标与许可

- 坐标来源：OpenStreetMap，ODbL 1.0；部分为区域中心（湖面/公园面/道路），不是入口；
- 4 个泛化地点无坐标：`p_cafe_sh/p_book_tg/p_food_ld/p_market`；
- 不得把示意坐标画到真实地图，也不得把直线距离标成导航结果。

---

## 8. 其他接口

### `GET /api/health`

```json
{ "status": "ok", "version": "1.0.0", "mode": "mock", "provider": "mock-rules", "uptimeMs": 1234, "time": "2026-10-26T…" }
```

### `GET /api/config`

```json
{ "mode": "mock", "remoteConfigured": false, "mapProvider": "mock", "telemetryEnabled": true, "version": "1.0.0" }
```

### `POST /api/events`

匿名事件批量上报（≤50 条/次，body≤32KB）；白名单事件见 `docs/PRODUCT-METRICS.md`。服务端只记录计数与结果码，不记录用户文本。`TELEMETRY_ENABLED=false` 时返回 404。

---

## 9. 联调命令

```bash
# 健康检查
curl -s http://localhost:3000/api/health

# Mock 规划
curl -s -X POST http://localhost:3000/api/agent/run \
  -H 'Content-Type: application/json' \
  -H 'X-Request-Id: demo-1' \
  -d '{"task":"plan","payload":{"conditions":{"city":"nanjing","durationMin":240,"interests":["coffee","history"],"budgetMax":150}}}'

# 澄清（缺时长）
curl -s -X POST http://localhost:3000/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"task":"plan","payload":{"conditions":{"city":"nanjing","interests":["coffee"]}}}'

# 调整
curl -s -X POST http://localhost:3000/api/agent/run \
  -H 'Content-Type: application/json' \
  -d '{"task":"refine","payload":{"text":"少走一点路","route":{ ... }}}'
```

Windows PowerShell 可用 `Invoke-RestMethod` 替代 curl；命令与字段一致。

---

## 10. 故障排查

| 现象 | 检查 |
| --- | --- |
| 502/504 | 远程地址、密钥、模型名、超时；看服务端日志的 `errorCode` 与 `traceId` |
| 429 | 调大 `RATE_LIMIT_PER_MIN` 或等待 `Retry-After` |
| 地图空白 | 是否引入 Leaflet、CSP 是否允许 CDN/瓦片、坐标是否存在 |
| 前端显示「已切换本地模拟」 | `degraded:true` 属预期降级；点重试或检查远程配置 |
| 页面 404 | 静态资源只允许 `/css`、`/js`、`/shared`、`/assets` |
| 生产环境泄露堆栈 | 检查 `NODE_ENV=production`；服务端只返回错误码与安全文案 |

---

## 11. 版本与兼容

- Schema：`route.v1` / `refine.v1`；破坏性变更需新版本号与迁移说明；
- 旧配置字段 `agent/map` 保留为别名，但文档与示例只使用 `AGENT/MAP`；
- 本期未实现：SSE、真实高德/腾讯、账号体系、云端持久化。
