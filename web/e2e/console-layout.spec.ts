import { expect, test } from '@playwright/test'

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

async function stubConsoleApis(page: import('@playwright/test').Page) {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/api/auth/validate')) {
      await route.fulfill(json({ ok: true, role: 'admin' }))
      return
    }
    if (url.includes('/api/accounts')) {
      await route.fulfill(json({
        ok: true,
        data: {
          accounts: [{ id: 'acc1', uin: '10001', name: '测试账号', nick: '', platform: 'qq' }],
        },
      }))
      return
    }
    if (url.includes('/api/status')) {
      await route.fulfill(json({
        ok: true,
        data: {
          connection: { connected: true, latencyMs: 8, lastEventAt: Date.now() },
          status: { level: 30, gold: 100, coupon: 5, goldBean: 20 },
          account: { id: 'acc1', uin: '10001', name: '测试账号', level: 30, exp: 100 },
          operations: { harvest: { running: false }, sell: { running: false }, plant: { running: false } },
          today: { harvest: 3, sell: 2, coins: 1200 },
        },
      }))
      return
    }
    if (url.includes('/api/logs')) {
      await route.fulfill(json({ ok: true, data: [] }))
      return
    }
    if (url.includes('/api/account-logs')) {
      await route.fulfill(json({ ok: true, data: [] }))
      return
    }
    if (url.includes('/api/bag')) {
      await route.fulfill(json({ ok: true, data: { items: [], originalItems: [] } }))
      return
    }
    if (url.includes('/api/friends')) {
      await route.fulfill(json({ ok: true, data: [] }))
      return
    }
    if (url.includes('/api/interact-records')) {
      await route.fulfill(json({ ok: true, data: [] }))
      return
    }
    if (url.includes('/api/friend-blacklist')) {
      await route.fulfill(json({ ok: true, data: [] }))
      return
    }
    if (url.includes('/api/friend-known-gids')) {
      await route.fulfill(json({ ok: true, data: { knownFriendGids: [], knownFriendGidSyncCooldownSec: 600 } }))
      return
    }
    if (url.includes('/api/settings')) {
      await route.fulfill(json({ ok: true, data: {} }))
      return
    }
    if (url.includes('/api/card-claim/status')) {
      await route.fulfill(json({ ok: true, enabled: false }))
      return
    }
    if (url.includes('/api/game-version')) {
      await route.fulfill(json({ ok: true, version: 'e2e' }))
      return
    }
    await route.fulfill(json({ ok: false, error: 'not found' }, 404))
  })
}

async function loginAsAdmin(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    localStorage.setItem('admin_token', 'e2e-token')
    localStorage.setItem('user_info', JSON.stringify({ role: 'admin' }))
  })
  await stubConsoleApis(page)
}

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

const viewports = [375, 768, 1440]

test.describe('console layout & a11y', () => {
  test('login page has no horizontal overflow at 375/768/1440', async ({ page }) => {
    await stubConsoleApis(page)
    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/login')
      await expect(page.getByRole('heading', { name: '登录控制台' })).toBeVisible({ timeout: 15000 })
      await expectNoHorizontalOverflow(page)
    }
  })

  test('dashboard has no horizontal overflow at 375/768/1440', async ({ page }) => {
    await loginAsAdmin(page)
    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await expect(page.getByText('运营概览').first()).toBeVisible({ timeout: 15000 })
      await expectNoHorizontalOverflow(page)
    }
  })

  test('friends page has no horizontal overflow at 375/768/1440', async ({ page }) => {
    await loginAsAdmin(page)
    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/friends')
      await expect(page.getByRole('heading', { name: '好友互动' })).toBeVisible({ timeout: 15000 })
      await expectNoHorizontalOverflow(page)
    }
  })

  test('batch-add GID dialog traps focus, Escape closes and restores focus', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/friends')
    const openButton = page.getByRole('button', { name: /批量新增 GID/ })
    await expect(openButton).toBeVisible({ timeout: 15000 })
    await openButton.focus()
    await openButton.click()

    const dialog = page.getByRole('dialog', { name: '批量新增 GID' })
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('textarea').first()).toBeFocused()
    await dialog.locator('textarea').fill('12345678')

    // Tab should stay inside the dialog (last -> first)
    await dialog.locator('textarea').press('Tab')
    await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
    await dialog.getByRole('button', { name: '取消' }).press('Tab')
    await expect(dialog.getByRole('button', { name: '确认添加' })).toBeFocused()
    await dialog.getByRole('button', { name: '确认添加' }).press('Tab')
    await expect(dialog.locator('textarea')).toBeFocused()

    // Shift+Tab from the first element wraps to the last
    await dialog.locator('textarea').press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: '确认添加' })).toBeFocused()

    // Escape closes and focus returns to the trigger
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(openButton).toBeFocused()
  })

  test('BaseSelect supports keyboard listbox interaction', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/')
    await expect(page.getByText('运营概览').first()).toBeVisible({ timeout: 15000 })

    const trigger = page.getByRole('button', { name: '选择选项' }).first()
    await expect(trigger).toBeVisible()
    await trigger.focus()
    await page.keyboard.press('Enter')

    const listbox = page.getByRole('listbox').first()
    await expect(listbox).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(listbox).toBeHidden()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')

    // Escape path: reopen then close with Escape, focus stays on the trigger
    await page.keyboard.press('Enter')
    await expect(page.getByRole('listbox').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('listbox').first()).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})
