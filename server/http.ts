import type { IncomingMessage, ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { dateInSingapore, validDate } from '../packages/generator/daily.ts'
import { ApiError, createService } from './service.ts'
import { contract } from './contract.ts'

type Req = IncomingMessage & { body?: unknown }
const cookieName = 'madori_session'
const error = (status: number, code: string, message: string) => new ApiError(status, code, message)

async function bodyOf(req: Req): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw error(415, 'JSON_REQUIRED', '请求需要 JSON 内容。')
  if (Number(req.headers['content-length']) > 180_000) throw error(413, 'PAYLOAD_TOO_LARGE', '请求内容过大。')
  let payload: unknown = req.body
  try {
    if (payload === undefined) {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk)
        size += buffer.length
        if (size > 180_000) throw error(413, 'PAYLOAD_TOO_LARGE', '请求内容过大。')
        chunks.push(buffer)
      }
      payload = Buffer.concat(chunks).toString()
    }
    if (typeof payload === 'string') payload = JSON.parse(payload)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error()
    return payload as Record<string, unknown>
  } catch (cause) {
    if (cause instanceof ApiError) throw cause
    throw error(400, 'JSON_INVALID', '无法读取请求内容。')
  }
}

export function createHandler(env: NodeJS.ProcessEnv, local = false) {
  const configured = Boolean(env.DATABASE_URL && (env.RECOVERY_CODE_SECRET?.length ?? 0) >= 32)
  const service = configured ? createService(env.DATABASE_URL!, env.RECOVERY_CODE_SECRET!) : undefined
  function reply(res: ServerResponse, status: number, payload: unknown) {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
  }
  function sessionCookie(res: ServerResponse, value: string, age = 2_592_000) {
    res.setHeader('Set-Cookie', `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${local ? '' : '; Secure'}`)
  }
  const denied = () => error(401, 'SIGN_IN_REQUIRED', '请先登录云档案。')

  return async (req: Req, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const path = url.pathname
      const method = req.method
      if (method === 'GET' && path === '/api/health') {
        if (service) await service.health()
        return reply(res, 200, { status: 'ok', cloud: Boolean(service) })
      }
      if (!service) throw error(503, 'CLOUD_UNCONFIGURED', '云服务未配置，本地存档可继续使用。')
      if (method === 'GET' && path === '/api/cron/daily') {
        const expected = Buffer.from(`Bearer ${env.CRON_SECRET ?? ''}`)
        const received = Buffer.from(req.headers.authorization ?? '')
        if (!env.CRON_SECRET || received.length !== expected.length || !timingSafeEqual(received, expected)) throw denied()
        return reply(res, 200, { dates: await service.replenish() })
      }
      const session = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
      const forwardedIp = req.headers['x-vercel-forwarded-for']
      const ip = !local && typeof forwardedIp === 'string' ? forwardedIp.split(',')[0] : req.socket.remoteAddress ?? 'unknown'
      if (method === 'GET' && path === '/api/daily') {
        const explicit = url.searchParams.get('date')
        const date = explicit ?? dateInSingapore()
        if (!validDate(date) || date > dateInSingapore()) throw error(400, 'DATE_INVALID', '该日期的挑战尚不可读取。')
        await service.limitDaily(ip)
        const { level } = await service.daily(date)
        res.setHeader('Cache-Control', explicit ? 'public, max-age=300, s-maxage=86400' : 'public, max-age=0, must-revalidate')
        return reply(res, 200, { level })
      }
      if (method === 'GET' && path === '/api/progress') {
        const profile = await service.authenticate(session)
        if (!profile) throw denied()
        return reply(res, 200, { profile, progress: await service.progress(profile) })
      }
      if (method !== 'POST' && method !== 'PUT') throw error(404, 'NOT_FOUND', '接口不存在。')
      const origin = env.APP_ORIGIN ?? `${local ? 'http' : 'https'}://${req.headers.host ?? ''}`
      if (req.headers.origin !== origin) throw error(403, 'ORIGIN_INVALID', '请求来源与当前应用不一致。')
      const route = contract[`${method} ${path}` as keyof typeof contract]
      if (!route || !('input' in route)) throw error(404, 'NOT_FOUND', '接口不存在。')
      const parsed = route.input.safeParse(await bodyOf(req))
      if (!parsed.success) throw error(400, 'REQUEST_INVALID', '请求字段格式无效。')
      const payload = parsed.data as Record<string, unknown>
      if (method === 'POST' && path === '/api/profile/create') {
        const { profile, recoveryCode, session } = await service.create(payload.username, ip)
        sessionCookie(res, session)
        return reply(res, 201, { profile, recoveryCode })
      }
      if (method === 'POST' && path === '/api/profile/restore') {
        const { profile, session } = await service.restore(payload.username, payload.recoveryCode, ip)
        sessionCookie(res, session)
        return reply(res, 200, { profile })
      }
      if (method === 'POST' && path === '/api/profile/logout') {
        await service.logout(session)
        sessionCookie(res, '', 0)
        return reply(res, 200, { signedOut: true })
      }
      if (method === 'POST' && path === '/api/daily/solution') {
        const date = typeof payload.id === 'string' ? /^daily-(\d{4}-\d{2}-\d{2})-\d+$/.exec(payload.id)?.[1] : undefined
        if (!date || date > dateInSingapore()) throw error(400, 'DATE_INVALID', '该日期的挑战尚不可读取。')
        const daily = await service.daily(date)
        if (daily.level.id !== payload.id) throw error(404, 'LEVEL_UNKNOWN', '找不到此版本的关卡。')
        return reply(res, 200, { board: daily.witnesses[0] })
      }
      const profile = await service.authenticate(session)
      if (method === 'POST' && path === '/api/daily/complete') return reply(res, 200, await service.completeDaily(payload, profile))
      if (!profile) throw denied()
      if (method === 'POST' && path === '/api/profile/rotate') {
        return reply(res, 200, { recoveryCode: await service.rotate(profile, session!) })
      }
      if (method === 'PUT' && path === '/api/progress') {
        if (payload.profileId !== profile.id) throw denied()
        return reply(res, 200, await service.save(profile, payload))
      }
      throw error(404, 'NOT_FOUND', '接口不存在。')
    } catch (cause) {
      if (cause instanceof ApiError) return reply(res, cause.status, { code: cause.code, message: cause.message, detail: cause.detail })
      return reply(res, 503, { code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后再试。' })
    }
  }
}
