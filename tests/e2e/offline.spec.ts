import { expect, test } from '@playwright/test'

test.skip(!process.env.MADORI_PREVIEW_BROWSER, '需要 Vite 生产预览')

test('生产构建离线刷新后继续编辑缓存日题', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await page.getByRole('button', { name: '每日挑战', exact: true }).click()
  await expect(page.getByRole('heading', { name: '每日建筑委托' })).toBeVisible()
  const cell = page.locator('[data-cell]:has(.cell-empty)').first().locator('.cell')
  const bounds = await cell.boundingBox()
  if (!bounds) throw new Error('找不到日题中的未分配格。')
  const before = await page.locator('.cell-empty').count()
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect(page.getByRole('status')).toContainText('已保存')
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: '每日建筑委托' })).toBeVisible()
  await expect(page.locator('.cell-empty')).toHaveCount(before - 1)
})
