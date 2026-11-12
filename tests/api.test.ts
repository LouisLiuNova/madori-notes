import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { teaching } from '../content/levels.ts'
import { dateInSingapore } from '../packages/generator/daily.ts'
import { contract } from '../server/contract.ts'

const endpoint = process.env.MADORI_API_TEST_URL
const origin = endpoint ? new URL(endpoint).origin : ''
const lesson = teaching[0]

async function request(method: string, path: string, payload?: object, cookie?: string, extra: Record<string, string> = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { ...(payload ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra },
    body: payload && JSON.stringify(payload),
  })
  return { status: response.status, headers: response.headers, data: await response.json() }
}

describe.skipIf(!endpoint)('PostgreSQL API 实例', () => {
  it('并发发布同一题，题面不含见证，匿名完成使用正式规则', async () => {
    const [a, b, c] = await Promise.all(Array.from({ length: 3 }, () => request('GET', '/api/daily')))
    expect(a.status).toBe(200)
    expect(a.data).toEqual(b.data)
    expect(a.data).toEqual(c.data)
    expect(contract['GET /api/daily'].response.safeParse(a.data).success).toBe(true)
    expect(Object.keys(a.data)).toEqual(['level'])
    const id = a.data.level.id
    const date = a.data.level.date
    expect(date).toBe(dateInSingapore())
    const solution = await request('POST', '/api/daily/solution', { id })
    expect(solution.status).toBe(200)
    expect(solution.headers.get('cache-control')).toBe('no-store')
    const fail = await request('POST', '/api/daily/complete', { id, date, board: a.data.level.initial })
    expect(fail.status).toBe(422)
    const pass = await request('POST', '/api/daily/complete', { id, date, board: solution.data.board })
    expect(pass.data).toEqual({ complete: true })
  })

  it('创建、恢复、校验会话归属、并发写入、首次完成和轮换恢复码', async () => {
    const username = `mvp-${randomUUID().slice(0, 12)}`
    const crossOrigin = await request('POST', '/api/profile/create', { username }, undefined, { Origin: 'http://127.0.0.1:1' })
    expect(crossOrigin.status).toBe(403)
    const created = await request('POST', '/api/profile/create', { username })
    expect(created.status).toBe(201)
    expect(contract['POST /api/profile/create'].response.safeParse(created.data).success).toBe(true)
    expect(created.headers.get('cache-control')).toBe('no-store')
    const cookie = created.headers.get('set-cookie')!
    expect(cookie.includes('HttpOnly')).toBe(true)
    const profileId = created.data.profile.id
    const oldCode = created.data.recoveryCode
    const restored = await request('POST', '/api/profile/restore', { username: username.toUpperCase(), recoveryCode: oldCode })
    expect(restored.status).toBe(200)
    const secondCookie = restored.headers.get('set-cookie')!
    const { level, reference } = lesson
    const initial = { id: level.id, board: level.initial, hints: 0, baseRevision: 0, profileId }
    expect((await request('PUT', '/api/progress', { ...initial, profileId: randomUUID() }, cookie)).status).toBe(401)
    expect((await request('PUT', '/api/progress', { ...initial, complete: true }, cookie)).status).toBe(422)
    const writes = await Promise.all([request('PUT', '/api/progress', initial, cookie), request('PUT', '/api/progress', initial, secondCookie)])
    expect(writes.map(item => item.status).sort()).toEqual([200, 409])
    expect(writes.find(item => item.status === 409)?.data.detail.revision).toBe(1)
    const completed = await request('PUT', '/api/progress', { ...initial, board: reference, baseRevision: 1, complete: true, hints: 2 }, cookie)
    expect(completed.status).toBe(200)
    expect(contract['PUT /api/progress'].response.safeParse(completed.data).success).toBe(true)
    const replay = await request('PUT', '/api/progress', { ...initial, baseRevision: 2, hints: 0 }, secondCookie)
    expect(replay.data.completed).toEqual(completed.data.completed)
    const rotated = await request('POST', '/api/profile/rotate', {}, cookie)
    expect(rotated.status).toBe(200)
    expect(rotated.data.recoveryCode !== oldCode).toBe(true)
    expect((await request('GET', '/api/progress', undefined, secondCookie)).status).toBe(401)
    expect((await request('POST', '/api/profile/restore', { username, recoveryCode: oldCode })).status).toBe(401)
    expect((await request('POST', '/api/profile/restore', { username, recoveryCode: rotated.data.recoveryCode })).status).toBe(200)
    expect((await request('POST', '/api/profile/logout', {}, cookie)).status).toBe(200)
    expect((await request('GET', '/api/progress', undefined, cookie)).status).toBe(401)
  })

  it('补足七天库存，同日重复调度保持发布结果', async () => {
    const secret = process.env.CRON_SECRET
    if (!secret) throw new Error('本地 API 验收需要独立的 CRON_SECRET。')
    const path = '/api/cron/daily'
    expect((await request('GET', path)).status).toBe(401)
    const headers = { Authorization: `Bearer ${secret}` }
    const first = await request('GET', path, undefined, undefined, headers)
    const second = await request('GET', path, undefined, undefined, headers)
    expect(first.status).toBe(200)
    expect(first.data.dates).toHaveLength(7)
    expect(first.data).toEqual(second.data)
  })
})
