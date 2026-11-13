import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpFromLine, BookOpen, CalendarDays, Check, ChevronDown,
  ChevronRight, CircleHelp, CircleX, Compass, DoorOpen, Eraser, FlipHorizontal2, Focus, Grid2X2, Hand, Layers3,
  Lightbulb, LockKeyhole, Minus, MousePointer2, PanelsTopLeft, Plus, Redo2, RotateCw, SquareDashed,
  Sun, Trash2, Undo2, Wifi, X,
} from 'lucide-react'
import { chapters, teaching } from '../../content/levels.ts'
import { legacyTeaching } from '../../content/legacy-levels.ts'
import { catalog } from '../../packages/domain/catalog.ts'
import { point, segment, turn } from '../../packages/domain/geometry.ts'
import { rooms } from '../../packages/domain/model.ts'
import type { Board, Level } from '../../packages/domain/model.ts'
import { validate } from '../../packages/domain/validate.ts'
import { dateInSingapore, generateDaily, generatorVersions } from '../../packages/generator/daily.ts'
import CloudPanel from '../components/CloudPanel.tsx'
import { api, useCloud } from './cloud.ts'
import Plan from '../components/Plan.tsx'
import { centered, clampView, layers } from './planView.ts'
import type { Layer, View } from './planView.ts'
import { rotateFurniture } from './editor.ts'
import type { EraseScope, Selection, Tool } from './editor.ts'
import { mergeSaves, readArchive, readSaves, writeSaves } from './storage.ts'
import type { Save, Saves } from './storage.ts'
import { useReport } from './useReport.ts'
import '../themes/workspace.css'

const original = import.meta.env.VITE_ORIGINAL_GAME_URL || 'https://store.steampowered.com/app/5429370/'
const presets = { paper: '奉书', bamboo: '若竹', iris: '藤霞', blueprint: '工业蓝图', bauhaus: '原色构成' } as const
type Theme = keyof typeof presets
type Mode = 'system' | 'light' | 'dark'
type ModalName = 'chapters' | 'about' | 'theme' | 'hint' | 'result' | 'storage' | 'rules' | 'layers' | 'reset'
type Session = { level: Level; reference: () => Promise<Board>; number?: number; legacy?: boolean }
function lesson(i: number, legacy = false): Session {
  const { level, reference } = (legacy ? legacyTeaching : teaching)[i]
  return { level, reference: async () => reference, number: i + 1, legacy }
}
const symbols: Record<Tool, typeof SquareDashed> = {
  rect: SquareDashed, eraseRect: Eraser, open: DoorOpen, wall: Grid2X2, swing: DoorOpen,
  sliding: PanelsTopLeft, window: PanelsTopLeft, furniture: Layers3, move: MousePointer2, remove: Trash2,
}
const toolNames: Record<Tool, string> = {
  rect: '矩形', eraseRect: '矩形擦除', open: '开放', wall: '恢复隔墙', swing: '推门', sliding: '拉门',
  window: '外窗', furniture: '家具', move: '移动家具', remove: '移除物件',
}
const rectangleShortcuts = { rect: 'M', eraseRect: 'E' } as const
const eraseScopes: Record<EraseScope, string> = {
  all: '擦除全部（含门窗与墙）',
  roomsFurniture: '房间和家具',
  rooms: '仅房间',
  furniture: '仅家具',
  openings: '仅门窗与墙体改动',
}

function preference(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function setPreference(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* 偏好不可持久化时仍可游玩。 */ }
}

