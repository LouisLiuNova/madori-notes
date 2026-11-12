export const layers = ['分区', '结构', '动线', '视线', 'Wi-Fi'] as const
export type Layer = typeof layers[number]
export interface View { zoom: number; x: number; y: number }
export const centered: View = { zoom: 1, x: 0, y: 0 }
