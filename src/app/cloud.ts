import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import type { Save, Saves } from './storage.ts'
import { knownLevel, mergeSaves } from './storage.ts'
import { validate } from '../../packages/domain/validate.ts'

export class CloudError extends Error {
  code: string
  detail?: RemoteSave
  constructor(message: string, code: string, detail?: RemoteSave) {
    super(message)
    this.code = code
    this.detail = detail
  }
}
export type Profile = { id: string; username: string }
export type RemoteSave = Save & { id: string; revision: number }
export type CloudStatus = 'checking' | 'available' | 'unconfigured' | 'offline'

export async function api<T>(path: string, method = 'GET', payload?: object): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/${path}`, {
      method, headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new CloudError('无法连接云服务，草稿仍保存在此设备。', 'NETWORK')
  }
  let data
  try { data = await response.json() }
  catch { throw new CloudError('云服务未配置。', 'CLOUD_UNCONFIGURED') }
  if (!response.ok) throw new CloudError(data.message, data.code, data.detail)
  return data as T
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}
function same(a: Save, b: Save) {
  return a.hints === b.hints && JSON.stringify(canonical(a.board)) === JSON.stringify(canonical(b.board))
}
const asSave = ({ board, hints, completed }: RemoteSave): Save => ({ board, hints, completed })

export function useCloud(ready: boolean, records: { current: Saves }, replace: (records: Saves) => void) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>('checking')
  const [syncStatus, setSyncStatus] = useState('')
  const [conflicts, setConflicts] = useState<Record<string, RemoteSave>>({})
  const remote = useRef<Record<string, RemoteSave>>({})
  const dirty = useRef(new Map<string, Save>())
  const blocked = useRef(new Map<string, RemoteSave>())
  const lock = useRef(false)
  const active = useRef<Profile | null>(null)
  const generation = useRef(0)
  const readyRef = useRef(ready)
  const replaceRef = useRef(replace)
  useLayoutEffect(() => { readyRef.current = ready; replaceRef.current = replace }, [ready, replace])

  function clear() {
    generation.current++
    active.current = null
    remote.current = {}
    dirty.current.clear()
    blocked.current.clear()
    setProfile(null)
    setConflicts({})
  }

  function ingest(account: Profile, rows: RemoteSave[]) {
    const changedAccount = active.current?.id !== account.id
    if (changedAccount) clear()
    active.current = account
    setProfile(account)
    const previous = remote.current
    remote.current = Object.fromEntries(rows.map(row => [row.id, row]))
    const remoteRecords = Object.fromEntries(rows.map(row => [row.id, asSave(row)]))
    const local = records.current
    const merged = mergeSaves(local, remoteRecords, false)
    for (const row of rows) {
      if (!local[row.id] || same(local[row.id], row)) blocked.current.delete(row.id)
      else if (previous[row.id]?.revision !== row.revision) blocked.current.set(row.id, row)
    }
    setConflicts(Object.fromEntries(blocked.current))
    if (JSON.stringify(merged) !== JSON.stringify(local)) replaceRef.current(merged)
    setSyncStatus(blocked.current.size ? '有待处理的草稿冲突' : '云档案已连接')
  }

  async function refresh() {
    const response = await api<{ profile: Profile; progress: RemoteSave[] }>('progress')
    ingest(response.profile, response.progress)
  }

  async function flush() {
    const account = active.current
    if (!account || lock.current) return
    const epoch = generation.current
    lock.current = true
    try {
      for (const [id, save] of dirty.current) {
        if (generation.current !== epoch) break
        if (blocked.current.has(id)) continue
        const previous = remote.current[id]
        const level = save.completed && !previous?.completed ? knownLevel(id) : undefined
        const complete = Boolean(level && validate(level, save.board).complete)
        if (previous && same(save, previous) && !complete) {
          dirty.current.delete(id)
          continue
        }
        try {
          const updated = await api<RemoteSave>('progress', 'PUT', { id, board: save.board, hints: save.hints,
            complete, profileId: account.id, baseRevision: previous?.revision ?? 0 })
          if (generation.current !== epoch) break
          remote.current[id] = updated
          if (dirty.current.get(id) === save) dirty.current.delete(id)
          setSyncStatus(blocked.current.size ? '有待处理的草稿冲突' : '云端草稿已同步')
        } catch (error) {
          if (generation.current !== epoch) break
          if (error instanceof CloudError && error.code === 'REVISION_CONFLICT' && error.detail) {
            blocked.current.set(id, error.detail)
            setConflicts(Object.fromEntries(blocked.current))
            setSyncStatus('有待处理的草稿冲突')
            continue
          }
          if (error instanceof CloudError && error.code === 'SIGN_IN_REQUIRED') {
            clear()
            setSyncStatus('会话已失效，请用恢复码重新登录')
          } else setSyncStatus('同步未完成，联网后重试')
          break
        }
      }
    } finally {
      lock.current = false
    }
  }

  const flushFromEffect = useEffectEvent(flush)
  const refreshFromEffect = useEffectEvent(refresh)
  useEffect(() => {
    if (!ready) return
    let live = true
    async function probe() {
      try {
        const { cloud } = await api<{ cloud: boolean }>('health')
        if (!live) return
        setCloudStatus(cloud ? 'available' : 'unconfigured')
        if (cloud && !active.current) await refreshFromEffect().catch(() => {})
      } catch (error) {
        if (live) setCloudStatus(error instanceof CloudError && error.code === 'CLOUD_UNCONFIGURED' ? 'unconfigured' : 'offline')
      }
    }
    void probe()
    const online = () => { void probe(); void flushFromEffect() }
    const timer = window.setInterval(() => void flushFromEffect(), 30_000)
    window.addEventListener('online', online)
    return () => { live = false; window.clearInterval(timer); window.removeEventListener('online', online) }
  }, [ready])

  return {
    profile, cloudStatus, syncStatus, conflicts,
    async signIn(username: string, recoveryCode?: string) {
      const response = await api<{ profile: Profile; recoveryCode?: string }>(recoveryCode === undefined ? 'profile/create' : 'profile/restore',
        'POST', { username, recoveryCode })
      try { await refresh() }
      catch {
        active.current = response.profile
        setProfile(response.profile)
        setSyncStatus('已登录，读取云端草稿失败，请重新同步')
      }
      return response.recoveryCode
    },
    async rotate() { return (await api<{ recoveryCode: string }>('profile/rotate', 'POST', {})).recoveryCode },
    async signOut() {
      await api('profile/logout', 'POST', {})
      clear()
      setSyncStatus('')
    },
    changed(id: string, save: Save, completed: boolean) {
      if (!active.current) return
      dirty.current.set(id, save)
      setSyncStatus('等待同步')
      if (completed) void flush()
    },
    async syncAll() {
      if (!readyRef.current) return
      await refresh()
      for (const [id, save] of Object.entries(records.current)) dirty.current.set(id, save)
      await flush()
      if (!dirty.current.size && !blocked.current.size) setSyncStatus('云端草稿已同步')
    },
    resolve(id: string, keepLocal: boolean) {
      const cloud = blocked.current.get(id)
      if (!cloud) return
      remote.current[id] = cloud
      blocked.current.delete(id)
      setConflicts(Object.fromEntries(blocked.current))
      if (keepLocal) {
        dirty.current.set(id, records.current[id])
        void flush()
      } else {
        dirty.current.delete(id)
        replaceRef.current(mergeSaves(records.current, { [id]: asSave(cloud) }, true))
        setSyncStatus(blocked.current.size ? '有待处理的草稿冲突' : '已采用云端草稿')
      }
    },
  }
}
