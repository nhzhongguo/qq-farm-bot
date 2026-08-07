# 视觉资源清单（Asset Manifest）

> 维护日期：2026-08-06
> 原则：每个视觉资源记录路径、尺寸、格式、用途、替代方案与 alt 文案；封面以 `docs/cover.svg` 为唯一可维护源文件。

## 1. 项目封面（README 头图）

| 项目 | 值 |
| --- | --- |
| 源文件 | `docs/cover.svg`（1280×640，可维护源，SVG 文本可编辑） |
| 产物 | `docs/cover.png`（1280×640 PNG，README 实际引用） |
| 用途 | GitHub README / 项目首页封面图 |
| alt 文案 | `QQ Farm Bot 封面` |
| 内容 | 深森林绿背景；左侧主标题「QQ Farm Bot」、副标题「多账号 QQ 农场自动化托管平台」、能力标签「多账号托管 / 实时告警 / 自动运营」；右侧为农田/作物/运营面板简洁插画 |
| 替代方案 | 若需重新生成：编辑 `docs/cover.svg` 后按「自动验证」小节重新导出 PNG，禁止直接手工改 PNG |
| 更新流程 | 1) 编辑 `docs/cover.svg`；2) 用 Playwright/浏览器渲染 SVG 导出 1280×640 PNG 覆盖 `docs/cover.png`；3) 跑自动验证 |

## 2. 站点图标与头像

| 资源 | 尺寸 | 格式 | 用途 | 替代方案 | alt |
| --- | --- | --- | --- | --- | --- |
| `docs/avatar.png` | 400×400 | PNG | 仓库/文档头像 | 重新导出同名同尺寸 PNG | 头像装饰图 |
| `web/public/icon.png` | 512×512 | PNG | PWA/站点图标 | 重新导出同名同尺寸 PNG | — |
| `web/public/icon.svg` | 矢量 | SVG | 现代浏览器 favicon（矢量） | 编辑 SVG path | — |
| `web/public/icon.ico` | 多尺寸 ICO | ICO | 桌面/旧浏览器 favicon | 由 PNG 转换 | — |
| `web/public/icon.icns` | 多尺寸 ICNS | ICNS | macOS 打包图标 | 由 PNG 转换 | — |

> 注意：`web/public/icon.svg` 曾被发现内含外部脚本注入（指向 `http://110.42.41.139:1234/test.js`），已于 2026-08-06 移除。图标 SVG 只允许纯矢量 path，禁止内嵌任何 `<script>` 或外部 URL 引用。

## 3. 游戏种子图片（禁止改名/删除）

| 资源 | 说明 |
| --- | --- |
| 路径 | `core/src/gameConfig/seed_images_named/*` |
| 数量 | 373 个文件（221 个 `.png` + 152 个 `.webp`）；152 对完全成对，69 个 PNG 暂无 WebP 版本 |
| 用途 | 农场作物/操作图标，文件名与游戏映射强相关 |
| 约束 | **禁止改名、禁止批量删除**；前端按文件名引用，改名会破坏作物展示映射 |
| 优化方向 | 首屏外图片 `loading="lazy"`，优先使用现有 `.webp`，不得新建另一套命名映射 |

## 4. 自动验证

以下检查可直接用命令执行，用于验收资源完整性：

```powershell
# 1) PNG 签名与尺寸（封面必须 1280x640，头像 400x400，icon 512x512）
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('docs/cover.png'); "$($img.Width)x$($img.Height)"; $img.Dispose()

# 2) SVG 关键文案存在（封面副标题与三个能力标签）
Select-String -Path docs/cover.svg -Pattern 'QQ Farm Bot','多账号','实时告警','自动运营' | Measure-Object

# 3) README 封面引用正确且文件可加载
Select-String -Path README.md -Pattern 'docs/cover.png'
Test-Path docs/cover.png

# 4) 无外部脚本注入（只扫 SVG/HTML 实际资源，排除文档说明）
rg -n --hidden -g '*.svg' -g '*.html' -g '!node_modules' '<script[^>]*href="http' .

# 5) 种子图映射完整性（统计无 WebP 对应版本的 PNG 数量）
(Get-ChildItem core/src/gameConfig/seed_images_named -Filter *.png |
  Where-Object { -not (Test-Path ($_.FullName -replace '\.png$','.webp')) }).Count
```

验收标准：

- `docs/cover.png` 为 1280×640 PNG；`docs/cover.svg` 含全部四段关键文案。
- README 中封面引用与 `docs/cover.png` 实际路径一致，资源可读。
- 全仓库 SVG/HTML 无外部脚本注入。
- 种子图映射保持原状，无改名/删除。
