# 持续升级学习笔记（开源对照）

更新时间：2026-07-15
对照对象：Express 安全实践、常见 Vue 管理面板、自托管 bot/account panel、JSON 文件型数据项目

## 本轮已落地（v2.3.2）

1. **HTTP 安全头**
   开源 Express 服务普遍会 `disable('x-powered-by')`，并加 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy` 等头。
   我们没有引入 `helmet`，先用轻量中间件覆盖核心头，降低依赖面。

2. **公开路由最小化**
   自托管面板常见规则：登录/注册/健康检查可公开，其它 API 默认鉴权。
   本轮把 `/api` 白名单明确为：`login`、`register`、`card-claim/*`、`game-version`、`ping`，以及续费预览 `GET /card/info/:code`。

3. **请求体限制**
   Express 官方安全指南会建议限制 body 大小。
   现已改为 `express.json({ limit: '1mb' })`。

4. **去掉 node-fetch**
   Node 20+ 已有原生 `fetch`。很多开源项目已迁移，减少 polyfill 与维护成本。

5. **鉴权回归测试**
   开源项目越来越重视“安全边界可测”。
   新增 `http-security.test.js`：公共路由、401、登录发 token。

## 我们已经做得不错的点

- JSON 原子写 + `.bak` 恢复（文件型 DB 的正确姿势）
- 登录失败限流 / 账号锁定（`user-store`）
- 卡密领取 UA/IP 限制
- 微信代理 API Key 仅后端保存
- 管理员首次强制改密
- 生产依赖审计无已知漏洞

## 值得学习、但本轮未改的点

| 开源常见做法 | 我们现状 | 为什么先不动 | 学习价值 |
|---|---|---|---|
| Helmet 全量安全头 / CSP | 已有核心安全头 | CSP 需要梳理前端资源策略，误配会白屏 | 学“默认安全配置 + 逐步收紧” |
| 登录接口 HTTP 级 rate limit | 已有账号/IP 失败计数 | `security.js` 有限流器但未接入主路径；要评估误伤 | 学“中间件复用，避免重复实现” |
| Token 放 HttpOnly Cookie | `localStorage + x-admin-token` | 前后端联调与 CORS/Socket 改动大 | 学 XSS 与 CSRF 权衡 |
| Express 5 / Vite 8 major | Express 4 / Vite 7 | major 变更收益低于回归成本 | 学“依赖升级要有兼容证据” |
| 统一 session/JWT 库 | 内存 token Set | 当前单机部署足够；先稳住边界 | 学“复杂度与部署形态匹配” |
| 更细的 RBAC 中间件 | `authRequired` + `adminRequired` | 结构可用，重写风险高 | 学“权限分层而不是堆 if” |

## 建议的后续学习路径

1. 读 Express 安全最佳实践：headers、body limit、trust proxy、公开路由。
2. 对照任意开源 Vue Admin：看 token 拦截器、401 跳转、路由守卫。
3. 对照 bot 面板项目：看多账号隔离、重启是否自动拉起、敏感配置如何存放。
4. 下一轮可选实现：登录/注册/卡密领取的 HTTP rate-limit 中间件接入。

## 本轮明确不做

- 不升级 Express/Vite/TypeScript major
- 不重写 worker 农场协议
- 不改 `core/data` 真实业务数据
- 不做 HttpOnly Cookie 大迁移