function Modal({ title, close, children, descriptionId, initialFocus }: {
  title: string; close: () => void; children: ReactNode; descriptionId?: string; initialFocus?: RefObject<HTMLElement | null>
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    dialog?.showModal()
    initialFocus?.current?.focus({ preventScroll: true })
    return () => {
      dialog?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [initialFocus])
  return <dialog ref={ref} className="modal" aria-label={title} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="modal-content">
      <header><h2>{title}</h2><button className="icon-btn" aria-label="关闭" onClick={close}><X size={19} /></button></header>
      {children}
    </div>
  </dialog>
}

function Workspace({ session, save, onSave, openChapters, next, closeLevel, status, levelTitle }: {
  session: Session; save?: Save; onSave: (id: string, save: Save) => void
  openChapters: () => void; next: () => void; closeLevel: () => void; status: string
  levelTitle: RefObject<HTMLHeadingElement | null>
}) {
  const { level, number } = session
  const [history, setHistory] = useState(() => ({ boards: [save?.board ?? level.initial], position: 0 }))
  const [draft, setDraft] = useState<Board | null>(null)
  const [selection, select] = useState<Selection>({ tool: 'rect', room: level.roomTypes[0], furniture: level.furnitureTypes[0] ?? '',
    rotation: 'N', side: 0, mirror: false, eraseScope: 'rooms' })
  const [view, renderView] = useState(centered)
  const viewFrame = useRef(0)
  const currentView = useRef(centered)
  const targetView = useRef(centered)
  const [panMode, setPanMode] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [showBrief, setShowBrief] = useState(false)
  const [visibleLayers, setLayers] = useState<Layer[]>(['分区', '结构'])
  const [selectedRule, setRule] = useState('')
  const [modal, setModal] = useState<ModalName | null>(null)
  const [hints, setHints] = useState(save?.hints ?? 0)
  const [hintStep, setHintStep] = useState(0)
  const [hintLoading, setHintLoading] = useState(false)
  const [hintMessage, setHintMessage] = useState('')
  const [reference, setReference] = useState<Board | null>(null)
  const [message, setMessage] = useState('')
  const [editFeedback, setEditFeedback] = useState({ message: '', revision: 0 })
  const [selectedObjectId, selectObject] = useState('')
  const hintRequest = useRef(0)
  const resetCancel = useRef<HTMLButtonElement>(null)
  const undoButton = useRef<HTMLButtonElement>(null)
  const drawing = useRef<HTMLDivElement>(null)
  const sheetTitle = useRef<HTMLElement>(null)
  const returnToEdit = useRef<HTMLButtonElement>(null)
  const board = history.boards[history.position]
  const selectedObject = board.furniture.find(item => item.id === selectedObjectId)
  const furniture = catalog[selection.furniture]
  const canRotate = selection.tool === 'furniture' || selection.tool === 'swing' || (selection.tool === 'move' && Boolean(selectedObject))
  const canMirror = selection.tool === 'swing' || selection.tool === 'sliding'
  const atInitial = board === level.initial || JSON.stringify(board) === JSON.stringify(level.initial)
  const visibleBoard = reference ?? draft ?? board
  const report = useReport(level, visibleBoard)
  const results = [...report.level, ...report.global]
  const highlight = results.find(rule => rule.id === selectedRule)
  const satisfied = report.level.filter(rule => rule.status === 'satisfied').length
  const problems = report.global.filter(rule => rule.status !== 'satisfied')
  const chapter = session.legacy ? '旧版教学' : number ? chapters[Math.floor((number - 1) / 6)] : '每日挑战'
  const readOnly = Boolean(reference)

  useLayoutEffect(() => {
    if (reference) returnToEdit.current?.focus()
  }, [reference])
  useLayoutEffect(() => () => { hintRequest.current++; cancelAnimationFrame(viewFrame.current) }, [])

  function stopView() {
    cancelAnimationFrame(viewFrame.current)
    targetView.current = currentView.current
  }

  function setView(next: View) {
    stopView()
    targetView.current = next
    currentView.current = next
    renderView(next)
  }

  function animateView(request: View) {
    const to = clampView(request, level.width + 3.15, level.height + 2.47)
    stopView()
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setView(to); return }
    targetView.current = to
    const from = currentView.current
    const started = performance.now()
    function frame(now: number) {
      const progress = 1 - (1 - Math.min(1, (now - started) / 180)) ** 3
      const next = { zoom: from.zoom + (to.zoom - from.zoom) * progress,
        x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }
      currentView.current = next
      renderView(next)
      if (progress < 1) viewFrame.current = requestAnimationFrame(frame)
    }
    viewFrame.current = requestAnimationFrame(frame)
  }

  function zoomBy(change: number) {
    const previous = targetView.current
    animateView({ ...previous, zoom: Math.max(1, Math.min(3, previous.zoom + change)) })
  }

  const persist = (next: Board, hintCount = hints, completed = save?.completed) =>
    onSave(level.id, { board: next, hints: hintCount, completed })
  function commit(nextBoard: Board) {
    if (nextBoard === board) return
    const boards = [...history.boards.slice(0, history.position + 1), nextBoard].slice(-100)
    setHistory({ boards, position: boards.length - 1 })
    setMessage('')
    setEditFeedback(current => ({ ...current, message: '' }))
    persist(nextBoard)
  }

  function navigateHistory(change: number) {
    const position = history.position + change
    if (!history.boards[position]) return
    setHistory({ ...history, position })
    setMessage('')
    setEditFeedback(current => ({ ...current, message: '' }))
    persist(history.boards[position])
  }

  function resetBoard() {
    commit(level.initial)
    setRule('')
    setModal(null)
    requestAnimationFrame(() => undoButton.current?.focus({ preventScroll: true }))
  }

  function chooseTool(tool: Tool) {
    setPanMode(false)
    if (selection.tool === tool) return
    select({ ...selection, tool, rotation: 'N', side: 0, mirror: false, targetOffset: 0 })
    selectObject('')
  }

  function rotate() {
    if (readOnly || draft || !canRotate) return
    if (selection.tool === 'move' && selectedObject) commit(rotateFurniture(board, selectedObject))
    else if (selection.tool === 'swing') select({ ...selection, side: selection.side === 0 ? 1 : 0 })
    else select({ ...selection, rotation: turn(selection.rotation, 1) })
  }

  function mirror() {
    if (canMirror && !draft && !readOnly) select({ ...selection, mirror: !selection.mirror })
  }

  function cycleTarget() {
    select({ ...selection, targetOffset: (selection.targetOffset ?? 0) + 1 })
    selectObject('')
  }

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if (modal || reference || document.querySelector('dialog[open]') || (event.target instanceof HTMLElement &&
          (event.target.matches('input, select, textarea') || event.target.isContentEditable))) return
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
        event.preventDefault()
        navigateHistory(key === 'y' || event.shiftKey ? 1 : -1)
      } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (key === 'm') chooseTool('rect')
        if (key === 'e') chooseTool('eraseRect')
        if (key === 'r') rotate()
        if (key === 'f') mirror()
        if (key === 'q' && (selection.tool === 'move' || selection.tool === 'remove')) cycleTarget()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  })

  function pointToRule(rule: (typeof results)[number]) {
    setRule(rule.id)
    const cell = rule.cells[0]
    const edge = rule.edges[0]
    const object = board.furniture.find(item => rule.objects.includes(item.id))
    const location = cell !== undefined ? point(level.width, cell) : edge ? segment(edge) : object
    if (location) {
      if (view.zoom > 1) animateView({ ...view, x: location.x + .5 - (-1.58 + (level.width + 3.15) / 2),
        y: location.y + .5 - (-.65 + (level.height + 2.47) / 2) })
      drawing.current?.scrollIntoView({ block: 'nearest' })
    }
  }

  function closeHint() {
    hintRequest.current++
    setHintLoading(false)
    setHintMessage('')
    setModal(null)
  }

  async function reveal(step: number) {
    const used = Math.max(step, hints)
    setHintMessage('')
    if (step === 3) {
      const request = ++hintRequest.current
      setHintLoading(true)
      try {
        const solution = await session.reference()
        if (hintRequest.current !== request) return
        setReference(solution)
        setRule('')
        closeHint()
      } catch {
        if (hintRequest.current === request) {
          setHintMessage('参考图暂时无法读取，请重试。')
          setHintLoading(false)
        }
        return
      }
    }
    if (step === 2) {
      const current = validate(level, board)
      const unresolved = [...current.level, ...current.global].find(rule =>
        rule.status !== 'satisfied' && (rule.cells.length || rule.edges.length))
      if (unresolved) {
        closeHint()
        requestAnimationFrame(() => pointToRule(unresolved))
      } else {
        setHintMessage('当前没有可在图纸上标出的问题。')
        return
      }
    }
    setHints(used)
    setHintStep(step)
    persist(board, used)
  }

  function submit() {
    if (reference || draft) return
    const final = validate(level, board)
    if (!final.complete) {
      setMessage('图纸还有未满足的条件，请检查委托和全局规则。')
      const unresolved = [...final.level, ...final.global].filter(rule => rule.status !== 'satisfied')
      const problem = unresolved.find(rule => rule.cells.length || rule.edges.length || rule.objects.length) ?? unresolved[0]
      if (problem) {
        pointToRule(problem)
        setEditFeedback(current => ({ message: problem.message, revision: current.revision + 1 }))
      }
      return
    }
    persist(board, hints, save?.completed ?? { at: new Date().toISOString(), hints })
    setModal('result')
  }

  const turned = selection.rotation === 'E' || selection.rotation === 'W'
  const usageLabels = { front: '单侧', sides: '两侧', around: '四周', none: '无需使用格' }
  const furnitureDetails = selection.tool === 'furniture' && furniture &&
    `${furniture.name} · ${turned ? furniture.height : furniture.width}×${turned ? furniture.width : furniture.height} · ${{ N: '初始', E: '顺转 90°', S: '顺转 180°', W: '顺转 270°' }[selection.rotation]} · 使用侧：${usageLabels[furniture.usage]} · 适用：${furniture.rooms.map(room => rooms[room]).join('、')}`

  const layerOptions = <div className="layer-options">
    {layers.map(layer => <label key={layer}><input type="checkbox" checked={visibleLayers.includes(layer)}
      onChange={() => setLayers(current => current.includes(layer) ? current.filter(item => item !== layer) : [...current, layer])} />
      {layer}</label>)}
  </div>

  const palette = <>
    <section className="palette-group" aria-label="房间类型"><div className="palette-heading"><Grid2X2 size={14} /> 房间</div>
    <div className="room-options">
      {level.roomTypes.map(type => <button className="room-option" key={type} disabled={readOnly}
        aria-pressed={selection.room === type && selection.tool === 'rect'}
        onClick={() => { setPanMode(false); select({ ...selection, room: type, tool: 'rect' }) }}>
        <span className={`swatch room-${type}`} />{rooms[type]}
        {selection.room === type && selection.tool === 'rect' && <Check className="choice-check" size={15} />}
      </button>)}
    </div></section>
    <section className="palette-group" aria-label="墙与开口"><div className="palette-heading"><DoorOpen size={15} /> 墙与开口</div>
    <div className="tool-options">
      {(['open', 'wall', ...level.openingTypes] as Tool[]).map(tool => {
        const Icon = symbols[tool]
        return <button key={tool} disabled={readOnly} aria-pressed={selection.tool === tool} onClick={() => chooseTool(tool)}><Icon size={16} />{toolNames[tool]}</button>
      })}
    </div></section>
    {level.furnitureTypes.length > 0 && <section className="palette-group" aria-label="家具与设备">
      <div className="palette-heading"><Layers3 size={15} /> 家具与设备</div>
      <div className="room-options">
        {level.furnitureTypes.map(type => {
          const def = catalog[type]
          return <button className="room-option object-option" key={type} disabled={readOnly} aria-pressed={selection.tool === 'furniture' && selection.furniture === type}
            title={`${def.rooms.map(room => rooms[room]).join('、')} · ${def.high ? '遮挡视线' : '视线可穿过'} · ${def.layer === 'floor' ? '可叠放' : '占据通道'} · ${def.usage === 'none' ? '装饰' : '需要使用格'}${def.radius ? ` · 半径 ${def.radius} 格` : ''}`}
            onClick={() => chooseFurniture(type)}>
            <span>{def.name}</span><small>{def.width}×{def.height}</small>
          </button>
        })}
      </div>
    </section>}
    <div className="layer-section palette-group">
      <div className="palette-heading"><Layers3 size={15} /> 辅助图层</div>
      {layerOptions}
    </div>
  </>

  function chooseFurniture(type: string) {
    setPanMode(false)
    select({ ...selection, tool: 'furniture', furniture: type, rotation: selection.tool === 'furniture' ? selection.rotation : 'N' })
  }

  const objectControls = (level.furnitureTypes.length > 0 || level.openingTypes.length > 0) && <div className="tool-options object-tools">
      {level.furnitureTypes.length > 0 && <button disabled={readOnly} aria-pressed={selection.tool === 'move'} onClick={() => chooseTool('move')}><MousePointer2 size={16} />移动</button>}
      <button disabled={readOnly} aria-pressed={selection.tool === 'remove'} onClick={() => chooseTool('remove')}><Trash2 size={16} />移除</button>
      {canRotate && <button disabled={readOnly} onClick={rotate}><RotateCw size={16} />
        {selection.tool === 'move' ? '旋转选中家具' : selection.tool === 'swing' ? '翻转开启侧' : '旋转预览'}</button>}
      {canMirror && <button disabled={readOnly} onClick={mirror} aria-pressed={selection.mirror}><FlipHorizontal2 size={16} />镜像</button>}
      {(selection.tool === 'move' || selection.tool === 'remove') &&
        <button disabled={readOnly} onClick={cycleTarget} title="Q">切换重叠目标</button>}
    </div>

  return <>
    <div className="workspace page-width">
      <div className="level-intro">
        <button className="breadcrumb" onClick={openChapters}><BookOpen size={15} /> 关卡目录 <ChevronRight size={13} /> {chapter}</button>
        <div className="level-title">
          <div className="level-number" aria-label={number ? `第 ${number} 关` : undefined}>{number ? String(number).padStart(2, '0') : <CalendarDays size={25} />}</div>
          <div><h1 ref={levelTitle} tabIndex={-1}>{level.title}</h1><p>{number ? level.brief : `${level.date} · ${level.difficulty}`}</p></div>
          <button className="plain intro-rules" onClick={() => setModal('rules')}><CircleHelp size={17} />规则说明</button>
        </div>
      </div>

      <main className="studio">
        <aside id="commission-brief" className="panel brief-panel" data-expanded={showBrief} aria-label="委托条件">
          <h2>委托清单</h2>
          <div className="progress-summary"><span>条件</span><strong>{satisfied}<span> / {report.level.length}</span></strong></div>
          <progress aria-label="已满足条件" max={report.level.length} value={satisfied} />
          <div className="conditions">
            {report.level.map((rule, i) => <button className="condition" key={rule.id}
              aria-pressed={rule.id === selectedRule} onClick={() => rule.id === selectedRule ? setRule('') : pointToRule(rule)}>
              <span className={`status-icon ${rule.status}`}>{rule.status === 'satisfied' ? <Check size={14} /> :
                rule.status === 'conflict' ? <X size={14} /> : <span className="status-dot" />}</span>
              <span><strong>{level.constraints[i].label}</strong><small>{rule.message}</small></span>
            </button>)}
          </div>
          <div className="global-rules">
            <h3>图纸完整性</h3>
            {problems.length ? problems.map(item => <button key={item.id} className="global-line" aria-pressed={item.id === selectedRule}
              onClick={() => item.id === selectedRule ? setRule('') : pointToRule(item)}>
              {item.status === 'conflict' ? <CircleX size={15} /> : <span className="status-dot" />}<span>{item.message}</span>
            </button>) : <p><Check size={15} />全局规则已满足</p>}
          </div>
          <button className="hint-action" disabled={readOnly} onClick={() => setModal('hint')}><Lightbulb size={18} /><span>查看提示</span><ChevronRight size={15} /></button>
        </aside>

        <section className="panel sheet" aria-label="图纸工作台">
          <div className="sheet-bar">
            <div><Compass size={18} /><strong ref={sheetTitle} tabIndex={-1}>{reference ? '参考图纸' : '平面图'}</strong><span className="sheet-size">{level.width} × {level.height}</span></div>
            <div className="sheet-actions">
              {reference && <button ref={returnToEdit} className="plain" onClick={() => {
                setReference(null)
                sheetTitle.current?.focus({ preventScroll: true })
              }}><ArrowLeft size={15} />返回编辑</button>}
              <button className="icon-btn" aria-label="缩小" title="缩小" disabled={view.zoom <= 1}
                onClick={() => zoomBy(-.25)}><Minus size={16} /></button>
              <span className="zoom">{Math.round(view.zoom * 100)}%</span>
              <button className="icon-btn" aria-label="放大" title="放大" disabled={view.zoom >= 3}
                onClick={() => zoomBy(.25)}><Plus size={16} /></button>
              <button className="icon-btn center-button" aria-label="居中" title="居中" onClick={() => animateView(centered)}><Focus size={17} /></button>
            </div>
          </div>
          <div className="sheet-utilities">
            <button className="plain" aria-pressed={readOnly || panMode} disabled={readOnly}
              onClick={() => setPanMode(current => !current)} title="图纸获得焦点后也可按住空格拖动"><Hand size={16} />平移</button>
            <button className="plain mobile-palette-toggle" aria-controls="drawing-palette" aria-expanded={showPalette}
              onClick={() => {
                setShowPalette(!showPalette)
                if (!showPalette) requestAnimationFrame(() => document.getElementById('drawing-palette')?.scrollIntoView({ block: 'nearest' }))
              }}>绘图工具 <ChevronDown size={14} /></button>
          </div>
          <div className="drawing" ref={drawing}>
            <Plan level={level} board={visibleBoard} report={report} selection={selection} layers={visibleLayers}
              highlight={highlight} view={view} setView={setView} commit={commit} preview={setDraft} readOnly={Boolean(reference)}
              panMode={panMode} stopView={stopView} selectedObject={readOnly ? '' : selectedObjectId} selectObject={selectObject}
              feedback={message => setEditFeedback(current => ({ message, revision: current.revision + 1 }))} />
          </div>
          {!readOnly && <div className="edit-feedback">
            {furnitureDetails && <span>{furnitureDetails}</span>}
            {selection.tool === 'move' && <span>{selectedObject ? `已选中 ${catalog[selectedObject.type]?.name}` : '点选家具后可原地旋转，拖动可移动。'}</span>}
            <span role="status">{editFeedback.message && <span key={editFeedback.revision}>{editFeedback.message}</span>}</span>
          </div>}
          <div className="sheet-legend">
            <span><i className="legend-line" />固定外墙</span><span><i className="legend-empty" />未分配</span>
            <span><i className="legend-entry" />主入口</span>
            {visibleLayers.includes('结构') && <span>图示尺寸 mm</span>}
            {visibleLayers.includes('Wi-Fi') && <span><Wifi size={14} />Wi-Fi 覆盖</span>}
          </div>
          <div className="quick-objects">
            {level.furnitureTypes.length > 0 && <select className="mobile-furniture" aria-label="选择家具"
              disabled={readOnly} value={selection.tool === 'furniture' ? selection.furniture : ''}
              onChange={event => chooseFurniture(event.target.value)}>
              <option value="" disabled>选择家具</option>
              {level.furnitureTypes.map(type => <option key={type} value={type}>{catalog[type].name}</option>)}
            </select>}
            {objectControls}
          </div>
          <div className="toolbar">
            <div className="toolbar-group">
              {(['rect', 'eraseRect'] as const).map(tool => {
                const Icon = symbols[tool]
                return <button className="tool-btn" key={tool} disabled={Boolean(reference)} aria-pressed={selection.tool === tool}
                  title={`${toolNames[tool]} (${rectangleShortcuts[tool]})`} onClick={() => chooseTool(tool)}><Icon size={17} />{toolNames[tool]}</button>
              })}
            </div>
            <label className="erase-scope">擦除范围
              <select disabled={Boolean(reference)} value={selection.eraseScope} onChange={event => select({ ...selection,
                tool: 'eraseRect', eraseScope: event.target.value as EraseScope })}>
                {Object.entries(eraseScopes).map(([scope, label]) => <option key={scope} value={scope}>{label}</option>)}
              </select>
            </label>
            <div className="toolbar-group history-group">
              <button ref={undoButton} className="icon-btn" aria-label="撤销" title="撤销 (Ctrl/⌘ Z)" disabled={!history.position || Boolean(reference)}
                onClick={() => navigateHistory(-1)}><Undo2 size={18} /></button>
              <button className="icon-btn" aria-label="重做" title="重做 (Ctrl/⌘ Shift Z)" disabled={history.position === history.boards.length - 1 || Boolean(reference)}
                onClick={() => navigateHistory(1)}><Redo2 size={18} /></button>
              <button className="tool-btn" title="恢复本关起始图纸，可撤销" disabled={atInitial || Boolean(draft || reference)}
                onClick={() => setModal('reset')}>重置图纸</button>
            </div>
            <button className="mobile-layers plain" aria-haspopup="dialog" onClick={() => setModal('layers')}><Layers3 size={17} />图层</button>
          </div>
          <div className="mobile-progress">
            <button className="plain" aria-controls="commission-brief" aria-expanded={showBrief} onClick={() => {
              setShowBrief(!showBrief)
              if (!showBrief) requestAnimationFrame(() => document.getElementById('commission-brief')?.scrollIntoView({ block: 'nearest' }))
            }}>条件 {satisfied}/{report.level.length}{problems.length > 0 ? ` · ${problems.length} 项图纸问题` : ''}</button>
            <button className="primary" onClick={submit} disabled={readOnly} data-ready={report.complete}>
              {report.complete ? '可以提交' : '提交图纸'} <ArrowRight size={16} /></button>
          </div>
        </section>

        <aside id="drawing-palette" className="palette-panel" data-expanded={showPalette} aria-label="绘图工具">{palette}</aside>
      </main>

      <div className="finish-bar">
        <div className="finish-status" role="status" data-incomplete={Boolean(message)}><span className="save-dot" />{message || status}</div>
        <span id="board-keys" hidden>方向键移动 · Shift + 方向键选边 · Enter 编辑 · 空格拖动平移</span>
        <button className="primary" onClick={submit} disabled={Boolean(reference)} data-ready={report.complete}>提交图纸 <ArrowRight size={17} /></button>
      </div>
    </div>
    {modal === 'reset' && <Modal title="重置图纸？" close={() => setModal(null)} descriptionId="reset-description" initialFocus={resetCancel}>
      <p id="reset-description">恢复本关的起始图纸。重置后可用「撤销」恢复当前草稿。</p>
      <div className="modal-actions">
        <button ref={resetCancel} className="plain" onClick={() => setModal(null)}>取消</button>
        <button className="primary" onClick={resetBoard}>确认重置</button>
      </div>
    </Modal>}
    {modal === 'layers' && <Modal title="辅助图层" close={() => setModal(null)}>{layerOptions}
      <div className="modal-actions"><button className="primary" onClick={() => setModal(null)}>返回图纸<ArrowRight size={16} /></button></div>
    </Modal>}
    {modal === 'rules' && <Modal title="规则说明" close={() => setModal(null)}>
      <ul className="rule-list">
        <li>涂绘所有可用格。同类四向连成一间房；承重墙完全截断时才分房。</li>
        <li>面积和数量都是下限。房间须有门或开放边界，并有至少一格可到达主入口。</li>
        <li>家具不能堵住门洞，需使用的家具须保留至少一个可达使用格。家具可移动，地毯可与家具叠放。</li>
        <li>推门可放在普通隔墙或外墙，外窗只可放在外墙。拉门需要连续两段普通隔墙，分别作为洞口和收纳墙。</li>
        <li>Wi-Fi 半径以格中心计算，跨墙覆盖取并集。</li>
        <li>图示以 1 格对应 1000 mm 标注定位轴线和轮廓尺寸。委托条件仍以格数计算。</li>
        <li>矩形 M，矩形擦除 E，旋转 R，镜像 F。点按编辑单格，拖动选定矩形。键盘用方向键选格，Shift + 方向键选边，Enter 应用工具。矩形工具用 Enter 分别选定两个角。</li>
        <li>使用「平移」或让图纸获得焦点后按住空格拖动。触屏可双指缩放和平移，参考图支持同样的浏览操作。</li>
        <li>触屏摆放家具或门窗时，先点选落点预览，可调整朝向，再次点按落点即可放置。移动工具点选家具后可原地旋转，按 Q 或使用「切换重叠目标」可选中底层物件。</li>
        <li>选择「擦除全部」会清除选区内的房间、家具、玩家门窗和墙体改动，固定结构保留。</li>
      </ul>
    </Modal>}
    {modal === 'hint' && <Modal title="委托提示" close={closeHint}>
      {hintStep > 0 && <p>{level.tip}</p>}
      <div className="modal-actions">
        <button className="plain" disabled={hintLoading} onClick={() => void reveal(1)}>解释线索</button>
        <button className="plain" disabled={hintLoading} onClick={() => void reveal(2)}>定位问题</button>
        <button className="primary" disabled={hintLoading} onClick={() => void reveal(3)}>{hintLoading ? '正在打开参考图…' : '查看参考图'} <ArrowRight size={16} /></button>
      </div>
      {hintLoading && <p className="sr-only" role="status">正在打开参考图…</p>}
      {hintMessage && <p role="status">{hintMessage}</p>}
    </Modal>}
    {modal === 'result' && <Modal title="委托已完成" close={() => setModal(null)}>
      {hints > 0 && <p>本次用到第 {hints} 级提示。</p>}
      <div className="modal-actions">
        <button className="plain" onClick={() => { setModal(null); closeLevel() }}>返回关卡目录</button>
        {number && number < teaching.length && <button className="primary" onClick={next}>下一关 <ArrowRight size={17} /></button>}
      </div>
    </Modal>}
  </>
}

