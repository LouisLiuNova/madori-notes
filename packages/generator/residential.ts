import { occupied, usage } from '../domain/catalog.ts'
import { delta, edgeAt, edgesOf, index, point, shiftEdge, sides } from '../domain/geometry.ts'
import { blank, directions, rooms, versions } from '../domain/model.ts'
import type { Board, Constraint, Edge, Furniture, Level, RoomType } from '../domain/model.ts'
import { validate } from '../domain/validate.ts'
import type { Daily } from './daily.ts'
import { generateResidentialPlan } from './residential-plan.ts'
import type { Pick, Route } from './residential-plan.ts'

const codes = { L: 'living', H: 'hall', B: 'bedroom', K: 'kitchen', T: 'bath' } as const
type Code = keyof typeof codes

const shells: { name: string; plan: string[]; routes: [Code, Code][] }[] = [
  {
    name: '中置玄关', plan: ['LLLLBBBB', 'LLLLBBBB', 'LLLLBBBB', 'LLLLBBBB', 'LLLLHHKK', 'LLLLHHKK', 'LLLLHHKK', 'LLLLHHKK'],
    routes: [['H', 'B'], ['H', 'L'], ['H', 'K']],
  },
  {
    name: '临街侧翼', plan: ['....BBBB', '....BBBB', '....BBBB', 'LLLLBBBB', 'LLLLHHKK', 'LLLLHHKK', 'LLLLHHKK', 'LLLLHHKK'],
    routes: [['H', 'B'], ['H', 'L'], ['H', 'K']],
  },
  {
    name: '折角端户', plan: ['LLLL....', 'LLLL....', 'LLLLBBBB', 'LLLLBBBB', 'HHHHBBBB', 'HHHHBBBB', '..HHKKKK', '..HHKKKK'],
    routes: [['H', 'B'], ['H', 'L'], ['H', 'K']],
  },
  {
    name: '三面采光', plan: ['...BBBB.', '...BBBB.', '.LLBBBB.', '.LLBBBB.', '.LLHHH..', '.LLHHHKK', '.LLHHHKK', '.LL...KK'],
    routes: [['H', 'B'], ['H', 'L'], ['H', 'K']],
  },
  {
    name: '长进深边户', plan: ['BBBBBB..', 'BBBBBB..', 'BBBBBB..', '..HHLLLL', '..HHLLLL', '..HHLLLL', 'KKHHLLLL', 'KKHHLLLL'],
    routes: [['H', 'B'], ['H', 'L'], ['H', 'K']],
  },
  {
    name: '错翼四开间', plan: ['BBBB....', 'BBBB....', 'BBBBLLLL', 'BBBBLLLL', 'HHHHLLLL', 'HHHHLLLL', 'TTTHKKKK', 'TTTHKKKK'],
    routes: [['H', 'B'], ['H', 'L'], ['L', 'K'], ['H', 'T']],
  },
  {
    name: '客厨串联', plan: ['....KKKK', '....KKKK', '....LLLL', '....LLLL', 'BBBBLLLL', 'BBBBLLLL', 'BBBBHH..', 'BBBBHH..'],
    routes: [['H', 'B'], ['H', 'L'], ['L', 'K']],
  },
]

function pick<T>(values: T[], random: Pick) {
  return values[random(values.length)]
}

function transform(plan: string[], rotation: number, width: number, height: number) {
  const rows = [...plan]
  if (rotation & 1) rows.reverse()
  if (rotation & 2) rows.forEach((row, i) => { rows[i] = [...row].reverse().join('') })
  if (rotation & 4) {
    const source = [...rows]
    rows.forEach((_, i) => { rows[i] = source.map(row => row[i]).join('') })
  }
  return Array.from({ length: width * height }, (_, i) => {
    const mark = rows[Math.floor(Math.floor(i / width) * 8 / height)][Math.floor((i % width) * 8 / width)]
    return codes[mark as Code] ?? null
  })
}

const count = (type: string, label: string, room?: RoomType): Constraint =>
  ({ kind: 'furniture', type, min: 1, label, ...(room && { room }) })

