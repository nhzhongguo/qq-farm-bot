# QQ农场功能缺口审计报告

- 审计日期: 2026-07-15
- 审计目标: 作为项目迭代审计 Agent，严格按三步走排查缺失功能，重点不是 Bug/版本升级，而是功能补齐。
- 本地版本基线: `2.3.2`，当前提交 `1020f49 feat(ui): redesign panel design system and key pages`
- 本地证据来源: `README.md`、`CHANGELOG.md`、`package.json`、`core/src/**`、`web/src/**`、`core/test/**`、`web/e2e/**`
- 外部检索方式: GitHub API、公开 README、官方文档页面抓取；快照保存在 `docs/audit/sources/`

## 结论摘要

本项目已经不是简单脚本，而是一个带多账号、Web 控制台、用户/卡密、实时日志、Worker 隔离、自动化策略和安全边界的 QQ 农场自动化系统。完整度最高的是农场/好友/仓库/任务自动化与基础后台管理；半成品集中在任务编排可视化、执行历史、审计日志、精细权限、指标监控、插件扩展、工作流导入导出。

对照 n8n、Airflow、Node-RED、Kestra、Huginn、ALAS、uiautomator2、GitHub Actions 等同赛道或相邻成熟产品，本项目下一轮最应该补的是“可运营化能力”：调度中心 UI、失败诊断包、持久化执行历史、操作审计、精细 RBAC、配置/模板导入导出、插件/事件触发接口。这些不是炫技功能，是长期 7x24 运行和多人使用时会很快暴露的缺口。

## 第一步: 已实现功能清单

### 1. 业务自动化功能

| 模块 | 已实现功能 | 完整度判断 | 本地证据 |
| --- | --- | --- | --- |
| 账号管理 | 多账号新增、编辑、删除、启动、停止；账号归属用户；QQ Code 与微信扫码登录入口 | 完整功能 | `core/src/controllers/admin.js` `/api/accounts`、`/api/accounts/:id/start`、`/api/accounts/:id/stop`、`/api/qr/create`、`/api/qr/check`; `web/src/components/AccountModal.vue`; `web/src/stores/account.ts` |
| 账号运行隔离 | 每个账号独立 Worker；支持 worker_threads/fork；主进程维护状态、日志、请求回调、停止/重启兜底 | 完整功能 | `core/src/runtime/worker-manager.js`; `core/src/runtime/runtime-engine.js`; `core/src/core/worker.js` |
| 农场基础操作 | 获取土地、收获、浇水、除草、除虫、铲除、种植、土地解锁/升级、手动一键操作 | 完整功能 | `core/src/services/farm.js`; `/api/lands`; `/api/farm/operate`; `web/src/components/FarmPanel.vue` |
| 土地/作物策略 | 土地类型识别、多季作物处理、空地/枯地分析、种子选择策略、指定种子、背包种子优先顺序、种植延迟与随机顺序 | 完整功能 | `core/src/services/farm.js`; `core/src/models/store.js` `plantingStrategy`, `preferredSeedId`, `bagSeedPriority`, `plantOrderRandom`, `plantDelaySeconds`; `web/src/views/Settings.vue` |
| 化肥策略 | 普通/有机/智能施肥；土地类型过滤；多季作物策略；化肥礼包自动开；化肥商城购买与阈值检测 | 完整功能 | `core/src/services/farm.js`; `core/src/services/warehouse.js`; `core/src/services/mall.js`; `/api/fertilizer/buy`; `/api/fertilizer/check-and-buy`; `web/src/views/Settings.vue` |
| 背包管理 | 背包/种子查询、物品使用、果实识别与批量出售、出售回包金币兜底同步 | 完整功能 | `core/src/services/warehouse.js`; `/api/bag`; `/api/bag/seeds`; `/api/bag/use`; `/api/bag/sell`; `web/src/components/BagPanel.vue` |
| 好友列表/互动 | 好友同步、好友农场查看、偷菜、浇水、除草、除虫、捣乱、批量操作、访客记录 | 完整功能 | `core/src/services/friend.js`; `/api/friends`; `/api/friend/:gid/lands`; `/api/friend/:gid/op`; `/api/friends/batch-op`; `/api/interact-records`; `web/src/views/Friends.vue` |
| 好友保护策略 | 好友黑名单、作物黑名单、已知好友 GID、同步冷却、静默时段、经验上限后停止帮忙 | 完整功能 | `core/src/models/store.js`; `/api/friend-blacklist`; `/api/plant-blacklist`; `/api/friend-known-gids`; `web/src/views/Friends.vue`; `web/src/views/Analytics.vue`; `web/src/views/Settings.vue` |
| 好友申请处理 | 微信好友申请检测与自动同意 | 完整功能 | `core/src/services/friend.js` `getApplications`, `acceptFriends`, `checkAndAcceptApplications`, `onFriendApplicationReceived` |
| 分享邀请处理 | 微信环境读取 `share.txt`，解析并去重分享链接，通过 `ReportArkClick` 触发好友申请，完成后清空文件 | 半成品功能 | `core/src/services/invite.js`; `core/src/core/worker.js`，仅文件驱动且无面板入口、执行历史或失败重试 |
| 日常奖励 | 自动任务领取、每日活跃、图鉴奖励、邮件领取、商城免费礼包、分享奖励、QQ 会员礼包、月卡礼包 | 完整功能 | `core/src/services/task.js`; `email.js`; `mall.js`; `share.js`; `qqvip.js`; `monthcard.js`; `core/src/core/worker.js` `getDailyGiftOverview` |
| 每日/会话统计 | 按账号持久化收获、浇水、除草、除虫、施肥、种植、偷菜、帮助、任务、出售、升级次数；展示会话金币/经验/点券增量 | 完整功能 | `core/src/services/stats.js`; `core/src/core/worker.js`; `web/src/views/Dashboard.vue` |
| 作物分析 | 种子/收益/经验/等级维度排序，策略推荐，黑名单联动 | 完整功能 | `core/src/services/analytics.js`; `/api/analytics`; `web/src/views/Analytics.vue` |
| 游戏配置资源 | 植物、物品、等级经验、种子图标、本地 protobuf | 完整功能 | `core/src/gameConfig/**`; `core/src/proto/**`; `/game-config` 静态服务 |

