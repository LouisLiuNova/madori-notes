import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpFromLine, BookOpen, CalendarDays, Check, ChevronDown,
  ChevronRight, CircleHelp, CircleX, Compass, DoorOpen, Eraser, FlipHorizontal2, Focus, Grid2X2, Layers3,
  Lightbulb, LockKeyhole, Minus, MousePointer2, Paintbrush, PanelsTopLeft, Plus, Redo2, RotateCw, SquareDashed,
  Sun, Trash2, Undo2, Wifi, X,
} from 'lucide-react'
import { chapters, teaching } from '../../content/levels.ts'
import { catalog } from '../../packages/domain/catalog.ts'
import { turn } from '../../packages/domain/geometry.ts'
import { rooms } from '../../packages/domain/model.ts'
import type { Board, Level } from '../../packages/domain/model.ts'
import { validate } from '../../packages/domain/validate.ts'
import { dateInSingapore, generateDaily, generatorVersions } from '../../packages/generator/daily.ts'
import CloudPanel from '../components/CloudPanel.tsx'
import { api, useCloud } from './cloud.ts'
import Plan from '../components/Plan.tsx'
import { centered, layers } from './planView.ts'
import type { Layer } from './planView.ts'
import type { Selection, Tool } from './editor.ts'
import { mergeSaves, readArchive, readSaves, writeSaves } from './storage.ts'
import type { Save, Saves } from './storage.ts'
import { useReport } from './useReport.ts'
import '../themes/workspace.css'

const repo = import.meta.env.VITE_REPOSITORY_URL || 'https://github.com/LouisLiuNova/madori-notes'
const original = import.meta.env.VITE_ORIGINAL_GAME_URL || 'https://store.steampowered.com/app/5429370/'
const presets = { paper: '奉书', bamboo: '若竹', iris: '藤霞', blueprint: '工业蓝图', bauhaus: '原色构成' } as const
type Theme = keyof typeof presets
type Mode = 'system' | 'light' | 'dark'
type ModalName = 'chapters' | 'about' | 'theme' | 'hint' | 'result' | 'storage' | 'rules' | 'drawer'
type Session = { level: Level; reference: () => Promise<Board>; number?: number }
const lesson = (i: number): Session => ({ ...teaching[i], reference: async () => teaching[i].reference, number: i + 1 })
const symbols: Record<Tool, typeof Paintbrush> = {
  paint: Paintbrush, rect: SquareDashed, erase: Eraser, open: DoorOpen, wall: Grid2X2, swing: DoorOpen,
  sliding: PanelsTopLeft, window: PanelsTopLeft, furniture: Layers3, move: MousePointer2, remove: Trash2,
}
const toolNames: Record<Tool, string> = {
  paint: '画笔', rect: '矩形', erase: '擦除', open: '开放', wall: '恢复隔墙', swing: '推门', sliding: '拉门',
  window: '外窗', furniture: '家具', move: '移动家具', remove: '移除物件',
}

function preference(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}
function setPreference(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* 偏好不可持久化时仍可游玩。 */ }
}

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement
    dialog?.showModal()
    return () => {
      dialog?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={ref} className="modal" aria-label={title} onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="modal-content">
      <header><h2>{title}</h2><button className="icon-btn" aria-label="关闭" onClick={close}><X size={19} /></button></header>
      {children}
    </div>
  </dialog>
}

