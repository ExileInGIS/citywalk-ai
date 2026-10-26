# CityWalk AI 现状审计报告（阶段 1）

> 审计日期：2026-10-26
> 审计对象：GitHub `ExileInGIS/citywalk-ai`，上游 `main` 分支（tree `94a657c1ce5bc790a37292476f440ae35c73c843`）
> 本地基线：`D:\PM\Citywalk_Agent`，首个提交 `f9ce979 chore: import upstream citywalk-ai prototype baseline`
> 审计方式：源码逐文件阅读 + 构建/测试命令实际执行 + GitHub API 目录与文件哈希核对
> 环境：Windows，Node.js v24.21.0（DSH 内置运行时），pnpm 11.28.5；系统未安装全局 Node/npm；shell 直连 GitHub 失败，仓库通过 Harness HTTPS 工具获取

---

## 一、结论摘要

现有仓库是一个**完成度较高、诚实标注边界的桌面端高保真原型**，不是可交付的产品：

- 前端三页（首页 / 发现路线 / 我的收藏）交互完整，视觉语言统一，CSS 设计变量已成体系；
- AI 能力 **100% 是浏览器本地规则模拟**，没有真实 LLM、没有后端、没有 `/api/agent/run`；
- 地图是**手绘 SVG 示意地图**，没有真实坐标，没有地图 Provider 的真实实现（只有未加载的 Leaflet 示例）；
- 测试脚本依赖作者本机绝对路径（`/tmp/node_modules/jsdom`、`/Coze/Drive/扣子/...`），在当前环境无法运行，也没有 `package.json`，README 宣称的「68 + 31 项检查」**不可复现**；
- 仓库没有服务端运行时代码、没有输入校验/Schema 校验/限流/日志/Trace、没有 CI、没有部署配置；
- 无障碍与响应式存在明确缺口：JS 中 `aria-*`/`role` 出现 0 次，`viewport` 被固定为 `width=1440`，无 focus-visible、无 reduced-motion 处理。

**判定：原型可复用（视觉、组件、页面结构、Mock 规划逻辑），但产品闭环、真实服务接入、工程化、测试与文档需要重建。**

---

## 二、获取与核对（可复现）

1. `git clone` 在本机失败：`Failed to connect to github.com:443`；`curl` 报 schannel 无凭据；`web_fetch`/GitHub API 可用。
2. 通过 GitHub API 获取 tree（50 个文件，4,567,686 字节），并用 Node `fetch` 下载 `main` 分支 tarball（4,390,793 字节）解压到工作目录。
3. 用 `git hash-object` 对照 GitHub blob SHA 抽查 8 个文件（README、CSS、config、agent、map、home、JPEG、PNG），**全部一致**。
4. 基线提交前 `D:\PM\Citywalk_Agent` 为空目录，不存在需要保护的用户未提交工作；因此新建 git 仓库并提交上游基线（未改写上游历史）。
5. 上游仓库无 GitHub Release、无 tag 信息被读取；本报告只对 `main` 当前快照负责。

---

## 三、代码规模

| 文件 | 行数 | 角色 |
| --- | ---: | --- |
| `js/pages/home.js` | 877 | 首页工作台：输入、加载、地图/摘要/时间线、对话调整 |
| `js/agent.js` | 704 | 本地规则 Agent：解析、规划、约束、调整、远程调用骨架 |
| `css/style.css` | 约 1,700 条 CSS 规则 / 559 个非空行统计口径 | 设计系统与全部页面样式 |
| `js/data.js` | 285 | 12 个地点、6 条精选路线、标签体系 |
| `js/map.js` | 281 | SVG 示意地图 + Provider 注册表 |
| `js/app.js` | 198 | 全局状态、路由、顶栏 |
| `js/pages/favorites.js` | 186 | 收藏页 |
| `js/pages/discover.js` | 161 | 发现页 |
| `js/ui.js` | 136 | DOM 助手、40+ SVG 图标、Toast、Modal |
| `index.html` | 50 | 入口 |
| `tests/smoke.js` / `tests/checks.js` | 194 / 122 | 作者本机冒烟检查（不可运行） |
| `server/agent-proxy.example.js` | 56 | 服务端代理示例（未接入、未运行） |
| `js/adapters/*.example.js` | 44 / 85 | 智能体 / Leaflet 适配示例（默认不加载） |

> 行数是本次审计命令的统计结果；`css/style.css` 因压缩/多规则同行，行数与规则数口径不同，以文件实际为准。

---

## 四、逐项能力核对

图例：**已实现** = 代码存在且可执行；**部分实现** = 有骨架/示例但未闭环；**缺失** = 没有实现。

