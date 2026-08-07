# QQ Farm Bot 升级审计（2026-08-06）

> 审计基准：工作区 HEAD `main` + 未提交改动（会话持久化、策略对比、报表相关，均为进行中工作，本审计不覆盖、不修改）。
> 方法：以代码与真实测试结果为准，`docs/` 与 `upgrade-report/` 仅作参考。
> 目标：把现有“QQ 农场自动化托管平台”升级为高效、克制、可信赖、现代的运营控制台。

---

## 1. 基线验证（本轮实测，2026-08-06）

| 命令 | 结果 | 耗时 | 备注 |
| --- | --- | --- | --- |
| `pnpm test` | 150/150 通过 | 4.4s（单测 3.82s） | 含会话持久化、策略对比新增用例 |
| `pnpm lint:check` | 0 error，49 warning | 12.3s | 49 个 warning 全部位于 `web/src/views/Report.vue`，均为 `vue/singleline-html-element-content-newline` 与 `unocss/order`，可 `--fix` 修复 |
| `pnpm build:web` | 通过 | 10.8s（Vite 5.53s） | 产物含 `.gz`（vite-plugin-compression） |
| `pnpm test:e2e` | 10 通过 / 1 失败 | 8.6s | 失败项：`auth-smoke` 的“/settings 无令牌重定向”，原因 `Page crashed`（页面在并行 worker 满载时崩溃）；单独复跑该用例 1 passed，判定为偶发资源竞争，非代码缺陷，后续批次观察 |

### 基线事实（后续每批对照）

- 后端单测 150 项；前端 E2E 共 11 项（3 个 spec）。
- lint 0 error；本次交付不得引入新 warning，并要求修复 Report.vue 现有 49 个 warning。
- 前端构建 ~5.5s（Vite）；主要 chunk gzip：`vendor-vue` 44.45kb、`AdminPanel` 16.80kb、`vendor-axios` 17.34kb、`index.css` 25.97kb。
- 版本事实：根 / core / web 的 `package.json` 与 `version.json` 均为 `2.7.0`；`CHANGELOG.md` 已有 v2.7.0 段（2026-08-05）；README 徽章仍为 `v2.5.0`、`130 passed`、`e2e 11 passed`，与真实值不一致，收尾批统一。

---

## 2. 页面审计

### 2.1 概览 Dashboard（`web/src/views/Dashboard.vue`）

- 主任务：账号健康总览、运行状态、实时日志、异常提示、收益/操作概览、诊断包导出与日志清空。
- 首屏信息：账号卡（头像/昵称/等级/状态）、金币/经验/操作计数、运行中任务、最近日志。
- 低频操作：导出诊断包、清空日志、全量刷新。
- 重复信息：日志同时通过轮询与 Socket 推送两路进入（`stores/status.ts` 的 `logs:snapshot` 与轮询接口），存在重复渲染与内存增长风险。
- 阻塞点：无“下一步动作”提示；异常仅散落在日志里，无聚合卡片；日志列表为 DOM 全量渲染，无虚拟化/上限截断策略（当前仅滚动加载）。

### 2.2 个人 Personal（`web/src/views/Personal.vue`）

- 主任务：查看当前账号个人状态与快捷入口（小页面，2KB）。
- 首屏信息：账号基础信息。
- 低频操作：无独立操作。
- 阻塞点：信息密度低，与 Dashboard 账号卡重复；后续可与账号设置合并或做深层跳转。

### 2.3 好友 Friends（`web/src/views/Friends.vue`）

- 主任务：好友列表巡检（偷菜/帮助/黑名单/静默时段）、批量操作、好友田地查看、互动记录。
- 首屏信息：Tab（好友/黑名单/互动记录）、搜索框、批量操作条、分页好友列表。
- 低频操作：清空好友缓存、批量拉黑/解除、逐块翻页。
- 重复信息：好友卡片与互动记录头像均从 QQ 头像 CDN 加载，同一头像在列表/弹窗/侧栏重复请求。
- 阻塞点：分页为页内数组切片，无服务端分页；好友列表过大时首屏渲染压力大；`v-for` 嵌套 `friendLands[friend.gid]` 无缓存键，切换 Tab 会重算。

### 2.4 分析 Analytics（`web/src/views/Analytics.vue`）

