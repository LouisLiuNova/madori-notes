import { z } from 'zod/mini'
import { directions, rooms } from './model.ts'
import type { Board, Level } from './model.ts'

const edge = z.templateLiteral([z.enum(['H', 'V']), ':', z.number(), ':', z.number()]).check(z.regex(/^[HV]:\d{1,2}:\d{1,2}$/))
const room = z.enum(Object.keys(rooms) as (keyof typeof rooms)[])
const direction = z.enum(directions)
const identifier = z.string().check(z.minLength(1), z.maxLength(80))
const bit = z.union([z.literal(0), z.literal(1)])
const boundedArray = <T extends z.ZodMiniType>(item: T, max: number) => z.array(item).check(z.maxLength(max))
export const openingSchema = z.discriminatedUnion('kind', [
  z.object({ edge, kind: z.literal('window') }),
  z.object({ edge, kind: z.literal('swing'), side: bit, hinge: bit }),
  z.object({ edge, kind: z.literal('sliding'), pocket: z.union([z.literal(-1), z.literal(1)]) }),
])

export const boardSchema = z.object({
  roomTypes: boundedArray(z.nullable(room), 256),
  openEdges: boundedArray(edge, 544),
  openings: boundedArray(openingSchema, 544),
  furniture: boundedArray(z.object({
    id: identifier, type: identifier, x: z.int(), y: z.int(), rotation: direction,
  }), 512),
})

export function isBoard(level: Level, value: unknown): value is Board {
  const parsed = boardSchema.safeParse(value)
  return parsed.success && parsed.data.roomTypes.length === level.usable.length &&
    parsed.data.roomTypes.every((type, i) => type === null || (level.usable[i] && level.roomTypes.includes(type)))
}

const minimum = z.int().check(z.minimum(1), z.maximum(256))
const predicate = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('area'), min: minimum }),
  z.object({ kind: z.literal('window') }),
  z.object({ kind: z.literal('wifi') }),
  z.object({ kind: z.literal('router') }),
  z.object({ kind: z.literal('noRouter') }),
])
const label = z.string()
const openingKind = z.enum(['swing', 'sliding', 'window'])
const constraint = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rooms'), label, type: room, min: minimum }),
  z.object({ kind: z.literal('slots'), label, type: room, slots: boundedArray(boundedArray(predicate, 8), 32) }),
  z.object({ kind: z.literal('roomRule'), label, type: room, predicates: boundedArray(predicate, 8), min: z.optional(minimum) }),
  z.object({ kind: z.literal('relation'), label, types: z.tuple([room, room]), mode: z.enum(['adjacent', 'separate', 'open', 'door', 'wall']) }),
  z.object({ kind: z.literal('opening'), label, type: openingKind, min: minimum, exterior: z.optional(z.boolean()), player: z.optional(z.boolean()) }),
  z.object({ kind: z.literal('furniture'), label, type: identifier, min: minimum }),
  z.object({ kind: z.literal('furnitureRule'), label, type: identifier, rule: z.enum(['direction', 'wall', 'window', 'headWall', 'headNoWindow', 'footNoDoor', 'privacy']), direction: z.optional(direction) }),
  z.object({ kind: z.literal('noFacing'), label }),
])

export const dateSchema = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/))
const dimension = z.int().check(z.minimum(8), z.maximum(16))
export const levelSchema = z.object({
  id: identifier, title: label, brief: label, tip: label,
  schemaVersion: z.int(), rulesVersion: identifier, catalogVersion: identifier,
  width: dimension, height: dimension, usable: boundedArray(z.boolean(), 256),
  entrance: edge, bearing: boundedArray(edge, 544), fixed: boundedArray(openingSchema, 544),
  roomTypes: boundedArray(room, 8), furnitureTypes: boundedArray(identifier, 64),
  openingTypes: boundedArray(openingKind, 3), initial: boardSchema, constraints: boundedArray(constraint, 64),
  date: z.optional(dateSchema), difficulty: z.optional(z.enum(['入门', '标准', '进阶'])),
  seed: z.optional(identifier), generatorVersion: z.optional(identifier),
})