### 2. 后台管理功能

| 模块 | 已实现功能 | 完整度判断 | 本地证据 |
| --- | --- | --- | --- |
| 登录/注册 | 管理员默认账号、普通用户注册、卡密绑定、续期 | 完整功能 | `/api/login`; `/api/register`; `/api/user/renew`; `core/src/models/user-store.js`; `web/src/views/Login.vue`; `web/src/components/Sidebar.vue` |
| 用户管理 | 管理员查看、编辑、删除用户；修改账号额度；管理员为用户续期 | 完整功能 | `/api/admin/users`; `/api/admin/users/:username/edit`; `/api/admin/users/:username/renew`; `web/src/views/AdminPanel.vue` |
| 卡密管理 | 单张/批量生成，时间卡/额度卡，启停，删除，批量删除，免费领卡开关与记录 | 完整功能 | `/api/admin/cards`; `/api/admin/cards/batch-delete`; `/api/card-claim/status`; `/api/admin/card-claim/status`; `/api/admin/card-claim/records`; `core/src/models/user-store.js` |
| 公告管理 | 管理员发布公告，用户已读记录，按 showOnce 控制展示 | 完整功能 | `/api/announcement`; `/api/admin/announcement`; `core/src/models/store.js`; `web/src/components/Sidebar.vue` |
| 系统配置 | clientVersion、host、platform、system、微信代理配置、用户隔离开关 | 完整功能 | `/api/admin/system-config`; `/api/admin/wx-config`; `core/src/models/store.js`; `web/src/views/AdminPanel.vue` |
| 下线提醒 | 多渠道 Pushoo 推送，Webhook、自定义 token、标题、内容、重登链接模式、下线后自动删除秒数、测试发送 | 完整功能 | `/api/settings/offline-reminder`; `/api/settings/offline-reminder/test`; `core/src/runtime/relogin-reminder.js`; `core/src/services/push.js`; `web/src/views/Settings.vue` |
| 主题与设计系统 | 明暗主题、主题色、基础 UI 组件、响应式布局 | 完整功能 | `web/src/composables/theme.ts`; `web/src/components/ui/**`; `web/src/styles/tokens.css` |

### 3. 任务调度与并发处理

| 模块 | 已实现功能 | 完整度判断 | 本地证据 |
| --- | --- | --- | --- |
| 调度器抽象 | 命名空间调度器、timeout/interval 管理、任务快照、错误日志 | 完整功能 | `core/src/services/scheduler.js` |
| Worker 统一调度 | 农场巡查、好友帮助/偷菜、日常任务、启动后一次性捣乱、推送触发巡田 | 完整功能 | `core/src/core/worker.js`; `core/src/services/farm.js`; `core/src/services/friend.js` |
| 调度状态 API | `/api/scheduler` 可返回 runtime/worker 调度快照 | 半成品功能 | `core/src/controllers/admin.js`; `core/src/runtime/data-provider.js`，但前端没有调度中心 UI、历史和操作入口 |
| 请求限流队列 | TokenBucket、PriorityQueue、RequestQueue、批量操作优化器、按服务配置并发/间隔 | 完整功能 | `core/src/services/rate-limiter.js` |
| 并发运营能力 | 每账号独立 Worker，多账号可并行运行 | 完整功能 | `core/src/runtime/worker-manager.js`; `core/src/runtime/runtime-engine.js` |
| 并发可视化/调参 | 缺少队列长度、等待时间、并发限制、失败率的前端展示与动态配置 | 半成品功能 | 后端存在 `getStatus()`，但 Web 未消费；没有 `/api/rate-limiter` 或配置 UI |

### 4. 日志监控功能

