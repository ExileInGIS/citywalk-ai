# 外部服务接入指南（智能体 API / 地图 API）

原型默认 **完全离线运行**：AI 规划是本地规则模拟，地图是自绘 SVG 示意图。需要接真实服务时，**只改 `js/config.js` 一个文件 +（按需）引入适配器**，业务页面无需改动。

```
js/config.js                 ← 唯一的接入开关（部署时改这里）
js/agent.js                  ← AI 统一入口 CW.agent.run()，读 config
js/map.js                    ← 地图统一入口 CW.map.render()，适配器注册表
js/adapters/agent-custom.example.js   ← 智能体自定义请求样例（默认不加载）
js/adapters/map-leaflet.example.js    ← 真实地图适配器样例（默认不加载）
server/agent-proxy.example.js         ← 服务端密钥代理样例（不在前端运行）
```

---

## 一、统一配置：`js/config.js`

```js
window.CW_CONFIG = {
  agent: { mode: 'mock', endpoint: '', auth: {...}, request: null,
           fallback: 'mock', timeoutMs: 20000 },
  map:   { provider: 'svg', amap: {...}, tencent: {...}, leaflet: {...},
           apiKeyFromProxy: '', geocode: null },
  storage: { favorites: 'memory' },
  app: { brand: 'CityWalk AI', defaultCity: 'nanjing', showDemoBadge: true }
};
```

`config.js` 在所有业务脚本**之前**加载，未配置时自动回落到内置默认值（mock / svg），所以删了配置文件也能跑。

---

## 二、接入智能体 API

### 2.1 最简单：标准 HTTP JSON

`js/config.js`：

```js
agent: {
  mode: 'remote',
  endpoint: 'https://your-domain.example.com/api/agent',  // 建议指向自有代理
  auth: { type: 'bearer', token: '' },   // 本地联调用；生产请走服务端代理，见第五节
  fallback: 'mock',                       // 远程挂了是否回退本地模拟
  timeoutMs: 20000
}
```

前端所有 AI 能力都经统一入口调用：

```js
CW.agent.run(task, payload)
// task = 'plan'   payload = { conditions }
// task = 'refine' payload = { text, route }
```

### 2.2 请求协议

**请求**（`POST {endpoint}`）：

```json
{
  "task": "plan",
  "payload": {
    "conditions": {
      "city": "nanjing", "durationMin": 240,
      "interests": ["coffee", "history", "photo"],
      "budgetMax": 150, "pace": "mid", "transport": "walk",
      "startAt": "14:00", "from": "", "mustEnd": "", "noBacktrack": true
    }
  }
}
```

**`plan` 期望返回**（顶层可包一层 `{ code:0, data:{...} }`，前端会自动取 `data`）：

```json
{
  "id": "route-xxx",
  "name": "南京老城 · 均衡漫步",
  "city": "nanjing",
  "source": "ai",
  "places": ["p_yihe", "p_cafe_sh", "p_xuanwu"],
  "segments": [
    { "placeId": "p_yihe",  "stay": 60, "walkFromPrev": 0 },
    { "placeId": "p_cafe_sh","stay": 45, "walkFromPrev": 12 },
    { "placeId": "p_xuanwu", "stay": 80, "walkFromPrev": 25 }
  ],
  "durationMin": 240, "actualMin": 222,
  "stayTotal": 185, "walkTotal": 37, "distanceKm": 2.8,
  "budget": [35, 70], "budgetMax": 150,
  "style": ["历史文化", "少走回头路", "适中"],
  "conditions": { "...": "原样回传" },
  "notes": ["时长、距离与费用均为估算值"],
  "conflict": null,
  "orderDirty": false,
  "createdAt": "2026-10-25T12:00:00.000Z"
}
```

**`refine` 期望返回**：

```json
{
  "changed": true,
  "reply": "我把咖啡馆加在了书店之前。",
  "bullets": ["新增 1 站", "预计步行增加约 6 分钟"],
  "changes": [{ "type": "add", "label": "上海路街角咖啡馆" }],
  "conflict": null,
  "route": { "...完整 Route 对象，同 plan..." }
}
```

冲突时不要静默丢需求，返回：

