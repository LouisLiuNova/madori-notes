import { rooms } from './model.ts'
import type { Furniture, Level, Point, RoomType } from './model.ts'
import { index, rotate } from './geometry.ts'

type Usage = 'front' | 'sides' | 'around' | 'none'
type Definition = {
  name: string; width: number; height: number; rooms: RoomType[]; usage: Usage
  layer: 'solid' | 'floor'; high: boolean; smart: boolean; radius?: number
}

const inside = Object.keys(rooms).filter(type => type !== 'balcony') as RoomType[]
const all = Object.keys(rooms) as RoomType[]

function item(name: string, width: number, height: number, allowed: RoomType[], options: Partial<Definition> = {}): Definition {
  return { name, width, height, rooms: allowed, usage: 'front', layer: 'solid', high: false, smart: false, ...options }
}

export const catalog: Readonly<Record<string, Definition>> = {
  bed: item('床', 2, 3, ['bedroom'], { usage: 'sides' }),
  wardrobe: item('衣柜', 2, 1, ['bedroom'], { high: true }),
  nightstand: item('床头柜', 1, 1, ['bedroom']),
  sofa: item('沙发', 3, 1, ['living']),
  coffeeTable: item('茶几', 2, 1, ['living']),
  tvStand: item('电视柜', 2, 1, ['living']),
  diningTable: item('餐桌', 2, 2, ['dining']),
  chair: item('餐椅', 1, 1, ['dining']),
  stove: item('灶台', 2, 1, ['kitchen']),
  sink: item('水槽', 2, 1, ['kitchen']),
  fridge: item('冰箱', 1, 1, ['kitchen'], { high: true }),
  toilet: item('马桶', 1, 1, ['bath']),
  basin: item('洗手台', 1, 1, ['bath']),
  shower: item('淋浴区', 2, 2, ['bath'], { high: true }),
  desk: item('书桌', 2, 1, ['study']),
  bookcase: item('书柜', 2, 1, ['study'], { high: true }),
  computer: item('电脑桌', 2, 1, ['study', 'bedroom']),
  dryingRack: item('晾衣架', 2, 1, ['balcony']),
  outdoorChair: item('户外座椅', 1, 1, ['balcony']),
  planter: item('种植箱', 2, 1, ['balcony'], { usage: 'none' }),
  plant: item('盆栽', 1, 1, all, { usage: 'none' }),
  lamp: item('落地灯', 1, 1, inside, { usage: 'around' }),
  displayCabinet: item('装饰柜', 2, 1, inside, { usage: 'none', high: true }),
  rug: item('地毯', 2, 2, inside, { layer: 'floor', usage: 'none' }),
  router: item('路由器', 1, 1, all, { usage: 'around', radius: 4 }),
  smartTv: item('智能电视', 2, 1, ['living'], { smart: true }),
  smartFridge: item('智能冰箱', 1, 1, ['kitchen'], { smart: true, high: true }),
  smartLamp: item('智能灯', 1, 1, inside, { smart: true, usage: 'around' }),
  robot: item('机器人基站', 1, 1, inside, { smart: true }),
}

export function footprint(object: Furniture, offsets: Point[]) {
  const def = catalog[object.type]
  return offsets.map(offset => {
    const { x, y } = rotate(offset, def.width, def.height, object.rotation)
    return { x: object.x + x, y: object.y + y }
  })
}

export function occupied(object: Furniture) {
  const def = catalog[object.type]
  if (!Object.hasOwn(catalog, object.type)) return []
  return footprint(object, Array.from({ length: def.width * def.height }, (_, i) => ({
    x: i % def.width, y: Math.floor(i / def.width),
  })))
}

export function usage(level: Level, object: Furniture) {
  const def = catalog[object.type]
  const offsets: Point[] = []
  if (def.usage === 'front' || def.usage === 'around') {
    for (let x = 0; x < def.width; x++) offsets.push({ x, y: def.height })
  }
  if (def.usage === 'around') {
    for (let x = 0; x < def.width; x++) offsets.push({ x, y: -1 })
  }
  if (def.usage === 'sides' || def.usage === 'around') {
    for (let y = 0; y < def.height; y++) offsets.push({ x: -1, y }, { x: def.width, y })
  }
  return footprint(object, offsets).map(({ x, y }) => index(level, x, y))
}
