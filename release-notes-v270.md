## v2.7.0 更新内容

> 本版本为「运营控制台升级」里程碑：运营报表、控制台视觉/交互升级、运行指标与缓存策略收口。v2.6 未单独发布，与 v2.7 合并交付。

### 新增

- 新增运营报表页（Report.vue）：日报 / 周报 / 多账号对比，数据源复用 stats.js 日归档与 task-run-store，零新增依赖。
- 新增报表 API：`/api/report`（JSON）与 `/api/report/html`（脱敏 HTML，浏览器打印/邮件正文），鉴权沿用账号隔离（越权 403）。
- 新增运行指标：`core/src/services/metrics.js` 采样 API 耗时/错误与 JSON 持久化耗时，管理员可通过 `GET /api/metrics` 查询 p50/p95（仅内存、不落盘、不采集敏感字段）。
- 新增控制台审计与升级规格：`docs/upgrade-audit-2026-08-06.md`（页面/性能/无障碍审计 + P0-P2 清单）与 `docs/ASSET_MANIFEST.md`（视觉资源清单）。

### 运营控制台升级

- 视觉系统：补齐 tokens（背景/文字/边框/状态/图表/农田/间距/层级/动效/z-index），清理视图硬编码颜色，深浅主题随动。
- 交互：BaseSelect 按 ARIA listbox 支持键盘/焦点/Escape；Modal 统一焦点陷阱与关闭还原；纯图标按钮补 aria-label；图片补有意义 alt；`html lang="zh-CN"`。
- Dashboard 首屏重排：账号健康、运行中任务、异常聚合、收益、下一步动作一屏可见。
- Friends / Admin / Scheduler：筛选、搜索、批量选择、二次确认、明确空/加载/错误/重试态；Scheduler 轮询卸载清理 + 页面可见性暂停。
- Report.vue 49 个 lint warning 清零；全站 lint 0 error 0 warning。

### 性能与可靠性

- 前端：请求 in-flight 去重 + TTL 缓存 + AbortController（`utils/request.ts`），路由切换取消过期请求；报表/调度/统计已接入。
- 静态资源缓存：hash 资源 `immutable`（1 年）、`index.html` `no-cache`、根目录 86400。
- 种子图 loading="lazy"，保留 `seed_images_named` 文件映射。
- 后端：指标先行（p50/p95），未增加 QQ 上游并发，账号级队列/退避/超时/取消保留。

### 封面

- 新封面 `docs/cover.svg`（可维护源）+ `docs/cover.png`（1280x640）：深森林绿背景，左侧标题/副标题/三能力标签，右侧农田插画。

### 测试

- 后端单元测试 154 项全部通过（含报表 8 项、会话持久化、策略对比、运行指标 4 项）。
- Playwright E2E 16 项全部通过（4 个 spec，含 375/768/1440 横向溢出断言、BaseSelect 键盘、弹窗焦点陷阱）。
- lint 0 error 0 warning；`pnpm build:web` 通过。

---

> 完整功能说明见 [README](https://github.com/yuchen0x1/qq-farm-bot)。
