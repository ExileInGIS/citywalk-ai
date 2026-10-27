# ADR 0002 · 后端零运行时依赖（Node 内置 http）

- 状态：已采纳
- 日期：2026-10-26
- 决策者：PM

## 背景

需要提供 `/api/agent/run`、健康检查、静态资源、限流、日志与超时。仓库原本没有 `package.json`，也没有服务端运行时。

## 选项

- A. Express/Fastify：生态成熟，但引入依赖树与供应链风险，需要安装；
- B. Node 内置 `http` + 自建小中间件：零运行时依赖，可控；
- C. Serverless 函数：需要平台账号与部署权限，本次不可用。

## 决定

选择 B；`jsdom` 仅作为开发依赖用于 DOM 测试。

## 理由

1. 接口只有 4 个，内置 `http` 足够；
2. 密钥、限流、日志、CSP 都能显式实现，便于审计；
3. 无安装即可启动，降低评审与复现成本；
4. 运行时无第三方代码，安全边界更小。

## 后果

- 路由、body 解析、静态服务、内容类型需要自己写并测试；
- 未来若接口增多，可迁移到框架，但需保留现有契约测试；
- 部署只需 Node ≥ 20，无 `node_modules` 运行时依赖。

## 验证

`tests/api/agent.test.js`、`tests/api/security.test.js`；`pnpm start` 后 `GET /api/health`。