| 模块 | 已实现功能 | 完整度判断 | 本地证据 |
| --- | --- | --- | --- |
| 实时日志 | Socket.IO 推送运行日志、账号日志、状态更新；前端实时订阅 | 完整功能 | `core/src/controllers/admin.js` `io.on('connection')`; `web/src/stores/status.ts`; `web/src/views/Dashboard.vue` |
| 日志筛选 | Dashboard 支持模块、事件、告警、关键词过滤与清空 | 完整功能 | `/api/logs`; `web/src/views/Dashboard.vue` |
| 账号操作日志 | 启动、停止、离线删除、踢下线等账号事件记录 | 完整功能 | `core/src/runtime/runtime-state.js`; `/api/account-logs`; `web/src/stores/account.ts` |
| 登录日志 | 登录日志查看与清空 | 完整功能 | `/api/admin/login-logs`; `core/src/models/user-store.js`; `web/src/views/AdminPanel.vue` |
| 指标/健康/追踪 | 缺少指标、健康状态、trace、错误聚合、告警规则 | 半成品功能 | 有日志和 `/api/ping`，但没有 metrics/traces/health/error tracking 模块 |
| 失败诊断包 | 缺少自动打包错误上下文、最近日志、账号快照、最近游戏回包/截图类证据 | 半成品功能 | ALAS 类项目有错误 log+截图约定；本项目仅有日志列表 |

### 5. 权限安全功能

| 模块 | 已实现功能 | 完整度判断 | 本地证据 |
| --- | --- | --- | --- |
| Token 鉴权 | 全局 `/api` 公共白名单，其他接口要求 `x-admin-token` | 完整功能 | `core/src/controllers/admin.js` global API auth |
| 用户角色 | `admin` / `user` 两级角色；前端 admin 菜单过滤；普通用户账号隔离 | 完整功能 | `core/src/controllers/admin.js`; `web/src/router/menu.ts`; `web/src/stores/user.ts` |
| 密码安全 | PBKDF2+salt、强密码校验、默认管理员强制改密、失败锁定、IP 尝试限制 | 完整功能 | `core/src/models/user-store.js`; `core/test/data-safety.test.js`; `core/test/http-security.test.js` |
| HTTP 安全 | 安全头、公开 API 白名单、login/register/card-claim HTTP 限流 | 完整功能 | `core/src/services/security.js`; `core/src/controllers/admin.js`; `core/test/http-security.test.js` |
| 精细 RBAC | 缺少操作级权限、项目/租户、只读/运维/卡密管理员等角色 | 半成品功能 | 只有 admin/user，`adminRequired` 粗粒度控制 |
| 审计日志 | 缺少“谁在何时改了什么配置/卡密/账号/用户”的不可抵赖操作审计 | 半成品功能 | 有登录日志和账号日志，但没有 admin operation audit log |
| 密钥管理 | 微信代理密钥后端保存，但缺少统一凭据库、加密轮换、最小可见性 | 半成品功能 | `core/src/models/store.js` `globalWxConfig`; `README.md` 安全建议 |

### 6. 扩展插件功能

| 模块 | 已实现功能 | 完整度判断 | 本地证据 |
| --- | --- | --- | --- |
| 推送渠道扩展 | 依赖 Pushoo 支持多个通知渠道 | 半成品功能 | `core/src/services/push.js`; `web/src/views/Settings.vue` channelOptions |
| 配置资源扩展 | 可替换本地 gameConfig/proto 资源 | 半成品功能 | `core/src/gameConfig/**`; `core/src/proto/**` |
| 插件系统 | 缺少插件清单、插件生命周期、钩子、前端管理、第三方任务/策略/通知扩展 | 缺失 | 未见 `plugins/`、manifest、loader、hook API |

### 7. 测试与发布功能

| 模块 | 已实现功能 | 完整度判断 | 本地证据 |
| --- | --- | --- | --- |
| 后端回归 | 数据安全与 HTTP 安全 13 项测试 | 半成品功能 | `core/test/data-safety.test.js`; `core/test/http-security.test.js` |
| 前端 e2e | 登录/鉴权烟测 5 项 | 半成品功能 | `web/e2e/auth-smoke.spec.ts` |
| 构建发布 | web build、pkg 多平台打包、Docker Compose | 完整功能 | `package.json`; `core/package.json`; `docker-compose.yml` |
| CI/CD | 缺少 GitHub Actions 或其他 CI 配置 | 缺失 | 未见 `.github/workflows/**` |

### 8. 源码模块覆盖索引

为避免清单只覆盖显性页面，下面按源码目录逐模块归档。这里的“完整/半成品”判断模块当前职责是否形成可用闭环；跨模块的行业能力缺口仍以第三步清单为准。