```json
{ "changed": false, "conflict": {
    "type": "time", "title": "时间预算不足",
    "detail": "当前安排约需 4 小时 40 分，超出你给的 3 小时。",
    "options": [ { "id": "drop_last", "label": "减少一个地点" },
                 { "id": "pace_light", "label": "调整为轻松节奏" } ] } }
```

前端会校验返回结构（必须有非空 `places` / `route.places`），结构不合法会按 `fallback` 处理或报错，不会渲染脏数据。

### 2.3 对接 Coze / 其他 Agent SDK（协议不一致时）

在 `config.js` 挂自定义函数，或参考 `js/adapters/agent-custom.example.js`：

```js
agent: {
  mode: 'remote',
  request: async (task, payload) => {
    // 在这里调平台 SDK / 处理流式输出，
    // 把结果整理成上面的 Route 结构后 return
  }
}
```

建议让智能体用 **function calling / JSON mode** 直接产出结构化路线（系统提示词样例见 `server/agent-proxy.example.js` 的 `PLAN_SYSTEM_PROMPT`）。

### 2.4 地点标识

`places` / `segments.placeId` 应与 `js/data.js` 中地点 `id` 一致；也可以返回**完整地点对象数组**并在 `data.js` 的数据访问层注册新地点。无法确认的营业时间、坐标、耗时不要编造——前端约定用 `hours: null` 表示「信息待确认」。

---

## 三、接入真实地图

### 3.1 切换 provider

`js/config.js`：

```js
map: { provider: 'leaflet', /* 或 'amap' | 'tencent' | 'custom' */
       leaflet: { tileUrl: '...', attribution: '...', routerUrl: '...' } }
```

业务侧始终只调 `CW.map.render(host, route, { onSelect })`，不感知底层厂商。

### 3.2 适配器接口（任意厂商都一样）

```js
CW.map.registerProvider('my-map', function render(host, route, opts) {
  // 在这里初始化厂商 SDK、画底图 / 标记 / 路线
  return {
    update(route) { /* 路线变化时重绘，不重建地图实例 */ },
    select(id)   { /* 卡片联动：平移/高亮标记 */ },
    destroy()    { /* 销毁实例，避免泄漏 */ }
  };
});
```

完整样例见 `js/adapters/map-leaflet.example.js`（Leaflet + OSM），接入后在 `index.html` 引入 Leaflet 的 CSS/JS 与该适配器，并把该文件加入 `build.js` 的 `JS_ORDER`。高德 / 腾讯把样例里的 `L.*` 换成对应 JS API 即可。

### 3.3 必须补真实坐标

模拟地点只有示意坐标 `mapX/mapY`（0–1000 的图幅坐标，不是经纬度），**不能用于真实地图**。二选一：

- 在 `js/data.js` 每个地点补 `lng` / `lat` 字段；或
- 在 `config.js` 提供 `map.geocode = async (place) => ({ lng, lat })`，由你的地理编码服务按地点解析。

适配器拿不到真实坐标时**跳过该点**，不会把标记画到错误位置。样例中路线用直线连接，真实步行路径需再接入路径规划服务（如 OSRM、高德/腾讯步行导航）替换坐标串。

---

## 四、收藏持久化（可选）

```js
storage: { favorites: 'localStorage' }   // 默认 'memory'，仅本次会话
```

接账号体系时，把 `js/pages/favorites.js` 的读写换成请求你的用户收藏接口即可。

---

## 五、安全与上线注意

1. **密钥不要进前端仓库**。浏览器代码用户可见，`auth.token` 只适合本地联调；正式环境让请求经过自己的后端 / Serverless 代理（参考 `server/agent-proxy.example.js`），密钥放服务端环境变量。
2. 地图 key 同样建议用 `map.apiKeyFromProxy` 指向你的后端换取，并在地图厂商后台配置域名白名单。
3. 接真实服务后，界面上的「演示模式 · 本地规则模拟」徽标会自动变为「已连接智能体服务」；SVG 地图的「示意」提示由真实地图适配器自行替换。
4. 远程失败时若 `fallback:'mock'`，界面会明确提示「已切换为本地模拟」，不会把模拟结果冒充真实结果。
