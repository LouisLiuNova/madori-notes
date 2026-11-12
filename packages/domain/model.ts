export const versions = { schemaVersion: 1, rulesVersion: '1', catalogVersion: '1' } as const

export const rooms = {
  living: '客厅', bedroom: '卧室', dining: '餐厅', kitchen: '厨房',
  bath: '卫生间', study: '书房', balcony: '阳台', hall: '走廊',
} as const
export type RoomType = keyof typeof rooms
export const directions = ['N', 'E', 'S', 'W'] as const
export type Direction = typeof directions[number]
export type Edge = `${'H' | 'V'}:${number}:${number}`
export type Point = { x: number; y: number }
export type Opening =
  | { edge: Edge; kind: 'window' }
  | { edge: Edge; kind: 'swing'; side: 0 | 1; hinge: 0 | 1 }
  | { edge: Edge; kind: 'sliding'; pocket: -1 | 1 }

export interface Furniture {
  id: string
  type: string
  x: number
  y: number
  rotation: Direction
}

export interface Board {
  roomTypes: (RoomType | null)[]
  openEdges: Edge[]
  openings: Opening[]
  furniture: Furniture[]
}

export type RoomPredicate =
  | { kind: 'area'; min: number }
  | { kind: 'window' | 'wifi' | 'router' | 'noRouter' }

export type Constraint = { label: string } & (
  | { kind: 'rooms'; type: RoomType; min: number }
  | { kind: 'slots'; type: RoomType; slots: RoomPredicate[][] }
  | { kind: 'roomRule'; type: RoomType; predicates: RoomPredicate[]; min?: number }
  | { kind: 'relation'; types: [RoomType, RoomType]; mode: 'adjacent' | 'separate' | 'open' | 'door' | 'wall' }
  | { kind: 'opening'; type: Opening['kind']; min: number; exterior?: boolean; player?: boolean }
  | { kind: 'furniture'; type: string; min: number; room?: RoomType }
  | { kind: 'furnitureRule'; type: string; rule: 'direction' | 'wall' | 'window' | 'headWall' | 'headNoWindow' | 'footNoDoor' | 'privacy'; direction?: Direction }
  | { kind: 'noFacing' }
)

export interface Level {
  id: string
  title: string
  brief: string
  tip: string
  schemaVersion: number
  rulesVersion: string
  catalogVersion: string
  width: number
  height: number
  usable: boolean[]
  entrance: Edge
  bearing: Edge[]
  fixed: Opening[]
  roomTypes: RoomType[]
  furnitureTypes: string[]
  openingTypes: Opening['kind'][]
  initial: Board
  constraints: Constraint[]
  date?: string
  difficulty?: '入门' | '标准' | '进阶'
  seed?: string
  generatorVersion?: string
}

export interface Result {
  id: string
  status: 'pending' | 'satisfied' | 'conflict'
  message: string
  cells: number[]
  edges: Edge[]
  objects: string[]
}

export const blank = (size: number): Board => ({
  roomTypes: Array<null>(size).fill(null), openEdges: [], openings: [], furniture: [],
})