| 目录/模块组 | 覆盖文件 | 当前职责与完整度 |
| --- | --- | --- |
| 后端配置 | `core/src/config/config.js`, `gameConfig.js`, `runtime-paths.js` | 环境参数、游戏资源装载、运行路径解析，完整功能 |
| HTTP/API 控制层 | `core/src/controllers/admin.js` | 登录注册、账号、农场、好友、背包、设置、管理员、日志、二维码与 Socket.IO API 均已接通，完整功能；路由集中在单文件是维护性问题，不算功能缺失 |
| 账号运行时 | `core/src/runtime/data-provider.js`, `relogin-reminder.js`, `runtime-engine.js`, `runtime-state.js`, `worker-manager.js` | Worker 请求桥接、下线提醒、生命周期、状态/日志、线程/进程隔离，完整功能 |
| 数据模型与持久化 | `core/src/models/store.js`, `user-store.js`, `core/src/services/json-db.js` | 自动化设置、账号、用户、卡密、登录/领取记录、原子写入与备份恢复，完整功能 |
| 农场业务服务 | `account-resolver.js`, `analytics.js`, `email.js`, `farm.js`, `friend.js`, `interact.js`, `invite.js`, `mall.js`, `monthcard.js`, `qqvip.js`, `share.js`, `task.js`, `warehouse.js` | 农场/好友/互动/商城/奖励/仓库链路完整为主；`invite.js` 只有微信文件驱动入口，判定为半成品 |
| 运行支撑服务 | `logger.js`, `push.js`, `qrlogin.js`, `rate-limiter.js`, `scheduler.js`, `security.js`, `stats.js`, `status.js` | 日志、推送、二维码登录、请求队列、任务计时、安全、统计、终端状态均已实现；其中调度可视化和指标监控属于跨模块半成品 |
| 协议与底层工具 | `core/src/utils/crypto-wasm.js`, `network.js`, `proto.js`, `qrutils.js`, `utils.js`, `core/src/proto/**`, `core/src/gameConfig/**` | RPC/Protobuf、加密 WASM、二维码工具、游戏配置和图片资源，完整功能 |
| Web 应用壳 | `web/src/main.ts`, `App.vue`, `api/index.ts`, `router/**`, `layouts/DefaultLayout.vue`, `composables/theme.ts`, `style.css`, `styles/tokens.css` | 应用启动、鉴权路由、菜单、布局、主题和设计令牌，完整功能 |
| Web 页面 | `Dashboard.vue`, `Personal.vue`, `Friends.vue`, `Analytics.vue`, `Settings.vue`, `AdminPanel.vue`, `Login.vue` | 概览、个人农场/背包/任务、好友、分析、设置、后台、登录注册页面，完整功能；调度中心、审计、诊断等页面缺失见第三步 |
| Web 状态层 | `account.ts`, `app.ts`, `bag.ts`, `farm.ts`, `friend.ts`, `plant-blacklist.ts`, `setting.ts`, `status.ts`, `toast.ts`, `user.ts`, `wx-login.ts` | 账号、业务数据、设置、实时状态、用户与交互反馈状态，完整功能 |
| Web 组件 | `AccountModal.vue`, `BagPanel.vue`, `DailyOverview.vue`, `FarmPanel.vue`, `LandCard.vue`, `RemarkModal.vue`, `TaskPanel.vue`, `WxLoginModal.vue`, `Sidebar.vue`, `ThemeToggle.vue`, `ConfirmModal.vue`, `ToastContainer.vue`, `components/ui/**` | 账号/农场/背包/任务操作、登录、导航、反馈与基础控件，完整功能 |
| 测试与交付 | `core/test/**`, `web/e2e/**`, `package.json`, `core/Dockerfile`, `docker-compose.yml` | 本地 lint/test/build/e2e、跨平台打包和 Docker 部署已实现；测试覆盖面半成品，CI/CD 缺失 |

## 第二步: 检索关键词与行业标准功能矩阵

### 自动生成的检索关键词

- `farm game automation bot web dashboard multi account scheduler logs`
- `open source game automation bot GUI 24/7 logs screenshot emulator device management`
- `workflow automation platform scheduler dashboard RBAC audit trails plugins templates integrations`
- `task orchestration scheduled event driven workflows retries timeout error handling parallel tasks`
- `automation monitoring logs metrics traces health check error tracking notifications`
- `low-code event-driven automation editor palette custom nodes flow library`
- `game automation adb uiautomator device registry screenshot doctor plugins`
- `workflow events schedule repository_dispatch webhook custom payload`

### 外部来源索引