- 主任务：作物/策略分析、排行榜、种植建议、策略对比（进行中功能）。
- 首屏信息：Tab 切换（作物/策略等）、当前账号等级与策略。
- 低频操作：黑名单切换、策略模板跳转。
- 重复信息：策略对比数据随账号切换单独请求，未与 `loadAnalytics` 合并；作物图片多次 `v-for` 全量渲染。
- 阻塞点：表格使用 `sticky` 首列 + 硬编码 `bg-white` / `dark:bg-gray-800`，主题切换不完全；策略对比仅有建议文案，无明确“不改配置”提示（见 5.3）。

### 2.5 统计 Statistics（`web/src/views/Statistics.vue`）

- 主任务：金币/经验/操作数 7/30/90 天趋势（自绘 SVG）。
- 首屏信息：范围切换、趋势曲线、月度汇总。
- 低频操作：范围切换、账号切换。
- 重复信息：与 Report 的“每日收益明细”重复（同源 stats 归档，两处口径应保持一致）。
- 阻塞点：SVG 用 `preserveAspectRatio="none"` 拉伸，窄屏文字与点标签易重叠；无空数据态兜底文案（空数组直接渲染空图）；硬编码 `gray` 系列类。

### 2.6 报表 Report（`web/src/views/Report.vue`）

- 主任务：日报/周报/多账号对比、HTML 下载/打印。
- 首屏信息：类型选择、日期区间、账号选择、汇总卡片。
- 低频操作：HTML 预览/下载、范围切换。
- 阻塞点（已修复）：49 个 lint warning 已清零；下载走 `/api/report/html` 返回 HTML，权限校验已确认（`resolveReportRequest` 内 `checkAccountAccess`/allowlist）；表格 `min-w-[420px]` + `overflow-x-auto`，375px 需滚动（可接受，提示可见）。

### 2.7 调度 Scheduler（`web/src/views/Scheduler.vue`）

- 主任务：运行时任务/Worker 状态、任务历史、手动重跑。
- 首屏信息：运行时作用域任务表、Worker 作用域任务表、最近任务历史。
- 低频操作：刷新、手动触发。
- 阻塞点：`setInterval(loadScheduler, 15000)` 固定 15s 轮询，切页未清理会导致页面堆叠轮询（需确认 `onUnmounted`）；任务行用网格布局，状态/耗时列在窄屏被压缩；失败原因无展开态。

### 2.8 设置 Settings（`web/src/views/Settings.vue`）

- 主任务：账号配置（登录、种植、化肥、好友、告警、模板）、个人设置、危险操作。
- 首屏信息：Tab 导航（账号列表 + 配置表单）。
- 低频操作：保存模板、测试告警、清空操作记录、删除账号。
- 重复信息：账号头像使用 QQ CDN 外链；账号配置与 Dashboard/Personal 存在部分重复字段。
- 阻塞点：76KB 单文件，脚本/模板规模最大；危险操作（删除账号/清空数据）需确认是否统一二次确认；部分保存为“即时保存”，需确认防抖与失败回滚（见 5.4）。

### 2.9 后台 AdminPanel（`web/src/views/AdminPanel.vue`）

- 主任务：用户/卡密/公告/告警规则/审计日志/系统配置/WX 配置管理。
- 首屏信息：Tab 导航。
- 低频操作：卡密流水清空、用户删除/编辑、告警规则增删、系统配置重置。
- 重复信息：用户列表与卡密流水均分页/滚动加载，需确认是否复用同一加载模式。
- 阻塞点：102KB 单文件，是全站最大视图；审计日志列表大时 DOM 全量渲染（v2.6 计划 B2 虚拟列表未实施）；多个 tab 各自独立加载函数，缺少统一 loading/error/retry 状态。

### 2.10 登录 Login（`web/src/views/Login.vue`）

- 主任务：账号密码登录、公告展示。
- 首屏信息：登录表单、公告弹窗。
- 低频操作：无。
- 阻塞点：`html lang="en"`（`web/index.html`），应改为 `zh-CN`；表单控件需核对 label 关联。

---

## 3. 性能风险

