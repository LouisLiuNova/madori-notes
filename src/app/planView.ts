export const layers = ['分区', '结构', '动线', '视线', 'Wi-Fi'] as const
export type Layer = typeof layers[number]
export interface View { zoom: number; x: number; y: number }
export const centered: View = { zoom: 1, x: 0, y: 0 }

export function clampView(view: View, width: number, height: number): View {
  const maxX = width * (1 - 1 / view.zoom) / 2
  const maxY = height * (1 - 1 / view.zoom) / 2
  return { ...view, x: Math.max(-maxX, Math.min(maxX, view.x)), y: Math.max(-maxY, Math.min(maxY, view.y)) }
}
