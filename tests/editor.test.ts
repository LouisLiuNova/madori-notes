import { describe, expect, it } from 'vitest'
import { teaching } from '../content/levels.ts'
import type { Board, Furniture } from '../packages/domain/model.ts'
import { edit, keyboardHit, rotateFurniture } from '../src/app/editor.ts'
import type { Selection } from '../src/app/editor.ts'

const level = teaching[12].level
const cell = level.usable.findIndex((usable, index) => usable && level.usable[index + 1])
const start = keyboardHit(level, cell, 0)
const target = keyboardHit(level, cell + 1, 0)
const sofa: Furniture = { id: 'sofa', type: 'sofa', x: cell % level.width, y: Math.floor(cell / level.width), rotation: 'S' }
const rug: Furniture = { ...sofa, id: 'rug', type: 'rug', rotation: 'N' }
const selection: Selection = { tool: 'move', room: 'living', furniture: 'sofa', rotation: 'N', side: 0, mirror: false, eraseScope: 'all' }

describe('重叠物件编辑', () => {
  it.each([[sofa, rug], [rug, sofa]])('按可见层级移动和移除，也可选择底层', (first, second) => {
    const board: Board = { ...level.initial, openings: [], furniture: [first, second] }
    expect(edit(level, board, start, { ...selection, tool: 'remove' }, start).furniture).toEqual([rug])
    expect(edit(level, board, start, { ...selection, tool: 'remove', targetOffset: 1 }, start).furniture).toEqual([sofa])
    const moved = edit(level, board, target, selection, start)
    expect(moved.furniture).toContainEqual({ ...sofa, x: sofa.x + 1 })
    expect(moved.furniture).toContain(rug)
    expect(rotateFurniture(board, sofa).furniture).toContainEqual({ ...sofa, rotation: 'W' })
    expect(board.furniture).toEqual([first, second])
  })

  it('只在靠近墙段时以门窗为指针移除目标', () => {
    const opening = { kind: 'window', edge: start.edge } as const
    const board: Board = { ...level.initial, openings: [opening], furniture: [sofa] }
    const remove = { ...selection, tool: 'remove' } as const
    expect(edit(level, board, { ...start, nearEdge: false }, remove, start).openings).toEqual([opening])
    expect(edit(level, board, { ...start, nearEdge: true }, remove, start).furniture).toEqual([sofa])
  })
})
