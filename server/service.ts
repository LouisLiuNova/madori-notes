import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import postgres from 'postgres'
import { legacyTeaching } from '../content/legacy-levels.ts'
import { teaching } from '../content/levels.ts'
import type { Board, Level } from '../packages/domain/model.ts'
import { isBoard } from '../packages/domain/schema.ts'
import { validate } from '../packages/domain/validate.ts'
import { dateInSingapore, generateDaily, validDate } from '../packages/generator/daily.ts'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail?: unknown
  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

type Profile = { id: string; username: string }
type ProgressRow = {
  level_id: string; board: Board; hints: number; revision: number; completed_at: Date | null; completed_hints: number | null
}
type Published = { level: Level; witnesses: Board[] }
const lessonById = new Map([...teaching, ...legacyTeaching].map(({ level }) => [level.id, level]))
const notSignedIn = () => new ApiError(401, 'SIGN_IN_REQUIRED', '请先登录云档案。')
const token = () => randomBytes(24).toString('base64url')
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as postgres.JSONValue
const asProgress = (row: ProgressRow) => ({
  id: row.level_id, revision: row.revision, board: row.board, hints: row.hints,
  completed: row.completed_at ? { at: row.completed_at.toISOString(), hints: row.completed_hints } : undefined,
})

function usernameOf(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 100) throw new ApiError(400, 'USERNAME_INVALID', '用户名需为 2–24 个字母、数字、下划线或连字符。')
  const username = raw.normalize('NFKC').trim()
  if (!/^[\p{L}\p{N}_-]{2,24}$/u.test(username)) throw new ApiError(400, 'USERNAME_INVALID', '用户名需为 2–24 个字母、数字、下划线或连字符。')
  const key = username.replace(/[A-Z]/g, letter => letter.toLowerCase())
  return { username, key }
}

