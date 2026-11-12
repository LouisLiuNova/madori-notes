import { area } from '../../content/legacy-levels.ts'
import { blank, versions } from '../domain/model.ts'
import type { Board, Constraint, Edge, Level, Opening, RoomType } from '../domain/model.ts'
import { maskBoard, shellMask, shellNames } from '../domain/shell.ts'
import { validate } from '../domain/validate.ts'
import { residentialDaily } from './residential.ts'

export const generatorVersion = '5'
export const generatorVersions = ['1', '2', '3', '4', generatorVersion] as const
export type GeneratorVersion = typeof generatorVersions[number]
export const dateInSingapore = (time = new Date()) => new Date(time.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
export const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date

function randomFor(seed: string) {
  let state = 2166136261
  for (const letter of seed) state = Math.imul(state ^ letter.charCodeAt(0), 16777619)
  return (max: number) => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0
    return Math.floor(state / 2 ** 32 * max)
  }
}

export interface Daily {
  level: Level
  witnesses: Board[]
  quality: { spare: number; groups: string[]; witnessKeys: string[]; attempts: number; outline: string }
}

function key(board: Board) {
  return JSON.stringify([
    board.roomTypes, [...board.openEdges].sort(),
    [...board.openings].sort((a, b) => a.edge.localeCompare(b.edge)),
    board.furniture.map(({ type, x, y, rotation }) => [type, x, y, rotation]).sort(),
  ])
}

