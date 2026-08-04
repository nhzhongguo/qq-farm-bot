# 🌾 QQ Farm Bot

> 多账号 QQ 农场自动化托管平台 —— 挂机 · 看板 · 告警 · 运维，一套自托管方案全搞定。

[![version](https://img.shields.io/badge/version-v2.5.0-blue)](https://github.com/nhzhongguo/qq-farm-bot/releases)
[![Node](https://img.shields.io/badge/Node.js-20%2B-339933)](https://nodejs.org)
[![Vue](https://img.shields.io/badge/Frontend-Vue3-42b883)](https://vuejs.org)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed)](https://www.docker.com)
[![Tests](https://img.shields.io/badge/unit-tests%20130%20passed-brightgreen)]()
[![E2E](https://img.shields.io/badge/e2e-11%20passed-brightgreen)]()

---

## 目录

- [项目简介](#项目简介)
- [核心能力](#核心能力)
- [面板功能一览](#面板功能一览)
- [告警与通知](#告警与通知)
- [快速开始](#快速开始)
- [配置说明](#配置说明)
- [数据存储与备份](#数据存储与备份)
- [开发与质量保障](#开发与质量保障)
- [目录结构](#目录结构)
- [版本发布与回退](#版本发布与回退)
- [安全设计](#安全设计)
- [致谢](#致谢)

---

## 项目简介

QQ Farm Bot 是一套面向**长期挂机场景**的多账号农场自动化管理系统。后端基于 Node.js，前端为 Vue 3 单页面板，每个农场账号由独立 Worker 驱动，互不干扰。

项目的设计目标很直接：**账号托管得稳、面板看得清、异常推得出、数据丢不了**。

- 🔌 多账号并行托管，QQ Code / 微信双通道登录接入
- 🖥️ 一站式 Web 面板：状态、日志、分析、调度、后台管理全在一个界面
- 📣 异常实时告警，打通 19 种主流推送渠道
- 📊 收益趋势可视化，7 / 30 / 90 天变化一目了然
- 🛡️ 数据原子写入 + 自动备份恢复，敏感信息全链路脱敏
- 🔁 语义化版本 + Git 标签，升级回退一键到位

## 核心能力

### 🧑🌾 账号托管

| 能力 | 说明 |
| --- | --- |
| 多账号管理 | 新增、编辑、启停、删除，账号级隔离，互不影响 |
| 批量运维 | 批量启动 / 停止 / 重启，带权限校验与审计记录 |
| 双通道登录 | QQ Code 与微信登录服务接入，微信代理密钥仅存后端 |
| 配额控制 | 账号额度、卡密续期、用户隔离与细粒度配额管理 |
| 开机策略 | 服务重启后由面板手动确认启动，避免误拉起全部账号 |

### 🌱 农场自动化

| 能力 | 说明 |
| --- | --- |
| 日常农活 | 自动收获、浇水、除草、除虫、种植与铲除 |
| 化肥管理 | 普通 / 有机 / 智能施肥，自动购买与容器阈值控制 |
| 成长经营 | 土地升级、任务领取、果实出售、每日奖励 |
| 种植策略 | 按种子、等级、经验、利润与背包优先级自定义 |
| 好友互动 | 自动偷菜、帮助好友、黑名单、静默时段与操作间隔 |

### 🛠️ 运维工具链

| 能力 | 说明 |
| --- | --- |
| 审计日志 | 关键操作留痕，密码 / 令牌 / 卡密等字段自动脱敏 |
| 诊断包 | 一键导出脱敏 JSON 诊断包，快速定位账号异常 |
| 重试策略 | 指数退避 + 随机抖动，识别超时 / 5xx / 429 可重试错误 |
| 健康自检 | Runtime Doctor 检查数据目录、版本、内存、磁盘与存储完整性 |
| 任务历史 | Worker 生命周期事件持久化，调度页可回溯运行历史 |

## 面板功能一览

| 页面 | 定位 |
| --- | --- |
| 概览 | 全局状态、账号健康度、关键指标总览 |
| 个人 | 当前账号信息、登录凭证与个人设置 |
| 好友 | 好友列表、农场巡查、黑名单与 GID 管理 |
| 分析 | 农场经营分析与操作数据 |
| 统计 | 金币 / 经验 / 操作数 7 / 30 / 90 天收益趋势 |
| 调度 | 任务调度、运行历史与任务级重试状态 |
| 设置 | 自动化参数、种植策略、告警规则与配置模板 |
| 后台管理 | 用户、卡密、公告、审计、登录日志与系统参数 |

支持**明暗双主题**与移动端响应式布局。

## 告警与通知

告警规则引擎支持 **连续失败 / 离线时长 / 任务错误数** 三种条件，最多 20 条规则，触发即推送。

打通 pushoo **19 种推送渠道**，覆盖国内外主流即时通讯：

> qmsg · Server酱 · PushPlus · 钉钉 · 企业微信 · Bark · Telegram · 飞书 · Discord · Webhook · 邮件 · 短信 · 语音 · 微信 · QQ · 极光 · 爱发信 · 微语 · PushDeer

所有渠道均支持在「测试推送」中一键验证，推送配置中的 token 类字段沿用脱敏规则。

## 快速开始

### 🪟 Windows

```powershell
git clone https://github.com/nhzhongguo/qq-farm-bot.git
cd qq-farm-bot

corepack enable
corepack prepare pnpm@10.30.2 --activate
pnpm install
pnpm build:web
pnpm dev:core
```

### 🐧 Linux

```bash
git clone https://github.com/nhzhongguo/qq-farm-bot.git
cd qq-farm-bot

corepack enable
corepack prepare pnpm@10.30.2 --activate
pnpm install
pnpm build:web
ADMIN_PORT=3007 pnpm dev:core
```

### 🐳 Docker

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f qq-farm-bot
```

更新并重建：

```bash
git pull --ff-only
docker compose up -d --build
```

启动后访问 <http://localhost:3007>，初始管理员账号与密码均为 `admin`。首次登录必须修改密码，之后才能使用全部页面。

## 配置说明

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `ADMIN_PORT` | `3007` | 源码运行时的面板监听端口 |
| `PORT` | `3007` | Docker Compose 暴露到宿主机的端口 |
| `FARM_DATA_DIR` | `core/data` | 自定义可写数据目录 |
| `LOG_LEVEL` | `info` | 日志级别 |
| `TZ` | `Asia/Shanghai` | 运行时区 |
| `TRUST_PROXY` | 关闭 | 仅在可信反向代理后开启 |
| `SESSION_ABSOLUTE_TTL_MS` | `43200000` | 面板会话最长有效期（12 小时） |
| `SESSION_IDLE_TTL_MS` | `7200000` | 面板无操作自动退出（2 小时） |
| `WX_PROXY_API_URL` | 后台配置 | 微信登录代理地址 |
| `WX_PROXY_API_KEY` | 后台配置 | 微信登录代理密钥 |
| `WX_PROXY_APP_ID` | 内置 | 微信小程序 App ID |

根目录 `version.json` 提供机器可读的版本、构建日期与升级摘要；后台「系统」页展示实时运行环境检查结果。

## 数据存储与备份

所有数据均为**本地 JSON 文件**，不依赖外部数据库。源码运行位于 `core/data/`，Docker 运行位于 `qq-farm-data` 命名卷。

| 文件 | 内容 |
| --- | --- |
| `users.json` | 用户、密码哈希、角色与有效期 |
| `cards.json` | 卡密库存与使用状态 |
| `accounts.json` | 农场账号与登录 Code |
| `store.json` | 自动化、种植策略与系统配置 |
| `card-claim.json` | 免费卡密领取状态 |
| `logs/` | 运行日志 |

数据文件含敏感信息，已被 Git 忽略。写入采用原子操作并自动生成 `.bak` 副本，主文件损坏时优先自动恢复。

```powershell
# Windows 备份示例
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item .\core\data ".ackup-$stamp" -Recurse
```

恢复时先停止服务，再将备份复制回 `core/data/`，切勿在服务运行期间覆盖数据文件。

## 开发与质量保障

```bash
pnpm test              # 单元测试（130 项全部通过）
pnpm lint:check        # 只读代码规范检查
pnpm build             # 前端类型检查与生产构建
pnpm test:e2e          # Playwright 端到端测试（11 项）
pnpm audit --prod      # 生产依赖安全审计
```

质量门在 GitHub Actions（`.github/workflows/ci.yml`）中自动执行：冻结锁文件安装、只读 Lint、前端构建、Playwright 冒烟测试。版本发布可运行 `node scripts/release.js` 自动校验四处版本号一致性并生成发布摘要。

## 目录结构

```text
.
|-- core/                  Node.js 后端与账号 Worker
|   |-- src/controllers/   HTTP 与 Socket.IO 接口
|   |-- src/core/          单账号运行逻辑
|   |-- src/models/        用户、账号与配置持久化
|   |-- src/runtime/       Worker 生命周期与数据提供层
|   |-- src/services/      农场、好友、商城、任务、告警等业务服务
|   |-- test/              后端回归测试
|   `-- data/              本地运行数据（不提交 Git）
|-- web/                   Vue 3 Web 面板
|   |-- src/components/    页面组件
|   |-- src/stores/        Pinia 状态管理
|   |-- src/views/         业务页面
|   `-- e2e/               Playwright 端到端测试
|-- docs/                  升级方案与设计文档
|-- scripts/              发布、分析与运维脚本
|-- docker-compose.yml
|-- pnpm-workspace.yaml
`-- CHANGELOG.md
```

## 版本发布与回退

项目遵循语义化版本（SemVer），从 `v2.3.0` 起使用不可移动的 Git 标签管理发布：

| 类型 | 示例 | 适用场景 |
| --- | --- | --- |
| PATCH | `2.3.0 → 2.3.1` | 缺陷修复、安全补丁、小范围调整 |
| MINOR | `2.3.1 → 2.4.0` | 向后兼容的新功能或较大优化 |
| MAJOR | `2.4.0 → 3.0.0` | 不兼容的数据结构、接口或部署变更 |

回退以标签为锚点，采用**新提交恢复旧版本代码**的方式，不强推、不删除历史标签，回退后仍可继续升级：

```bash
git fetch --tags
git switch main
git restore --source v2.2.1 --staged --worktree .
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

## 安全设计

- 密码使用带盐 PBKDF2 哈希保存，比较采用 `timingSafeEqual` 防时序侧信道
- 登录 / 注册 / 卡密领取接口启用 IP 级限流，超限返回 429
- 基础 HTTP 安全头内置，公开 API 白名单明确，其余接口统一要求 token
- 审计日志与诊断包统一脱敏，不输出原始凭据与本地绝对路径
- 卡密领取叠加 IP 与客户端标识双重限制，领取后预留防重复
- 公网部署建议叠加 HTTPS、可信反向代理与防火墙访问控制

## 致谢

本项目基于上游开源项目 [cxw521/qq-farm-automation-bot](https://github.com/cxw521/qq-farm-automation-bot) 的代码进行二次开发，在此感谢原作者的贡献。QQ Farm Bot 在继承其功能的基础上，完成了产品化重构与持续迭代，目前功能已全面覆盖上游并持续扩展。
