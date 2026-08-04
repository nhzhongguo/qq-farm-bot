# QQ 农场助手 v2.7 升级方案（v2.6 收口 + v2.7 新方向）

> 基于 2026-08-05 对当前仓库（HEAD `f518315`，v2.5.0 标签，v2.6 方案未实施）的现场复核。
> 覆盖：现状快照 → v2.6 遗留核对 → v2.7 升级内容（收口 + 新方向）→ 分批实施 → 风险与验收。

---

## 一、现状快照（2026-08-05 实测）

| 维度 | 现状 |
|---|---|
| 版本 | `2.5.0`（version.json / 根 / core / web 四处一致），标签 `v2.2.1 → v2.5.0` 齐备，HEAD `f518315` |
| 后端 | Node.js + Express 4.21（CJS）+ Socket.IO + Winston，JSON 文件存储（json-db 写合并 + `.bak` 自动恢复） |
| 前端 | Vue 3.5 + Vite 7.3 + UnoCSS + Pinia + vue-router 5，9 页面，统计图为自绘 SVG（零图表依赖） |
| 质量门 | `pnpm lint:check` 全绿；130 单测、11 E2E；CI 含 install / test / lint / build / Playwright 冒烟 |
| 部署 | Docker Compose（`qq-farm-data` 命名卷）+ 源码运行 + pkg 打包（win/linux/mac） |

### 待处理事项（升级前必须收口）

| 项 | 说明 | 处置 |
|---|---|---|
| 未跟踪文件 | `docs/upgrade-plan-v2.6.md`、7 个 `release-notes-v*.md`、`.reasonix/` | 随 v2.7 批次 0 一并提交 |
| 文档滞后 | `CHANGELOG.md` 停在 v2.5.0「待发布」段（标签已打） | v2.7 批次 0 补发布日期并追加新段 |

---

## 二、v2.6 计划遗留项核对（2026-08-05 复核）

v2.6 方案（4 大方向 13 项 + 安全 E 方向）**尚未开始实施**，以下为仍需收口的项：

| 原计划项 | 优先级 | 状态 | v2.7 归属 |
|---|---|---|---|
| A1 每日/每周运营报表 | P0 | ❌ 未做 | 批次 1（本次实施） |
| A2 作物策略对比提示 | P1 | ❌ 未做 | 批次 2 |
| A3 收益趋势增强（90 天月度汇总 + 多账号对比） | P2 | ❌ 未做 | 批次 2 |
| B1 轻量 i18n 框架（自研 dict + `t()`） | P1 | ❌ 未做 | 批次 3 |
| B2 虚拟列表（好友/审计/登录日志大表格） | P2 | ❌ 未做 | 批次 3（预算内） |
| B3 批量操作体验（全选/反选/过滤 + 二次确认统一） | P2 | ❌ 未做 | 批次 3（预算内） |
| C1 OpenAPI 文档（`/api/docs`，生产可关） | P1 | ❌ 未做 | 批次 3 |
| C2 CI 发布检查联动（`release:check` + `audit --prod`） | P1 | ❌ 未做 | 批次 3 |
| C3 未用依赖清理（knip） | P1 | ❌ 未做 | 批次 3 |
| D1 静态资源缓存策略（immutable + HTTP/2 + brotli 头） | P1 | ❌ 未做 | 批次 3 |
| D2 JSON→SQLite 基准评估 | P2 | ❌ 未做 | 批次 4（v2.7-D，评估后定） |
| D3 依赖升级验证分支（Vite 8 / Express 5 / pinia 4） | P2 | ❌ 未做 | 批次 4（v2.7-D，评估后定） |
| D4 前端构建复查（lazy 核对 / stats.html 移出） | P2 | ❌ 未做 | 批次 3 |
| E1 敏感字段静态加密（AES-256-GCM） | P1 | ❌ 未做 | 批次 3 |
| E2 secrets 扫描（gitleaks） | P2 | ❌ 未做 | 批次 3 |
| E3 限流参数配置化 | P2 | ❌ 未做 | 批次 3 |

---

## 三、v2.7.0 升级内容

### 阶段一：v2.6 收口（本次实施的重点）

#### 批次 1 — 运营报表（v2.6 A1，P0）

基于 `stats.js` 日归档 + `task-run-store` 生成账号级报表，**不引入 PDF 重型依赖**：

| # | 功能 | 说明 |
|---|---|---|
| R1 | 日报 / 周报生成 | `core/src/services/report.js`：按账号 + 日期区间汇总收获数、偷菜数、任务数、异常数、金币/经验增量、操作明细；输出 JSON（机器可读）+ HTML（浏览器打印/邮件正文） |
| R2 | 报表 API | `/api/report/daily|weekly|compare`，鉴权沿用 `getAccId` + `checkAccountAccess`（管理员可跨账号） |
| R3 | 报表前端 | 报表页/弹窗：账号选择 + 区间选择 + 预览/下载；沿用自绘 SVG 与 EmptyState 组件 |

验收：单测 ≥ 6 项（日/周/空历史/越权/HTML 转义/90 天窗口）；E2E 报表页冒烟 ≥ 1 项。

#### 批次 2 — 报表增强 + 策略对比（v2.6 A2/A3）

