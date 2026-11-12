import { catalog } from '../../packages/domain/catalog.ts'
import type { Furniture } from '../../packages/domain/model.ts'

export default function FurnitureSymbol({ item, invalid }: { item: Furniture; invalid: boolean }) {
  const def = catalog[item.type]
  const { width, height, name } = def
  const turns = {
    N: '', E: `translate(${height} 0) rotate(90)`, S: `translate(${width} ${height}) rotate(180)`,
    W: `translate(0 ${width}) rotate(-90)`,
  }
  return <g transform={`translate(${item.x} ${item.y})`} className={`object ${def.layer} ${invalid ? 'invalid' : ''}`}>
    <title>{name}</title>
    <g transform={turns[item.rotation]}>
      <rect x=".08" y=".08" width={width - .16} height={height - .16} rx=".04" />
      {item.type === 'bed' ? <g className="fixture-detail">
        <path d="M .08 .24 H 1.92 M .08 1.12 H 1.92 M .16 2.73 H 1.84" />
        <rect x=".23" y=".36" width=".65" height=".54" rx=".09" />
        <rect x="1.12" y=".36" width=".65" height=".54" rx=".09" />
      </g> : item.type === 'sofa' ? <path className="fixture-detail" d="M .27 .88 V .27 H 2.73 V .88 M 1.09 .28 V .84 M 1.91 .28 V .84" />
      : item.type === 'stove' ? <g className="fixture-detail">
        {[.48, 1.52].map(x => <circle key={x} cx={x} cy=".46" r=".23" />)}
      </g> : item.type === 'sink' || item.type === 'basin' ? <g className="fixture-detail">
        <rect x=".21" y=".21" width={width - .42} height=".57" rx=".12" /><circle cx={width / 2} cy=".44" r=".045" />
      </g> : item.type === 'toilet' ? <g className="fixture-detail">
        <path d="M .16 .31 H .84 M .28 .31 V .53 A .22 .27 0 0 0 .72 .53 V .31" />
      </g> : item.type === 'router' ? <path className="fixture-detail" d="M .22 .51 A .4 .4 0 0 1 .78 .51 M .32 .61 A .25 .25 0 0 1 .68 .61 M .46 .72 H .54" />
      : item.type === 'shower' ? <path className="fixture-detail" d="M .13 1.87 L 1.86 .14 M .13 .14 L 1.87 1.87" />
      : <text x={width / 2} y={height / 2 + .06}>{name}</text>}
      {def.usage !== 'none' && def.usage !== 'sides' && def.usage !== 'around' &&
        <path className="fixture-detail" d={`M ${width / 2 - .08} ${height - .15} l .08 .055 .08 -.055`} />}
    </g>
  </g>
}
