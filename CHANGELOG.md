# Changelog

本项目遵循「只写用户能感知的变化」；技术细节与测试数字见 `docs/EVALUATION-REPORT.md` 与 git 历史。

## [1.0.0] — 2026-10-26

### 新增

- **真实服务链路**：Node 服务端（零运行时依赖）提供 `POST /api/agent/run`、`GET /api/health`、`GET /api/config`、`POST /api/events`；请求带 `requestId`/`traceId`，支持超时、限流、CORS、CSP、结构化日志与统一错误码。
- **Mock / Remote 双模式**：默认无需密钥即可完整规划；Remote 支持 OpenAI 兼容接口与 Coze 适配器骨架，失败按配置降级并在界面标注。
- **约束优先的规划**：时间、预算、必去、避开、步行上限、无障碍 unknown 由确定性代码校验；冲突给出可执行选项，不静默放宽。
- **可解释结果**：每站推荐理由、分项评分、约束清单、数据来源与「估算/未验证」提示。
- **自然语言调整**：少走路、换类型、加主题、预算、结束时间、保留首尾、下雨室内、去相似、删类型、改节奏、改时长；返回调整前后差异与未解决项。
- **地图 Provider**：统一 `CW.MapEngine` 契约（`update/select/setLayer/fit/destroy`），保留 SVG 示意地图，新增 Leaflet + OSM 适配器（仅渲染 8 个有真实坐标的点）。
- **保存/导出**：localStorage 持久化收藏，Markdown / JSON 导出，复制分享文本。
- **可访问性基线**：表单标签、弹窗焦点圈闭与归还、`aria-live` 反馈、键盘可操作地点卡、`:focus-visible`、`prefers-reduced-motion`、对比度修正、响应式布局。
- **测试与评测**：90 项自动化测试（单元/API/jsdom 集成）、24 条固定评测场景、12 条调整指令、`pnpm eval` 真实执行并生成报告、`pnpm check` 一致性自检、`qa/run-all.js` 一键 QA。
- **文档**：审计、竞品分析、PRD、用户流程、指标、架构、Agent 工作流、RAG 取舍、API 接入、测试计划、评测报告、部署、复盘、ADR、设计系统知识库。

### 变更

- `js/config.js` 改为统一大写配置入口 `AGENT/MAP/STORAGE/TELEMETRY/APP`，旧 `agent/map` 字段保留为兼容别名。
- `js/data.js` 改为 UMD（浏览器与 Node 共用），补充 8 个地点的 OpenStreetMap 坐标、来源、许可、室内外属性与数据版本。
- `js/agent.js` 退化为适配层（mock 走共享核心、remote 走 HTTP、二次 Schema 校验、超时/降级）；规划逻辑集中到 `shared/core.js`。
- 地图/时间线/摘要联动保留；手动排序改为**重算**距离与时间（不再显示「未重算」）。
- 上游无法复现的测试脚本不再维护；测试体系重建为可在干净环境运行。
- 响应式 viewport 从固定 `width=1440` 改为 `width=device-width`，桌面布局优先。

### 未验证 / 未包含

- 真实 LLM（OpenAI 兼容 / Coze）**未联调**：无密钥；接入步骤见 `docs/API-INTEGRATION.md`。
- 真实地图瓦片未在自动化中加载；高德/腾讯 Provider 未实现。
- **未部署到公网**；未实现账号体系、云同步、支付、流式输出。
- 4 个泛化地点无单一实体、无坐标；营业时间与图片版权仍需人工核验。

### 修复

- 上游 README 宣称的「68 + 31 项检查」在本仓库不可复现；已替换为真实可运行的测试与评测，不再引用旧数字。