| # | 能力 | 状态 | 证据与说明 |
| --- | --- | --- | --- |
| 1 | 三页路由与页面渲染 | 已实现 | `js/app.js:37-58,182-197`；`home/discover/favorites` 三个 `render` |
| 2 | 自然语言需求解析 | 部分实现 | `js/agent.js:45-89` 仅关键词/正则；无 LLM；无结构化 Schema |
| 3 | 必填信息检查与追问 | 部分实现 | `js/agent.js:90-125`；`home.js:344-365` 仅覆盖城市/时长，追问只进对话，不是结构化澄清 |
| 4 | 路线规划（候选/排序/打分） | 已实现（规则） | `js/agent.js:169-233`；贪心插入 + 地理扫掠；非真实路径规划 |
| 5 | 硬约束校验（时间/预算） | 部分实现 | `js/agent.js:275-308`；仅时间超出 10% 与预算上限；无必去点、避开项、无障碍、步行上限 |
| 6 | 自然语言调整 | 部分实现 | `js/agent.js:401-563` 约 6 类规则；无「保留首尾」「下雨室内」「不要类似」等；无修改前后完整差异与未解决约束 |
| 7 | 冲突解释与选项 | 部分实现 | `js/agent.js:565-590`；选项执行 `resolveConflict` 存在，但冲突类型有限 |
| 8 | 统一 Agent 入口 | 部分实现 | `js/agent.js:663-695` `run/status`；远程仅浅校验 `places` 数组（`:635-650`） |
| 9 | 真实 Agent API | 缺失 | 无 `/api/agent/run` 服务端；`endpoint` 为空即回落 mock |
| 10 | 服务端代理 | 缺失 | 只有 `server/agent-proxy.example.js`，未被任何启动脚本引用 |
| 11 | 请求 ID / Trace / 超时 / 重试 / 错误码 | 部分实现 | 仅前端 `fetchWithTimeout`（`:605-610`）；无 requestId/traceId、无重试、无统一错误码 |
| 12 | 结构化输出校验 | 缺失 | `normalizeRemote` 只查 `places`/`route.places`；不校验字段类型、范围、引用完整性 |
| 13 | Prompt / 工具调用 / Workflow | 缺失 | 无 Prompt 文件、无工具层、无工作流编排、无评测集 |
| 14 | 地图 Provider 注册 | 部分实现 | `js/map.js:256-260` `registerProvider(name, fn)`，与目标接口 `registerProvider({id, init})` 不一致 |
| 15 | 地图统一渲染接口 | 部分实现 | `js/map.js:233-250` 返回 `update/select/destroy`；缺 `setLayer` / `fit` |
| 16 | 真实地图 | 缺失 | 只有 `js/adapters/map-leaflet.example.js`；数据无经纬度；默认 `provider:'svg'` |
| 17 | 地图与列表/时间线联动 | 已实现 | `home.js:556-559,767-785`；点地图回调 `selectPlace`，卡片滚动高亮 |
| 18 | 地图降级提示 | 部分实现 | `js/map.js:263-278` 未加载适配器时回退 SVG；无加载失败/无效坐标处理 |
| 19 | 结果页关键信息 | 部分实现 | `home.js:562-630,701-741`；有顺序/停留/总时长/距离/预算/理由/冲突；缺数据来源+更新时间、逐点约束满足、可信度 |
| 20 | 保存/复制/导出 | 部分实现 | 收藏在内存；分享为复制文本（`home.js:609-629`）；无 JSON/Markdown 导出、无持久化 |
| 21 | 空/错误/加载状态 | 部分实现 | 收藏空状态、加载 4 步、请求失败提示存在；无全局错误边界、无统一重试组件 |
| 22 | AI/地图状态提示 | 部分实现 | 对话头部 `A.status().connected`（`home.js:181`）；地图 note 固定文案；无连接探测 |
| 23 | 设计系统 | 部分实现 | `style.css` 有颜色/间距变量与组件样式；无 token 文档、无组件规范、无状态矩阵 |
| 24 | 无障碍 | 缺失 | JS 中 `aria-*`/`role` 0 处；地图 SVG `<g>` 不可聚焦；Modal 无焦点圈闭/`role="dialog"`；`index.html` viewport 固定 `width=1440` |
| 25 | 响应式 | 缺失 | 同上；桌面 1440 固定视口，小屏不保证可用 |
| 26 | 用户系统 / 持久化 | 缺失（设计上不需要） | 无账号、无数据库；`config.js:93` 宣称 `localStorage` 可选项但代码未实现（`favorites.js` 无 localStorage 调用） |
| 27 | 服务端安全 | 缺失 | 无限流、无 CORS 策略、无请求体限制、无日志脱敏、无 CSP；前端配置示例可放 token（文档已警示） |
| 28 | 测试 | 不可用 | `tests/smoke.js:3` `require('/tmp/node_modules/jsdom')`；`:5` `/Coze/Drive/扣子/...`；无 `package.json`；`node tests/smoke.js` 实测 `MODULE_NOT_FOUND` |
| 29 | 构建 | 部分实现 | `build.js` 可生成单文件 `CityWalk-AI.html`，但产物被 `.gitignore:2` 忽略，仓库内没有该文件；README 第 18 行仍把它列为交付版本 |
| 30 | CI / 部署 | 缺失 | 无 `.github/workflows/`、无 Dockerfile、无部署脚本 |
| 31 | 文档与代码一致性 | 部分实现 | `docs/API-INTEGRATION.md` 与 `js/config.js` 基本一致；但它描述的是「未来接入」，不是已实现能力；README 的测试数字无法复现 |

