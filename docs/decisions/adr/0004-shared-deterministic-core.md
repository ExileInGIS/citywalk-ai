# ADR 0004 · 浏览器与服务端共用一份确定性核心

- 状态：已采纳
- 日期：2026-10-26
- 决策者：PM / 架构

## 背景

原型把规划逻辑放在 `js/agent.js`（依赖 `window`）。服务端也需要同一套 Mock 规划。若各写一份，行为会漂移，测试也无法证明两端一致。

## 选项

- A. 服务端复制一份规划逻辑：快，但两套代码必然漂移；
- B. 服务端用 VM 加载浏览器脚本：能复用，但难调试、难测试；
- C. 抽出 UMD 共享核心 `shared/core.js`：浏览器与 Node 共用，依赖注入数据与 Schema；
- D. 只保留服务端规划，浏览器全部走网络：离线 Mock 失效，违背“无密钥可演示”。

## 决定

选择 C。

## 理由

1. 同一输入在两端的规划结果可复现；
2. Mock 可离线运行，Remote 失败时也能本地降级；
3. 核心是纯函数，可直接用 `node:test` 覆盖；
4. 数据 `js/data.js` 已是 UMD，可同时被浏览器与服务端读取。

## 后果

- `js/agent.js` 退化为适配层（超时/校验/降级），不再承载算法；
- 浏览器脚本顺序必须保证 `data → schema → core → agent`；
- 单文件构建需包含 `shared/core.js`；
- 公共 API 变更需同步两端与 Schema，纳入测试。

## 验证

`tests/unit/core.test.js`（服务端）、`tests/unit/agent-adapter.test.js`（浏览器适配）、`tests/integration/`（jsdom 主流程）。