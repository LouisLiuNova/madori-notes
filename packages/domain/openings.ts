import { shiftEdge, sides } from './geometry.ts'
import type { Board, Edge, Level, Opening } from './model.ts'

export type WallBoundary = 'none' | 'wall' | 'bearing' | 'railing' | 'exterior'
export type Boundary = WallBoundary | Opening['kind'] | 'open' | 'pocket'

export function wallBoundary(level: Level, board: Board, edge: Edge, bearing = level.bearing.includes(edge)): WallBoundary {
  if (bearing) return 'bearing'
  const [a, b] = sides(level, edge)
  const first = board.roomTypes[a]
  const second = board.roomTypes[b]
  if (a < 0 && b < 0) return 'none'
  if (a < 0 || b < 0) return (first ?? second) === 'balcony' ? 'railing' : 'exterior'
  return first && second && first !== second ? 'wall' : 'none'
}

export function fitsOpening(opening: Opening, boundaryAt: (edge: Edge) => Boundary | undefined) {
  const boundary = boundaryAt(opening.edge)
  if (opening.kind === 'window') return boundary === 'exterior'
  if (opening.kind === 'swing') return boundary === 'exterior' || boundary === 'wall'
  return boundary === 'wall' && boundaryAt(shiftEdge(opening.edge, opening.pocket)) === 'wall'
}
