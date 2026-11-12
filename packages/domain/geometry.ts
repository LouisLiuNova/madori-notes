import { directions } from './model.ts'
import type { Direction, Edge, Level, Point } from './model.ts'

export const delta = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]
export const point = (width: number, cell: number): Point => ({ x: cell % width, y: Math.floor(cell / width) })
export const index = (level: Level, x: number, y: number) =>
  x >= 0 && x < level.width && y >= 0 && y < level.height && level.usable[y * level.width + x] ? y * level.width + x : -1

export function edgeAt({ x, y }: Point, direction: number): Edge {
  if (direction === 0) return `H:${x}:${y}`
  if (direction === 1) return `V:${x + 1}:${y}`
  if (direction === 2) return `H:${x}:${y + 1}`
  return `V:${x}:${y}`
}

export function segment(edge: Edge) {
  const [axis, a, b] = edge.split(':')
  return { horizontal: axis === 'H', x: Number(a), y: Number(b) }
}

export function sides(level: Level, edge: Edge): [number, number] {
  const { horizontal, x, y } = segment(edge)
  return [index(level, x - Number(!horizontal), y - Number(horizontal)), index(level, x, y)]
}

export function shiftEdge(edge: Edge, offset: number): Edge {
  const { horizontal, x, y } = segment(edge)
  return horizontal ? `H:${x + offset}:${y}` : `V:${x}:${y + offset}`
}

export function edgesOf(level: Level) {
  const edges = new Set<Edge>()
  level.usable.forEach((usable, cell) => {
    if (usable) delta.forEach((_, direction) => edges.add(edgeAt(point(level.width, cell), direction)))
  })
  return edges
}

export function rotate({ x, y }: Point, width: number, height: number, direction: Direction): Point {
  switch (direction) {
    case 'E': return { x: height - 1 - y, y: x }
    case 'S': return { x: width - 1 - x, y: height - 1 - y }
    case 'W': return { x: y, y: width - 1 - x }
    default: return { x, y }
  }
}

export function turn(direction: Direction, quarterTurns: number) {
  return directions[(directions.indexOf(direction) + quarterTurns + 4) % 4]
}