function Workspace({ session, save, onSave, openChapters, next, closeLevel, status }: {
  session: Session; save?: Save; onSave: (id: string, save: Save) => void
  openChapters: () => void; next: () => void; closeLevel: () => void; status: string
}) {
  const { level, number } = session
  const [history, setHistory] = useState(() => ({ boards: [save?.board ?? level.initial], position: 0 }))
  const [draft, setDraft] = useState<Board | null>(null)
  const [selection, select] = useState<Selection>({ tool: 'paint', room: level.roomTypes[0], furniture: level.furnitureTypes[0] ?? '',
    rotation: 'N', side: 0, mirror: false })
  const [view, setView] = useState(centered)
  const [visibleLayers, setLayers] = useState<Layer[]>(['分区', '结构'])
  const [selectedRule, setRule] = useState('')
  const [modal, setModal] = useState<ModalName | null>(null)
  const [hints, setHints] = useState(save?.hints ?? 0)
  const [hintStep, setHintStep] = useState(0)
  const [reference, setReference] = useState<Board | null>(null)
  const [message, setMessage] = useState('')
  const board = history.boards[history.position]
  const visibleBoard = reference ?? draft ?? board
  const report = useReport(level, visibleBoard)
  const results = [...report.level, ...report.global]
  const highlight = results.find(rule => rule.id === selectedRule)
  const satisfied = report.level.filter(rule => rule.status === 'satisfied').length
  const problems = report.global.filter(rule => rule.status !== 'satisfied')
  const chapter = number ? chapters[Math.floor((number - 1) / 6)] : '每日挑战'

  const persist = (next: Board, hintCount = hints, completed = save?.completed) =>
    onSave(level.id, { board: next, hints: hintCount, completed })
  function commit(nextBoard: Board) {
    if (nextBoard === board) return
    const boards = [...history.boards.slice(0, history.position + 1), nextBoard].slice(-100)
    setHistory({ boards, position: boards.length - 1 })
    setMessage('')
    persist(nextBoard)
  }

  function navigateHistory(change: number) {
    const position = history.position + change
    if (!history.boards[position]) return
    setHistory({ ...history, position })
    setMessage('')
    persist(history.boards[position])
  }

  function chooseTool(tool: Tool) {
    select({ ...selection, tool, rotation: tool === 'move' ? 'N' : selection.rotation })
  }

  function rotate() {
    select({ ...selection, rotation: turn(selection.rotation, 1), side: selection.side === 0 ? 1 : 0 })
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
        const tools: Partial<Record<string, Tool>> = { b: 'paint', m: 'rect', e: 'erase' }
        if (tools[key]) chooseTool(tools[key])
        if (key === 'r') rotate()
        if (key === 'f') select({ ...selection, mirror: !selection.mirror })
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  })

  async function reveal(step: number) {
    const used = Math.max(step, hints)
    setHints(used)
    setHintStep(step)
    persist(board, used)
    if (step === 2) {
      const unresolved = results.find(rule => rule.status !== 'satisfied' && (rule.cells.length || rule.edges.length))
      setRule(unresolved?.id ?? '')
      setModal(null)
    } else if (step === 3) {
      try { setReference(await session.reference()); setModal(null); setRule('') }
      catch { setMessage('参考图暂时无法读取，请重试。') }
    }
  }

  function submit() {
    if (reference || draft) return
    const final = validate(level, board)
    if (!final.complete) {
      setMessage('图纸还有未满足的条件，请检查委托和全局规则。')
      setRule([...final.level, ...final.global].find(item => item.status !== 'satisfied')?.id ?? '')
      return
    }
    persist(board, hints, save?.completed ?? { at: new Date().toISOString(), hints })
    setModal('result')
  }

  const palette = <>

    <section className="palette-group" aria-label="房间类型"><div className="palette-heading"><Grid2X2 size={14} /> 房间</div>
    <div className="room-options">
      {level.roomTypes.map(type => <button className="room-option" key={type}
        aria-pressed={selection.room === type && ['paint', 'rect'].includes(selection.tool)}
        onClick={() => select({ ...selection, room: type, tool: selection.tool === 'rect' ? 'rect' : 'paint' })}>
        <span className={`swatch room-${type}`} />{rooms[type]}
        {selection.room === type && ['paint', 'rect'].includes(selection.tool) && <Check className="choice-check" size={15} />}
      </button>)}
    </div></section>
    <section className="palette-group" aria-label="墙与开口"><div className="palette-heading"><DoorOpen size={15} /> 墙与开口</div>
    <div className="tool-options">
      {(['open', 'wall', ...level.openingTypes] as Tool[]).map(tool => {
        const Icon = symbols[tool]
        return <button key={tool} aria-pressed={selection.tool === tool} onClick={() => chooseTool(tool)}><Icon size={16} />{toolNames[tool]}</button>
      })}
    </div></section>
    {level.furnitureTypes.length > 0 && <section className="palette-group" aria-label="家具与设备">
      <div className="palette-heading"><Layers3 size={15} /> 家具与设备</div>
      <div className="room-options">
        {level.furnitureTypes.map(type => {
          const def = catalog[type]
          return <button className="room-option object-option" key={type} aria-pressed={selection.tool === 'furniture' && selection.furniture === type}
            title={`${def.rooms.map(room => rooms[room]).join('、')} · ${def.high ? '遮挡视线' : '视线可穿过'} · ${def.layer === 'floor' ? '可叠放' : '占据通道'} · ${def.usage === 'none' ? '装饰' : '需要使用格'}${def.radius ? ` · 半径 ${def.radius} 格` : ''}`}
            onClick={() => select({ ...selection, tool: 'furniture', furniture: type })}>
            <span>{def.name}</span><small>{def.width}×{def.height}</small>
          </button>
        })}
      </div>
    </section>}
    {(level.furnitureTypes.length > 0 || level.openingTypes.length > 0) && <div className="tool-options object-tools">
      {level.furnitureTypes.length > 0 && <button aria-pressed={selection.tool === 'move'} onClick={() => chooseTool('move')}><MousePointer2 size={16} />移动</button>}
      <button aria-pressed={selection.tool === 'remove'} onClick={() => chooseTool('remove')}><Trash2 size={16} />移除</button>
      <button onClick={rotate}><RotateCw size={16} />旋转</button>
      <button onClick={() => select({ ...selection, mirror: !selection.mirror })} aria-pressed={selection.mirror}><FlipHorizontal2 size={16} />镜像</button>
    </div>}
    <div className="layer-section palette-group">
      <div className="palette-heading"><Layers3 size={15} /> 辅助图层</div>
      <div className="layer-options">
        {layers.map(layer => <label key={layer}><input type="checkbox" checked={visibleLayers.includes(layer)}
          onChange={() => setLayers(current => current.includes(layer) ? current.filter(item => item !== layer) : [...current, layer])} />
          {layer}</label>)}
      </div>
    </div>
  </>

  return <>
    <div className="workspace page-width">
      <div className="level-intro">
        <button className="breadcrumb" onClick={openChapters}><BookOpen size={15} /> 关卡目录 <ChevronRight size={13} /> {chapter}</button>
        <div className="level-title">
          <div className="level-number" aria-label={number ? `第 ${number} 关` : undefined}>{number ? String(number).padStart(2, '0') : <CalendarDays size={25} />}</div>
          <div><h1>{level.title}</h1><p>{number ? level.brief : `${level.date} · ${level.difficulty} · ${level.brief}`}</p></div>
          <button className="plain intro-rules" onClick={() => setModal('rules')}><CircleHelp size={17} />规则说明</button>
        </div>
      </div>

      <main className="studio">
        <aside className="panel brief-panel" aria-label="委托条件">
          <h2>委托清单</h2>
          <div className="progress-summary"><span>条件</span><strong>{satisfied}<span> / {report.level.length}</span></strong></div>
          <progress aria-label="已满足条件" max={report.level.length} value={satisfied} />
          <div className="conditions">
            {report.level.map((rule, i) => <button className="condition" key={rule.id}
              aria-pressed={rule.id === selectedRule} onClick={() => setRule(rule.id === selectedRule ? '' : rule.id)}>
              <span className={`status-icon ${rule.status}`}>{rule.status === 'satisfied' ? <Check size={14} /> :
                rule.status === 'conflict' ? <X size={14} /> : <span className="status-dot" />}</span>
              <span><strong>{level.constraints[i].label}</strong><small>{rule.message}</small></span>
            </button>)}
          </div>
          <div className="global-rules">
            <h3>图纸完整性</h3>
            {problems.length ? problems.map(item => <button key={item.id} className="global-line" aria-pressed={item.id === selectedRule}
              onClick={() => setRule(item.id === selectedRule ? '' : item.id)}>
              {item.status === 'conflict' ? <CircleX size={15} /> : <span className="status-dot" />}<span>{item.message}</span>
            </button>) : <p><Check size={15} />全局规则已满足</p>}
          </div>
          <button className="hint-action" onClick={() => setModal('hint')}><Lightbulb size={18} /><span>查看提示</span><ChevronRight size={15} /></button>
        </aside>

        <section className="panel sheet" aria-label="图纸工作台">
          <div className="sheet-bar">
            <div><Compass size={18} /><strong>{reference ? '参考图纸' : '平面图'}</strong><span className="sheet-size">{level.width} × {level.height}</span></div>
            <div className="sheet-actions">
              {reference && <button className="plain" onClick={() => setReference(null)}><ArrowLeft size={15} />返回编辑</button>}
              <button className="icon-btn" aria-label="缩小" title="缩小" disabled={view.zoom <= 1}
                onClick={() => setView({ ...view, zoom: Math.max(1, view.zoom - .25) })}><Minus size={16} /></button>
              <span className="zoom">{Math.round(view.zoom * 100)}%</span>
              <button className="icon-btn" aria-label="放大" title="放大" disabled={view.zoom >= 3}
                onClick={() => setView({ ...view, zoom: Math.min(3, view.zoom + .25) })}><Plus size={16} /></button>
              <button className="icon-btn center-button" aria-label="居中" title="居中" onClick={() => setView(centered)}><Focus size={17} /></button>
            </div>
          </div>
          <div className="drawing">
            <Plan level={level} board={visibleBoard} report={report} selection={selection} layers={visibleLayers}
              highlight={highlight} view={view} setView={setView} commit={commit} preview={setDraft} readOnly={Boolean(reference)} />
          </div>
          <div className="sheet-legend">
            <span><i className="legend-line" />固定外墙</span><span><i className="legend-empty" />未分配</span>
            <span><i className="legend-entry" />主入口</span>
            {visibleLayers.includes('结构') && <span>图示尺寸 mm</span>}
            {visibleLayers.includes('Wi-Fi') && <span><Wifi size={14} />Wi-Fi 覆盖</span>}
          </div>
          <div className="toolbar">
            <div className="toolbar-group">
              {(['paint', 'rect', 'erase'] as const).map((tool, i) => {
                const Icon = symbols[tool]
                return <button className="tool-btn" key={tool} disabled={Boolean(reference)} aria-pressed={selection.tool === tool}
                  title={`${toolNames[tool]} (${['B', 'M', 'E'][i]})`} onClick={() => chooseTool(tool)}><Icon size={17} />{toolNames[tool]}</button>
              })}
            </div>
            <div className="toolbar-group history-group">
              <button className="icon-btn" aria-label="撤销" title="撤销 (Ctrl/⌘ Z)" disabled={!history.position || Boolean(reference)}
                onClick={() => navigateHistory(-1)}><Undo2 size={18} /></button>
              <button className="icon-btn" aria-label="重做" title="重做 (Ctrl/⌘ Shift Z)" disabled={history.position === history.boards.length - 1 || Boolean(reference)}
                onClick={() => navigateHistory(1)}><Redo2 size={18} /></button>
            </div>
            <button className="mobile-palette plain" onClick={() => setModal('drawer')}><Layers3 size={17} />目录</button>
          </div>
        </section>

        <aside className="palette-panel" aria-label="绘图目录">{palette}</aside>
      </main>

      <div className="finish-bar">
        <div className="finish-status" role="status"><span className="save-dot" />{message || status}</div>
        <span className="keyboard-note" id="board-keys">方向键移动 · Shift + 方向键选边 · Enter 编辑</span>
        <button className="primary" onClick={submit} disabled={Boolean(reference)} data-ready={report.complete}>提交图纸 <ArrowRight size={17} /></button>
      </div>
    </div>
    {modal === 'drawer' && <Modal title="绘图目录" close={() => setModal(null)}><div className="drawer">{palette}
      <button className="primary" onClick={() => setModal(null)}>返回图纸<ArrowRight size={16} /></button>
    </div></Modal>}
    {modal === 'rules' && <Modal title="规则说明" close={() => setModal(null)}>
      <ul className="rule-list">
        <li>涂绘所有可用格。同类四向连成一间房；承重墙完全截断时才分房。</li>
        <li>面积和数量都是下限。房间须有门或开放边界，并有至少一格可到达主入口。</li>
        <li>家具不能堵住门洞，需使用的家具须保留至少一个可达使用格。家具可移动，地毯可与家具叠放。</li>
        <li>拉门需要一格洞口和一格收纳墙。Wi-Fi 半径以格中心计算，跨墙覆盖取并集。</li>
        <li>图示以 1 格对应 1000 mm 标注定位轴线和轮廓尺寸。委托条件仍以格数计算。</li>
        <li>画笔 B，矩形 M，擦除 E，旋转 R，镜像 F。图纸聚焦时用方向键选择格子，按 Enter 应用工具。</li>
      </ul>
    </Modal>}
    {modal === 'hint' && <Modal title="委托提示" close={() => setModal(null)}>
      <p>{hintStep > 0 ? level.tip : '可以先看说明，再定位未完成的位置，或打开一份合法的参考图。'}</p>
      {hints > 0 && <p className="muted">已使用第 {hints} 级提示</p>}
      <div className="modal-actions">
        <button className="plain" onClick={() => void reveal(1)}>解释线索</button>
        <button className="plain" onClick={() => void reveal(2)}>定位问题</button>
        <button className="primary" onClick={() => void reveal(3)}>查看参考图 <ArrowRight size={16} /></button>
      </div>
    </Modal>}
    {modal === 'result' && <Modal title="委托已完成" close={() => setModal(null)}>
      <p>图纸已通过全局规则与全部委托条件。{hints ? `本次使用了 ${hints} 级提示。` : '本次未使用提示。'}</p>
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


  function openLesson(i: number) {
    const target = lesson(i)
    setSession(target)
    setPreference('madori-last', target.level.id)
    setModal(null)
  }

  async function openDaily(date = day, savedId?: string) {
    setDailyLoading(true)
    setNotice('')
    try {
      const version = generatorVersions.find(value => value === savedId?.slice(17))
      const local = generateDaily(date, date, undefined, version)
      const server = cloud.cloudStatus === 'available'
        ? await api<{ level: Level }>(`daily?date=${date}`).catch(() => null) : null
      const published = server && (!savedId || server.level.id === savedId) ? server : null
      const level = published?.level ?? local.level
      setSession({ level, reference: async () => published
        ? (await api<{ board: Board }>('daily/solution', 'POST', { id: level.id })).board : local.witnesses[0] })
      if (cloud.cloudStatus === 'available' && !server) setNotice('正式日题暂不可读取，已打开本地日题。')
      setPreference('madori-last', level.id)
      setModal(null)
    } catch { setNotice('今日题生成失败，请稍后重试。') }
    finally { setDailyLoading(false) }
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
  const oldDaily = Object.keys(saves).filter(id => id.startsWith('daily-') && !id.includes(day)).sort().reverse()
  const close = () => { setModal(null); setIncoming(null); setNotice('') }

  return <>
    <header className="topbar">
      <div className="page-width header-row">
        <button className="brand" onClick={() => setModal('chapters')} aria-label="间取手帖关卡目录">
          <span className="brand-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 11h7V4m0 7v5h9M8 20v-4" /></svg></span>
          <span>间取手帖<small>MADORI NOTES</small></span>
        </button>
        <nav aria-label="主要导航">
          <button className="nav-link" data-active={Boolean(session.number)} onClick={() => setModal('chapters')}><BookOpen size={17} />章节</button>
          <button className="nav-link" data-active={!session.number} disabled={!ready || dailyLoading} onClick={() => void openDaily()}><CalendarDays size={17} />每日挑战</button>
        </nav>
        <div className="header-actions">
          <button className="plain theme-trigger" onClick={() => setModal('theme')}><Sun size={17} />{presets[theme]} <ChevronDown size={14} /></button>
          <button className="icon-btn" title="本地存档" aria-label="本地存档" onClick={() => setModal('storage')}><BookOpen size={18} /></button>
        </div>
      </div>
    </header>
    {notice && !modal && <div className="page-width notice" role="alert">{notice}</div>}
    {ready ? <Workspace key={`${session.level.id}-${saveVersion}`} session={session} save={saves[session.level.id]} status={status}
      onSave={(id, save) => {
        const isCompletion = Boolean(save.completed && !savesRef.current[id]?.completed)
        write({ ...savesRef.current, [id]: save })
        cloud.changed(id, save, isCompletion)
        if (isCompletion && !cloud.profile && session.level.date && cloud.cloudStatus === 'available') {
          void api('daily/complete', 'POST', { id, date: session.level.date, board: save.board }).catch(() => {
            setStatus('本地完成记录已保留，正式日题验证暂不可用')
          })
        }
      }} openChapters={() => setModal('chapters')}
      next={() => session.number && openLesson(session.number)} closeLevel={() => setModal('chapters')} /> :
      <p className="page-width loading" role="status">正在打开图纸…</p>}
    <footer className="page-width footer"><span>间取手帖 · 建筑空间解谜</span><div>
      <button onClick={() => setModal('about')}>关于</button>
      <a href={repo} target="_blank" rel="noreferrer">GitHub</a><a href={`${repo}/issues`} target="_blank" rel="noreferrer">反馈问题</a>
      <a href={original} target="_blank" rel="noreferrer">购买原作</a>
    </div></footer>

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
        <button className="plain" disabled={!ready || dailyLoading} onClick={() => void openDaily()}><CalendarDays size={17} />每日挑战</button>
      </div>
    </Modal>}
    {modal === 'theme' && <Modal title="图纸主题" close={close}>
      <div className="theme-list">{Object.entries(presets).map(([id, name]) => <button key={id} aria-pressed={theme === id}
        onClick={() => setTheme(id as Theme)}><span className={`theme-sample sample-${id}`} />{name}{theme === id && <Check size={16} />}</button>)}</div>
      <div className="mode-list" aria-label="亮暗模式">{(['system', 'light', 'dark'] as const).map(value => <button key={value}
        aria-pressed={mode === value} className="plain" onClick={() => setMode(value)}>{{ system: '跟随系统', light: '亮色', dark: '暗色' }[value]}</button>)}</div>
    </Modal>}
    {modal === 'storage' && <Modal title="本地存档" close={close}>
      <p>{status}。{cloud.profile ? '' : '当前以游客身份游玩。'}</p>
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
      {incoming && <><p>已读取 {Object.keys(incoming).length} 份图纸。遇到同一关的草稿时，可选择保留来源。</p>
        <div className="modal-actions">{[false, true].map(prefer => <button key={String(prefer)} className="plain" onClick={() => {
          write(mergeSaves(savesRef.current, incoming, prefer)); setSaveVersion(value => value + 1); setIncoming(null); setNotice('已合并存档。')
        }}>{prefer ? '采用导入草稿' : '保留本地草稿'}</button>)}</div></>}
      {oldDaily.length > 0 && <details><summary>往期每日挑战</summary><div className="old-daily">
        {oldDaily.map(id => <button className="plain" key={id} onClick={() => void openDaily(id.slice(6, 16), id)}>{id.slice(6, 16)}</button>)}
      </div></details>}
      {notice && <p role="status">{notice}</p>}
      <CloudPanel cloud={cloud} />
    </Modal>}
    {modal === 'about' && <Modal title="关于间取手帖" close={close}>
      <p>本项目受《图纸没问题》的空间解谜玩法启发，由个人出于兴趣爱好与技术练习制作，非官方项目。欢迎前往 Steam 了解并购买原作，支持原作者。</p>
      <p className="muted">React · TypeScript · Vite · SVG · IndexedDB</p>
      <div className="modal-actions"><a href={original} target="_blank" rel="noreferrer">购买原作</a><a href={repo} target="_blank" rel="noreferrer">项目源码</a></div>
    </Modal>}
  </>
}