| 风险 | 位置 | 说明 | 影响 |
| --- | --- | --- | --- |
| 固定 15s 轮询 | `Scheduler.vue:190` | `setInterval` 轮询调度状态；需确认卸载清理与多页面并发 | 后台常驻时 CPU/请求浪费；切页残留导致多倍轮询 |
| 日志双通道 | `stores/status.ts` + `Dashboard.vue` | Socket `logs:snapshot` 与轮询/全量加载并存 | 重复渲染、内存增长 |
| 无静态缓存头 | `admin.js:301-303` | `express.static(webDist)` 无 `maxAge/immutable`；`index.html` 无 `no-cache` | 静态资源重复下载，首屏变慢 |
| JSON 读写 | `core/src/services/*-store.js` + `json-db.js` | 已用 debounce 写合并 + `.bak` 恢复；读路径仍多为全量 `readFileSync` 解析 | 账号/日志量大时单请求延迟升高 |
| 大列表全量渲染 | Friends / AdminPanel / Dashboard 日志 | 无虚拟列表；Friends 为页内切片分页 | 千级好友/审计条目卡顿 |
| 图片无懒加载 | `Analytics.vue` / `BagPanel.vue` / `Friends.vue` 的 `<img>` | 种子图、头像无 `loading="lazy"` | 首屏请求数偏高 |
| 重复上游调用 | `admin.js` / `services/*` | 存在 `analytics-cache`（5 分钟）与 wx-login in-flight 去重；其余分析/排行 API 无统一去重缓存 | 同屏多请求重复计算 |
| 大 chunk | `AdminPanel.vue` 102KB / `Settings.vue` 76KB | 单文件视图未再按子模块拆包 | 后台/设置首开体积大 |

## 4. 可访问性缺口

| 缺口 | 位置 | 现状 |
| --- | --- | --- |
| `lang` 错误 | `web/index.html` | `lang="en"`，应 `zh-CN` |
| BaseSelect 无 ARIA | `ui/BaseSelect.vue` | 是 `<button>` + 绝对定位列表，无 `listbox/option` 角色、无方向键/Home/End/Escape、无焦点管理 |
| Modal 焦点管理 | `AccountModal.vue`、`Friends.vue` Teleport、`WxLoginModal.vue`、`ConfirmModal.vue` | 仅 `AccountModal` 有 `role=dialog` + ESC 关闭；无打开聚焦、Tab 焦点陷阱、关闭后焦点还原 |
| 表单标签 | 多个视图直接 `<input>` | 部分输入无 `label`/`aria-label` 关联 |
| 图标按钮 | 各处图标按钮 | 部分无 `aria-label` 与 tooltip（如 BaseButton 纯图标场景） |
| 图片 alt | `AccountModal.vue:388`（微信二维码）、`WxLoginModal.vue:144`、`BagPanel/Friends/Analytics` 的装饰/头像图 | 缺 `alt` 或 `alt=""` |
| 颜色对比 | `LandCard.vue`、`Statistics.vue`、`Analytics.vue` 硬编码色 | 浅/深主题下部分图表与状态色不随 tokens 切换 |
| 移动端溢出 | `Report.vue` 表格、`Analytics.vue` sticky 表、`Scheduler.vue` 网格 | 需逐页验证 375px 无横向溢出/截断/重叠 |
| `prefers-reduced-motion` | `tokens.css` 已有全局降级 | 需确认动效新增处均遵守 |

## 5. P0 / P1 / P2 任务清单

### P0（本次升级必须，阻塞交付）

