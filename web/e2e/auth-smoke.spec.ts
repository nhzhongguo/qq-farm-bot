import { expect, test } from '@playwright/test'

async function stubOptionalApis(page: import('@playwright/test').Page) {
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })

  await page.route('**/api/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/api/auth/validate')) {
      await route.fulfill(json({ ok: false, error: 'invalid token' }, 401))
      return
    }
    if (url.includes('/api/card-claim/status')) {
      await route.fulfill(json({ ok: true, enabled: false }))
      return
    }
    if (url.includes('/api/game-version')) {
      await route.fulfill(json({ ok: true, version: 'smoke' }))
      return
    }
    if (url.includes('/api/settings')) {
      await route.fulfill(json({ ok: true, data: {} }))
      return
    }
    await route.fulfill(json({ ok: false, error: 'not found' }, 404))
  })
}

test.describe('frontend auth smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('admin_token')
      localStorage.removeItem('user_info')
      localStorage.removeItem('settings-active-tab')
    })
    await stubOptionalApis(page)
  })

  test('unauthenticated root redirects to login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByRole('heading', { name: '登录控制台' })).toBeVisible({ timeout: 15000 })
  })

  test('login page renders core controls', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('用户名').first()).toBeVisible()
    await expect(page.getByText('密码').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /登录|立即登录|注册/ }).first()).toBeVisible()
  })

  test('protected friends route redirects without token', async ({ page }) => {
    await page.goto('/friends')
    await expect(page).toHaveURL(/\/login/)
  })

  test('protected settings route redirects without token', async ({ page }) => {
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login/)
  })

  test('invalid token is cleared and bounced to login', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('admin_token', 'smoke-invalid-token')
      localStorage.setItem('user_info', JSON.stringify({ role: 'user' }))
    })

    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login/)
  })
})