- A2 作物策略对比提示：基于 stats 归档计算近 7 天同策略收益均值，Analytics 页给出差距提示（仅提示不改配置）
- A3 趋势增强：统计页 90 天月度汇总视图 + 多账号同图对比（沿用自绘 SVG）

### 阶段二：v2.6 其余收口（批次 3，工程化 + 体验 + 安全）

- B1 轻量 i18n：自研 dict + `t()`（约 200 行），zh/en 切换 + localStorage 记忆，先覆盖导航/登录/设置/统计核心页
- C1 OpenAPI：精简手写 `swagger.json` 挂 `/api/docs`（生产可关）
- C2 CI 联动：`pnpm release:check` + `pnpm audit --prod` 进 CI 门禁
- C3 knip 清理未用依赖/导出（预期 JS 再降 5–10%）
- D1 静态资源缓存头（`.br` 已产出，只差响应头）+ nginx 部署示例
- D4 前端构建复查（lazy 核对、`web/stats.html` 移出产物）
- E1 敏感字段 at-rest 加密（AES-256-GCM，兼容 `.bak` 恢复链路，先迁移后回退验证）
- E2 CI secrets 扫描；E3 限流参数环境变量化
- B2/B3 虚拟列表与批量操作体验（预算内）

### 阶段三：v2.7 新方向（批次 4）

| # | 方向 | 说明 | 优先级 |
|---|---|---|---|
| V1 | 报表订阅推送 | 日报/周报按账号定时推送到告警渠道（复用 19 渠道与 alert-rule-engine 触发机制） | P1 |
| V2 | 多实例部署支持 | 当前 Worker 单进程内调度，评估状态外部化（任务状态、调度器快照共享），支持多机横向扩容 | P2 |
| V3 | 登录链路自动化 | 微信/QQ 二维码托管页，扫码登录不再依赖本机弹窗 | P2 |
| V4 | 存储层评估 | JSON→SQLite 基准（10 万条流水对比）；通过则仅迁移高频追加型数据，保留 JSON 导出兼容 | P2 |
| V5 | 全站 i18n 补完 | en 全覆盖（批次 3 框架之上补完剩余页面） | P2 |
| V6 | 依赖升级分支 | 单开分支逐项验证 Vite 8 / Express 5 / pinia 4，过全量门禁才合入 | P2 |

---

## 四、分批实施步骤（每批独立提交 + 可回退）

### 批次 0（基线收口）
1. 提交未跟踪文件：`docs/upgrade-plan-v2.6.md`、7 个 `release-notes-v*.md`（`.reasonix/` 按需纳入或忽略）
2. `CHANGELOG.md` 补 v2.5.0 发布日期（2026-08-05），v2.7 追加新段
3. 全量验证基线：`pnpm test`（130）+ `pnpm lint:check` + `pnpm build:web`，记录构建时长

### 批次 1（运营报表，本次实施）
4. `core/src/services/report.js`：日/周/对比三报表生成，复用 stats 归档与 task-run-store，禁止另起口径
5. `/api/report/*` 控制器（admin.js 注册，authRequired + checkAccountAccess）
6. 单测 `core/test/report.test.js`（≥6 项）
7. 前端报表视图 + 路由（`web/src/views/Report.vue` 或嵌入 Statistics 弹窗）+ 联调

### 批次 2–4（后续会话分批推进）
- 批次 2：A2 策略对比 + A3 趋势增强
- 批次 3：i18n / OpenAPI / CI 联动 / knip / 缓存头 / 静态加密 / secrets 扫描
- 批次 4：V1 报表订阅 → V4 存储评估 → V2/V3/V5/V6
- 每批次收尾：更新 version.json 四处版本号、CHANGELOG、`node scripts/release.js --tag`

---

## 五、风险与约束

| 项 | 风险 | 对策 |
|---|---|---|
| 兼容性 | 全部新增向后兼容 | JSON 存储格式不变；报表只读现有归档，不写业务数据 |
| 报表准确性 | 统计口径漂移 | 直接复用 stats 归档与 task-run-store，单测断言样例数据 |
| 静态加密 | 与 `.bak` 自动恢复链路冲突 | 加密仅作用于敏感字段值，写兼容层，先迁移后回退验证 |
| 依赖升级 | Express 5 / Vite 8 / pinia 4 为 breaking | 独立验证分支 + 全量门禁，不满足即保留现状并记录 |
| i18n 范围蔓延 | 全站翻译工作量大 | 首批只覆盖核心页，`t()` 未覆盖处回退中文 |
| pkg 打包 | 原生模块（SQLite）兼容性 | 批次 4 评估时单独验证 `pkg .` 产物可运行 |

---

## 六、验收指标

| 指标 | 目标 |
|---|---|
| 单测 | 130 → ≥145（报表 ≥6、后续 i18n/加密/限流等） |
| E2E | 11 → ≥14 |
| lint / build | 全绿；`pnpm build:web` ≤ 20s |
| 安全 | 生产依赖 `pnpm audit --prod` 0 高危；敏感字段文件中无明文 token |
| 发布 | 4 处版本号一致 + 标签 + CHANGELOG 完整，`git checkout vX.Y.Z` 可一键回退 |
| 文档 | 本方案随版本发布；批次 4 评估报告落盘 `upgrade-report/` |