---

## 五、数据真实性核对

- 地点名称取自南京真实地标，但 `js/data.js:3-10` 明确声明全部为演示数据；`hours` 一律 `null`（`:98` 等），界面显示「信息待确认」——**这一点做得正确，应保留**。
- 坐标是 `mapX/mapY`（0–1000 × 0–640 图幅坐标），不是经纬度；`js/data.js:89` 明确标注「非真实经纬度」。
- 距离/步行时间是「图幅单位 × 8 米」与 75 米/分钟估算（`js/agent.js:127-134`），不是地图厂商结果；界面已标注估算。
- 消费区间、停留时长均为产品假设，无来源。
- 结论：现有数据**不能**直接用于真实地图或导航；升级时必须补真实坐标与来源，或明确降级。

---

## 六、缺陷与风险清单

### P0（阻断「可交付产品」）

1. **测试不可复现**：硬编码作者本机路径 + 缺 `jsdom` 依赖 + 无 `package.json`；README 的 132 项检查数字不能作为本项目结果。
2. **没有后端与真实 Agent 调用链路**：`/api/agent/run` 不存在，远程模式无服务可连，`docs/API-INTEGRATION.md` 描述的是未来能力。
3. **结构化输出无 Schema 校验**：远程返回只要含非空 `places` 就会被渲染，无法防止字段缺失、地点引用不存在、时间/预算越界。
4. **无障碍与响应式不达交付线**：0 个 `aria` 属性、固定 1440 视口、Modal 无焦点管理、地图不可键盘操作。
5. **`config.js` 存储选项与实现不一致**：文档说可切 `localStorage`，代码未实现，用户会以为收藏能留存。

### P1（影响体验/可维护性）

6. 地图 Provider 接口与目标契约不一致（缺 `setLayer`/`fit`，注册签名不同），真实地图无法直接接入。
7. 必填信息检查只覆盖城市/时长；预算、同行人、无障碍、必去点等会静默使用默认值。
8. 自然语言调整只覆盖 6 类；「保留首尾」「不要类似」「下雨室内」等要求未实现；每次调整没有持久的「调整前后」对比与未满足约束清单。
9. 规划打分权重无出处、不可配置、无解释；没有评分口径文档。
10. 数据无真实坐标、无来源、无更新时间；接入真实地图会失败或画错点。
11. README 描述单文件版但仓库不含该文件（虽可由 `build.js` 生成）；测试数字不可验证。

### P2（工程质量）

12. 17 处 `innerHTML` 赋值，多数经 `U.esc`，但缺少统一的「不可信内容」边界与 CSP。
13. 前端无请求取消、无并发保护（对话已串行化，但生成请求没有）。
14. 无 CI、无 Docker、无 `.env.example`、无日志。
15. 服务端示例未使用、未测试，Node 版本/依赖未声明。

---

## 七、可复用资产（升级时保留）

| 资产 | 复用方式 |
| --- | --- |
| `css/style.css` 视觉语言与组件类 | 保留并补充 token/状态/响应式/焦点样式，不做重设计 |
| `js/ui.js` 图标、Toast、Modal | 保留，补 `role`/焦点圈闭/`aria-live` |
| `js/map.js` SVG 示意地图 | 保留为 Mock Provider，补 `setLayer/fit` 与 failed 状态 |
| `js/pages/home.js` 工作台结构 | 保留布局与交互骨架，增字段、澄清、差异、导出、来源 |
| `js/data.js` 地点与精选路线 | 保留内容与图片，补真实坐标/来源/室内外/无障碍字段 |
| `js/agent.js` 规则规划 | 保留算法思想，迁到共享核心供浏览器与 Node 共用，并补约束/校验 |
| `js/adapters/*.example.js` | 作为真实适配器起点重写，不直接信任 |
| 12 张地点图片 + 原始素材 | 保留（版权状态上游未声明，需在文档中标注「来源与许可待核实」） |

---

## 八、阶段 1 结论

1. 原型的产品结构、交互密度和视觉质量足以作为升级底座；**不应该另起一个无关的新页面**。
2. 升级的核心不是「再加一个 AI 输入框」，而是补上**服务端调用链路、结构化契约、确定性约束、可复现测试、真实数据来源与降级标识**。
3. 任何「已接入 Coze / 已上线 / 已通过测试」的说法在当前仓库都不成立；本报告之后的文档与汇报，只写实际执行结果。
4. 下一步：竞品研究 → PRD/指标 → 技术设计（含统一 Agent/地图契约）→ 分阶段实现与验证。
