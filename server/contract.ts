import { z } from 'zod/mini'
import { boardSchema, dateSchema, levelSchema } from '../packages/domain/schema.ts'

const identifier = z.string().check(z.minLength(1), z.maxLength(80))
const username = z.string().check(z.maxLength(100))
const recoveryCode = z.string().check(z.maxLength(100))
const revision = z.int().check(z.minimum(0), z.maximum(2147483646))
const hints = z.int().check(z.minimum(0), z.maximum(3))
const profile = z.object({ id: z.uuid(), username })
const completed = z.object({ at: z.iso.datetime(), hints })
const progress = z.object({ id: identifier, board: boardSchema, hints, revision, completed: z.optional(completed) })
const progressInput = { id: identifier, board: boardSchema, hints, baseRevision: revision }
const empty = z.object({})

export const contract = {
  'GET /api/health': { label: '健康状态', response: z.object({ status: z.literal('ok'), cloud: z.boolean() }) },
  'POST /api/profile/create': { label: '创建云档案', input: z.object({ username }), response: z.object({ profile, recoveryCode }), status: 201 },
  'POST /api/profile/restore': { label: '恢复云档案', input: z.object({ username, recoveryCode }), response: z.object({ profile }) },
  'POST /api/profile/rotate': { label: '更换恢复码', input: empty, response: z.object({ recoveryCode }), private: true },
  'POST /api/profile/logout': { label: '注销会话', input: empty, response: z.object({ signedOut: z.literal(true) }), private: true },
  'GET /api/progress': { label: '读取云进度', response: z.object({ profile, progress: z.array(progress) }), private: true },
  'PUT /api/progress': { label: '更新云进度', input: z.object({ ...progressInput, profileId: z.uuid(), complete: z.optional(z.boolean()) }), response: progress, private: true },
  'GET /api/daily': { label: '读取每日挑战题面', response: z.object({ level: levelSchema }), query: { date: dateSchema } },
  'POST /api/daily/solution': { label: '读取一份合法参考图', input: z.object({ id: identifier }), response: z.object({ board: boardSchema }) },
  'POST /api/daily/complete': { label: '校验日题并在登录时记录完成', input: z.object({
    id: identifier, date: dateSchema, board: boardSchema, hints: z.optional(hints), baseRevision: z.optional(revision),
  }), response: z.union([z.object({ complete: z.literal(true) }), progress]) },
  'GET /api/cron/daily': { label: '补齐七天库存并清理历史计数', response: z.object({ dates: z.array(dateSchema) }), cron: true },
} as const

export const errorSchema = z.object({ code: z.string(), message: z.string(), detail: z.optional(progress) })