export default function App() {
  const [session, setSession] = useState<Session>(() => lesson(0))
  const [saves, setSaves] = useState<Saves>({})
  const savesRef = useRef<Saves>({})
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState('')
  const [status, setStatus] = useState('草图自动保存在此设备')
  const [saveVersion, setSaveVersion] = useState(0)
  const [modal, setModal] = useState<ModalName | null>(null)
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = preference('madori-theme')
    return saved && Object.hasOwn(presets, saved) ? saved as Theme : 'paper'
  })
  const [mode, setMode] = useState<Mode>(() => {
    const saved = preference('madori-mode')
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  })
  const [day, setDay] = useState(dateInSingapore)
  const [dailyLoading, setDailyLoading] = useState(false)
  const dailyRequest = useRef(0)
  const levelTitle = useRef<HTMLHeadingElement>(null)
  const [incoming, setIncoming] = useState<Saves | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const [canWrite, setCanWrite] = useState(false)
  function write(records: Saves) {
    savesRef.current = records
    setSaves(records)
    if (!canWrite) return
    void writeSaves(records).then(() => {
      if (savesRef.current === records) setStatus('草图已保存到此设备')
    }).catch(() => {
      if (savesRef.current === records) setStatus('保存失败，请导出存档')
    })
  }

  const cloud = useCloud(ready, savesRef, records => {
    write(records)
    setSaveVersion(value => value + 1)
  })

  useEffect(() => {
    let active = true
    void readSaves().then(records => {
      if (!active) return
      savesRef.current = records
      setSaves(records)
      setCanWrite(true)
      const last = preference('madori-last')
      const i = teaching.findIndex(item => item.level.id === last)
      if (i >= 0) setSession(lesson(i))
      const legacy = legacyTeaching.findIndex(item => item.level.id === last)
      if (legacy >= 0) setSession(lesson(legacy, true))
      if (last?.startsWith('daily-')) {
        const date = last.slice(6, 16)
        try {
          const version = generatorVersions.find(value => value === last.slice(17))
          const daily = generateDaily(date, date, undefined, version)
          setSession({ level: daily.level, reference: async () => daily.witnesses[0] })
        } catch { setStatus('上次的每日挑战暂时无法读取') }
      }
    }).catch(() => {
      if (active) setStatus('存档读取失败，本次操作可手动导出')
    }).finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const system = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => { document.documentElement.dataset.mode = mode === 'system' ? (system.matches ? 'dark' : 'light') : mode }
    apply()
    setPreference('madori-theme', theme)
    setPreference('madori-mode', mode)
    system.addEventListener('change', apply)
    return () => system.removeEventListener('change', apply)
  }, [theme, mode])
  useEffect(() => {
    const timer = window.setInterval(() => setDay(dateInSingapore()), 15_000)
    return () => window.clearInterval(timer)
  }, [])


  function cancelDaily() {
    dailyRequest.current++
    setDailyLoading(false)
  }

  function showDialog(name: ModalName) {
    cancelDaily()
    setNotice('')
    setModal(name)
  }

  function enterLevel(target: Session) {
    setSession(target)
    setPreference('madori-last', target.level.id)
    setModal(null)
    requestAnimationFrame(() => levelTitle.current?.focus())
  }

  function openLesson(i: number, legacy = false) {
    cancelDaily()
    enterLevel(lesson(i, legacy))
  }

  async function openDaily(date = day, savedId?: string) {
    const request = ++dailyRequest.current
    setDailyLoading(true)
    setNotice('')
    try {
      const version = generatorVersions.find(value => value === savedId?.slice(17))
      const local = generateDaily(date, date, undefined, version)
      const server = cloud.cloudStatus === 'available'
        ? await api<{ level: Level }>(`daily?date=${date}`).catch(() => null) : null
      if (dailyRequest.current !== request) return
      const published = server && (!savedId || server.level.id === savedId) ? server : null
      const level = published?.level ?? local.level
      enterLevel({ level, reference: async () => published
        ? (await api<{ board: Board }>('daily/solution', 'POST', { id: level.id })).board : local.witnesses[0] })
      if (cloud.cloudStatus === 'available' && !server) setNotice('正式日题暂不可读取，已打开本地日题。')
    } catch {
      if (dailyRequest.current === request) setNotice('每日挑战暂时无法打开，请重试。')
    } finally {
      if (dailyRequest.current === request) setDailyLoading(false)
    }
  }

  function exportArchive() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, saves }, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `间取手帖-${dateInSingapore()}.json`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const unlocked = teaching.findIndex(({ level }) => !saves[level.id]?.completed)
  const completed = teaching.filter(({ level }) => saves[level.id]?.completed).length
  const hasOldLessons = legacyTeaching.some(({ level }) => saves[level.id])
  const oldDaily = Object.keys(saves).filter(id => id.startsWith('daily-')).sort().reverse()
  const close = () => { cancelDaily(); setModal(null); setIncoming(null); setNotice('') }

  return <>
    <header className="topbar">
      <div className="page-width header-row">
        <button className="brand" onClick={() => showDialog('chapters')} aria-label="间取手帖关卡目录">
          <span className="brand-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 11h7V4m0 7v5h9M8 20v-4" /></svg></span>
          <span>间取手帖</span>
        </button>
        <nav aria-label="主要导航">
          <button className="nav-link" data-active={Boolean(session.number)} onClick={() => showDialog('chapters')}><BookOpen size={17} />章节</button>
          <button className="nav-link" data-active={!session.number} disabled={!ready || dailyLoading} onClick={() => void openDaily()}><CalendarDays size={17} />{dailyLoading && !modal ? '正在打开…' : '每日挑战'}</button>
        </nav>
        <div className="header-actions">
          <button className="plain theme-trigger" onClick={() => showDialog('theme')}><Sun size={17} />{presets[theme]} <ChevronDown size={14} /></button>
          <button className="icon-btn" title="本地存档" aria-label="本地存档" onClick={() => showDialog('storage')}><BookOpen size={18} /></button>
        </div>
      </div>
    </header>
    {dailyLoading && !modal && <p className="sr-only" role="status">正在打开每日挑战…</p>}
    {notice && !modal && <div className="page-width notice" role="alert">{notice}</div>}
    {ready ? <Workspace key={`${session.level.id}-${saveVersion}`} session={session} save={saves[session.level.id]} status={status} levelTitle={levelTitle}
      onSave={(id, save) => {
        const isCompletion = Boolean(save.completed && !savesRef.current[id]?.completed)
        write({ ...savesRef.current, [id]: save })
        cloud.changed(id, save, isCompletion)
        if (isCompletion && !cloud.profile && session.level.date && cloud.cloudStatus === 'available') {
          void api('daily/complete', 'POST', { id, date: session.level.date, board: save.board }).catch(() => {
            setStatus('本地完成记录已保留，正式日题验证暂不可用')
          })
        }
      }} openChapters={() => showDialog('chapters')}
      next={() => session.number && openLesson(session.number, session.legacy)} closeLevel={() => showDialog('chapters')} /> :
      <p className="page-width loading" role="status">正在打开图纸…</p>}
    <footer className="page-width footer">
      <button onClick={() => showDialog('about')}>关于</button>
    </footer>

    {modal === 'chapters' && <Modal title="关卡目录" close={close}>
      <p>已完成 {completed} / {teaching.length} 关</p>
      <div className="chapters">
        {chapters.map((chapter, group) => <section key={chapter}><h3>{chapter}</h3>
          {teaching.slice(group * 6, group * 6 + 6).map(({ level }, index) => {
            const i = group * 6 + index
            return <button key={level.id} disabled={unlocked >= 0 && i > unlocked && !saves[level.id]?.completed} onClick={() => openLesson(i)}>
              <span className="chapter-index">{String(i + 1).padStart(2, '0')}</span>{level.title}
              {saves[level.id]?.completed ? <Check size={16} /> : unlocked >= 0 && i > unlocked ? <LockKeyhole size={14} /> : <ChevronRight size={16} />}
            </button>
          })}
        </section>)}
      </div>
      <div className="modal-actions"><button className="primary" disabled={!ready} onClick={() => openLesson(Math.max(0, unlocked))}>继续绘图 <ArrowRight size={16} /></button>
        <button className="plain" disabled={!ready || dailyLoading} onClick={() => void openDaily()}><CalendarDays size={17} />{dailyLoading ? '正在打开…' : '每日挑战'}</button>
      </div>
      {(dailyLoading || notice) && <p role="status" className={dailyLoading ? 'sr-only' : undefined}>{dailyLoading ? '正在打开每日挑战…' : notice}</p>}
    </Modal>}
    {modal === 'theme' && <Modal title="图纸主题" close={close}>
      <div className="theme-list">{Object.entries(presets).map(([id, name]) => <button key={id} aria-pressed={theme === id}
        onClick={() => setTheme(id as Theme)}><span className={`theme-sample sample-${id}`} />{name}{theme === id && <Check size={16} />}</button>)}</div>
      <div className="mode-list" aria-label="亮暗模式">{(['system', 'light', 'dark'] as const).map(value => <button key={value}
        aria-pressed={mode === value} className="plain" onClick={() => setMode(value)}>{{ system: '跟随系统', light: '亮色', dark: '暗色' }[value]}</button>)}</div>
    </Modal>}
    {modal === 'storage' && <Modal title="本地存档" close={close}>
      <p>{status}。</p>
      <input type="file" accept=".json,application/json" ref={upload} hidden onChange={async event => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setIncoming(null)
        try {
          if (file.size > 5 * 1024 * 1024) throw new Error('存档文件超过 5 MB。')
          setIncoming(readArchive(JSON.parse(await file.text())))
          setNotice('')
        } catch (error) { setNotice(error instanceof Error ? error.message : '无法导入该存档。') }
      }} />
      <div className="modal-actions">
        <button className="plain" disabled={!ready} onClick={exportArchive}><ArrowDownToLine size={16} />导出存档</button>
        <button className="plain" disabled={!ready} onClick={() => upload.current?.click()}><ArrowUpFromLine size={16} />导入存档</button>
      </div>
      {incoming && <><p>已读取 {Object.keys(incoming).length} 份图纸。请选择同关草稿冲突时保留的版本。</p>
        <div className="modal-actions">{[false, true].map(prefer => <button key={String(prefer)} className="plain" onClick={() => {
          write(mergeSaves(savesRef.current, incoming, prefer)); setSaveVersion(value => value + 1); setIncoming(null); setNotice('已合并存档。')
        }}>{prefer ? '采用导入草稿' : '保留本地草稿'}</button>)}</div></>}
      {hasOldLessons && <details><summary>旧版教学草稿</summary><div className="old-daily">
        {legacyTeaching.map(({ level }, i) => saves[level.id] && <button className="plain" key={level.id}
          onClick={() => openLesson(i, true)}>{level.title}</button>)}
      </div></details>}
      {oldDaily.length > 0 && <details><summary>每日挑战草稿</summary><div className="old-daily">
        {oldDaily.map(id => <button className="plain" key={id} disabled={dailyLoading} onClick={() => void openDaily(id.slice(6, 16), id)}>{id.slice(6, 16)} · v{id.slice(17)}</button>)}
      </div></details>}
      {(dailyLoading || notice) && <p role="status">{dailyLoading ? '正在打开每日挑战…' : notice}</p>}
      <CloudPanel cloud={cloud} />
    </Modal>}
    {modal === 'about' && <Modal title="关于间取手帖" close={close}>
      <p>间取手帖是一款建筑空间解谜游戏。在网格图纸上划分房间、设置门窗、摆放家具，满足委托对面积、采光和动线的要求。你可以从 24 个教学关卡入门，也可以直接尝试每日挑战。</p>
      <h3>声明</h3>
      <p>间取手帖由个人独立开发，玩法受<a className="about-link" href={original} target="_blank" rel="noreferrer">《图纸没问题》</a>启发，为非官方作品。</p>
    </Modal>}
  </>
}
