import { describe, expect, it } from 'vitest'
import { teaching } from '../content/levels.ts'
import { mergeSaves, readArchive } from '../src/app/storage.ts'

describe('本地存档', () => {
  it('版本和字段异常保留原存档，合并保留首次完成', () => {
    const { level, reference } = structuredClone(teaching[0])
    const first = { board: reference, hints: 1, completed: { at: '2026-11-01T00:00:00.000Z', hints: 1 } }
    const replay = { board: level.initial, hints: 2, completed: { at: '2026-11-02T00:00:00.000Z', hints: 2 } }
    const existing = { [level.id]: first }
    const loaded = readArchive({ schemaVersion: 1, saves: { [level.id]: replay } })
    expect(mergeSaves(existing, loaded, true)[level.id]).toEqual({ ...replay, completed: first.completed })
    expect(() => readArchive({ schemaVersion: 2, saves: existing })).toThrow()
    expect(() => readArchive({ schemaVersion: 1, saves: { [level.id]: { ...replay, board: {} } } })).toThrow()
    expect(existing[level.id]).toEqual(first)
  })
})