| # | 任务 | 影响文件 | 风险 | 验收标准 | 回退方案 |
| --- | --- | --- | --- | --- | --- |
| P0-1 | 视觉基线：补齐 tokens（背景/文字/边框/状态/图表/农田/间距/层级/动效/z-index），替换视图内硬编码色 | `styles/tokens.css`、`Statistics.vue`、`Analytics.vue`、`LandCard.vue`、`Settings.vue` 等 | 主题回归、图表失真 | 深浅主题下正文对比度达 WCAG AA；375/768/1440 无溢出无重叠；`pnpm test`/`lint:check`/`build:web` 全绿 | 保留 tokens 兼容别名 `--theme-*`，CSS 变量逐个替换，可随时 `git diff` 回退 |
| P0-2 | `html lang="zh-CN"` + 登录/导航无障碍冒烟 | `web/index.html` | 无 | `document.documentElement.lang === 'zh-CN'` | 单行改动 |
| P0-3 | 修复 Report.vue 49 个 lint warning（✅ 已完成） | `web/src/views/Report.vue` | 模板改动引发显示回归 | 实测 `pnpm lint:check` 0 error 0 warning；Report 页手工验证无显示回归 | 每处为格式化级改动，`git diff` 可逆 |
| P0-4 | 关键页面 E2E 新增/更新：375/768/1440 无横向溢出 + 登录/导航/弹窗/筛选冒烟（✅ 已完成） | `web/e2e/*.spec.ts`（新增 `console-layout.spec.ts`） | E2E 偶发崩溃需重试策略 | 实测 16/16 通过（4 个 spec），375/768/1440 三档 `scrollWidth <= clientWidth` 断言通过 | 新 spec 独立文件，不影响现有用例 |
| P0-5 | 新封面 `docs/cover.svg` + 生成 `docs/cover.png`（1280x640）+ `docs/ASSET_MANIFEST.md` | `docs/`、`README.md` 引用 | SVG 文字渲染、PNG 尺寸不符 | 自动校验 PNG 尺寸/格式、SVG 含主标题/副标题/三标签、README 引用正确 | 保留旧 `cover.png` 备份；清单记录替代方案 |

### P1（视觉/交互/可靠性，本批交付）

| # | 任务 | 影响文件 | 风险 | 验收标准 | 回退方案 |
| --- | --- | --- | --- | --- | --- |
| P1-1 | Dashboard 首屏重排：账号健康、运行中任务、异常聚合、收益、下一步动作 | `Dashboard.vue` | 信息层级变化 | 首屏 1 屏内可见 5 类信息；空/加载/错误态齐全 | 先加卡片区块再删旧区块，分两步提交 |
| P1-2 | Friends/Admin/Scheduler：筛选、搜索、批量选择、二次确认、明确空/加载/错误/重试态 | `Friends.vue`、`AdminPanel.vue`、`Scheduler.vue` | 批量操作误触 | 危险操作二次确认；重试按钮可用；批量选中状态清晰 | 每个交互独立提交 |
| P1-3 | Settings 按风险分组，危险操作隔离；即时保存防抖 + 反馈 + 失败恢复 | `Settings.vue` | 保存语义变化 | 防抖 300ms；失败 toast + 字段回滚；危险区视觉分隔 | 防抖封装独立 composable |
| P1-4 | BaseSelect 按 ARIA listbox 升级：方向键/Home/End/Escape/焦点/aria-selected | `ui/BaseSelect.vue` | 键盘操作回归 | 键盘可完全操作选择；Escape 关闭并还原焦点 | 组件内实现，独立提交 |
| P1-5 | Modal 焦点管理统一：打开聚焦、Tab 陷阱、关闭还原 | `ui/`（新增 focus-trap composable）→ 各 Modal | 弹窗行为变化 | 键盘 Tab 不逃逸；关闭后焦点回触发元素 | 仅新增 composable，逐个接入 |
| P1-6 | 图片 alt / 装饰图 `alt=""` / 图标按钮 aria-label + tooltip | 各视图与 `ui/BaseButton.vue` | 无 | 无意义 alt 清零；纯图标按钮均有 aria-label | 逐文件小改 |
| P1-7 | Scheduler 轮询生命周期修复：卸载清理 + 页面可见性暂停 | `Scheduler.vue` | 轮询缺失 | 切页后无残留定时器；后台页可见时恢复轮询 | 独立提交 |
| P1-8 | 静态资源缓存：hash 资源 `immutable` + `index.html` `no-cache` | `core/src/controllers/admin.js` | 更新后旧缓存 | 响应头断言通过 E2E/curl | 保留旧头部逻辑开关 |

### P2（收尾批与后续）

