import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { teaching } from '../../content/levels.ts'
import { validate } from '../../packages/domain/validate.ts'

const boardName = '平面图编辑区'
const first = '第一张平面图'

async function at(page: Page, x: number, y: number) {
  return page.getByRole('application', { name: boardName }).evaluate((element, [x, y]) => {
    const point = new DOMPoint(x, y).matrixTransform((element as SVGSVGElement).getScreenCTM()!)
    return { x: point.x, y: point.y }
  }, [x, y] as const)
}
async function click(page: Page, x: number, y: number) {
  const coords = await at(page, x, y)
  await page.mouse.click(coords.x, coords.y)
}
async function drag(page: Page, a: [number, number], b: [number, number]) {
  const start = await at(page, ...a)
  const end = await at(page, ...b)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 5 })
  await page.mouse.up()
}

async function unlock(page: Page, n: number) {
  const saves = Object.fromEntries(teaching.slice(0, n - 1).map(({ level, reference }) =>
    [level.id, { board: reference, hints: 0, completed: { at: '2026-11-12T01:00:00.000Z', hints: 0 } }]))
  await page.getByRole('button', { name: '本地存档' }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: '验收存档.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, saves })),
  })
  await page.getByRole('button', { name: '采用导入草稿' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '章节', exact: true }).click()
  await page.getByRole('button', { name: new RegExp(teaching[n - 1].level.title) }).click()
  await expect(page.getByRole('heading', { name: teaching[n - 1].level.title })).toBeVisible()
}

test('矩形手势只记一次历史，撤销、重做、刷新和通关解锁', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: first })).toBeVisible()
  await page.getByRole('button', { name: '提交图纸' }).click()
  await expect(page.getByRole('status')).toContainText('还有未满足的条件')
  await page.getByRole('button', { name: '矩形', exact: true }).click()
  await drag(page, [5.5, .5], [7.5, 3.5])
  await expect(page.getByText('还有 3 格尚未分配。')).toBeVisible()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByText('还有 15 格尚未分配。')).toBeVisible()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await drag(page, [7.5, 5.5], [7.5, 7.5])
  await expect(page.getByText('全局规则已满足')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.reload()
  await expect(page.getByText('全局规则已满足')).toBeVisible()
  await page.getByRole('button', { name: '提交图纸' }).click()
  await expect(page.getByRole('dialog', { name: '委托已完成' })).toBeVisible()
  await page.getByRole('button', { name: '下一关' }).click()
  await expect(page.getByRole('heading', { name: '一室相连' })).toBeVisible()
  expect(errors).toEqual([])
})

test('键盘画图、提示返回、焦点恢复、参考图不提交', async ({ page }) => {
  await page.goto('/')
  const plan = page.getByRole('application', { name: boardName })
  await plan.focus()
  await page.keyboard.press('m')
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByText('还有 3 格尚未分配。')).toBeVisible()
  const hint = page.getByRole('button', { name: '查看提示' })
  await hint.click()
  await page.getByRole('button', { name: '解释线索' }).click()
  await expect(page.getByText('选中客厅，拖动画笔涂绘，或使用矩形工具一次填满一块区域。')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(hint).toBeFocused()
  await hint.click()
  await page.getByRole('button', { name: '查看参考图' }).click()
  await expect(page.getByRole('button', { name: '提交图纸' })).toBeDisabled()
  await page.getByRole('button', { name: '返回编辑' }).click()
  await expect(page.getByText('还有 3 格尚未分配。')).toBeVisible()
})

test('拉门在普通墙落位，撤销后保留原结构', async ({ page }) => {
  await page.goto('/')
  await unlock(page, 8)
  await page.getByRole('button', { name: '拉门', exact: true }).click()
  await click(page, 5, 2.5)
  await expect(page.locator('.edge-pocket')).toHaveCount(1)
  await expect(page.getByText('全局规则已满足')).toBeVisible()
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(page.locator('.edge-pocket')).toHaveCount(0)
  await expect(page.getByText('餐厅需要开口和一条通往主入口的路线。')).toBeVisible()
})

