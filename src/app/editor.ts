import { catalog, occupied } from '../../packages/domain/catalog.ts'
import { edgeAt, index, point, shiftEdge, sides, turn } from '../../packages/domain/geometry.ts'
import type { Board, Direction, Edge, Furniture, Level, Opening, RoomType } from '../../packages/domain/model.ts'
import { fitsOpening, wallBoundary } from '../../packages/domain/openings.ts'

export type Tool = 'rect' | 'eraseRect' | 'open' | 'wall' | Opening['kind'] | 'furniture' | 'move' | 'remove'
export type EraseScope = 'all' | 'roomsFurniture' | 'rooms' | 'furniture' | 'openings'
export interface Hit { cell: number; edge: Edge; nearEdge?: boolean }
export interface Selection {
  tool: Tool
  room: RoomType
  furniture: string
  rotation: Direction
  side: 0 | 1
  mirror: boolean
  eraseScope: EraseScope
  targetOffset?: number
}

export const isRectangleTool = (tool: Tool) => tool === 'rect' || tool === 'eraseRect'
export const isOpeningTool = (tool: Tool): tool is Opening['kind'] =>
  tool === 'window' || tool === 'swing' || tool === 'sliding'

function occupiesEdge(opening: Opening, edge: Edge) {
  return opening.edge === edge || (opening.kind === 'sliding' && shiftEdge(opening.edge, opening.pocket) === edge)
}

export const openingNames = { window: '外窗', swing: '推门', sliding: '拉门' }

export function openingPreview(edge: Edge, { tool, side, mirror }: Selection): Opening | undefined {
  if (!isOpeningTool(tool)) return
  if (tool === 'window') return { edge, kind: tool }
  if (tool === 'swing') return { edge, kind: tool, side, hinge: mirror ? 1 : 0 }
  return { edge, kind: tool, pocket: mirror ? -1 : 1 }
}

export function edgeProblem(level: Level, board: Board, edge: Edge, selection: Selection): string | undefined {
  const { tool } = selection
  if (tool === 'open' || tool === 'wall') {
    if (level.bearing.includes(edge) || level.fixed.some(item => item.edge === edge)) return '这里是固定结构，请选择可编辑的墙段。'
    if (tool === 'wall') return board.openEdges.includes(edge) ? undefined : '请选择已开放的边界恢复隔墙。'
    const [a, b] = sides(level, edge)
    if (board.openEdges.includes(edge)) return '这段边界已经开放。'
    if (board.openings.some(item => occupiesEdge(item, edge))) return '这段墙已有门窗，请先移除门窗。'
    if (!board.roomTypes[a] || !board.roomTypes[b] || board.roomTypes[a] === board.roomTypes[b]) {
      return '开放边界需要两侧为不同的已划分房间。'
    }
    return
  }
  const opening = openingPreview(edge, selection)
  if (!opening || !level.openingTypes.includes(opening.kind)) return '本关不支持这种门窗。'
  const name = openingNames[opening.kind]
  const segments = opening.kind === 'sliding' ? [edge, shiftEdge(edge, opening.pocket)] : [edge]
  if (segments.some(key => board.openEdges.includes(key) ||
      level.fixed.some(item => occupiesEdge(item, key)) ||
      board.openings.some(item => item.edge !== edge && occupiesEdge(item, key)))) {
    return `${name}与已有开口或固定门窗冲突，请换一段墙。`
  }
  if (!fitsOpening(opening, key => wallBoundary(level, board, key))) {
    return { window: '外窗需要外墙，请选择外轮廓的墙段。', swing: '推门需要普通隔墙或外墙，请换一段墙。',
      sliding: '拉门需要两段连续的普通隔墙，请换墙段或镜像收纳方向。' }[opening.kind]
  }
}

export function openingAt(level: Level, board: Board, edge: Edge, selection: Selection) {
  return edgeProblem(level, board, edge, selection) ? undefined : openingPreview(edge, selection)
}

export function furnitureInPaintOrder(board: Board) {
  return [...board.furniture].sort((a, b) => Number(catalog[b.type]?.layer === 'floor') - Number(catalog[a.type]?.layer === 'floor'))
}