| 来源 | URL | 本地快照 | 用途 |
| --- | --- | --- | --- |
| n8n README | https://github.com/n8n-io/n8n/blob/master/README.md | `docs/audit/sources/n8n-README.md` | 工作流自动化、集成、模板、RBAC、审计轨迹、敏感数据 |
| n8n RBAC docs | https://docs.n8n.io/administer/manage-users-and-access/set-permissions-and-roles-rbac/ | `docs/audit/sources/n8n-rbac.html` | 角色、项目、权限模型 |
| Apache Airflow README | https://github.com/apache/airflow/blob/main/README.md | `docs/audit/sources/airflow-README.md` | 任务编排、DAG、调度器、worker、生产 UI、回填 |
| Airflow Logging & Monitoring | https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/logging-monitoring/index.html | `docs/audit/sources/airflow-logging-monitoring.html` | 日志、指标、traces、health、错误跟踪 |
| Node-RED README | https://github.com/node-red/node-red/blob/master/README.md | `docs/audit/sources/node-red-README.md` | 低代码事件自动化、节点/流程/集合库 |
| Node-RED Editor Guide | https://nodered.org/docs/user-guide/editor/ | `docs/audit/sources/node-red-editor.html` | 可视化编辑器、palette、workspace、debug/sidebar、import/export |
| Kestra README | https://github.com/kestra-io/kestra/blob/develop/README.md | `docs/audit/sources/kestra-README.md` | scheduled/event-driven、YAML as code、插件、重试、timeout、parallel、backfill、通知 |
| Huginn README | https://github.com/huginn/huginn/blob/master/README.md | `docs/audit/sources/huginn-README.md` | Agent、事件图、WebHook、第三方 Agent gems |
| AzurLaneAutoScript README | https://github.com/LmeSzinc/AzurLaneAutoScript/blob/master/README.md | `docs/audit/sources/alas-README.md` | 游戏助手 GUI、7x24、全玩法接管、错误日志+截图、地图识别 |
| uiautomator2 README | https://github.com/openatx/uiautomator2/blob/master/README.md | `docs/audit/sources/uiautomator2-README.md` | 设备连接、截图、doctor、插件、结构化日志、服务/设备注册 |
| MAA GitHub repository/API | https://github.com/MaaAssistantArknights/MaaAssistantArknights | `docs/audit/sources/maa-repository.json` | 游戏助手一键日常、computer-vision、全客户端支持 |
| GitHub Actions Events docs | https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows | `docs/audit/sources/github-actions-events.html` | schedule、workflow_dispatch、repository_dispatch、事件过滤 |

### 行业标准功能矩阵

| 七大板块 | 行业标准能力 | 外部证据 | 对本项目的审计含义 |
| --- | --- | --- | --- |
| 业务功能 | 7x24 场景、GUI、近乎全玩法接管、多服支持、错误日志与截图 | ALAS README 明确 “bot with GUI”、“designed for 24/7 running scenes”、“take over almost all gameplay”，并要求错误时上传 `log/error`、`log.txt`、最近截图 | 本项目已有 7x24 自动化基础，但缺少失败诊断包、游戏协议异常归因、可导出证据包 |
| 业务功能 | 设备/环境诊断、截图、当前 App、服务状态、doctor | uiautomator2 README 提供 device info、screenshot、doctor、server-status、device registry | 本项目是协议自动化，不需要 ADB，但仍需要运行环境 doctor、账号会话诊断、最近状态快照 |
| 后台管理 | 可视化工作流/节点编辑、模板/集成库、导入导出 | n8n README 提到 visual canvas、1500+ integrations、9000+ workflow templates；Node-RED README 提到 Nodes/Flows/Collections，Editor Guide 提到 palette、workspace、import/export | 本项目配置主要是表单开关，缺少可复用任务模板、配置导入导出、策略可视化 |
| 任务调度 | 工作流 as code、计划触发、事件触发、声明式配置 | Kestra README: scheduled and event-driven workflows、declarative YAML、UI/code editor；Airflow README: author, schedule, monitor workflows; GitHub Actions docs: scheduled time and outside events | 本项目有内部 interval 调度，但缺少用户可见、可版本化、可暂停/回填/事件触发的任务编排层 |
| 任务调度 | 重试、超时、错误处理、条件分支、backfill、顺序/并行任务 | Kestra README 明确 retries、timeout、error handling、conditional branching、backfills、sequential and parallel tasks | 本项目有超时和循环，但缺少任务级重试策略、失败状态、回填、条件化任务流 |
| 并发处理 | 调度器执行任务到 worker 数组；并发可扩展 | Airflow README: scheduler executes tasks on an array of workers；Kestra README: scalable, high availability, fault tolerance | 本项目已有 per-account Worker，但缺少全局并发策略、worker 池可视化、故障转移模型 |
| 日志监控 | 日志、指标、trace、health、错误跟踪、实时通知 | Airflow Logging & Monitoring: multiple logging mechanisms, metrics, traces, health check, Sentry error notification；Kestra README: monitoring and notifications | 本项目有实时日志和推送，但缺指标、trace、health、告警规则、错误聚合 |
| 权限安全 | RBAC、projects、account types、audit trails、sensitive data | n8n README: role-based access, audit trails, sensitive data；n8n RBAC docs: permissions/roles/projects | 本项目只有 admin/user，需要细分权限和操作审计 |
| 扩展插件 | 自定义节点、插件生态、第三方 Agent gems、插件开发指南 | n8n: add your own nodes; Node-RED: custom nodes/flows/collections; Kestra: plugin ecosystem and plugin developer guide; Huginn: Agents as external gems; uiautomator2: third-party plugins | 本项目没有插件框架，后续扩展只能改核心代码，维护成本会升高 |

## 第三步: 功能比对与缺失项开发清单

### A. 刚需必补

