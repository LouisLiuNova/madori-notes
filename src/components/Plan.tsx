import { useRef, useState } from 'react'
import DimensionLines from './DimensionLines.tsx'
import FurnitureSymbol from './FurnitureSymbol.tsx'
import type { KeyboardEvent, PointerEvent } from 'react'
import { catalog, occupied } from '../../packages/domain/catalog.ts'
import { edgeAt, index, point, segment, shiftEdge, sides, turn } from '../../packages/domain/geometry.ts'
import { directions, rooms } from '../../packages/domain/model.ts'
import type { Board, Edge, Level, Opening, Result } from '../../packages/domain/model.ts'
import type { Report } from '../../packages/domain/validate.ts'
import { edit, isOpeningTool, isRectangleTool, keyboardHit, openingAt } from '../app/editor.ts'
import type { Hit, Selection, Tool } from '../app/editor.ts'

import type { Layer, View } from '../app/planView.ts'

const edgeTools = new Set(['open', 'wall', 'swing', 'sliding', 'window'])

interface Props {
  level: Level; board: Board; report: Report; selection: Selection; layers: Layer[]; highlight?: Result
  view: View; setView: (view: View) => void; preview: (board: Board | null) => void
  commit: (board: Board) => void; readOnly: boolean
}

function line(edge: Edge, inset = 0) {
  const { horizontal, x, y } = segment(edge)
  return { x1: x + (horizontal ? inset : 0), x2: x + (horizontal ? 1 - inset : 0),
    y1: y + (horizontal ? 0 : inset), y2: y + (horizontal ? 0 : 1 - inset) }
}

function DoorSymbol({ opening }: { opening: Opening }) {
  const { x, y, horizontal } = segment(opening.edge)
  if (opening.kind === 'window') return <g className="edge-window">
    {[-.036, .036].map(offset => <line key={offset} {...line(opening.edge, .05)}
      transform={horizontal ? `translate(0 ${offset})` : `translate(${offset} 0)`} />)}
  </g>
  if (opening.kind === 'sliding') return <g>
    <line {...line(opening.edge, .08)} className="edge-window" />
    <line {...line(shiftEdge(opening.edge, opening.pocket), .14)} className="edge-pocket" />
  </g>
  const across = opening.side === 1 ? 1 : -1
  const from = opening.hinge === 1 ? 1 : 0
  const tip = .87 * across
  const far = from ? .13 : .87
  const path = horizontal ? `M ${far} 0 A .87 .87 0 0 ${Number(from === Number(across === 1))} ${from} ${tip}`
    : `M 0 ${far} A .87 .87 0 0 ${Number(from !== Number(across === 1))} ${tip} ${from}`
  return <g transform={`translate(${x} ${y})`} className="door">
    <path d={path} />
    {horizontal ? <line x1={from} x2={from} y1={0} y2={tip} /> : <line x1={0} x2={tip} y1={from} y2={from} />}
  </g>
}