export function residentialDaily(date: string, seed: string, size: number | undefined, attempt: number,
  random: Pick, signature: (board: Board) => string, version: '4' | '5'): Daily | undefined {
  const tier = random(3)
  const wifi = tier === 2 && random(2) === 0
  const dimensionCount = version === '4' ? 3 : 5
  const width = size ?? 8 + random(dimensionCount)
  const height = size ?? 8 + random(dimensionCount)
  const plan = version === '4' ? legacyPlan(date, width, height, random) : generateResidentialPlan(width, height, random)
  if (!plan) return
  const { roomTypes, routes } = plan
  const usable = roomTypes.map(Boolean)
  const allowed = [...new Set(roomTypes.filter(type => type !== null))]
  const level: Level = {
    ...versions, generatorVersion: version, seed, date, id: `daily-${date}-${version}`,
    title: '每日建筑委托', brief: '根据入户门、外窗和面积分配房间，再让各处动线连通。',
    tip: tier === 0 ? '先看固定窗，估算各房间的面积，再让走廊接上其余区域。'
      : '卧室拉门需要两段隔墙。分房时一并给门洞、收纳段和床侧通行留位置。',
    difficulty: (['入门', '标准', '进阶'] as const)[tier], width, height,
    usable, entrance: 'H:0:0', bearing: [], fixed: [], roomTypes: allowed,
    openingTypes: [...(tier ? ['sliding'] as const : []), ...(allowed.includes('balcony') ? ['swing'] as const : [])],
    furnitureTypes: tier ? wifi ? ['bed', 'router', 'smartTv'] : ['bed'] : [],
    constraints: [], initial: blank(roomTypes.length),
  }
  const edges = [...edgesOf(level)].map(edge => ({ edge, cells: sides(level, edge) }))
  const exterior = (type: RoomType) => edges.filter(({ cells: [a, b] }) =>
    (a === -1 && roomTypes[b] === type) || (b === -1 && roomTypes[a] === type))
  const entries = exterior('hall')
  if (!entries.length) return
  level.entrance = pick(entries, random).edge
  level.fixed.push({ edge: level.entrance, kind: 'swing', side: sides(level, level.entrance)[0] === -1 ? 1 : 0, hinge: 0 })
  const lit: RoomType[] = ['living', 'bedroom', 'kitchen']
  for (const type of lit) {
    const walls = exterior(type)
    if (!walls.length) return
    level.fixed.push({ kind: 'window', edge: pick(walls, random).edge })
  }
  const minima = allowed.map(type => {
    const area = roomTypes.filter(value => value === type).length
    return [type, area - Math.min(3 - tier, area - 1)] as const
  })
  for (const [type, min] of minima) {
    const daylight = lit.includes(type)
    level.constraints.push({
      kind: 'slots', type, slots: [[{ kind: 'area', min }, ...(daylight ? [{ kind: 'window' } as const] : [])]],
      label: `${rooms[type]}至少 ${min} 格${daylight ? '，且有外窗' : ''}`,
    })
  }
  for (const [a, b] of routes) {
    const opening = routeOpening(b, tier)
    const connection = opening === 'sliding' ? '以拉门相通' : opening === 'swing' ? '以推门相通' : '开放相通'
    level.constraints.push({ kind: 'relation', types: [a, b], mode: opening ? 'door' : 'open',
      label: `${rooms[a]}与${rooms[b]}${connection}` })
  }
  const groups = ['邻接', '建筑边界']
  if (tier) {
    groups.push('家具')
    level.constraints.push(count('bed', '卧室至少有一张床'))
  }
  if (wifi) {
    groups.push('Wi-Fi')
    level.constraints.push(count('router', '走廊内至少有一台路由器', 'hall'), count('smartTv', '客厅至少有一台智能电视'),
      { kind: 'roomRule', type: 'living', predicates: [{ kind: 'noRouter' }], label: '客厅内禁止放路由器' },
      { kind: 'roomRule', type: 'bedroom', predicates: [{ kind: 'noRouter' }], label: '卧室内禁止放路由器' },
      { kind: 'roomRule', type: 'kitchen', predicates: [{ kind: 'noRouter' }], label: '厨房内禁止放路由器' })
  } else if (tier === 2) {
    groups.push('风水')
    level.constraints.push({ kind: 'furnitureRule', type: 'bed', rule: 'headWall', label: '床头全段靠实墙' },
      { kind: 'furnitureRule', type: 'bed', rule: 'footNoDoor', label: '床尾轴线避开门洞' })
  }

  // 只给主入口内侧一个玄关起点，窗与各房间的剩余边界由玩家推断。
  const entryCell = sides(level, level.entrance).find(cell => cell >= 0)!
  level.initial.roomTypes[entryCell] = 'hall'
  const anchored = new Set(level.fixed.flatMap(({ edge }) => sides(level, edge)))
  const partitions = edges.filter(({ cells: [a, b] }) => a >= 0 && b >= 0 && roomTypes[a] !== roomTypes[b])
  const edits = partitions.filter(({ cells }) => cells.every(cell => roomTypes[cell] !== 'balcony'))
    .flatMap(({ cells: [a, b] }) => [a, b].filter(cell => !anchored.has(cell))
      .map(cell => ({ cell, type: roomTypes[cell === a ? b : a] })))
  const target = [4, 3, 2][tier]
  const witnesses: Board[] = []
  const layouts = new Set<string>()
  for (let pass = 0; pass < 100 && witnesses.length < target; pass++) {
    const board = blank(roomTypes.length)
    board.roomTypes = [...roomTypes]
    if (witnesses.length || pass % 4 !== 0) {
      const edit = pick(edits, random)
      board.roomTypes[edit.cell] = edit.type
    }
    const layout = board.roomTypes.join(',')
    if (layouts.has(layout)) continue
    if (!connect(level, board, partitions, routes, tier, random)) continue
    if (tier && !furnish(level, board, wifi, tier === 2, random)) continue
    if (!validate(level, board).complete) continue
    layouts.add(layout)
    witnesses.push(board)
  }
  if (witnesses.length < target) return
  const spare = 1 - minima.reduce((sum, [, min]) => sum + min, 0) / usable.filter(Boolean).length
  return { level, witnesses, quality: { spare, groups, witnessKeys: witnesses.map(signature), attempts: attempt + 1, outline: plan.name } }
}