| 编号 | 缺失项 | 行业依据 | 本项目现状 | 开发内容 | 代码改造点 | 新增配置 |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | 调度中心 UI 与任务快照可视化 | Airflow 提供 DAG/Grid/Graph/Backfill/Code UI；Kestra 提供 UI 构建和可视化 workflow | 后端已有 `/api/scheduler`，前端无入口 | 新增“调度中心”页面，展示 runtime/worker 调度器、任务名、nextRun、running、lastRun、失败原因；支持按账号过滤 | `web/src/router/menu.ts`; 新增 `web/src/views/Scheduler.vue`; `web/src/stores/scheduler.ts`; 扩展 `/api/scheduler` 返回更稳定 schema | `scheduler.uiEnabled`, `scheduler.snapshotRefreshSec` |
| M2 | 持久化任务执行历史 | Airflow/Kestra 都强调生产运行可监控与故障排查；Airflow UI 可按时间查看 DAG run/Grid | 当前调度快照是内存态，重启丢失；日志不能结构化还原任务生命周期 | 为 farm/friend/daily/fertilizer/task 等执行生成 `task_runs.json`，记录 startedAt/endedAt/status/duration/accountId/error | `core/src/services/scheduler.js`; `core/src/core/worker.js`; 新增 `core/src/services/task-run-store.js`; 新增 `/api/task-runs` | `taskRuns.retentionDays`, `taskRuns.maxRecords` |
| M3 | 任务级重试、超时、失败策略 | Kestra 明确 retries、timeout、error handling；GitHub Actions 支持事件/条件触发 | 现有部分 API timeout、循环 catch，但没有统一任务策略 | 每类自动化任务支持 retry count、backoff、timeout、失败后跳过/停止账号/通知 | `core/src/services/scheduler.js`; `core/src/services/farm.js`; `friend.js`; `task.js`; `core/src/models/store.js`; `web/src/views/Settings.vue` | `automationPolicy.{farm,friend,task}.retries`, `.timeoutSec`, `.backoffSec`, `.onFailure` |
| M4 | 失败诊断包 | ALAS 要求错误目录包含 `log.txt` 和最近截图；Airflow 强调日志用于诊断问题 | 本项目只有日志列表，无法一键导出失败上下文 | 任务失败时生成诊断包: 最近账号日志、任务运行记录、账号状态快照、调度快照、最近异常、相关配置脱敏副本；支持下载 zip/json | 新增 `core/src/services/diagnostic-bundle.js`; `core/src/services/logger.js`; `worker-manager.js`; `/api/diagnostics/:id`; `web/src/views/Dashboard.vue` | `diagnostics.enabled`, `diagnostics.retentionDays`, `diagnostics.includeConfigSnapshot` |
| M5 | 操作审计日志 | n8n README 明确 audit trails；RBAC 文档围绕角色/项目权限 | 本项目有登录日志和账号日志，但没有管理员操作审计 | 对用户、卡密、系统配置、微信配置、公告、账号增删改、自动化设置保存记录 actor/action/target/before/after | 新增 `core/src/services/audit-log.js`; 在 `admin.js` 关键 POST/DELETE 包装审计；`web/src/views/AdminPanel.vue` 新增审计 tab | `audit.enabled`, `audit.retentionDays`, `audit.maskFields` |
| M6 | 精细 RBAC | n8n 支持 role-based access、projects、roles；RBAC docs 描述 account types、projects | 当前只有 `admin` 和 `user`；后台全部 adminRequired | 引入角色: owner/admin/operator/viewer/card-admin/config-admin/auditor；按 API 维护权限表；菜单按 permission 过滤 | `core/src/models/user-store.js`; `core/src/controllers/admin.js` `adminRequired` 改为 `permissionRequired`; `web/src/stores/user.ts`; `web/src/router/menu.ts` | `security.rbacEnabled`, `roles[]`, `permissions[]` |
| M7 | 凭据/密钥管理 | n8n 强调 sensitive data；RBAC 文档涉及项目与凭据访问 | 微信代理 key、token 等分散在 store/global config；没有统一加密/轮换 | 新增凭据库，敏感字段加密保存，前端永不回显明文；支持测试、轮换、撤销 | 新增 `core/src/services/credential-store.js`; `core/src/services/security.js`; 改造 `store.js` globalWxConfig/offlineReminder token; `AdminPanel.vue`/`Settings.vue` | `CREDENTIAL_MASTER_KEY`, `credentials.rotationDays`, `credentials.maskInApi` |
| M8 | 配置导入/导出与策略模板 | n8n 有 workflow templates；Node-RED 有 flow library 和 import/export；Kestra workflow as code | 现在策略配置只能手工表单编辑，迁移/复用困难 | 支持账号策略导出 JSON、导入校验、保存为模板、从模板套用到多个账号 | `core/src/models/store.js`; 新增 `/api/config/templates`; `web/src/views/Settings.vue`; `web/src/views/AdminPanel.vue` | `templates.enabled`, `templates.maxCount`, `templates.allowOverwrite` |
| M9 | 事件/Webhook 触发入口 | Huginn 支持 send/receive WebHooks；GitHub Actions 支持 repository_dispatch 和 schedule；Kestra 支持 event triggers | 现有 API 多为面板调用，缺少外部事件规则 | 新增安全的 `/api/events/webhook/:token`，可按事件触发巡田、好友同步、通知测试、账号重启、配置模板应用 | `core/src/controllers/admin.js`; 新增 `core/src/services/event-router.js`; `runtime-engine.js`; 前端事件规则 UI | `events.enabled`, `events.tokens[]`, `events.rules[]` |
| M10 | CI/CD 质量门 | GitHub Actions 文档提供 schedule、pull_request、release 等事件触发工作流 | 本地有 test/build/e2e 脚本，但无 `.github/workflows` | 新增 CI: install, lint, test, build, e2e smoke；release/tag 时跑 audit/build | `.github/workflows/ci.yml`; `package.json` 可补 `ci` 聚合脚本 | `CI_NODE_VERSION`, `CI_PNPM_VERSION` |

