import { occupied } from '../../packages/domain/catalog.ts'
import { edgeAt, index, point, shiftEdge, sides } from '../../packages/domain/geometry.ts'
import type { Board, Direction, Edge, Level, Opening, RoomType } from '../../packages/domain/model.ts'
import { fitsOpening, wallBoundary } from '../../packages/domain/openings.ts'

export type Tool = 'rect' | 'eraseRect' | 'open' | 'wall' | Opening['kind'] | 'furniture' | 'move' | 'remove'
export type EraseScope = 'all' | 'roomsFurniture' | 'rooms' | 'furniture' | 'openings'
export interface Hit { cell: number; edge: Edge }
export interface Selection {
  tool: Tool
  room: RoomType
  furniture: string
  rotation: Direction
  side: 0 | 1
  mirror: boolean
  eraseScope: EraseScope
}

export const isRectangleTool = (tool: Tool) => tool === 'rect' || tool === 'eraseRect'
export const isOpeningTool = (tool: Tool): tool is Opening['kind'] =>
  tool === 'window' || tool === 'swing' || tool === 'sliding'

function occupiesEdge(opening: Opening, edge: Edge) {
  return opening.edge === edge || (opening.kind === 'sliding' && shiftEdge(opening.edge, opening.pocket) === edge)
}

export function openingAt(level: Level, board: Board, edge: Edge, { tool, side, mirror }: Selection): Opening | undefined {
  if (!isOpeningTool(tool) || !level.openingTypes.includes(tool)) return
  const opening: Opening = tool === 'window' ? { edge, kind: tool } : tool === 'swing' ?
    { edge, kind: tool, side, hinge: mirror ? 1 : 0 } : { edge, kind: tool, pocket: mirror ? -1 : 1 }
  if (!fitsOpening(opening, key => wallBoundary(level, board, key))) return
  const segments = opening.kind === 'sliding' ? [edge, shiftEdge(edge, opening.pocket)] : [edge]
  if (segments.some(key => board.openEdges.includes(key) ||
      level.fixed.some(item => occupiesEdge(item, key)) ||
      board.openings.some(item => item.edge !== edge && occupiesEdge(item, key)))) return
  return opening
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
    if (level.bearing.includes(edge) || level.fixed.some(item => item.edge === edge)) return board
    if (tool === 'wall') {
      if (!board.openEdges.includes(edge)) return board
      return { ...board, openEdges: board.openEdges.filter(key => key !== edge) }
    }
    const [a, b] = sides(level, edge)
    if (!board.roomTypes[a] || !board.roomTypes[b] || board.roomTypes[a] === board.roomTypes[b] ||
        board.openEdges.includes(edge) || board.openings.some(item => occupiesEdge(item, edge))) return board
    return { ...board, openEdges: [...board.openEdges, edge] }
  }
  const at = (source: number) => board.furniture.slice().reverse().find(item =>
    occupied(item).some(p => index(level, p.x, p.y) === source))
  if (tool === 'remove') {
    const opening = board.openings.find(item => occupiesEdge(item, edge))
    if (opening) return { ...board, openings: board.openings.filter(item => item !== opening) }
    const object = at(cell)
    if (!object) return board
    return { ...board, furniture: board.furniture.filter(item => item !== object) }
  }
  if (tool === 'move' || tool === 'furniture') {
    if (cell < 0) return board
    const target = point(level.width, cell)
    if (tool === 'move') {
      const object = at(start.cell)
      if (!object) return board
      const source = point(level.width, start.cell)
      if (source.x === target.x && source.y === target.y && object.rotation === selection.rotation) return board
      return { ...board, furniture: board.furniture.map(item => item === object ?
        { ...item, x: item.x + target.x - source.x, y: item.y + target.y - source.y, rotation: selection.rotation } : item) }
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
