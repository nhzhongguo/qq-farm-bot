# C05 - 私人仓库推送边界

- Updated: 2026-07-16 00:37:45 +08:00
- Status: active hard boundary
- Source: 用户明确要求确保隐私、禁止推送错仓库并长期记住

## Allowed Push Target

- Remote name: `origin`
- Exact push URL: `https://github.com/nhzhongguo/qq-farm-automation-bot-private.git`
- Expected repository: `nhzhongguo/qq-farm-automation-bot-private`

## Forbidden

- 禁止向 `upstream` (`https://github.com/cxw521/qq-farm-automation-bot.git`) 推送。
- 禁止向任何非上述精确 `origin` URL 的远端推送。
- 不得因为仓库名相似、当前分支相同或历史上成功推送过，就跳过远端核验。
- 未经用户新的明确授权，不得修改、替换或放宽此边界。

## Required Guard

1. 推送前运行 `git remote get-url --push origin`，必须与允许 URL 完全一致。
2. 推送命令必须显式使用 `git push origin <branch>`，不得使用模糊默认远端。
3. 推送后重新 fetch，并核验本地与 `origin/<branch>` 的 commit、tree、ahead/behind 和 diff。
4. 任一检查不一致时立即停止，不推送，并向用户说明。
5. 本地 `.git/hooks/pre-push` 必须阻止非 `origin` 或非允许 URL 的推送。
6. 本地 Git 配置固定 `remote.pushDefault=origin`、`branch.main.pushRemote=origin`、`push.default=simple`。
7. `upstream` 仅允许 fetch，其 push URL 必须保持为 `DISABLED_BY_PRIVACY_GUARD`。

## Evidence

- 2026-07-16 核验：本地和 `origin/main` commit 均为 `2383503205a03098771fd1deacebd64db5c7dbc8`。
- 2026-07-16 核验：本地和 `origin/main` tree 均为 `090a8e6bc353512bada4e9c43774e6dcaf33c825`。
- 同期 `upstream/main` 为 `bf30e57a4110a3c8584cba3b67e23c7f8e14c53e`，与私人仓库不同。
- 保护演练：允许的 origin hook 返回 0；upstream hook 返回 1；禁用 upstream push URL 后 dry-run 在本地返回 128。
