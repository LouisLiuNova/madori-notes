import { occupied } from '../../packages/domain/catalog.ts'
import { edgeAt, index, point, shiftEdge, sides } from '../../packages/domain/geometry.ts'
import type { Board, Direction, Edge, Level, RoomType } from '../../packages/domain/model.ts'

export type Tool = 'paint' | 'rect' | 'erase' | 'open' | 'wall' | 'swing' | 'sliding' | 'window' | 'furniture' | 'move' | 'remove'
export interface Hit { cell: number; edge: Edge }
export interface Selection {
  tool: Tool
  room: RoomType
  furniture: string
  rotation: Direction
  side: 0 | 1
  mirror: boolean
}

export function edit(level: Level, board: Board, hit: Hit, selection: Selection, start: Hit, from = start): Board {
  const { cell, edge } = hit
  const { tool } = selection
  if (tool === 'paint' || tool === 'rect' || tool === 'erase') {
    if (cell < 0 || from.cell < 0) return board
    const a = point(level.width, from.cell)
    const b = point(level.width, cell)
    const next = board.roomTypes.slice()
    const assign = (x: number, y: number) => {
      const i = index(level, x, y)
      if (i >= 0) next[i] = tool === 'erase' ? null : selection.room
    }
    if (tool === 'rect') {
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
        for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) assign(x, y)
      }
    } else {
      const steps = Math.max(1, Math.abs(a.x - b.x), Math.abs(a.y - b.y))
      for (let step = 0; step <= steps; step++) {
        assign(Math.round(a.x + (b.x - a.x) * step / steps), Math.round(a.y + (b.y - a.y) * step / steps))
      }
    }
    if (next.every((type, i) => type === board.roomTypes[i])) return board
    return { ...board, roomTypes: next }
  }
  if (tool === 'open' || tool === 'wall') {
    if (level.bearing.includes(edge) || level.fixed.some(item => item.edge === edge)) return board
    if (tool === 'wall') {
      if (!board.openEdges.includes(edge)) return board
      return { ...board, openEdges: board.openEdges.filter(key => key !== edge) }
    }
    const [a, b] = sides(level, edge)
    if (!board.roomTypes[a] || !board.roomTypes[b] || board.roomTypes[a] === board.roomTypes[b] ||
        board.openEdges.includes(edge) || board.openings.some(item => item.edge === edge ||
          (item.kind === 'sliding' && shiftEdge(item.edge, item.pocket) === edge))) return board
    return { ...board, openEdges: [...board.openEdges, edge] }
  }
  const at = (source: number) => board.furniture.slice().reverse().find(item =>
    occupied(item).some(p => index(level, p.x, p.y) === source))
  if (tool === 'remove') {
    const opening = board.openings.find(item => item.edge === edge || (item.kind === 'sliding' && shiftEdge(item.edge, item.pocket) === edge))
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
  if (!level.openingTypes.includes(tool) || level.fixed.some(item => item.edge === edge) ||
      level.bearing.includes(edge) || sides(level, edge).every(cell => cell < 0)) return board
  const rest = board.openings.filter(item => item.edge !== edge)
  const opening = tool === 'window' ? { edge, kind: 'window' } as const : tool === 'swing' ?
    { edge, kind: 'swing', side: selection.side, hinge: Number(selection.mirror) as 0 | 1 } as const :
    { edge, kind: 'sliding', pocket: selection.mirror ? -1 : 1 } as const
  return { ...board, openings: [...rest, opening], openEdges: board.openEdges.filter(key => key !== edge) }
}

export function keyboardHit(level: Level, cell: number, side: number): Hit {
  return { cell, edge: edgeAt(point(level.width, cell), side) }
}
