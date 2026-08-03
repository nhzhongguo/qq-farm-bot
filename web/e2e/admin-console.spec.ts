import { expect, test } from '@playwright/test'

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

async function stubAdminApis(page: import('@playwright/test').Page) {
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
    if (url.includes('/api/card-claim/status')) {
      await route.fulfill(json({ ok: true, enabled: false }))
      return
    }
    if (url.includes('/api/game-version')) {
      await route.fulfill(json({ ok: true, version: 'e2e' }))
      return
    }
    if (url.includes('/api/admin/alert-rules')) {
      await route.fulfill(json({
        ok: true,
        data: {
          rules: [{
            id: 'r1', name: '离线告警', description: '', condition: 'offline_duration',
            threshold: 300, channel: 'log', endpoint: '', enabled: true, createdAt: 1, updatedAt: 1,
          }],
          triggers: [{ id: 't1', ruleId: 'r1', ruleName: '离线告警', condition: 'offline_duration', threshold: 300, actualValue: 600, username: 'alice', triggeredAt: 1000, channel: 'log' }],
        },
      }))
      return
    }
    if (url.includes('/api/admin/audit-log')) {
      await route.fulfill(json({
        ok: true,
        data: {
          entries: [{ id: 'a1', timestamp: 1000, actor: 'admin', action: 'card.create', target: 'card:ABC', severity: 'info', ip: '127.0.0.1' }],
        },
      }))
      return
    }
    if (url.includes('/api/announcement')) {
      await route.fulfill(json({ ok: true, data: { content: '系统维护公告', showOnce: false, updatedAt: 1000, shouldShow: true } }))
      return
    }
    if (url.includes('/api/admin/login-logs')) {
      await route.fulfill(json({
        ok: true,
        data: {
          logs: [{ id: 'l1', timestamp: 1000, event: 'login_success', username: 'alice', errorType: null, ip: '1.2.3.4', userAgent: 'Mozilla' }],
          total: 1,
        },
      }))
      return
    }
    if (url.includes('/api/stats/trend')) {
      await route.fulfill(json({
        ok: true,
        data: {
          accountId: 'acc1', days: 30,
          points: [{ date: '2026-07-01', gold: 100, exp: 50, goldGained: 100, expGained: 50, operations: { harvest: 3 }, savedAt: 1000 }],
        },
      }))
      return
    }
    if (url.includes('/api/settings')) {
      await route.fulfill(json({ ok: true, data: {} }))
      return
    }
    await route.fulfill(json({ ok: false, error: 'not found' }, 404))
  })
}

test.describe('admin console (v2.5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('admin_token', 'e2e-token')
      localStorage.setItem('user_info', JSON.stringify({ role: 'admin' }))
      localStorage.removeItem('admin-active-tab')
    })
    await stubAdminApis(page)
  })

  test('admin alert tab lists rules and triggers', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('button', { name: '告警' }).click()
    await expect(page.getByRole('cell', { name: '离线告警' })).toBeVisible()
    await expect(page.getByText('最近触发记录')).toBeVisible()
    await expect(page.getByText('600')).toBeVisible()
  })

  test('admin audit tab renders audit entries', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('button', { name: '审计' }).click()
    await expect(page.getByText('card.create')).toBeVisible()
    await expect(page.getByText('admin')).toBeVisible()
  })

  test('admin announcement tab loads and can save', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('button', { name: '公告' }).click()
    await expect(page.getByText('系统维护公告')).toBeVisible()
    await expect(page.getByRole('button', { name: '保存公告' })).toBeVisible()
  })

  test('admin log tab lists login history', async ({ page }) => {
    await page.goto('/admin')
    await page.getByRole('button', { name: '日志' }).click()
    await expect(page.getByText('登录成功')).toBeVisible()
    await expect(page.getByText('1.2.3.4')).toBeVisible()
  })

  test('statistics page renders trend chart', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('admin_token', 'e2e-token')
      localStorage.setItem('user_info', JSON.stringify({ role: 'user' }))
      localStorage.setItem('current_account_id', 'acc1')
    })
    await page.goto('/statistics')
    await expect(page.getByRole('heading', { name: '收益统计' })).toBeVisible()
    await expect(page.getByText('当前金币')).toBeVisible()
    await expect(page.getByText('近 30 天')).toBeVisible()
  })
})