### B. 体验优化

| 编号 | 缺失项 | 行业依据 | 本项目现状 | 开发内容 | 代码改造点 | 新增配置 |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | 可视化任务拓扑/时间线 | Airflow Graph/Grid；Kestra Live Topology View | Dashboard 主要是状态卡和日志 | 增加账号任务时间线: 农场巡查、好友帮助、偷菜、日常奖励、化肥购买的最近运行顺序和耗时 | `web/src/views/Dashboard.vue`; `web/src/components/TaskTimeline.vue`; 依赖 M2 `task_runs` | `dashboard.showTaskTimeline` |
| E2 | 高级日志检索与导出 | Airflow logging/metrics；ALAS 错误日志打包 | 当前支持基础过滤、清空 | 增加保存过滤器、按时间范围导出、只看某账号某任务、下载 CSV/JSON | `/api/logs` 扩展 params; `web/src/stores/status.ts`; `Dashboard.vue` | `logs.exportEnabled`, `logs.maxExportRows` |
| E3 | 告警规则构建器 | Kestra monitoring and notifications；Airflow Sentry error notification | 只有下线提醒和测试发送 | 自定义规则: 连续失败 N 次、账号离线超过 N 分钟、登录失效、任务超时、队列堆积，发送指定渠道 | 新增 `core/src/services/alert-rules.js`; `relogin-reminder.js`; `worker-manager.js`; `Settings.vue` | `alerts.rules[]`, `alerts.defaultChannel` |
| E4 | 运行环境 doctor | uiautomator2 提供 `doctor`；ALAS 文档要求定位 ADB/uiautomator2/模拟器问题 | 本项目有 `/api/ping`，但不检查 Node/pnpm/数据目录/端口/配置资源 | 新增系统诊断: Node 版本、pnpm 声明、可写数据目录、gameConfig/proto 存在、端口、Docker env、磁盘空间 | 新增 `/api/admin/doctor`; `core/src/config/runtime-paths.js`; `AdminPanel.vue` system tab | `doctor.checkDiskMinMb`, `doctor.checkPnpmVersion` |
| E5 | 多账号批量运维 | ALAS/游戏助手面向 24/7，多账号运行需要批量控制；Airflow worker/UI 面向批量生产任务 | 当前账号列表可单个启动/停止 | 批量启动/停止/重启、按平台/用户/状态筛选、批量应用策略模板 | `/api/accounts/batch-start`; `/api/accounts/batch-stop`; `worker-manager.js`; `Settings.vue`/`Sidebar.vue` | `accounts.batchLimit`, `accounts.batchConfirmRequired` |
| E6 | 策略预览/模拟执行 | Kestra UI 实时校验；Node-RED editor 支持构建/调试 flows | Analytics 有推荐，但设置页保存前不可模拟 | 对当前账号土地/背包做 dry-run，显示本次会收获/铲除/种植/施肥/偷菜的对象 | 新增 `/api/farm/plan`; `farm.js` 抽出 plan/apply 双阶段；`Settings.vue` | `dryRun.enabled`, `dryRun.maxPreviewItems` |
| E7 | 卡密/用户运营分析 | Airflow 官方监控文档把 metrics 列为生产监控能力；Kestra 明确 monitoring，卡密/用户维度是结合本项目数据模型的运营指标落地 | 只做列表管理，缺少转化/使用率/过期分布 | 卡密使用率、未使用库存、用户过期趋势、账号额度使用率 | `user-store.js` 增统计函数; `/api/admin/analytics/users`; `AdminPanel.vue` | `adminAnalytics.enabled` |
| E8 | API 文档/OpenAPI | n8n/Node-RED/Kestra 均有文档和 API/集成生态 | API 只在源码里 | 自动生成或维护 OpenAPI，便于外部面板、Webhook、插件调用 | `core/src/controllers/admin.js` 路由 schema; 新增 `docs/api/openapi.yaml`; `/api/docs` | `apiDocs.enabled` |

### C. 长期拓展