test('家具摆放和移动驱动覆盖、全局状态与提交', async ({ page }) => {
  await page.goto('/')
  await unlock(page, 20)
  await page.getByRole('button', { name: /智能电视 2×1/ }).click()
  await click(page, 4.5, 2.5)
  await expect(page.getByText('智能电视的所有占地都需要 Wi-Fi。')).toBeVisible()
  await page.getByRole('button', { name: /路由器 1×1/ }).click()
  await click(page, 3.5, 4.5)
  await page.getByRole('checkbox', { name: 'Wi-Fi' }).check()
  await expect(page.locator('.wifi-radius')).toHaveCount(1)
  await expect(page.getByText('全局规则已满足')).toBeVisible()
  await page.getByRole('button', { name: '移动', exact: true }).click()
  await drag(page, [3.5, 4.5], [1.5, 9.5])
  await expect(page.getByText('智能电视的所有占地都需要 Wi-Fi。')).toBeVisible()
  await page.getByRole('button', { name: '撤销' }).click()
  await page.getByRole('button', { name: '提交图纸' }).click()
  await expect(page.getByRole('dialog', { name: '委托已完成' })).toBeVisible()
})

test('主题切换不改变命中位置和进度', async ({ page }) => {
  await page.goto('/')
  const trigger = page.locator('.theme-trigger')
  await trigger.click()
  for (const theme of ['奉书', '若竹', '藤霞', '工业蓝图', '原色构成']) {
    await page.getByRole('button', { name: theme, exact: true }).last().click()
    for (const mode of ['亮色', '暗色']) {
      await page.getByRole('button', { name: mode, exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode === '亮色' ? 'light' : 'dark')
      await expect(page.getByText('还有 15 格尚未分配。')).toBeVisible()
    }
  }
  await page.keyboard.press('Escape')
  await click(page, 5.5, .5)
  await expect(page.getByText('还有 14 格尚未分配。')).toBeVisible()
})

test('日题可直接进入，重载后继续原图', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '每日挑战', exact: true }).click()
  await expect(page.getByRole('heading', { name: '每日建筑委托' })).toBeVisible()
  const initial = await page.locator('.cell-empty').count()
  expect(initial).toBeGreaterThan(0)
  const last = page.locator('[data-cell]:has(.cell-empty)').last()
  const cell = Number(await last.getAttribute('data-cell'))
  const size = Number((await page.locator('.sheet-size').innerText()).split('×')[0].trim())
  await click(page, cell % size + .5, Math.floor(cell / size) + .5)
  await expect(page.locator('.cell-empty')).toHaveCount(initial - 1)
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.reload()
  await expect(page.getByRole('heading', { name: '每日建筑委托' })).toBeVisible()
  await expect(page.locator('.cell-empty')).toHaveCount(initial - 1)
})

test('触屏抽屉和单指绘图，窄屏无横向溢出', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL })
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('button', { name: '目录', exact: true }).tap()
  await expect(page.getByRole('dialog', { name: '绘图目录' })).toBeVisible()
  await page.getByRole('checkbox', { name: '动线' }).check()
  await page.getByRole('button', { name: '返回图纸' }).tap()
  const coords = await at(page, 5.5, .5)
  await page.touchscreen.tap(coords.x, coords.y)
  await expect(page.getByText('还有 14 格尚未分配。')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await context.close()
})

test('导出和导入提供可读取的存档', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: first })).toBeVisible()
  await click(page, 5.5, .5)
  await page.getByRole('button', { name: '本地存档' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出存档' }).click()
  const file = await download
  const stream = await file.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  const output = JSON.parse(Buffer.concat(chunks).toString())
  expect(output.schemaVersion).toBe(1)
  expect(validate(teaching[0].level, output.saves['lesson-01'].board).global[0].message).toContain('14')
})
