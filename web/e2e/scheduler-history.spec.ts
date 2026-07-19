import { expect, test } from '@playwright/test'

test('scheduler shows recent successful and failed task runs without mobile overflow', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('admin_token', 'scheduler-test-token')
    localStorage.setItem('current_account_id', 'account-a')
    localStorage.setItem('user_info', JSON.stringify({ username: 'history_user', role: 'user', accountLimit: 2, mustChangePassword: false }))
  })
  const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/validate') return route.fulfill(json({ ok: true }))
    if (path === '/api/accounts') return route.fulfill(json({ ok: true, data: { accounts: [{ id: 'account-a', name: '测试农场', running: true }] } }))
    if (path === '/api/scheduler') return route.fulfill(json({ ok: true, data: { runtime: { schedulerCount: 0, schedulers: [] }, worker: { schedulerCount: 0, schedulers: [] } } }))
    if (path === '/api/task-runs') return route.fulfill(json({ ok: true, data: { schemaVersion: 1, runs: [
      { id: 'failed-run', accountId: 'account-a', taskName: 'friend_help', trigger: 'scheduler', status: 'failed', startedAt: 1_700_000_000_000, endedAt: 1_700_000_000_250, durationMs: 250, error: 'network unavailable' },
      { id: 'successful-run', accountId: 'account-a', taskName: 'farm_check', trigger: 'scheduler', status: 'success', startedAt: 1_700_000_001_000, endedAt: 1_700_000_001_125, durationMs: 125, error: null },
    ] } }))
    return route.fulfill(json({ ok: true, data: {} }))
  })
  await page.goto('/scheduler')
  await expect(page.getByRole('heading', { name: '最近执行' })).toBeVisible()
  await expect(page.getByText('农场巡查')).toBeVisible()
  await expect(page.getByText('好友帮助')).toBeVisible()
  await expect(page.getByText('成功', { exact: true })).toBeVisible()
  await expect(page.getByText('失败', { exact: true })).toBeVisible()
  await expect(page.getByText('network unavailable')).toBeVisible()
  await expect(page.getByText('250 毫秒')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(hasHorizontalOverflow).toBe(false)
})