| 编号 | 缺失项 | 行业依据 | 本项目现状 | 开发内容 | 代码改造点 | 新增配置 |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | 插件系统 | n8n 自定义 nodes；Node-RED custom nodes/flows/collections；Kestra plugin ecosystem；Huginn external Agent gems；uiautomator2 third-party plugins | 无插件 loader 和 manifest | 设计插件 manifest，支持任务插件、策略插件、通知插件、面板插件；插件可注册 API、调度任务、设置表单 | 新增 `core/src/plugins/**`; `web/src/plugins/**`; `plugins/`; `plugin.json`; `AdminPanel.vue` 插件页 | `plugins.enabled`, `plugins.dir`, `plugins.allowUnsigned` |
| L2 | 工作流 as code 与版本控制 | Kestra workflow as code + Git integration；Airflow workflows defined as code | 自动化流程硬编码在服务中 | 把任务编排抽象为 YAML/JSON workflow，支持导出、Git 存档、差异查看、回滚 | `core/src/services/workflow-engine.js`; `scheduler.js`; `farm/friend/task` 作为 actions；`docs/workflows/` | `workflows.dir`, `workflows.versioning` |
| L3 | 分布式 Worker/高可用 | Kestra scalable/HA/fault tolerance；Airflow worker array | 当前单进程主控多 Worker，主控挂了全部停止 | 支持多主机 worker agent、心跳、租约、任务抢占、失败转移 | 新增 `core/src/agent/**`; 需要持久数据库或轻量队列表；`runtime-engine.js` 重构 | `cluster.enabled`, `cluster.nodeId`, `cluster.heartbeatSec` |
| L4 | 多租户项目/空间 | n8n RBAC docs 提到 projects；角色可在不同项目不同权限 | 当前用户隔离按账号归属，缺少 project/workspace | 增加 project 概念，账号、模板、插件、凭据、审计日志按 project 隔离 | `user-store.js`; `store.js`; `admin.js`; `web/src/stores/user.ts`; 全部账号 API 增 projectId | `projects.enabled`, `projects.defaultId` |
| L5 | 低代码事件自动化编辑器 | Node-RED editor/palette/workspace；Huginn directed graph agents | 当前只能开关固定策略 | 拖拽/表单式规则: 当账号下线 -> 发通知 -> 等待扫码 -> 自动重启；当化肥低于阈值 -> 购买 -> 记录 | 新增 `web/src/views/AutomationBuilder.vue`; `event-router.js`; `workflow-engine.js` | `automationBuilder.enabled` |
| L6 | AI/规则混合策略助手 | n8n AI-native workflows, model flexibility, tool use, human approvals | 当前种植策略是确定性排序 | 可选策略助手: 根据历史收益、账号等级、背包、金币预测策略；所有执行前可人工确认 | `analytics.js`; 新增 `strategy-advisor.js`; `Settings.vue` 策略建议区 | `advisor.enabled`, `advisor.mode`, `advisor.requireApproval` |
| L7 | 更完整的游戏异常识别 | ALAS 强调地图识别/模板匹配限制；MAA 以 computer-vision 为主题 | 本项目是协议层，缺少异常场景分类与恢复知识库 | 对 RPC 错误码、登录失效、好友访问禁止、游戏版本变化建立错误字典和恢复动作 | `network.js`; `friend.js`; `worker-manager.js`; 新增 `error-catalog.json` | `errorCatalog.enabled`, `errorCatalog.autoRecovery` |

## 建议实施路线

### 第一批: 运营安全闭环

1. M2 持久化任务执行历史。
2. M4 失败诊断包。
3. M5 操作审计日志。
4. M1 调度中心 UI。
5. M10 CI/CD 质量门。

这一批能让项目从“能跑”升级到“出问题能定位、多人操作能追责、任务状态能复盘”。

### 第二批: 多人/长期运行能力

1. M6 精细 RBAC。
2. M7 凭据/密钥管理。
3. M3 任务级重试/超时/失败策略。
4. E3 告警规则构建器。
5. E4 运行环境 doctor。

这一批解决多用户、多账号、长期部署的管理风险。

### 第三批: 生态化与可扩展

1. M8 配置导入/导出与策略模板。
2. M9 事件/Webhook 触发入口。
3. L1 插件系统。
4. L2 工作流 as code。
5. L5 低代码事件自动化编辑器。

这一批适合在核心稳定后推进，避免过早重构影响当前业务稳定性。

## 本次审计边界与注意事项

- 本报告没有把“依赖升级”“漏洞修复”作为主线；除 CI/CD 和凭据安全外，所有条目都围绕缺失功能。
- 行业矩阵只引用已抓取的公开资料；没有把未验证的产品功能写成依据。
- 本地“完整/半成品”判断基于源码存在性、前后端闭环、配置持久化、测试/运行可观察性四个维度。
- 本项目当前稳定模块包括数据安全、HTTP 安全、多账号隔离、核心农场/好友自动化；实现上述缺口时应优先加外层能力，不要重写稳定业务主流程。
