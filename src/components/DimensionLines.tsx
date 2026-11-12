import { edgesOf, segment, sides } from '../../packages/domain/geometry.ts'
import type { Level } from '../../packages/domain/model.ts'

const axisLetters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const moduleMm = 1000

export default function DimensionLines({ level }: { level: Level }) {
  const xs = new Set<number>()
  const ys = new Set<number>()
  for (const edge of edgesOf(level)) {
    if (!sides(level, edge).includes(-1)) continue
    const { x, y, horizontal } = segment(edge)
    if (horizontal) ys.add(y)
    else xs.add(x)
  }
  const columns = [...xs].sort((a, b) => a - b)
  const rows = [...ys].sort((a, b) => a - b)
  const bottom = level.height

  function chain(values: number[], y: number, outside: number, axis: boolean) {
    const last = values.at(-1) ?? 0
    const first = values[0] ?? 0
    return <>
      <line x1={first - .06} y1={y} x2={last + .06} y2={y} />
      {values.map((value, i) => <g key={value}>
        <line x1={value} y1={outside} x2={value} y2={y + .11} />
        <line className="dimension-tick" x1={value - .065} y1={y + .065} x2={value + .065} y2={y - .065} />
        {i > 0 && <text x={(values[i - 1] + value) / 2} y={y - .09}>{(value - values[i - 1]) * moduleMm}</text>}
        {axis && <g className="axis-bubble" transform={`translate(${value} ${y + .31})`}>
          <circle r=".12" /><text y=".047">{i + 1}</text>
        </g>}
      </g>)}
    </>
  }

  return <g className="dimensions" role="img" aria-label="轴线编号及毫米尺寸链，图示一格为一千毫米">
    {chain(columns, bottom + .82, bottom + .43, true)}
    {columns.length > 2 && chain([columns[0], columns.at(-1)!], bottom + 1.39, bottom + .92, false)}
    <line x1="-.83" y1={rows[0] ?? 0} x2="-.83" y2={rows.at(-1) ?? 0} />
    {rows.map((y, i) => <g key={y}>
      <line x1="-1.03" y1={y} x2="-.14" y2={y} />
      <line className="dimension-tick" x1="-.9" y1={y + .065} x2="-.76" y2={y - .065} />
      {i > 0 && <text transform={`translate(-.92 ${(rows[i - 1] + y) / 2}) rotate(-90)`}>{(y - rows[i - 1]) * moduleMm}</text>}
      <g className="axis-bubble" transform={`translate(-1.25 ${y})`}>
        <circle r=".12" /><text y=".047">{axisLetters[i]}</text>
      </g>
    </g>)}
  </g>
}
