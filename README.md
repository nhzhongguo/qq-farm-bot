# QQ农场智能助手

QQ农场智能助手是一套持续维护的多账号自动化管理系统，由 Node.js 后端、Vue Web 面板和独立账号 Worker 组成。项目面向长期运行场景，重点处理账号隔离、自动化任务、实时状态、运行日志、数据安全和版本回退。

当前开发版本：`v2.4.0`

仓库地址：<https://github.com/nhzhongguo/qq-farm-automation-bot-private>

## 功能概览

### 账号与用户

- 支持 QQ Code 和微信登录服务接入。
- 支持多账号新增、编辑、启动、停止和删除。
- 支持管理员与普通用户、账号额度、卡密续期和用户隔离。
- 服务重启后不会自动启动全部农场账号，需在面板中手动确认启动。
- 默认管理员首次登录后必须修改密码。

### 农场自动化

- 自动收获、浇水、除草、除虫、种植和铲除。
- 支持普通化肥、有机化肥、智能施肥和指定土地类型。
- 支持自动购买化肥、化肥容器阈值和购买数量设置。
- 支持土地升级、任务领取、果实出售和每日奖励。
- 支持指定种子、等级、经验、利润和背包优先级种植策略。

### 好友与互动

- 好友列表、好友农场查看和批量操作。
- 自动偷菜、帮助好友和互动记录。
- 好友黑名单、作物黑名单和已知好友 GID 管理。
- 好友操作静默时段和操作间隔设置。
- 微信好友申请检测与自动同意。

### 面板与运维

- 概览、个人、好友、分析、设置和后台管理页面。
- 实时状态、运行日志、账号日志和 Socket.IO 推送。
- 用户、卡密、公告、系统参数和微信登录配置管理。
- 下线提醒、Webhook 和多种推送渠道。
- 明暗主题与响应式页面。

### 数据安全

- 用户密码使用带盐 PBKDF2 哈希保存。
- 登录频率限制和失败锁定。
- 用户、卡密、登录记录采用原子写入。
- 数据文件自动生成 `.bak`，主文件损坏时优先恢复备份。
- 卡密领取采用 IP 与客户端标识组合限制，并在领取后预留卡密。
- 微信代理密钥只保存在后端，不下发到普通用户浏览器。

## 技术栈

- 后端：Node.js、Express、Socket.IO、WebSocket、Protobuf。
- 前端：Vue 3、TypeScript、Pinia、Vue Router、UnoCSS、Vite。
- 工程：pnpm workspace、Node Test Runner、ESLint、Docker Compose。
- 数据：本地 JSON 文件和自动备份，不依赖外部数据库。

## 运行要求

- Node.js 20 或更高版本。
- pnpm 10.30.2，建议通过 Corepack 管理。
- Windows、Linux 或支持 Docker 的系统。
- Git，用于更新、版本标签和回退。

## 源码运行

### Windows PowerShell

```powershell
git clone https://github.com/nhzhongguo/qq-farm-automation-bot-private.git
cd qq-farm-automation-bot-private

corepack enable
corepack prepare pnpm@10.30.2 --activate
pnpm install
pnpm build:web
pnpm dev:core
```

指定其他端口：

```powershell
$env:ADMIN_PORT="3100"
pnpm dev:core
```

### Linux

```bash
git clone https://github.com/nhzhongguo/qq-farm-automation-bot-private.git
cd qq-farm-automation-bot-private

corepack enable
corepack prepare pnpm@10.30.2 --activate
pnpm install
pnpm build:web
ADMIN_PORT=3007 pnpm dev:core
```

启动后访问：<http://localhost:3007>

初始管理员账号和密码均为 `admin`。首次登录会被引导到修改密码页面，完成改密后才能使用其他页面。

## Docker 部署

Docker Compose 会构建前端、安装后端生产依赖，并将运行数据保存到命名卷。

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f qq-farm-bot
```

停止服务：

```bash
docker compose down
```

重新构建：

```bash
git pull --ff-only
docker compose up -d --build
```

默认宿主机端口为 `3007`，可以在 `.env` 中修改 `PORT`。容器内端口固定为 `3007`。

## 环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `ADMIN_PORT` | `3007` | 源码运行时的面板监听端口 |
| `PORT` | `3007` | Docker Compose 暴露到宿主机的端口 |
| `FARM_DATA_DIR` | `core/data` | 自定义可写数据目录 |
| `LOG_LEVEL` | `info` | 日志级别 |
| `TZ` | `Asia/Shanghai` | 运行时区 |
| `TRUST_PROXY` | 关闭 | 仅在可信反向代理后设置为 `true` |
| `SESSION_ABSOLUTE_TTL_MS` | `43200000` | 管理面板会话的最长有效期（12 小时） |
| `SESSION_IDLE_TTL_MS` | `7200000` | 管理面板无活动自动退出时间（2 小时） |
| `WX_PROXY_API_URL` | 后台配置 | 微信登录代理地址 |
| `WX_PROXY_API_KEY` | 后台配置 | 微信登录代理密钥 |
| `WX_PROXY_APP_ID` | 内置 App ID | 微信小程序 App ID |

服务地址、游戏版本、平台和系统类型也可以在后台管理页面中修改。

根目录 `version.json` 提供机器可读的版本、构建日期与升级摘要；后台“系统”页会显示当前运行环境检查结果。

## 数据目录与备份

源码运行时的数据位于 `core/data/`，Docker 运行时的数据位于 `qq-farm-data` 命名卷。主要文件包括：

- `users.json`：用户、密码哈希、角色和有效期。
- `cards.json`：卡密库存和使用状态。
- `accounts.json`：农场账号和登录 Code。
- `store.json`：自动化、种植策略和系统配置。
- `card-claim.json`：免费卡密领取状态。
- `logs/`：运行日志。

这些内容包含敏感信息，已被 Git 忽略，不会随代码推送。更新和回退代码前应先备份数据。

Windows 备份示例：

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item .\core\data ".\backup-$stamp" -Recurse
```

