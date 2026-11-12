import { delta, point, rotate } from '../domain/geometry.ts'
import { directions } from '../domain/model.ts'
import type { Point, RoomType } from '../domain/model.ts'

export type Pick = (max: number) => number
export type Route = [RoomType, RoomType]

interface ResidentialPlan {
  name: string
  roomTypes: (RoomType | null)[]
  routes: Route[]
}

function hasSetback(plan: (RoomType | null)[], width: number) {
  const cells = plan.flatMap((room, cell) => room ? [point(width, cell)] : [])
  const xs = cells.map(({ x }) => x)
  const ys = cells.map(({ y }) => y)
  const right = Math.max(...xs)
  const bottom = Math.max(...ys)
  for (let y = Math.min(...ys); y < bottom; y++) {
    for (let x = Math.min(...xs); x < right; x++) {
      const start = y * width + x
      if ([start, start + 1, start + width, start + width + 1].every(cell => plan[cell] === null)) return true
    }
  }
  return false
}

function addBalcony(plan: (RoomType | null)[], width: number, height: number, random: Pick) {
  const at = ({ x, y }: Point) => x >= 0 && x < width && y >= 0 && y < height ? y * width + x : -1
  const options: number[][] = []
  plan.forEach((room, cell) => {
    if (room !== 'living') return
    const start = point(width, cell)
    for (const outward of delta) {
      const horizontal = outward.x === 0
      const terrace: number[] = []
      for (let length = 0; length < 5; length++) {
        const x = start.x + (horizontal ? length : 0)
        const y = start.y + (horizontal ? 0 : length)
        const wall = at({ x, y })
        if (plan[wall] !== 'living') break
        const deck = [1, 2].map(depth => ({ x: x + outward.x * depth, y: y + outward.y * depth }))
        if (deck.some(tile => plan[at(tile)] !== null || delta.some(step => {
          const neighbor = at({ x: tile.x + step.x, y: tile.y + step.y })
          return neighbor >= 0 && neighbor !== wall && plan[neighbor] !== null
        }))) break
        terrace.push(...deck.map(at))
        if (length >= 1) options.push([...terrace])
      }
    }
  })
  if (!options.length) return false
  for (const cell of options[random(options.length)]) plan[cell] = 'balcony'
  return true
}

export function generateResidentialPlan(width: number, height: number, random: Pick): ResidentialPlan | undefined {
  const facing = directions[random(directions.length)]
  const sideways = facing === 'E' || facing === 'W'
  const w = sideways ? height : width
  const h = sideways ? width : height
  const hallWidth = 2 + random(Math.min(2, w - 7))
  const hallStart = 3 + random(w - hallWidth - 5)
  const hallEnd = hallStart + hallWidth
  const plan = Array<RoomType | null>(w * h).fill(null)
  const routes: Route[] = []
  const paint = (room: RoomType, left: number, right: number, top: number, bottom: number) => {
    for (let y = top; y < bottom; y++) plan.fill(room, y * w + left, y * w + right)
  }
  paint('hall', hallStart, hallEnd, 0, h)

  const singleWing = random(3) === 0 ? random(2) : -1
  const rooms: RoomType[] = ['living', 'bedroom', 'kitchen']
  if (singleWing === -1) rooms.push('bath')
  for (let side = 0; side < 2; side++) {
    const capacity = side === 0 ? hallStart : w - hallEnd
    const split = 3 + random(h - 5)
    const bands = side === singleWing ? [[0, h]] : [[0, split], [split, h]]
    for (const [start, end] of bands) {
      const [room] = rooms.splice(random(rooms.length), 1)
      const minWidth = room === 'bedroom' || room === 'living' ? 3 : 2
      const minHeight = room === 'bedroom' ? 3 : 2
      const depth = minWidth + random(capacity - minWidth + 1)
      const top = start + random(Math.min(2, end - start - minHeight) + 1)
      const bottom = end - random(Math.min(2, end - top - minHeight) + 1)
      if (side === 0) paint(room, hallStart - depth, hallStart, top, bottom)
      else paint(room, hallEnd, hallEnd + depth, top, bottom)
      routes.push(['hall', room])
    }
  }

  if (!hasSetback(plan, w)) return
  const balcony = random(2) === 0 && addBalcony(plan, w, h, random)
  if (balcony) {
    if (!hasSetback(plan, w)) return
    routes.push(['living', 'balcony'])
  }

  const roomTypes = Array<RoomType | null>(width * height).fill(null)
  plan.forEach((room, cell) => {
    const { x, y } = rotate(point(w, cell), w, h, facing)
    roomTypes[y * width + x] = room
  })
  return { name: balcony ? '外挑阳台' : singleWing === -1 ? '双翼错台' : '侧翼退台', roomTypes, routes }
}