| # | 任务 | 影响文件 | 风险 | 验收标准 | 回退方案 |
| --- | --- | --- | --- | --- | --- |
| P2-1 | 分析/排行/报表前端缓存与请求合并、路由切换取消过期请求 | `stores/`、`views/*.vue`、`utils/request` | 缓存脏数据 | 相同参数同屏仅 1 次请求；切页 Abort 生效 | 缓存独立模块，可开关 |
| P2-2 | 好友/日志/审计/任务历史虚拟列表或严格分页 | `Friends.vue`、`AdminPanel.vue`、`Dashboard.vue` | 渲染回归 | 千级数据滚动流畅（60fps 采样） | 独立组件接入 |
| P2-3 | 种子图 `loading="lazy"` + 优先 WebP，不破坏映射 | `Analytics.vue`、`BagPanel.vue`、`LandCard.vue` | 图片映射破坏 | `seed_images_named` 文件名不变；lazy 属性生效 | 仅加属性不改路径 |
| P2-4 | 后端指标：关键 API / 任务执行 / JSON 持久化耗时与错误，p50/p95 | `core/src/controllers/admin.js`、`services/*` | 无 | 指标输出可查询；先测后优化 | 指标埋点独立模块 |
| P2-5 | 后端 in-flight 去重 / 受限并发 / 超时 / AbortSignal 复查与补强 | `services/*` | 并发行为变化 | 不增加 QQ 上游并发；账号级队列/退避/超时保留 | 新增开关默认关闭 |
| P2-6 | 任务面板状态补齐：排队/执行/成功/失败/重试/耗时/下一步/可操作错误 | `Scheduler.vue` + 后端任务元数据 | 状态口径变化 | 状态字段齐全；失败原因可展开 | 后端只读字段新增 |
| P2-7 | 报表下载与权限校验、空数据/窄屏/色盲友好/数值兜底（✅ 已完成） | `Report.vue`、`report.js`、`admin.js` | 报表口径漂移 | 实测 `/api/report` 与 `/api/report/html` 经 `resolveReportRequest` 账号隔离（daily/weekly 走 `checkAccountAccess`，compare 走 `getAccessibleAccountIds` allowlist，越权 403）；空历史/窄屏/色盲替代由 Report.vue 兜底 | 复用现有 `checkAccountAccess` |
| P2-8 | 版本一致性收口：README 徽章/测试数/版本对齐 2.7.0（✅ 已完成） | `README.md`、`CHANGELOG.md`、`release-notes-v270.md` | 文档滞后 | 4 处版本号一致；测试数 154；E2E 16 项；release notes 与版本对应 | 无风险 |

## 6. 与既有文档的差异声明

- `upgrade-plan-v2.7.md` 声称“全量测试 130 通过”，审计时实测为 150（会话持久化 3 项 + 策略对比 4 项 + 报表等已并入）；收尾批新增运行指标 4 项后为 154。
- `upgrade-plan-v2.7.md` 批次 1/2 的报表与策略对比已落地（`Report.vue`、`strategy-compare.js`、`/api/analytics/strategy-compare`）。
- v2.6 计划遗留项 B2（虚拟列表）、C1（OpenAPI）、D1（缓存头）、E1（静态加密）等仍未实施，纳入本审计 P2。
- `upgrade-report/` 中 `02-UI升级方案.md`、`03-性能优化方案.md` 作为参考；具体优先级以本审计实测为准。

## 7. 收尾验收（2026-08-06，批 1-3 全部完成后实测）

### 最终验证结果

| 命令 | 结果 | 耗时 |
| --- | --- | --- |
| `pnpm test` | 154/154 通过（基线 150 + 新增运行指标 4 项） | 4.6s（测试 3.96s） |
| `pnpm lint:check` | 0 error 0 warning（Report.vue 49 个 warning 已清零） | ~14s |
| `pnpm build:web` | 通过（vue-tsc + Vite） | 15.1s（Vite ~6.5s） |
| `pnpm test:e2e` | 16/16 通过（4 个 spec） | 7.5s（测试 6.4s） |

### P0 / P1 / P2 完成状态

