import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.skip(!process.env.MADORI_CLOUD_BROWSER, '需要隔离 PostgreSQL 云档案服务')

async function fillCell(page: Page, cell: number) {
  const p = await page.locator(`[data-cell="${cell}"]`).first().locator('.cell').boundingBox()
  if (!p) throw new Error('找不到可编辑格子。')
  await page.mouse.click(p.x + p.width / 2, p.y + p.height / 2)
}

test('创建档案、跨浏览器恢复，冲突时采用指定草稿', async ({ browser, baseURL }) => {
  const first = await browser.newContext({ baseURL })
  const second = await browser.newContext({ baseURL })
  try {
    const a = await first.newPage()
    const b = await second.newPage()
    await a.goto('/')
    await a.getByRole('button', { name: '本地存档' }).click()
    const name = `mvp-${crypto.randomUUID().slice(0, 10)}`
    await a.getByLabel('用户名', { exact: true }).fill(name)
    await a.getByRole('button', { name: '创建云档案' }).click()
    const code = await a.locator('.recovery-code code').innerText()
    await a.keyboard.press('Escape')
    await fillCell(a, 5)
    await expect(a.getByText('还有 14 格尚未分配。')).toBeVisible()
    await a.getByRole('button', { name: '本地存档' }).click()
    await a.getByRole('button', { name: '同步本地草稿' }).click()
    await expect(a.getByText(/云端草稿已同步/)).toBeVisible()
    await a.keyboard.press('Escape')

    await b.goto('/')
    await b.getByRole('button', { name: '本地存档' }).click()
    await b.getByRole('button', { name: '使用恢复码' }).click()
    await b.getByLabel('用户名', { exact: true }).fill(name)
    await b.getByLabel('恢复码', { exact: true }).fill(code)
    await b.getByRole('button', { name: '恢复云档案' }).click()
    await expect(b.getByRole('button', { name: '同步本地草稿' })).toBeVisible()
    await b.keyboard.press('Escape')
    await expect(b.getByText('还有 14 格尚未分配。')).toBeVisible()

    await fillCell(a, 6)
    await a.getByRole('button', { name: '本地存档' }).click()
    await a.getByRole('button', { name: '同步本地草稿' }).click()
    await expect(a.getByText(/云端草稿已同步/)).toBeVisible()
    await second.setOffline(true)
    await fillCell(b, 7)
    await expect(b.getByText('还有 13 格尚未分配。')).toBeVisible()
    await second.setOffline(false)
    await b.getByRole('button', { name: '本地存档' }).click()
    await b.getByRole('button', { name: '同步本地草稿' }).click()
    await expect(b.getByText('第一张平面图有两份草稿，请选择要继续使用的一份。')).toBeVisible()
    await b.getByRole('button', { name: '采用云端草稿' }).click()
    await b.keyboard.press('Escape')
    await expect(b.locator('[data-cell="6"] .cell')).toHaveClass(/room-living/)
    await expect(b.locator('[data-cell="7"] .cell')).toHaveClass(/cell-empty/)
  } finally {
    await first.close()
    await second.close()
  }
})