export function editTarget(level: Level, board: Board, hit: Hit, selection: Selection) {
  const furniture = hit.cell < 0 ? [] : furnitureInPaintOrder(board).reverse().filter(item =>
    occupied(item).some(p => index(level, p.x, p.y) === hit.cell))
  const opening = selection.tool === 'remove' && hit.nearEdge !== false
    ? board.openings.find(item => occupiesEdge(item, hit.edge)) : undefined
  const candidates = opening ? [opening, ...furniture] : furniture
  return candidates[(selection.targetOffset ?? 0) % candidates.length]
}

export function rotateFurniture(board: Board, object: Furniture): Board {
  return { ...board, furniture: board.furniture.map(item => item.id === object.id
    ? { ...item, rotation: turn(item.rotation, 1) } : item) }
}

function erase(level: Level, board: Board, cells: Set<number>, scope: EraseScope): Board {
  const clearRooms = scope === 'all' || scope === 'roomsFurniture' || scope === 'rooms'
  const clearFurniture = scope === 'all' || scope === 'roomsFurniture' || scope === 'furniture'
  const clearOpenings = scope === 'all' || scope === 'openings'
  const touches = (edge: Edge) => sides(level, edge).some(cell => cells.has(cell))
  const roomTypes = clearRooms && [...cells].some(cell => board.roomTypes[cell] !== null)
    ? board.roomTypes.map((type, cell) => cells.has(cell) ? null : type) : board.roomTypes
  const furniture = clearFurniture ? board.furniture.filter(item =>
    !occupied(item).some(({ x, y }) => cells.has(index(level, x, y)))) : board.furniture
  const openings = clearOpenings ? board.openings.filter(item =>
    !touches(item.edge) && (item.kind !== 'sliding' || !touches(shiftEdge(item.edge, item.pocket)))) : board.openings
  const openEdges = clearOpenings ? board.openEdges.filter(edge => !touches(edge)) : board.openEdges
  if (roomTypes === board.roomTypes && furniture.length === board.furniture.length &&
      openings.length === board.openings.length && openEdges.length === board.openEdges.length) return board
  return { ...board, roomTypes, furniture, openings, openEdges }
}

export function edit(level: Level, board: Board, hit: Hit, selection: Selection, start: Hit): Board {
  const { cell, edge } = hit
  const { tool } = selection
  if (isRectangleTool(tool)) {
    if (cell < 0 || start.cell < 0) return board
    const a = point(level.width, start.cell)
    const b = point(level.width, cell)
    const cells = new Set<number>()
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
      for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
        const i = index(level, x, y)
        if (i >= 0) cells.add(i)
      }
    }
    if (tool === 'eraseRect') return erase(level, board, cells, selection.eraseScope)
    if ([...cells].every(cell => board.roomTypes[cell] === selection.room)) return board
    return { ...board, roomTypes: board.roomTypes.map((type, cell) => cells.has(cell) ? selection.room : type) }
  }
  if (tool === 'open' || tool === 'wall') {
    if (edgeProblem(level, board, edge, selection)) return board
    return { ...board, openEdges: tool === 'wall' ? board.openEdges.filter(key => key !== edge) : [...board.openEdges, edge] }
  }
  if (tool === 'remove') {
    const object = editTarget(level, board, hit, selection)
    if (!object) return board
    return 'id' in object ? { ...board, furniture: board.furniture.filter(item => item !== object) }
      : { ...board, openings: board.openings.filter(item => item !== object) }
  }
  if (tool === 'move' || tool === 'furniture') {
    if (cell < 0) return board
    const target = point(level.width, cell)
    if (tool === 'move') {
      const object = editTarget(level, board, start, selection)
      if (!object || !('id' in object)) return board
      const source = point(level.width, start.cell)
      if (source.x === target.x && source.y === target.y) return board
      return { ...board, furniture: board.furniture.map(item => item === object ?
        { ...item, x: item.x + target.x - source.x, y: item.y + target.y - source.y } : item) }
    }
    if (!level.furnitureTypes.includes(selection.furniture)) return board
    return { ...board, furniture: [...board.furniture, { ...target, type: selection.furniture,
      rotation: selection.rotation, id: crypto.randomUUID() }] }
  }
  const opening = openingAt(level, board, edge, selection)
  if (!opening) return board
  return { ...board, openings: [...board.openings.filter(item => item.edge !== edge), opening] }
}

export function keyboardHit(level: Level, cell: number, side: number): Hit {
  return { cell, edge: edgeAt(point(level.width, cell), side) }
}