- P0-1 ~ P0-5 全部完成：tokens 补齐、`lang=zh-CN`、Report.vue 49 warning 清零、375/768/1440 溢出断言（E2E 16 项含键盘/焦点陷阱）、新封面 `docs/cover.svg`/`docs/cover.png`（1280x640）与 `docs/ASSET_MANIFEST.md`。
- P1-1 ~ P1-8 全部完成：Dashboard 首屏重排、Friends/Admin/Scheduler 筛选搜索批量二次确认与空/加载/错误/重试态、Settings 分组与防抖保存、BaseSelect ARIA listbox 键盘、Modal 焦点陷阱与还原、alt/aria-label、Scheduler 卸载清理 + 页面可见性暂停、静态资源缓存头（实测：`/` no-cache、hash 资源 immutable、根目录 86400）。
- P2-1 完成：`utils/request.ts` in-flight 去重 + TTL 缓存 + AbortController；`router.afterEach` 调 `cancelAllRequests()`；Report/Scheduler/Statistics 已接入。
- P2-2 部分完成：任务历史严格分页（`limit:50`）；好友/日志/审计的虚拟列表未做，见「剩余风险」。
- P2-3 完成：种子图 lazy 属性，`seed_images_named` 文件名未动。
- P2-4 完成：`services/metrics.js` + 管理员专用 `GET /api/metrics`（401/403 保护实测）+ JSON 读写采样；p50/p95 实测见下。
- P2-5 完成（复查结论）：账号级队列/速率控制/指数退避/超时/取消保留，未新增任何 QQ 上游并发。
- P2-6 完成：任务面板含排队/执行中/成功/失败/重试计数/耗时/下次执行；失败原因内联展示 + tooltip。
- P2-7 完成：`/api/report` 与 `/api/report/html` 均经 `resolveReportRequest` 账号隔离（daily/weekly 走 `checkAccountAccess`，compare 走 `getAccessibleAccountIds` allowlist），越权 403；空历史/窄屏/色盲替代由 Report.vue 状态兜底。
- P2-8 完成：README/CHANGELOG/`release-notes-v270.md`/version.json 全部 2.7.0；测试数 154、E2E 16 与实测一致（`version.json` 的 `build=20260804` 被 `release-contract.test.js` 契约锁定，保持不动）。

### 性能记录（批 3 实测基线）

- 构建：`pnpm build:web` 15.1s（Vite ~6.5s）；主要 chunk gzip：`vendor-vue` 44.45kb、`vendor-axios` 17.34kb、`index.css` 26.66kb（基线 25.97kb，+0.69kb）、`AdminPanel` 16.99kb、`Settings` 14.96kb、`Friends` 9.93kb、`Dashboard` 6.66kb、`Analytics` 6.57kb、`Report` 4.00kb、`Scheduler` 3.56kb、`Statistics` 3.50kb、入口 `index` 6.56kb。
- API p50/p95（本地实测采样，独立临时数据实例）：`POST /api/login` 47.54ms、`POST /api/user/change-password` 68.13ms、`GET /api/scheduler` 1.68ms、`GET /api/task-runs` 1.76ms、`GET /api/report` 1.30ms、`GET /api/stats/trend` 0.85ms、静态资源 ~1ms。
- JSON 持久化：write count=9，p50 1.66ms / p95 36.82ms / max 36.82ms；read count=2，p50 0.03ms / p95 0.04ms。
- 缓存头实测：`/` 与 `/index.html` → `no-cache`；`/assets/*-hash.*` → `public, max-age=31536000, immutable`；`/icon.png` → `public, max-age=86400`。
- 首屏请求数：登录后 Dashboard 聚合接口保持不变，路由级懒加载保持；E2E 375/768/1440 三档无横向溢出断言通过。

### 剩余风险

- `/api/metrics` 的 p50/p95 完整读出口需管理员完成初始改密后使用（`mustChangePassword` 强制；本机管理员账号正处于该状态，属预期安全行为）。
- P2-2 好友/日志/审计大列表虚拟列表未实施；当前任务历史以严格分页兜底，好友列表量级增大后需补虚拟滚动。
- E2E 期间 `vite preview` 的 WebSocket 代理报 `ECONNREFUSED` 属预期（后端不在 E2E 环境运行），不影响用例通过。
- 验收过程中在真实数据目录产生过本地登录审计日志（临时测试实例），已清理会话残留；`login-logs.json` 保留审计痕迹属正常。

## 8. 分批执行约束

- 每批完成后汇报：改动摘要（`git diff --stat`）、验证结果（test/lint/build/e2e）、剩余风险，再进入下一批。
- 不修改未提交文件（`core/src/controllers/admin.js`、`user-store.js`、`session-store.js`、`strategy-compare.js`、Analytics.vue、相关测试）的功能语义；如必须触碰，先说明并与现状兼容。
- 不引入重型 UI 框架或图表依赖；统计/分析继续使用自绘 SVG，除非数据证明不满足需求。
- 不直接替换 JSON 数据层为 SQLite；仅允许基准评估文档。
- 不擅自提交、暂存或删除用户改动。