function candidate(date: string, seed: string, attempt: number, size: number | undefined, version: GeneratorVersion): Daily | undefined {
  const random = randomFor(`${seed}:${attempt}`)
  if (version === '4' || version === '5') return residentialDaily(date, seed, size, attempt, random, key, version)
  const tier = random(3)
  const n = size ?? (8 + random(9))
  const type: RoomType = tier === 0 ? (random(2) ? 'study' : 'dining') : 'bedroom'
  const split = Math.floor(n / 2)
  const entrance: Edge = `H:1:${n}`
  const fixed: Opening[] = [{ kind: 'swing', edge: entrance, side: 0, hinge: 0 }]
  const dayIndex = Math.floor(Date.parse(date) / 86400_000)
  const families = shellNames.length - 1
  const dailyFamily = 1 + ((dayIndex % families) + families) % families
  const outline = version === '1' ? '整矩形' : version === '2' ? shellNames[1 + random(6)] : shellNames[dailyFamily]
  const variation = version === '3' ? random(6) : 0
  const usable = shellMask(n, n, outline, variation)
  const areaA = usable.filter((cell, i) => cell && i % n < split).length
  const areaB = usable.filter((cell, i) => cell && i % n >= split).length
  const spareTarget = [0.32, 0.23, 0.16][tier]
  const minA = Math.floor((1 - spareTarget) * areaA)
  const minB = Math.floor((1 - spareTarget) * areaB)
  const constraints: Constraint[] = [
    area('living', minA), area(type, minB),
    { kind: 'relation', types: ['living', type], mode: 'adjacent', label: '两个区域共享边界' },
  ]
  const openings: Opening['kind'][] = tier === 0 ? [] : ['sliding', 'window']
  const furnitureTypes = tier === 0 ? [] : tier === 1 ? ['bed'] : ['bed', 'router', 'smartTv']
  const groups = ['邻接', '建筑边界']
  constraints.push({
    kind: 'relation', types: ['living', type], mode: tier === 0 ? 'open' : 'door',
    label: tier === 0 ? '两个区域开放相通' : '两个区域通过门洞相连',
  })
  if (tier > 0) {
    groups.push('家具')
    constraints.push(
      { kind: 'opening', type: 'sliding', min: 1, player: true, label: '新增至少一扇拉门' },
      { kind: 'furniture', type: 'bed', min: 1, label: '卧室至少有一张床' },
    )
  }
  if (tier === 2 && random(2)) {
    groups.push('Wi-Fi')
    constraints.push(
      { kind: 'furniture', type: 'router', min: 1, label: '摆放至少一台路由器' },
      { kind: 'furniture', type: 'smartTv', min: 1, label: '为智能电视联网' },
      { kind: 'roomRule', type, predicates: [{ kind: 'noRouter' }], label: '卧室内不得摆放路由器' },
    )
  } else if (tier === 2) {
    groups.push('风水')
    constraints.push(
      { kind: 'furnitureRule', type: 'bed', rule: 'headWall', label: '床头全段贴实墙' },
      { kind: 'opening', type: 'window', min: 1, player: true, label: '新增至少一扇外窗' },
    )
  }
  const bearing: Edge[] = tier === 2 ? [`V:${split}:${n - 2}`, `V:${split}:${n - 1}`] : []
  const blankBoard = blank(n * n)
  const base = maskBoard({ ...blankBoard, roomTypes: blankBoard.roomTypes.map((_, cell) => cell % n < split ? 'living' : type) }, usable)
  const level: Level = {
    ...versions, generatorVersion: version, seed, date, id: `daily-${date}-${version}`,
    title: '每日建筑委托', brief: '从起始分区出发，调整边界，完成今天的空间要求。',
    tip: tier === 0 ? '为两个区域各保留面积，并在隔墙上开一段通道。' : '先确定开口和可达，再摆放家具。',
    difficulty: (['入门', '标准', '进阶'] as const)[tier], width: n, height: n,
    usable, entrance, bearing, fixed, roomTypes: ['living', type],
    openingTypes: openings, furnitureTypes, constraints,
    initial: { ...base, roomTypes: base.roomTypes.map((room, cell) => cell % n === n - 1 && cell >= 2 * n ? null : room) },
  }
  const witnesses: Board[] = []
  const keys = new Set<string>()
  const target = [4, 3, 2][tier]
  for (let pass = 0; pass < 200 && witnesses.length < target; pass++) {
    const board = structuredClone(base)
    const boundaryY = 2 + random(n - 5)
    const edge: Edge = `V:${split}:${boundaryY}`
    const changedRow = 1 + random(n - 2)
    if (changedRow !== boundaryY && changedRow !== boundaryY + 1) board.roomTypes[changedRow * n + split] = 'living'
    if (tier === 0) board.openEdges.push(edge)
    else {
      board.openings.push({ edge, kind: 'sliding', pocket: 1 })
      const bedX = outline === '侧翼' ? n - 3 : n - 2
      board.furniture.push({ type: 'bed', id: 'bed', x: bedX, y: groups.includes('风水') ? 0 : random(2), rotation: 'N' })
    }
    if (groups.includes('风水')) board.openings.push({ kind: 'window', edge: `H:${random(split)}:0` })
    if (groups.includes('Wi-Fi')) board.furniture.push(
      { type: 'router', id: 'router', x: 1, y: 4 + random(2), rotation: 'N' },
      { type: 'smartTv', id: 'tv', x: 1, y: 1 + random(2), rotation: 'N' },
    )
    const signature = key(board)
    if (keys.has(signature) || !validate(level, board).complete) continue
    keys.add(signature)
    witnesses.push(board)
  }
  const spare = 1 - (minA + minB) / (areaA + areaB)
  const [minSpare, maxSpare] = [[0.25, 0.4], [0.15, 0.3], [0.1, 0.2]][tier]
  if (witnesses.length < target || spare < minSpare || spare > maxSpare) return
  return { level, witnesses, quality: { spare, groups, witnessKeys: [...keys], attempts: attempt + 1, outline } }
}

export function generateDaily(date: string, seed = date, size?: number, version: GeneratorVersion = generatorVersion): Daily {
  if (!validDate(date) || (size !== undefined && (!Number.isInteger(size) || size < 8 || size > 16))) {
    throw new Error('日期或图纸尺寸无效。')
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const daily = candidate(date, seed, attempt, size, version)
    if (daily) return daily
  }
  const backup = candidate(date, '备用-1', 0, size, version)
  if (!backup) throw new Error('生成预算内没有合格的每日题。')
  return backup
}
