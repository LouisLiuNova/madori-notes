import { catalog, footprint, occupied, usage } from './catalog.ts'
import { delta, edgeAt, edgesOf, index, point, segment, shiftEdge, sides, turn } from './geometry.ts'
import { directions, rooms, versions } from './model.ts'
import type { Board, Constraint, Edge, Furniture, Level, Opening, Result, RoomPredicate, RoomType } from './model.ts'
import { fitsOpening, wallBoundary } from './openings.ts'
import type { Boundary } from './openings.ts'
import { isBoard } from './schema.ts'

export type { Boundary } from './openings.ts'
export interface Room {
  type: RoomType
  cells: number[]
}
export interface Report {
  complete: boolean
  global: Result[]
  level: Result[]
  rooms: Room[]
  boundaries: Map<Edge, Boundary>
  reachable: Set<number>
  wifi: Set<number>
  useCells: Set<number>
  sight: Set<number>
}

const result = (id: string, status: Result['status'], message: string, cells: number[] = [], edges: Edge[] = [], objects: string[] = []): Result =>
  ({ id, status, message, cells, edges, objects })
const validPassage = (boundary?: Boundary) =>
  boundary === 'none' || boundary === 'open' || boundary === 'swing' || boundary === 'sliding'
const solidWall = (boundary?: Boundary) =>
  boundary === 'wall' || boundary === 'bearing' || boundary === 'exterior' || boundary === 'pocket'
const door = (boundary?: Boundary) => boundary === 'swing' || boundary === 'sliding'

function flood(start: number, neighbors: (cell: number) => number[]) {
  const visited = new Set([start])
  const queue = [start]
  for (const cell of queue) {
    for (const next of neighbors(cell)) {
      if (visited.has(next)) continue
      visited.add(next)
      queue.push(next)
    }
  }
  return queue
}

