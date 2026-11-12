import type { Board, Level } from '../../packages/domain/model.ts'
import { maskBoard } from '../../packages/domain/shell.ts'
import { boardSchema, isBoard } from '../../packages/domain/schema.ts'
import { teaching } from '../../content/levels.ts'
import { legacyTeaching } from '../../content/legacy-levels.ts'
import { generateDaily, generatorVersions, validDate } from '../../packages/generator/daily.ts'

export interface Save {
  board: Board
  hints: number
  completed?: { at: string; hints: number }
}
export type Saves = Record<string, Save>
const teachingById = new Map([...teaching, ...legacyTeaching].map(({ level }) => [level.id, level]))

export function knownLevel(id: string): Level | undefined {
  const daily = /^daily-(\d{4}-\d{2}-\d{2})-(\d+)$/.exec(id)
  const version = generatorVersions.find(value => value === daily?.[2])
  if (daily && version && validDate(daily[1])) return generateDaily(daily[1], daily[1], undefined, version).level
  return teachingById.get(id)
}

export function readArchive(input: unknown): Saves {
  if (!input || typeof input !== 'object' || !('schemaVersion' in input) || input.schemaVersion !== 1 ||
      !('saves' in input) || !input.saves || typeof input.saves !== 'object' || Array.isArray(input.saves)) {
    throw new Error('无法读取此版本的存档。')
  }
  const entries = Object.entries(input.saves)
  if (entries.length > 3660) throw new Error('存档包含过多关卡。')
  return Object.fromEntries(entries.map(([id, save]) => {
    const level = knownLevel(id)
    const parsed = boardSchema.safeParse(save?.board)
    const board = level && parsed.success ? maskBoard(parsed.data, level.usable) : undefined
    if (!level || !save || typeof save !== 'object' || !isBoard(level, board) ||
        ![0, 1, 2, 3].includes(save.hints) || (save.completed !== undefined &&
        (!save.completed || typeof save.completed.at !== 'string' || Number.isNaN(Date.parse(save.completed.at)) ||
          ![0, 1, 2, 3].includes(save.completed.hints)))) {
      throw new Error(`存档中包含无法读取的关卡 ${id}。`)
    }
    return [id, {
      board, hints: save.hints,
      completed: save.completed && { at: save.completed.at, hints: save.completed.hints },
    }]
  }))
}

let connection: Promise<IDBDatabase> | undefined
function database() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('madori-notes', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('progress')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return connection
}

export async function readSaves(): Promise<Saves> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('progress', 'readonly')
    const request = transaction.objectStore('progress').get('archive')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      try { resolve(request.result ? readArchive(request.result) : {}) }
      catch (error) { reject(error) }
    }
  })
}

export async function writeSaves(saves: Saves) {
  const db = await database()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('progress', 'readwrite')
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.objectStore('progress').put({ schemaVersion: 1, saves }, 'archive')
  })
}

export function mergeSaves(existing: Saves, incoming: Saves, preferIncoming: boolean): Saves {
  const merged = { ...existing }
  for (const [id, save] of Object.entries(incoming)) {
    const previous = existing[id]
    if (!previous) { merged[id] = save; continue }
    const completed = [previous.completed, save.completed].filter(value => value !== undefined)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0]
    merged[id] = { ...(preferIncoming ? save : previous), completed }
  }
  return merged
}