export default function Plan({ level, board, report, selection, layers, highlight, view, setView, preview, commit, readOnly }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const gesture = useRef<{ id: number; start: Hit; last: Hit; before: Board; next: Board; selection: Selection } | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ x: number; y: number; length: number; view: View } | null>(null)
  const [hover, setHover] = useState<Hit | null>(null)
  const [cursor, setCursor] = useState(() => Math.max(0, level.usable.findIndex(Boolean)))
  const [keyboardSide, setKeyboardSide] = useState(0)
  const [keyboardAnchor, setKeyboardAnchor] = useState<{ hit: Hit; tool: Tool } | null>(null)
  const keyboardStart = keyboardAnchor?.tool === selection.tool ? keyboardAnchor.hit : null
  if (keyboardAnchor && !keyboardStart) setKeyboardAnchor(null)
  const width = level.width + 3.15
  const height = level.height + 2.47
  const highlightCells = new Set(highlight?.cells)
  const highlightEdges = new Set(highlight?.edges)
  const outline = new Set(report.global.filter(item => item.status === 'conflict').flatMap(item => item.objects))
  const invalidOpenings = new Set(report.global.filter(item => item.status === 'conflict' && item.id.startsWith('opening-')).map(item => item.id))
  const structure = layers.includes('结构')
  const canHighlight = (edge: Edge) => !isOpeningTool(selection.tool) || Boolean(openingAt(level, board, edge, selection))
  const cursorEdge = keyboardHit(level, cursor, keyboardSide).edge

  function hit(event: PointerEvent<SVGSVGElement>): Hit | null {
    const element = svg.current
    const matrix = element?.getScreenCTM()
    if (!element || !matrix) return null
    const coords = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    const x = Math.min(level.width - 1, Math.max(0, Math.floor(coords.x)))
    const y = Math.min(level.height - 1, Math.max(0, Math.floor(coords.y)))
    if (coords.x < -.35 || coords.x > level.width + .35 || coords.y < -.35 || coords.y > level.height + .35) return null
    const distances = [Math.abs(coords.y - y), Math.abs(x + 1 - coords.x), Math.abs(y + 1 - coords.y), Math.abs(coords.x - x)]
    const distance = Math.min(...distances)
    if (isOpeningTool(selection.tool) && distance > .28) return null
    return { cell: index(level, x, y), edge: edgeAt({ x, y }, distances.indexOf(distance)) }
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (readOnly || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touches.current.size > 1) {
        const [a, b] = [...touches.current.values()]
        pinch.current = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, length: Math.hypot(a.x - b.x, a.y - b.y), view }
        gesture.current = null
        preview(null)
        return
      }
    }
    const target = hit(event)
    if (!target) return
    const object = selection.tool === 'move' ? board.furniture.slice().reverse().find(item =>
      occupied(item).some(p => index(level, p.x, p.y) === target.cell)) : undefined
    const effective = object ? { ...selection, rotation: turn(object.rotation, directions.indexOf(selection.rotation)) } : selection
    const next = selection.tool === 'move' ? board : edit(level, board, target, effective, target)
    gesture.current = { id: event.pointerId, start: target, last: target, before: board, next, selection: effective }
    setHover(target)
    if (target.cell >= 0) setCursor(target.cell)
    preview(next)
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const camera = pinch.current
    if (camera) {
      if (touches.current.size < 2) return
      const [a, b] = [...touches.current.values()]
      const zoom = Math.max(1, Math.min(3, camera.view.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, camera.length)))
      const scale = width / event.currentTarget.getBoundingClientRect().width / zoom
      setView({ zoom, x: camera.view.x - ((a.x + b.x) / 2 - camera.x) * scale, y: camera.view.y - ((a.y + b.y) / 2 - camera.y) * scale })
      return
    }
    const target = hit(event)
    setHover(target)
    const action = gesture.current
    if (!action || action.id !== event.pointerId || !target || (action.last.cell === target.cell && action.last.edge === target.edge)) return
    if (isRectangleTool(action.selection.tool) || action.selection.tool === 'move') {
      action.next = edit(level, action.before, target, action.selection, action.start)
    } else if (action.selection.tool === 'open' || action.selection.tool === 'wall') {
      action.next = edit(level, action.next, target, action.selection, action.start)
    }
    action.last = target
    preview(action.next)
  }

  function pointerEnd(event: PointerEvent<SVGSVGElement>, cancel = false) {
    touches.current.delete(event.pointerId)
    if (!touches.current.size) pinch.current = null
    const action = gesture.current
    if (action?.id !== event.pointerId) return
    gesture.current = null
    preview(null)
    if (!cancel && action.before !== action.next) commit(action.next)
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (readOnly) return
    const keys = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']
    const direction = keys.indexOf(event.key)
    if (direction >= 0) {
      event.preventDefault()
      if (event.shiftKey) { setKeyboardSide(direction); return }
      const { x, y } = point(level.width, cursor)
      const dx = [0, 1, 0, -1][direction]
      const dy = [-1, 0, 1, 0][direction]
      for (let step = 1; step < Math.max(level.width, level.height); step++) {
        const next = index(level, x + dx * step, y + dy * step)
        if (next >= 0) { setCursor(next); break }
      }
      return
    }
    if (event.key === 'Escape') { setKeyboardAnchor(null); return }
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    const target = keyboardHit(level, cursor, keyboardSide)
    if ((isRectangleTool(selection.tool) || selection.tool === 'move') && !keyboardStart) {
      setKeyboardAnchor({ hit: target, tool: selection.tool })
      return
    }
    const start = keyboardStart ?? target
    const object = selection.tool === 'move' ? board.furniture.slice().reverse().find(item =>
      occupied(item).some(p => index(level, p.x, p.y) === start.cell)) : undefined
    const effective = object ? { ...selection, rotation: turn(object.rotation, directions.indexOf(selection.rotation)) } : selection
    const next = edit(level, board, target, effective, start)
    setKeyboardAnchor(null)
    if (next !== board) commit(next)
  }

  return <svg ref={svg} role="application" tabIndex={0} aria-label="平面图编辑区" aria-describedby="board-keys"
    className="plan" data-tool={selection.tool}
    viewBox={`${-1.58 + width * (1 - 1 / view.zoom) / 2 + view.x} ${-.65 + height * (1 - 1 / view.zoom) / 2 + view.y} ${width / view.zoom} ${height / view.zoom}`}
    onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd}
    onPointerCancel={event => pointerEnd(event, true)} onLostPointerCapture={event => pointerEnd(event, true)}
    onPointerLeave={() => setHover(null)} onBlur={() => setKeyboardAnchor(null)} onKeyDown={onKeyDown}>
    <defs>
      <pattern id="paper-grid" width=".25" height=".25" patternUnits="userSpaceOnUse">
        <path d="M .25 0 H 0 V .25" className="micro-grid" />
      </pattern>
      <pattern id="unassigned" width=".16" height=".16" patternUnits="userSpaceOnUse">
        <path d="M -.04 .04 L .04 -.04 M 0 .16 L .16 0 M .12 .20 L .20 .12" className="hatch" />
      </pattern>
      <pattern id="reachable" width=".25" height=".25" patternUnits="userSpaceOnUse">
        <circle cx=".125" cy=".125" r=".025" className="path-dot" />
      </pattern>
    </defs>
    <rect width={width * 3} height={height * 3} x={-width} y={-height} fill="url(#paper-grid)" />
    {structure && <DimensionLines level={level} />}
    {level.usable.map((usable, cell) => {
      if (!usable) return null
      const { x, y } = point(level.width, cell)
      const type = board.roomTypes[cell]
      return <g key={cell} data-cell={cell}>
        <rect x={x} y={y} width="1" height="1" className={`cell ${type ? `room-${type}` : 'cell-empty'}`} />
        {!type && <rect x={x} y={y} width="1" height="1" fill="url(#unassigned)" />}
        {layers.includes('Wi-Fi') && report.wifi.has(cell) && <rect x={x} y={y} width="1" height="1" className="wifi-cell" />}
        {layers.includes('动线') && report.reachable.has(cell) && <rect x={x} y={y} width="1" height="1" fill="url(#reachable)" />}
        {layers.includes('动线') && report.useCells.has(cell) && <circle cx={x + .5} cy={y + .5} r=".13" className="use-cell" />}
        {layers.includes('视线') && report.sight.has(cell) && <rect x={x + .39} y={y + .39} width=".22" height=".22" className="sight-cell" />}
        {highlightCells.has(cell) && <rect x={x + .06} y={y + .06} width=".88" height=".88" className="cell-mark" />}
      </g>
    })}
    {layers.includes('分区') && report.rooms.map(room => {
      const centroid = room.cells.reduce((sum, cell) => {
        const p = point(level.width, cell)
        return { x: sum.x + p.x / room.cells.length, y: sum.y + p.y / room.cells.length }
      }, { x: 0, y: 0 })
      const cell = room.cells.reduce((best, candidate) => {
        const distance = (i: number) => { const p = point(level.width, i); return (p.x - centroid.x) ** 2 + (p.y - centroid.y) ** 2 }
        return distance(candidate) < distance(best) ? candidate : best
      })
      const { x, y } = point(level.width, cell)
      return <g key={room.cells[0]} className="room-label" transform={`translate(${x + .5} ${y + .5})`}>
        <rect x="-.59" y="-.36" width="1.18" height=".72" rx=".05" />
        <text y="-.03">{rooms[room.type]}</text>
        <text y=".22" className="room-size">{room.cells.length} 格</text>
      </g>
    })}
    {[...report.boundaries].map(([edge, boundary]) => {
      if (boundary === 'none' || boundary === 'swing' || boundary === 'sliding' || boundary === 'window' || boundary === 'pocket') return null
      if (boundary === 'open' && !layers.includes('分区')) return null
      if (!structure && (boundary === 'wall' || boundary === 'bearing')) return null
      return <line key={edge} {...line(edge)} className={`edge edge-${boundary} ${highlightEdges.has(edge) ? 'edge-mark' : ''}`} />
    })}
    {[...level.fixed, ...board.openings].map((opening, i) => {
      const key = `${opening.edge}-${i}`
      return invalidOpenings.has(`opening-${i}`)
        ? <line key={key} {...line(opening.edge)} className="edge-invalid" />
        : <DoorSymbol key={key} opening={opening} />
    })}
    {[...board.furniture].sort((a, b) => Number(catalog[b.type]?.layer === 'floor') - Number(catalog[a.type]?.layer === 'floor'))
      .map(item => Object.hasOwn(catalog, item.type) && <FurnitureSymbol key={item.id} item={item} invalid={outline.has(item.id)} />)}
    {layers.includes('Wi-Fi') && board.furniture.filter(item => catalog[item.type]?.radius).map(item =>
      <circle key={item.id} cx={item.x + .5} cy={item.y + .5} r={catalog[item.type].radius} className="wifi-radius" />)}
    {[...highlightEdges].map(edge => <line key={edge} {...line(edge, .07)} className="edge-mark" />)}
    {(() => {
      const { x, y, horizontal } = segment(level.entrance)
      const outward = sides(level, level.entrance)[0] === -1 ? -1 : 1
      const angle = horizontal ? (outward === 1 ? 0 : 180) : (outward === -1 ? 90 : 270)
      return <g className="entry-label" transform={`translate(${x + (horizontal ? .5 : 0)} ${y + (horizontal ? 0 : .5)})`}>
        <path d="M 0 .17 L -.09 .31 H .09 Z" transform={`rotate(${angle})`} />
        <text x={horizontal ? 0 : outward * .56} y={horizontal ? outward * .52 : 0}
          textAnchor="middle" dominantBaseline="central">主入口</text>
      </g>
    })()}
    <g className="drawing-scale" transform={`translate(${level.width + .34} ${level.height - .62})`}>
      <path d="M 0 0 V .11 H 1 V 0 M .5 0 V .11" /><text x=".5" y=".34">1000</text>
    </g>
    <g className="north-arrow" transform={`translate(${level.width + .75} .18)`}>
      <text y="0">N</text><path d="M 0 .16 L -.12 .52 L 0 .46 L .12 .52 Z" />
    </g>
    {!readOnly && hover && (edgeTools.has(selection.tool) ?
      canHighlight(hover.edge) && <line {...line(hover.edge, .05)} className="edge-hover" /> : hover.cell >= 0 &&
      <rect x={point(level.width, hover.cell).x + .06} y={point(level.width, hover.cell).y + .06} width=".88" height=".88" className="cell-hover" />)}
    {!readOnly && <g className="keyboard-cursor">
      {edgeTools.has(selection.tool) ? canHighlight(cursorEdge) && <line {...line(cursorEdge, .05)} className="edge-hover" /> :
        <rect x={point(level.width, cursor).x + .06} y={point(level.width, cursor).y + .06} width=".88" height=".88" className="cell-hover" />}
      {keyboardStart && <rect x={point(level.width, keyboardStart.cell).x + .1} y={point(level.width, keyboardStart.cell).y + .1} width=".8" height=".8" className="cell-mark" />}
    </g>}
  </svg>
}
