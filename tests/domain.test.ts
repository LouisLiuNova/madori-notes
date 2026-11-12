import { describe, expect, it } from 'vitest'
import { teaching } from '../content/levels.ts'
import { catalog, occupied, usage } from '../packages/domain/catalog.ts'
import { edgeAt, shiftEdge } from '../packages/domain/geometry.ts'
import type { Edge, Furniture } from '../packages/domain/model.ts'
import { validate } from '../packages/domain/validate.ts'
import { dateInSingapore, generateDaily } from '../packages/generator/daily.ts'

function lesson(n: number) {
  return structuredClone(teaching[n - 1])
}

describe('全局合法性', () => {
  it('同类四连通合并，对角不合并，承重墙可绕通时仍合并', () => {
    const { level, reference } = lesson(1)
    level.bearing = ['V:4:0']
    expect(validate(level, reference).rooms).toHaveLength(1)
    level.bearing = Array.from({ length: 8 }, (_, i): Edge => `V:4:${i}`)
    expect(validate(level, reference).rooms).toHaveLength(2)
    expect(validate(level, reference).complete).toBe(false)
    reference.roomTypes.fill(null)
    reference.roomTypes[2] = 'living'
    reference.roomTypes[11] = 'living'
    expect(validate(level, reference).rooms).toHaveLength(2)
  })

  it('数值采用下限，两个槽位需要两间不同的房间', () => {
    const { level, reference } = lesson(3)
    expect(validate(level, reference).complete).toBe(true)
    for (let y = 0; y < 8; y++) reference.roomTypes[y * 8 + 4] = 'bedroom'
    expect(validate(level, reference).level[1].status).toBe('pending')
    const slot = level.constraints[1]
    if (slot.kind !== 'slots') throw new Error()
    slot.slots[0].push({ kind: 'window' })
    expect(validate(level, lesson(3).reference).level[1].status).toBe('pending')
  })

  it('开口可用作房间入口，额外外门不会建立室外绕行路径', () => {
    const { level, reference } = lesson(9)
    expect(validate(level, reference).complete).toBe(true)
    reference.openEdges = []
    const report = validate(level, reference)
    expect(report.complete).toBe(false)
    expect(report.global.some(item => item.id.startsWith('access-'))).toBe(true)
    expect(report.reachable.has(8 * 10 + 8)).toBe(false)
  })

  it('拉门收纳墙不通行，且与洞口使用唯一格边', () => {
    const { level, reference } = lesson(8)
    expect(edgeAt({ x: 4, y: 2 }, 1)).toBe(edgeAt({ x: 5, y: 2 }, 3))
    const edge = reference.openings[0].edge
    const pocket = shiftEdge(edge, 1)
    const report = validate(level, reference)
    expect(report.boundaries.get(edge)).toBe('sliding')
    expect(report.boundaries.get(pocket)).toBe('pocket')
    level.bearing.push(pocket)
    expect(validate(level, reference).complete).toBe(false)
  })

  it('推门需要落脚与开启净空，家具不切割房间识别', () => {
    const { level, reference } = lesson(7)
    level.furnitureTypes.push('plant')
    reference.furniture.push({ id: 'plant', type: 'plant', x: 4, y: 2, rotation: 'N' })
    const report = validate(level, reference)
    expect(report.rooms).toHaveLength(2)
    expect(report.global.some(item => item.message.includes('开启净空'))).toBe(true)
    expect(report.complete).toBe(false)
  })

  it('保留变更后失效的门，并报告冲突', () => {
    const { level, reference } = lesson(8)
    reference.roomTypes = level.usable.map(cell => cell ? 'living' : null)
    const report = validate(level, reference)
    expect(reference.openings).toHaveLength(1)
    expect(report.boundaries.get(reference.openings[0].edge)).toBe('none')
    expect(report.global.some(item => item.status === 'conflict')).toBe(true)
  })

  it('地毯可与家具叠放，装饰免使用检查，堵住沙发正面会失败', () => {
    const { level, reference } = lesson(13)
    expect(validate(level, reference).complete).toBe(true)
    for (let x = 1; x < 4; x++) reference.furniture.push({ id: `plant-${x}`, type: 'plant', x, y: 2, rotation: 'N' })
    const report = validate(level, reference)
    expect(report.global.some(item => item.id === 'use-sofa')).toBe(true)
    expect(report.global.some(item => item.id.startsWith('use-plant'))).toBe(false)
  })

  it('旋转同时改变使用格和占地', () => {
    const { level } = lesson(13)
    const sofa: Furniture = { type: 'sofa', id: 'sofa', x: 2, y: 2, rotation: 'E' }
    expect(occupied(sofa)).toEqual([{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 2, y: 4 }])
    expect(usage(level, sofa)).toEqual([25, 37, 49])
    expect(Object.values(catalog)).toHaveLength(29)
  })

  it('固定窗与床头实墙分别检查，开口轴线对冲报告冲突', () => {
    const { level, reference } = lesson(17)
    reference.furniture[0].x = 9
    const report = validate(level, reference)
    expect(report.level.slice(1, 3).every(item => item.status === 'conflict')).toBe(true)
    const alignment = lesson(18)
    alignment.reference.openings[0].edge = 'H:1:0'
    expect(validate(alignment.level, alignment.reference).level.at(-1)?.status).toBe('conflict')
  })

  it('Wi-Fi 无视承重墙、包含圆边界，并检查智能设备的全部占地', () => {
    const { level, reference } = lesson(20)
    const router = reference.furniture.find(item => item.type === 'router')!
    router.x = 0
    router.y = 3
    reference.furniture.find(item => item.type === 'smartTv')!.y = 3
    level.bearing.push('V:2:3')
    const report = validate(level, reference)
    expect(report.wifi.has(3 * level.width + 4)).toBe(true)
    expect(report.wifi.has(3 * level.width + 5)).toBe(false)
    expect(report.global.some(item => item.id === 'wifi-smartTv')).toBe(true)
  })

  it('全房覆盖包含占地，Wi-Fi 取多个路由器并集', () => {
    const { level, reference } = lesson(21)
    const report = validate(level, reference)
    expect(report.complete).toBe(true)
    expect(report.wifi.has(3 * level.width + 9)).toBe(true)
    reference.furniture = reference.furniture.filter(item => item.id !== 'router-3')
    expect(validate(level, reference).level.at(-1)?.status).toBe('pending')
  })
})