function legacyPlan(date: string, width: number, height: number, random: Pick) {
  const day = Math.floor(Date.parse(date) / 86400_000)
  const shell = shells[((day % shells.length) + shells.length) % shells.length]
  const routes: Route[] = shell.routes.map(([a, b]) => [codes[a], codes[b]])
  return { name: shell.name, roomTypes: transform(shell.plan, random(8), width, height), routes }
}

function routeOpening(to: RoomType, tier: number) {
  if (to === 'balcony') return 'swing'
  if (tier > 0 && to === 'bedroom') return 'sliding'
}

function connect(level: Level, board: Board, original: { edge: Edge; cells: [number, number] }[],
  routes: Route[], tier: number, random: Pick) {
  const matches = ([a, b]: [number, number], first: RoomType, second: RoomType) => {
    const x = board.roomTypes[a]
    const y = board.roomTypes[b]
    return (x === first && y === second) || (x === second && y === first)
  }
  for (const [a, b] of routes) {
    const opening = routeOpening(b, tier)
    const options = original.filter(({ cells }) => matches(cells, a, b))
    if (opening === 'sliding') {
      const doors = options.flatMap(({ edge }) => ([-1, 1] as const)
        .filter(pocket => matches(sides(level, shiftEdge(edge, pocket)), a, b))
        .map(pocket => ({ edge, kind: 'sliding' as const, pocket })))
      if (!doors.length) return false
      board.openings.push(pick(doors, random))
    } else {
      if (!options.length) return false
      const { edge, cells } = pick(options, random)
      if (opening === 'swing') board.openings.push({ edge, kind: 'swing', side: board.roomTypes[cells[0]] === b ? 0 : 1, hinge: 0 })
      else board.openEdges.push(edge)
    }
  }
  return true
}

function furnish(level: Level, board: Board, wifi: boolean, advanced: boolean, random: Pick) {
  const landings = new Set([level.entrance, ...board.openEdges, ...board.openings.map(value => value.edge)]
    .flatMap(edge => sides(level, edge)))
  function placements(type: string, room: RoomType, againstWall = false) {
    return board.roomTypes.flatMap((value, cell) => {
      if (value !== room) return []
      const origin = point(level.width, cell)
      return directions.flatMap((rotation, direction) => {
        const object: Furniture = { id: type, type, ...origin, rotation }
        const cells = occupied(object)
        if (!cells.every(({ x, y }) => {
          const i = index(level, x, y)
          return board.roomTypes[i] === room && !landings.has(i)
        }) || !usage(level, object).some(i => board.roomTypes[i] === room)) return []
        if (againstWall) {
          const back = delta[direction]
          const head = cells.filter(p => !cells.some(q => q.x === p.x + back.x && q.y === p.y + back.y))
          if (!head.every(p => board.roomTypes[index(level, p.x + back.x, p.y + back.y)] !== room &&
              !level.fixed.some(({ edge }) => edge === edgeAt(p, direction)) &&
              !board.openings.some(({ edge }) => edge === edgeAt(p, direction)))) return []
        }
        return [object]
      })
    })
  }
  const beds = placements('bed', 'bedroom', advanced && !wifi)
  if (!beds.length) return false
  board.furniture.push(pick(beds, random))
  if (!wifi) return true
  const routers = placements('router', 'hall')
  const pairs = placements('smartTv', 'living').flatMap(tv =>
    routers.filter(router => occupied(tv).every(p => (p.x - router.x) ** 2 + (p.y - router.y) ** 2 <= 16))
      .map(router => [tv, router]))
  if (!pairs.length) return false
  board.furniture.push(...pick(pairs, random))
  return true
}