export function createService(url: string, secret: string) {
  const sql = postgres(url, { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 8, onnotice: () => {} })
  const digest = (value: string) => createHmac('sha256', secret).update(value).digest('hex')
  const recoveryDigest = (code: string) => digest(`recovery:${code}`)
  const rateDigest = (value: string) => digest(`rate:${value}`)

  async function rateLimit(bucket: string, max: number) {
    const window = Math.floor(Date.now() / 900_000)
    const [entry] = await sql<{ hits: number }[]>`
      INSERT INTO rate_windows (bucket, window_start, hits) VALUES (${rateDigest(bucket)}, ${window}, 1)
      ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_windows.hits + 1
      RETURNING hits
    `
    if (entry.hits > max) throw new ApiError(429, 'RATE_LIMITED', '操作过于频繁，请稍后再试。')
  }

  async function authenticate(session?: string) {
    if (!session || !/^[A-Za-z0-9_-]{32}$/.test(session)) return null
    const [profile] = await sql<Profile[]>`
      SELECT profiles.id, profiles.username FROM sessions JOIN profiles ON profiles.id = sessions.profile_id
      WHERE sessions.digest = ${hash(session)} AND sessions.expires_at > now()
    `
    return profile ?? null
  }

  async function daily(date: string): Promise<Published> {
    if (!validDate(date) || date < '2020-01-01' || date > dateInSingapore(new Date(Date.now() + 7 * 86400_000))) {
      throw new ApiError(400, 'DATE_INVALID', '日期不在可用范围内。')
    }
    const [existing] = await sql<Published[]>`SELECT level, witnesses FROM daily_challenges WHERE challenge_date = ${date}`
    if (existing) return existing
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`madori-daily:${date}`}))`
      const [winner] = await tx<Published[]>`SELECT level, witnesses FROM daily_challenges WHERE challenge_date = ${date}`
      if (winner) return winner
      const start = performance.now()
      const generated = generateDaily(date)
      const { level, witnesses, quality } = generated
      await tx`INSERT INTO daily_challenges (challenge_date, seed, level, witnesses)
        VALUES (${date}, ${level.seed ?? date}, ${tx.json(asJson(level))}, ${tx.json(asJson(witnesses))})`
      await tx`INSERT INTO generation_reports (challenge_date, quality, elapsed_ms)
        VALUES (${date}, ${tx.json(asJson({ ...quality, witnessKeys: quality.witnessKeys.map(hash) }))}, ${Math.round(performance.now() - start)})`
      return { level, witnesses }
    })
  }

  async function levelFor(id: unknown) {
    if (typeof id !== 'string') throw new ApiError(400, 'LEVEL_INVALID', '关卡编号无效。')
    const lesson = lessonById.get(id)
    if (lesson) return lesson
    const match = /^daily-(\d{4}-\d{2}-\d{2})-\d+$/.exec(id)
    if (match) {
      const published = await daily(match[1])
      if (published.level.id === id) return published.level
    }
    throw new ApiError(404, 'LEVEL_UNKNOWN', '找不到此版本的关卡。')
  }

  async function update(profile: Profile, level: Level, input: Record<string, unknown>, complete: boolean) {
    const { board, hints, baseRevision } = input
    if (!isBoard(level, board) || typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) ||
        baseRevision < 0 || baseRevision >= 2147483647 || typeof hints !== 'number' || ![0, 1, 2, 3].includes(hints)) {
      throw new ApiError(400, 'PROGRESS_INVALID', '存档格式或版本无效。')
    }
    if (complete && !validate(level, board).complete) throw new ApiError(422, 'BOARD_INCOMPLETE', '图纸尚未满足全部条件。')
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`madori-progress:${profile.id}:${level.id}`}))`
      const [old] = await tx<ProgressRow[]>`SELECT * FROM progress WHERE profile_id = ${profile.id} AND level_id = ${level.id}`
      if ((old?.revision ?? 0) !== baseRevision) {
        throw new ApiError(409, 'REVISION_CONFLICT', '此关卡已有其他设备的更新。', old && asProgress(old))
      }
      const completedAt = old?.completed_at ?? (complete ? new Date() : null)
      const completedHints = old?.completed_hints ?? (complete ? hints : null)
      const [row] = await tx<ProgressRow[]>`
        INSERT INTO progress (profile_id, level_id, board, hints, revision, completed_at, completed_hints)
        VALUES (${profile.id}, ${level.id}, ${tx.json(asJson(board))}, ${hints}, ${baseRevision + 1}, ${completedAt}, ${completedHints})
        ON CONFLICT (profile_id, level_id) DO UPDATE SET board = EXCLUDED.board, hints = EXCLUDED.hints,
          revision = EXCLUDED.revision, completed_at = EXCLUDED.completed_at,
          completed_hints = EXCLUDED.completed_hints, updated_at = now()
        RETURNING *
      `
      return asProgress(row)
    })
  }

  return {
    async health() { await sql`SELECT 1 FROM daily_challenges LIMIT 1` },
    async close() { await sql.end() },
    async limitDaily(ip: string) { await rateLimit(`daily:${ip}`, 120) },
    async create(raw: unknown, ip: string) {
      await rateLimit(`create:${ip}`, 12)
      const { key, username } = usernameOf(raw)
      const recoveryCode = token()
      const session = token()
      const profile = { id: randomUUID(), username }
      await sql.begin(async tx => {
        const inserted = await tx`INSERT INTO profiles (id, username_key, username, recovery_digest)
          VALUES (${profile.id}, ${key}, ${username}, ${recoveryDigest(recoveryCode)}) ON CONFLICT DO NOTHING RETURNING id`
        if (!inserted.length) throw new ApiError(409, 'USERNAME_TAKEN', '该用户名已被使用。')
        await tx`INSERT INTO sessions (digest, profile_id, expires_at) VALUES
          (${hash(session)}, ${profile.id}, now() + interval '30 days')`
      })
      return { profile, recoveryCode, session }
    },
    async restore(raw: unknown, code: unknown, ip: string) {
      await rateLimit(`restore-ip:${ip}`, 30)
      const { key } = usernameOf(raw)
      await rateLimit(`restore-user:${key}`, 8)
      const [row] = await sql<(Profile & { recovery_digest: string })[]>`
        SELECT id, username, recovery_digest FROM profiles WHERE username_key = ${key}
      `
      const supplied = recoveryDigest(typeof code === 'string' ? code.slice(0, 100) : '')
      const match = timingSafeEqual(Buffer.from(supplied), Buffer.from(row?.recovery_digest ?? recoveryDigest('invalid')))
      if (!row || !match) throw new ApiError(401, 'RECOVERY_INVALID', '用户名或恢复码不正确。')
      const session = token()
      await sql.begin(async tx => {
        const [current] = await tx<{ recovery_digest: string }[]>`
          SELECT recovery_digest FROM profiles WHERE id = ${row.id} FOR UPDATE
        `
        if (!current || current.recovery_digest !== row.recovery_digest) {
          throw new ApiError(401, 'RECOVERY_INVALID', '用户名或恢复码不正确。')
        }
        await tx`INSERT INTO sessions (digest, profile_id, expires_at) VALUES
          (${hash(session)}, ${row.id}, now() + interval '30 days')`
      })
      return { profile: { id: row.id, username: row.username }, session }
    },
    async rotate(profile: Profile, session: string) {
      const recoveryCode = token()
      await sql.begin(async tx => {
        await tx`SELECT id FROM profiles WHERE id = ${profile.id} FOR UPDATE`
        const [current] = await tx`SELECT digest FROM sessions WHERE digest = ${hash(session)}
          AND profile_id = ${profile.id} AND expires_at > now()`
        if (!current) throw notSignedIn()
        await tx`UPDATE profiles SET recovery_digest = ${recoveryDigest(recoveryCode)} WHERE id = ${profile.id}`
        await tx`DELETE FROM sessions WHERE profile_id = ${profile.id} AND digest <> ${hash(session)}`
      })
      return recoveryCode
    },
    async logout(session?: string) { if (session) await sql`DELETE FROM sessions WHERE digest = ${hash(session)}` },
    authenticate,
    async progress(profile: Profile) {
      return (await sql<ProgressRow[]>`SELECT * FROM progress WHERE profile_id = ${profile.id}`).map(asProgress)
    },
    async save(profile: Profile, input: Record<string, unknown>) {
      return update(profile, await levelFor(input.id), input, input.complete === true)
    },
    daily,
    async completeDaily(input: Record<string, unknown>, profile: Profile | null) {
      const level = await levelFor(input.id)
      if (!level.date || input.date !== level.date || !isBoard(level, input.board) || !validate(level, input.board).complete) {
        throw new ApiError(422, 'BOARD_INCOMPLETE', '图纸或挑战日期未通过验证。')
      }
      return profile ? update(profile, level, input, true) : { complete: true }
    },
    async replenish() {
      const now = Date.now()
      const dates = Array.from({ length: 7 }, (_, i) => dateInSingapore(new Date(now + i * 86400_000)))
      for (const date of dates) await daily(date)
      await sql`DELETE FROM generation_reports WHERE created_at < now() - interval '30 days'`
      await sql`DELETE FROM rate_windows WHERE window_start < ${Math.floor(now / 900_000) - 96}`
      await sql`DELETE FROM sessions WHERE expires_at <= now()`
      return dates
    },
  }
}
