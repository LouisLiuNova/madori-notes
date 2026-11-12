import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { teaching } from '../../content/levels.ts'
import { legacyTeaching } from '../../content/legacy-levels.ts'
import { validate } from '../../packages/domain/validate.ts'
import { generateDaily } from '../../packages/generator/daily.ts'

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
  await expect(page.getByRole('heading', { name: '一室相连' })).toBeFocused()
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
  await expect(page.getByRole('button', { name: '返回编辑' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('平面图', { exact: true })).toBeFocused()
  await expect(page.getByText('还有 3 格尚未分配。')).toBeVisible()
})

test('画笔擦除沿路径清格，矩形擦除按两个角清格并可一次撤销', async ({ page }) => {
  await page.goto('/')
  const plan = page.getByRole('application', { name: boardName })
  const empty = plan.locator('.cell-empty')
  const undo = page.getByRole('button', { name: '撤销', exact: true })
  await expect(empty).toHaveCount(15)
  await page.getByRole('button', { name: '画笔擦除', exact: true }).click()
  await drag(page, [1.5, 4.5], [3.5, 6.5])
  await expect(empty).toHaveCount(18)
  await undo.click()
  await expect(empty).toHaveCount(15)

  await page.getByRole('button', { name: '矩形擦除', exact: true }).click()
  const start = await at(page, 1.5, 4.5)
  const far = await at(page, 4.5, 7.5)
  const end = await at(page, 3.5, 6.5)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(far.x, far.y)
  await expect(empty).toHaveCount(31)
  await page.mouse.move(end.x, end.y)
  await page.mouse.up()
  await expect(empty).toHaveCount(24)
  await undo.click()
  await expect(empty).toHaveCount(15)

  await plan.focus()
  await page.keyboard.press('Shift+E')
  await expect(page.getByRole('button', { name: '矩形擦除', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(empty).toHaveCount(19)
})

test('日题擦除范围可分别清除家具、房间和门窗，整图重置可撤销并保存', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-12T03:00:00Z'))
  const { level, witnesses: [board] } = generateDaily('2026-11-12')
  await page.goto('/')
  await page.getByRole('button', { name: '本地存档' }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: '日题草稿.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, saves: { [level.id]: { board, hints: 0 } } })),
  })
  await page.getByRole('button', { name: '采用导入草稿' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '每日挑战', exact: true }).click()
  await expect(page.getByRole('heading', { name: '每日建筑委托' })).toBeVisible()
  const scope = page.getByRole('combobox', { name: '擦除范围' })
  const undo = page.getByRole('button', { name: '撤销', exact: true })
  const reset = page.getByRole('button', { name: '重置图纸', exact: true })
  const empty = page.locator('.cell-empty')
  const furniture = page.locator('g.object')
  const pocket = page.locator('.edge-pocket')
  const openWalls = page.locator('.edge-open')
  const fixedWindows = page.locator('g.edge-window')
  await expect(furniture).toHaveCount(1)
  await expect(openWalls).toHaveCount(3)

  await scope.selectOption('furniture')
  await click(page, 7.5, 7.5)
  await expect(furniture).toHaveCount(0)
  await expect(empty).toHaveCount(0)
  await expect(pocket).toHaveCount(1)
  await undo.click()

  await scope.selectOption('openings')
  await click(page, 9.5, 6.5)
  await expect(pocket).toHaveCount(0)
  await expect(furniture).toHaveCount(1)
  await expect(empty).toHaveCount(0)
  await undo.click()

  await page.getByRole('button', { name: '矩形擦除', exact: true }).click()
  await scope.selectOption('roomsFurniture')
  await drag(page, [7.5, 6.5], [9.5, 8.5])
  await expect(furniture).toHaveCount(0)
  await expect(empty).toHaveCount(9)
  await expect(page.locator('.edge-invalid')).toHaveCount(1)
  await undo.click()

  await scope.selectOption('all')
  await drag(page, [3.5, 4.5], [9.5, 8.5])
  await expect(furniture).toHaveCount(0)
  await expect(openWalls).toHaveCount(1)
  await expect(pocket).toHaveCount(0)
  await expect(page.locator('.edge-invalid')).toHaveCount(0)
  await expect(fixedWindows).toHaveCount(3)
  await undo.click()

  await reset.click()
  const confirmation = page.getByRole('dialog', { name: '重置图纸？' })
  await expect(confirmation).toBeVisible()
  await expect(confirmation.getByRole('button', { name: '取消' })).toBeFocused()
  await expect(furniture).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(confirmation).toHaveCount(0)
  await expect(reset).toBeFocused()
  await expect(empty).toHaveCount(0)
  await expect(openWalls).toHaveCount(3)

  await reset.click()
  await confirmation.getByRole('button', { name: '确认重置' }).click()
  await expect(confirmation).toHaveCount(0)
  await expect(undo).toBeFocused()
  await expect(reset).toBeDisabled()
  await expect(empty).toHaveCount(level.usable.filter(Boolean).length - 1)
  await expect(openWalls).toHaveCount(0)
  await expect(fixedWindows).toHaveCount(3)
  await undo.click()
  await expect(furniture).toHaveCount(1)
  await expect(pocket).toHaveCount(1)
  await expect(openWalls).toHaveCount(3)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.reload()
  await expect(reset).toBeDisabled()
  await expect(empty).toHaveCount(level.usable.filter(Boolean).length - 1)
  await expect(furniture).toHaveCount(0)
})

test('拉门只放在连续隔墙，墙被擦掉后显示冲突且可撤销', async ({ page }) => {
  await page.goto('/')
  await unlock(page, 8)
  const undo = page.getByRole('button', { name: '撤销' })
  const pocket = page.locator('.edge-pocket')
  await page.getByRole('button', { name: '拉门', exact: true }).click()
  await click(page, 2, 1.5)
  await click(page, 4, 6.5)
  await expect(pocket).toHaveCount(0)
  await expect(undo).toBeDisabled()
  await click(page, 4, 1.5)
  await expect(pocket).toHaveCount(1)
  await expect(page.getByText('全局规则已满足')).toBeVisible()
  await page.getByRole('button', { name: '画笔擦除', exact: true }).click()
  await click(page, 4.5, 1.5)
  await expect(page.locator('.edge-invalid')).toHaveCount(1)
  await expect(pocket).toHaveCount(0)
  await undo.click()
  await expect(pocket).toHaveCount(1)
  await undo.click()
  await expect(pocket).toHaveCount(0)
  await expect(page.getByText('餐厅需要开口和一条通往主入口的路线。')).toBeVisible()
})

test('外窗只放在外墙，推门只能放在墙段上', async ({ page }) => {
  await page.goto('/')
  await unlock(page, 9)
  const windows = page.locator('g.edge-window')
  const doors = page.locator('g.door')
  const undo = page.getByRole('button', { name: '撤销' })
  await page.getByRole('button', { name: '外窗', exact: true }).click()
  await click(page, 4, 4.5)
  await click(page, 9, 3.5)
  await click(page, 8.67, 4.5)
  await expect(windows).toHaveCount(1)
  await expect(undo).toBeDisabled()
  await click(page, 9, 4.5)
  await expect(windows).toHaveCount(2)
  await undo.click()
  await page.getByRole('button', { name: '推门', exact: true }).click()
  await click(page, 6, 4.5)
  await expect(doors).toHaveCount(1)
  await expect(undo).toBeDisabled()
  await click(page, 4, 4.5)
  await expect(doors).toHaveCount(2)
})

test('家具摆放和移动驱动覆盖、全局状态与提交', async ({ page }) => {
  await page.goto('/')
  await unlock(page, 20)
  await page.getByRole('button', { name: /智能电视 2×1/ }).click()
  await page.keyboard.press('r')
  await click(page, 5.5, 2.5)
  await expect(page.getByText('智能电视的所有占地都需要 Wi-Fi。')).toBeVisible()
  await page.getByRole('button', { name: /路由器 1×1/ }).click()
  await click(page, 6.5, 3.5)
  await page.getByRole('checkbox', { name: 'Wi-Fi' }).check()
  await expect(page.locator('.wifi-radius')).toHaveCount(1)
  await expect(page.getByText('全局规则已满足')).toBeVisible()
  await page.getByRole('button', { name: '移动', exact: true }).click()
  await drag(page, [6.5, 3.5], [9.5, 5.5])
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

test('慢速日题显示加载状态，返回章节后可以重新打开', async ({ page }) => {
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', cloud: true } }))
  let requests = 0
  await page.route('**/api/daily?*', async route => {
    if (++requests === 1) {
      started.resolve()
      await release.promise
    }
    await route.fulfill({ status: 503, json: {} })
  })
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: '主要导航' })
  await nav.getByRole('button', { name: '每日挑战' }).click()
  await started.promise
  await expect(nav.getByRole('button', { name: '正在打开…' })).toBeDisabled()
  await nav.getByRole('button', { name: '章节' }).click()
  await page.getByRole('dialog').getByRole('button', { name: /01 第一张平面图/ }).click()
  const response = page.waitForResponse('**/api/daily?*')
  release.resolve()
  await (await response).finished()
  await expect(page.getByRole('heading', { name: first })).toBeFocused()
  await nav.getByRole('button', { name: '每日挑战' }).click()
  await expect(page.getByRole('heading', { name: '每日建筑委托' })).toBeFocused()
  await expect(page.getByRole('alert')).toHaveText('正式日题暂不可读取，已打开本地日题。')
  expect(requests).toBe(2)
})

test('参考图加载可关闭，失败后可在提示弹窗重试', async ({ page }) => {
  const date = '2026-11-12'
  await page.clock.setFixedTime(new Date(`${date}T03:00:00Z`))
  const { level, witnesses: [board] } = generateDaily(date)
  const release = Promise.withResolvers<void>()
  let requests = 0
  await page.route('**/api/health', route => route.fulfill({ json: { status: 'ok', cloud: true } }))
  await page.route('**/api/daily?*', route => route.fulfill({ json: { level } }))
  await page.route('**/api/daily/solution', async route => {
    const attempt = ++requests
    if (attempt === 1) await release.promise
    await route.fulfill(attempt === 2 ? { status: 503, json: {} } : { json: { board } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '每日挑战', exact: true }).click()
  const hint = page.getByRole('button', { name: '查看提示' })
  const dialog = page.getByRole('dialog', { name: '委托提示' })
  await hint.click()
  await dialog.getByRole('button', { name: '查看参考图' }).click()
  await expect(dialog.getByRole('button', { name: '正在打开参考图…' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(hint).toBeFocused()
  const response = page.waitForResponse('**/api/daily/solution')
  release.resolve()
  await (await response).finished()
  await hint.click()
  await dialog.getByRole('button', { name: '查看参考图' }).click()
  await expect(dialog.getByRole('status')).toHaveText('参考图暂时无法读取，请重试。')
  await dialog.getByRole('button', { name: '查看参考图' }).click()
  await expect(page.getByRole('button', { name: '返回编辑' })).toBeFocused()
  expect(requests).toBe(3)
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

test('320 像素触屏可定位问题并完整操作参考图，遵循减少动态效果偏好', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce', baseURL,
  })
  try {
    const page = await context.newPage()
    await page.goto('/')
    const plan = page.getByRole('application', { name: boardName })
    const hint = page.getByRole('button', { name: '查看提示' })
    const dialog = page.getByRole('dialog', { name: '委托提示' })
    await hint.tap()
    await expect(dialog).toHaveCSS('animation-name', 'none')
    await dialog.getByRole('button', { name: '定位问题' }).tap()
    await expect(plan.locator('.cell-mark').first()).toBeInViewport()
    await expect(plan.locator('.cell').first()).toHaveCSS('transition-duration', '0s')

    await hint.tap()
    await dialog.getByRole('button', { name: '查看参考图' }).tap()
    const center = page.getByRole('button', { name: '居中' })
    await expect(center).toBeInViewport({ ratio: 1 })
    await page.getByRole('button', { name: '放大' }).tap()
    await center.tap()
    await expect(page.getByText('100%', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '目录', exact: true }).tap()
    const palette = page.getByRole('dialog', { name: '绘图目录' })
    await expect(palette.getByRole('button', { name: '客厅', exact: true })).toBeDisabled()
    await expect(palette.getByRole('checkbox', { name: '动线' })).toBeEnabled()
  } finally {
    await context.close()
  }
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
  expect(validate(teaching[0].level, output.saves[teaching[0].level.id].board).global[0].message).toContain('14')
})


test('两间卧室分别满足面积、外窗和走廊动线后才能提交', async ({ page }) => {
  await page.goto('/')
  await unlock(page, 3)
  const rectangle = page.getByRole('button', { name: '矩形', exact: true })
  await rectangle.click()
  await page.getByRole('button', { name: '卧室', exact: true }).click()
  await drag(page, [.5, .5], [3.5, 3.5])
  await drag(page, [.5, 5.5], [3.5, 7.5])
  await page.getByRole('button', { name: '客厅', exact: true }).click()
  await drag(page, [5.5, .5], [8.5, 7.5])
  await page.getByRole('button', { name: '提交图纸' }).click()
  await expect(page.getByRole('status')).toContainText('还有未满足的条件')
  await page.getByRole('button', { name: '开放', exact: true }).click()
  for (const [x, y] of [[1.5, 4], [1.5, 5], [5, 4.5]]) await click(page, x, y)
  await expect(page.getByText('全局规则已满足')).toBeVisible()
  await page.getByRole('button', { name: '提交图纸' }).click()
  await expect(page.getByRole('dialog', { name: '委托已完成' })).toBeVisible()
})

test('旧版草稿可以导入和继续绘图，独立于新版关卡进度', async ({ page }) => {
  await page.goto('/')
  const { level } = legacyTeaching[1]
  await page.getByRole('button', { name: '本地存档' }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: '旧版.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, saves: { [level.id]: { board: level.initial, hints: 0 } } })),
  })
  await page.getByRole('button', { name: '采用导入草稿' }).click()
  await page.getByText('旧版教学草稿', { exact: true }).click()
  await page.getByRole('button', { name: level.title, exact: true }).click()
  await expect(page.getByRole('heading', { name: level.title })).toBeVisible()
  await page.reload()
  await expect(page.getByText('旧版教学', { exact: false }).first()).toBeVisible()
  await page.getByRole('button', { name: '章节', exact: true }).click()
  await expect(page.getByRole('button', { name: /02 一室相连/ })).toBeDisabled()
})
