import type { Board } from './model.ts'

export const shellNames = ['整矩形', '缺角', '双退台', '侧凹口', '错层', '梯形退台', '双缺角', '侧翼'] as const
export type Shell = typeof shellNames[number]

export function shellMask(width: number, height: number, shell: Shell, variation = 0) {
  const depth = Math.max(1, (width <= 10 ? 2 : 3) + (variation % 3 === 1 ? 1 : variation % 3 === 2 ? -1 : 0))
  const middle = Math.floor(height / 2) + Math.floor(variation / 3)
  return Array.from({ length: width * height }, (_, i) => {
    const x = i % width
    const y = Math.floor(i / width)
    switch (shell) {
      case '缺角': return !(x < depth && y < depth)
      case '双退台': return !(x >= width - depth && y >= height - depth) &&
        !(x === width - 1 && y >= height - depth - 2)
      case '侧凹口': return !(x >= width - depth && y >= middle && y < middle + 2)
      case '错层': return !(x === 0 && y < middle - 1) && !(x === width - 1 && y > middle + 1)
      case '梯形退台': return !(x < 2 && y === 0) && !(x === 0 && y === 1) &&
        !(x >= width - 2 && y === height - 1) && !(x === width - 1 && y === height - 2)
      case '双缺角': return !(x === 0 && y <= 1) && !(x >= width - depth && y >= height - 2)
      case '侧翼': return !(x === width - 1 && (y < middle - 1 || y > middle + 1)) &&
        !(x === 0 && y >= 2 && y <= height - 3 && (y < middle - 1 || y > middle + 1))
      default: return true
    }
  })
}

export function maskBoard(board: Board, usable: boolean[]): Board {
  return { ...board, roomTypes: board.roomTypes.map((type, i) => usable[i] ? type : null) }
}