export function validate(level: Level, board: Board): Report {
  const global: Result[] = []
  const found: Room[] = []
  const boundaries = new Map<Edge, Boundary>()
  const reachable = new Set<number>()
  const wifi = new Set<number>()
  const useCells = new Set<number>()
  const sight = new Set<number>()
  const report = { complete: false, global, level: [] as Result[], rooms: found, boundaries, reachable, wifi, useCells, sight }
  if (level.schemaVersion !== versions.schemaVersion || level.rulesVersion !== versions.rulesVersion ||
      level.catalogVersion !== versions.catalogVersion || !isBoard(level, board)) {
    global.push(result('schema', 'conflict', '图纸格式或规则版本不受支持。'))
    return report
  }

  const adjacent = (cell: number) => {
    const p = point(level.width, cell)
    return delta.map(({ x, y }, direction) => ({ cell: index(level, p.x + x, p.y + y), edge: edgeAt(p, direction) }))
  }
  const bearing = new Set(level.bearing)
  const roomOf = new Map<number, Room>()
  const empty: number[] = []
  for (let cell = 0; cell < level.usable.length; cell++) {
    if (!level.usable[cell]) continue
    const type = board.roomTypes[cell]
    if (!type) empty.push(cell)
    else if (!roomOf.has(cell)) {
      const cells = flood(cell, current => adjacent(current)
        .filter(next => next.cell >= 0 && board.roomTypes[next.cell] === type && !bearing.has(next.edge))
        .map(next => next.cell))
      const room = { type, cells }
      found.push(room)
      cells.forEach(member => roomOf.set(member, room))
    }
  }
  global.push(result('fill', empty.length ? 'pending' : 'satisfied',
    empty.length ? `还有 ${empty.length} 格尚未分配。` : '已分配全部可用格。', empty))

  for (const edge of edgesOf(level)) {
    boundaries.set(edge, wallBoundary(level, board, edge, bearing.has(edge)))
  }

  const occupiedEdges = new Map<Edge, Opening>()
  const openings = [...level.fixed, ...board.openings]
  const validOpenings: Opening[] = []
  const openingEdges = new Set(openings.map(opening => opening.edge))
  const sweep = new Map<Edge, number>()
  for (const [i, opening] of openings.entries()) {
    const { edge, kind } = opening
    const pocket = kind === 'sliding' ? shiftEdge(edge, opening.pocket) : undefined
    const fixed = i < level.fixed.length
    const [a, b] = sides(level, edge)
    const validPocket = !pocket || (!openingEdges.has(pocket) && !occupiedEdges.has(pocket))
    if ((!fixed && !level.openingTypes.includes(kind)) || !fitsOpening(opening, key => boundaries.get(key)) ||
        !validPocket || occupiedEdges.has(edge)) {
      global.push(result(`opening-${i}`, 'conflict', '门窗须放在允许的墙段上，且洞口与收纳墙不能重叠。',
        [a, b].filter(cell => cell >= 0), pocket ? [edge, pocket] : [edge]))
      continue
    }
    occupiedEdges.set(edge, opening)
    boundaries.set(edge, kind)
    validOpenings.push(opening)
    if (pocket) {
      occupiedEdges.set(pocket, opening)
      boundaries.set(pocket, 'pocket')
    }
    if (kind === 'swing') sweep.set(edge, opening.side === 0 ? a : b)
  }
  for (const edge of new Set(board.openEdges)) {
    if (boundaries.get(edge) === 'wall' && sides(level, edge).every(cell => Boolean(board.roomTypes[cell]))) {
      boundaries.set(edge, 'open')
    } else if (boundaries.get(edge) !== 'none') {
      global.push(result(`open-${edge}`, 'conflict', '开放边界须位于两个功能区域之间的普通墙段。', [], [edge]))
    }
  }

  const solid = new Map<number, string>()
  const floor = new Set<number>()
  const high = new Set<number>()
  const objects = new Map<Furniture, number[]>()
  const objectIds = new Set<string>()
  for (const object of board.furniture) {
    const def = catalog[object.type]
    const cells = occupied(object).map(p => index(level, p.x, p.y))
    const room = roomOf.get(cells[0])
    const reason = !def || !level.furnitureTypes.includes(object.type) ? '本关不适用，请移除。'
      : objectIds.has(object.id) ? '标识重复，请移除重复物件后重新放置。'
      : cells.some(cell => cell < 0) ? '超出可用格，请移回图纸内。'
      : !room ? '位于未划分区域，请先划分房间或移入房间。'
      : !def.rooms.includes(room.type) ? '不适用于该房间，请移入适用房间。'
      : cells.some(cell => roomOf.get(cell) !== room) ||
        cells.some(cell => adjacent(cell).some(next => cells.includes(next.cell) && bearing.has(next.edge)))
        ? '跨越房间边界或承重墙，请移到同一房间内。'
      : cells.some(cell => def.layer === 'solid' ? solid.has(cell) : floor.has(cell))
        ? '与同层家具重叠，请移动其中一件。' : undefined
    if (reason) {
      global.push(result(`furniture-${object.id}`, 'conflict', `${def?.name ?? '未知家具'}：${reason}`,
        cells.filter(cell => cell >= 0), [], [object.id]))
      continue
    }
    objectIds.add(object.id)
    for (const cell of cells) {
      if (def.layer === 'solid') solid.set(cell, object.id)
      else floor.add(cell)
      if (def.high) high.add(cell)
    }
    objects.set(object, cells)
    if (def.radius !== undefined) {
      const radius = def.radius
      level.usable.forEach((usable, cell) => {
        const p = point(level.width, cell)
        if (usable && (p.x - object.x) ** 2 + (p.y - object.y) ** 2 <= radius ** 2) wifi.add(cell)
      })
    }
  }

  for (const opening of validOpenings) {
    if (opening.kind === 'window') continue
    const a = sides(level, opening.edge)
    const swing = sweep.get(opening.edge)
    if (a.some(cell => solid.has(cell))) {
      global.push(result(`landing-${opening.edge}`, 'conflict',
        swing !== undefined && solid.has(swing) ? '家具侵入推门开启净空。' : '门洞落脚格被家具挡住。',
        a.filter(cell => cell >= 0), [opening.edge]))
    }
  }

  const entry = sides(level, level.entrance).find(cell => cell >= 0) ?? -1
  if (door(boundaries.get(level.entrance)) && board.roomTypes[entry] && !solid.has(entry)) {
    flood(entry, cell => adjacent(cell).filter(next => next.cell >= 0 && board.roomTypes[next.cell] &&
      !solid.has(next.cell) && validPassage(boundaries.get(next.edge))).map(next => next.cell))
      .forEach(cell => reachable.add(cell))
  } else {
    global.push(result('entrance', empty.includes(entry) ? 'pending' : 'conflict',
      '主入口内侧需要已分配且可通行的落脚格。', entry >= 0 ? [entry] : [], [level.entrance]))
  }
  for (const room of found) {
    const entries = room.cells.flatMap(cell => adjacent(cell).filter(next => roomOf.get(next.cell) !== room &&
      (door(boundaries.get(next.edge)) || boundaries.get(next.edge) === 'open')).map(next => next.edge))
    if (!entries.length || !room.cells.some(cell => reachable.has(cell))) {
      global.push(result(`access-${room.cells[0]}`, empty.length ? 'pending' : 'conflict',
        `${rooms[room.type]}需要开口和一条通往主入口的路线。`, room.cells, entries))
    }
  }

  for (const [object, cells] of objects) {
    const def = catalog[object.type]
    if (def.usage !== 'none') {
      const usable = usage(level, object).filter(cell => cell >= 0 && adjacent(cell).some(next =>
        cells.includes(next.cell) && validPassage(boundaries.get(next.edge))))
      usable.forEach(cell => useCells.add(cell))
      if (!usable.some(cell => reachable.has(cell))) {
        global.push(result(`use-${object.id}`, 'conflict', `${def.name}没有可达的使用格。`, [...cells, ...usable], [], [object.id]))
      }
    }
    if (def.smart && cells.some(cell => !wifi.has(cell))) {
      global.push(result(`wifi-${object.id}`, 'pending', `${def.name}的所有占地都需要 Wi-Fi。`,
        cells.filter(cell => !wifi.has(cell)), [], [object.id]))
    }
  }

  const trace = (start: number, direction: number, ignoreFirst = false) => {
    const cells: number[] = []
    const openings: Edge[] = []
    let current = start
    while (current >= 0) {
      if (!(ignoreFirst && current === start) && high.has(current)) break
      cells.push(current)
      const next = adjacent(current)[direction]
      const boundary = boundaries.get(next.edge)
      if (door(boundary) || boundary === 'window') openings.push(next.edge)
      if (!validPassage(boundary) && boundary !== 'window') break
      current = next.cell
    }
    return { cells, openings }
  }
  const inward = (edge: Edge, cell: number) => {
    const outward = delta.findIndex((_, direction) => edgeAt(point(level.width, cell), direction) === edge)
    return (outward + 2) % 4
  }
  if (entry >= 0) trace(entry, inward(level.entrance, entry)).cells.forEach(cell => sight.add(cell))

  const matches = (room: Room, predicates: RoomPredicate[]) => predicates.every(predicate => {
    switch (predicate.kind) {
      case 'area': return room.cells.length >= predicate.min
      case 'window': return room.cells.some(cell => adjacent(cell).some(next => boundaries.get(next.edge) === 'window'))
      case 'wifi': return room.cells.every(cell => wifi.has(cell))
      case 'router': return [...objects].some(([object, cells]) => object.type === 'router' && roomOf.get(cells[0]) === room)
      case 'noRouter': return ![...objects].some(([object, cells]) => object.type === 'router' && roomOf.get(cells[0]) === room)
    }
  })

  const furnitureRule = (object: Furniture, cells: number[], rule: Extract<Constraint, { kind: 'furnitureRule' }>) => {
    if (rule.rule === 'privacy') return cells.every(cell => !sight.has(cell))
    if (rule.rule === 'direction') return turn(object.rotation, 2) === rule.direction
    const def = catalog[object.type]
    const foot = rule.rule === 'footNoDoor'
    const face = directions.indexOf(turn(object.rotation, foot ? 2 : 0))
    const line = footprint(object, Array.from({ length: def.width }, (_, x) => ({ x, y: foot ? def.height - 1 : 0 })))
    const boundariesAlongFace = line.map(p => boundaries.get(edgeAt(p, face)))
    if (foot) return line.every(p => trace(index(level, p.x, p.y), face, true).openings.every(edge => !door(boundaries.get(edge))))
    if (rule.rule === 'headNoWindow') return boundariesAlongFace.every(edge => edge !== 'window')
    if (rule.rule === 'window') return boundariesAlongFace.some(edge => edge === 'window')
    return boundariesAlongFace.every(solidWall)
  }

  function evaluate(rule: Constraint, i: number) {
    const id = `rule-${i}`
    const group = 'type' in rule && typeof rule.type === 'string' ? found.filter(room => room.type === rule.type) : []
    let cells = group.flatMap(room => room.cells)
    let edges: Edge[] = []
    let objectIds: string[] = []
    let good = false
    let hard = false
    let count = ''
    switch (rule.kind) {
      case 'rooms':
        good = group.length >= rule.min
        count = `当前 ${group.length} / 至少 ${rule.min} 间`
        break
      case 'slots': {
        const allocation = new Map<Room, number>()
        function assign(slot: number, seen: Set<Room>): boolean {
          for (const room of group) {
            if (seen.has(room) || !matches(room, rule.kind === 'slots' ? rule.slots[slot] : [])) continue
            seen.add(room)
            const previous = allocation.get(room)
            if (previous === undefined || assign(previous, seen)) {
              allocation.set(room, slot)
              return true
            }
          }
          return false
        }
        const matched = rule.slots.filter((_, slot) => assign(slot, new Set())).length
        good = matched === rule.slots.length
        count = rule.slots.length === 1 && rule.slots[0][0]?.kind === 'area'
          ? `当前最大 ${Math.max(0, ...group.map(room => room.cells.length))} / 至少 ${rule.slots[0][0].min} 格`
          : `已匹配 ${matched} / ${rule.slots.length} 间`
        break
      }
      case 'roomRule': {
        const matched = group.filter(room => matches(room, rule.predicates))
        good = matched.length >= (rule.min ?? Math.max(1, group.length))
        hard = rule.predicates.some(predicate => predicate.kind === 'noRouter') && group.length > 0
        count = `满足 ${matched.length} / ${rule.min ?? group.length} 间`
        if (!good) cells = group.filter(room => !matched.includes(room)).flatMap(room => room.cells)
        break
      }
      case 'relation': {
        edges = [...boundaries].filter(([edge]) => {
          const [a, b] = sides(level, edge).map(cell => board.roomTypes[cell])
          return a !== b && rule.types.includes(a!) && rule.types.includes(b!)
        }).map(([edge]) => edge)
        const match = edges.some(edge => {
          const boundary = boundaries.get(edge)
          if (rule.mode === 'open') return boundary === 'open' && sides(level, edge).every(cell => !solid.has(cell))
          if (rule.mode === 'door') return door(boundary) && sides(level, edge).every(cell => !solid.has(cell))
          if (rule.mode === 'wall') return solidWall(boundary)
          return true
        })
        good = rule.mode === 'separate' ? !match : match
        hard = rule.mode === 'separate'
        cells = edges.flatMap(edge => sides(level, edge))
        break
      }
      case 'opening': {
        edges = validOpenings.filter(opening => opening.kind === rule.type &&
          (!rule.exterior || sides(level, opening.edge).includes(-1)) &&
          (!rule.player || !level.fixed.includes(opening))).map(opening => opening.edge)
        good = edges.length >= rule.min
        count = `当前 ${edges.length} / 至少 ${rule.min} 处`
        break
      }
      case 'furniture':
      case 'furnitureRule': {
        const group = [...objects].filter(([object, cells]) =>
          object.type === rule.type && (rule.kind !== 'furniture' || !rule.room || roomOf.get(cells[0])?.type === rule.room))
        cells = group.flatMap(([, cells]) => cells)
        objectIds = group.map(([object]) => object.id)
        good = rule.kind === 'furniture' ? group.length >= rule.min :
          group.length > 0 && group.every(([object, cells]) => furnitureRule(object, cells, rule))
        hard = rule.kind === 'furnitureRule' && group.length > 0
        if (rule.kind === 'furniture') count = `当前 ${group.length} / 至少 ${rule.min} 件`
        break
      }
      case 'noFacing':
        edges = validOpenings.flatMap(opening => {
          const [a, b] = sides(level, opening.edge)
          const horizontal = segment(opening.edge).horizontal
          return [a, b].flatMap((cell, side) => cell < 0 ? [] :
            trace(cell, horizontal ? side * 2 : 3 - side * 2).openings)
        })
        good = !edges.length
        hard = true
        break
    }
    return result(id, good ? 'satisfied' : hard ? 'conflict' : 'pending',
      count || (good ? '条件已满足' : '待调整'), cells, edges, objectIds)
  }
  report.level = level.constraints.map(evaluate)
  report.complete = [...global, ...report.level].every(item => item.status === 'satisfied')
  return report
}