describe('关卡与存档', () => {
  it.each(teaching)('$level.id 两份不同的解均通过，起始草稿未完成', ({ level, reference, alternative }) => {
    expect(reference).not.toEqual(alternative)
    expect(validate(level, level.initial).complete).toBe(false)
    expect(validate(level, reference).complete).toBe(true)
    expect(validate(level, alternative).complete).toBe(true)
    expect(level.initial.furniture).toHaveLength(0)
  })

  it('不规则边界的凹口是外轮廓，空缺不计入面积或动线', () => {
    const { level, reference } = lesson(1)
    const report = validate(level, reference)
    expect(level.usable.filter(Boolean)).toHaveLength(60)
    expect(report.rooms[0].cells).toHaveLength(60)
    expect(report.reachable.has(0)).toBe(false)
    expect(report.boundaries.get('V:2:0')).toBe('exterior')
  })

  it('按 UTC+8 零点换日，同一日期与版本可复现', () => {
    expect(dateInSingapore(new Date('2026-11-12T15:59:59.999Z'))).toBe('2026-11-12')
    expect(dateInSingapore(new Date('2026-11-12T16:00:00.000Z'))).toBe('2026-11-13')
    expect(generateDaily('2026-11-12')).toEqual(generateDaily('2026-11-12'))
  })

  it('连续七天生成七种轮廓，历史版本仍可读取', () => {
    const dates = Array.from({ length: 7 }, (_, i) => `2026-11-${12 + i}`)
    expect(new Set(dates.map(date => generateDaily(date).quality.outline)).size).toBe(7)
    expect(generateDaily(dates[0], dates[0], undefined, '1').quality.outline).toBe('整矩形')
  })

  it('验证 1,000 个可复现种子的面积余量和全部见证', () => {
    const groups = new Set<string>()
    const sizes = new Set<number>()
    const tiers = new Set<string>()
    const outlines = new Set<string>()
    let worst = 0
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      const started = performance.now()
      const date = new Date(Date.UTC(2026, 10, 12 + i % 49)).toISOString().slice(0, 10)
      const daily = generateDaily(date, `mvp-check-${i}`, 8 + i % 9)
      worst = Math.max(worst, performance.now() - started)
      sizes.add(daily.level.width)
      tiers.add(daily.level.difficulty!)
      outlines.add(daily.quality.outline)
      daily.quality.groups.forEach(group => groups.add(group))
      const [min, max, count] = daily.level.difficulty === '入门' ? [.25, .4, 4] :
        daily.level.difficulty === '标准' ? [.15, .3, 3] : [.1, .2, 2]
      if (daily.quality.spare < min || daily.quality.spare > max || new Set(daily.quality.witnessKeys).size < count ||
          daily.witnesses.some(board => !validate(daily.level, board).complete)) {
        throw new Error(`种子 mvp-check-${i} 不满足发布条件。`)
      }
    }
    expect(sizes.size).toBe(9)
    expect(tiers.size).toBe(3)
    expect(groups.size).toBe(5)
    expect(outlines.size).toBe(7)
    console.info(`生成压测 mvp-check-0 至 mvp-check-999，${Math.round(performance.now() - start)} ms，最慢生成 ${worst.toFixed(1)} ms`)
  }, 30_000)
})