恢复时先停止服务，再将备份数据复制回 `core/data/`。不要在服务运行期间覆盖数据文件。

## 开发与验证

```bash
# 后端回归测试
pnpm test

# 只读代码规范检查（不会修改工作区）
pnpm lint:check

# 需要时显式执行自动修复
pnpm lint:fix

# 前端类型检查和生产构建
pnpm build

# Playwright 认证冒烟测试（先完成 pnpm build:web）
pnpm test:e2e:smoke

# 生产依赖安全审计
pnpm audit --prod
```

GitHub Actions 质量门位于 `.github/workflows/ci.yml`，固定 Node.js `20.19.0` 和 pnpm `10.30.2`，使用冻结锁文件安装、只读 Lint、前端构建和 Playwright 冒烟测试。工作流仅验证代码，不包含发布、推送或密钥配置。

每次正式发布至少需要满足：测试通过、Lint 通过、构建通过、依赖审计无已知漏洞、面板可以正常访问。

## 项目结构

```text
.
|-- core/                  Node.js 后端与账号 Worker
|   |-- src/controllers/  HTTP 和 Socket.IO 接口
|   |-- src/core/         单账号运行逻辑
|   |-- src/models/       用户、账号和配置持久化
|   |-- src/runtime/      Worker 生命周期与数据提供层
|   |-- src/services/     农场、好友、商城、任务等业务服务
|   |-- test/             后端回归测试
|   `-- data/             本地运行数据，不提交 Git
|-- web/                   Vue Web 面板
|   |-- src/components/   页面组件
|   |-- src/stores/       Pinia 状态管理
|   `-- src/views/        业务页面
|-- docker-compose.yml
|-- pnpm-workspace.yaml
`-- CHANGELOG.md
```

## 版本规则

项目从 `v2.3.0` 开始执行语义化版本规则：

| 类型 | 示例 | 使用场景 |
| --- | --- | --- |
| PATCH | `2.3.0` -> `2.3.1` | Bug 修复、安全补丁、小范围调整 |
| MINOR | `2.3.1` -> `2.4.0` | 向后兼容的新功能或较大优化 |
| MAJOR | `2.4.0` -> `3.0.0` | 不兼容的数据结构、接口或部署变更 |

每次正式推送执行以下流程：

1. 确认下一个版本号。
2. 同步根目录、后端和前端版本。
3. 更新 `CHANGELOG.md`。
4. 完成测试、Lint、构建、审计和页面验证。
5. 提交到 `main`。
6. 创建不可移动的 `vX.Y.Z` Git 标签并推送。

查看可用版本：

```bash
git fetch --tags
git tag --sort=-v:refname
git log --oneline --decorate -20
```

## 回退规则

发布标签用于代码回退，不包含 `core/data/` 运行数据。`v2.2.1` 是正式版本流程启用前的回退基线；需要回退时，只要指定目标版本，例如“回退到 `v2.2.1`”。回退采用新的提交恢复旧版本代码，不强推、不删除历史标签，保证后续仍能继续升级。

手动回退前先备份数据，然后执行：

```bash
git fetch --tags
git switch main
git restore --source v2.2.1 --staged --worktree .
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

确认无误后创建回退提交和新的版本标签。旧版本标签保持不变，可以随时再次比较或恢复。

## 安全建议

- 服务已启用基础 HTTP 安全头，并限制公开 API 白名单；公网部署仍应叠加 HTTPS 与反向代理。
- 登录/注册/卡密领取接口已启用 IP 级限流，降低暴力尝试风险。
- 首次登录后立即修改默认管理员密码。
- 不要将 `core/data/`、登录 Code、卡密、API Key 或日志上传到公共仓库。
- 公网部署时使用 HTTPS、可信反向代理和防火墙访问控制。
- 只有在反向代理会清理伪造转发头时才启用 `TRUST_PROXY`。
- 更新或回退前同时保留代码标签和本地数据备份。
