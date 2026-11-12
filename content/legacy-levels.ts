import { maskBoard, shellMask } from '../packages/domain/shell.ts'
import type { Shell } from '../packages/domain/shell.ts'
import { catalog } from '../packages/domain/catalog.ts'
import { blank, rooms, versions } from '../packages/domain/model.ts'
import type { Board, Constraint, Edge, Furniture, Level, Opening, RoomType } from '../packages/domain/model.ts'

export const area = (type: RoomType, min: number): Constraint =>
  ({ kind: 'slots', type, slots: [[{ kind: 'area', min }]], label: `${rooms[type]}至少 ${min} 格` })
const quantity = (type: string): Constraint => ({ kind: 'furniture', type, min: 1, label: `摆放至少一件${catalog[type].name}` })
const opening = (type: Opening['kind'], label: string, exterior = false): Constraint =>
  ({ kind: 'opening', type, min: 1, exterior, player: true, label })
const relation = (a: RoomType, b: RoomType, mode: Extract<Constraint, { kind: 'relation' }>['mode'], label: string): Constraint =>
  ({ kind: 'relation', types: [a, b], mode, label })
const property = (type: string, rule: Extract<Constraint, { kind: 'furnitureRule' }>['rule'], label: string): Constraint =>
  ({ kind: 'furnitureRule', type, rule, label, ...(rule === 'direction' ? { direction: 'S' } : {}) })
const roomRule = (type: RoomType, kind: 'window' | 'wifi' | 'router' | 'noRouter', label: string): Constraint =>
  ({ kind: 'roomRule', type, predicates: [{ kind }], label })

function layout(n: number, bands: [RoomType, number][], cuts?: number[]) {
  const board = blank(n * n)
  for (let y = 0; y < n; y++) {
    const cut = cuts?.[y] ?? 0
    let start = 0
    for (const [type, end] of bands) {
      const stop = end === n ? n : end + cut
      for (let x = start; x < stop; x++) board.roomTypes[y * n + x] = type
      start = stop
    }
  }
  return board
}
const swing = (edge: Edge): Opening => ({ edge, kind: 'swing', side: 0, hinge: 0 })
const furniture = (type: string, x: number, y: number, rotation: Furniture['rotation'] = 'N'): Furniture =>
  ({ id: type, type, x, y, rotation })

interface Teaching {
  title: string
  brief: string
  tip: string
  n: number
  types: RoomType[]
  constraints: Constraint[]
  build: (variant: number) => Board
  draft?: (solution: Board) => Board
  bearing?: Edge[]
  fixed?: Opening[]
  openings?: Opening['kind'][]
  furniture?: string[]
}

const dual = (n: number, type: RoomType, variant: number, mode: 'open' | 'swing' | 'sliding' = 'open') => {
  const x = Math.floor(n / 2)
  const board = layout(n, [['living', x], [type, n]], Array.from({ length: n }, (_, y) => y === n - 1 && variant === 1 ? 1 : 0))
  const edge: Edge = `V:${x}:${2 + variant}`
  if (mode === 'open') board.openEdges.push(edge)
  if (mode === 'swing') board.openings.push(swing(edge))
  if (mode === 'sliding') board.openings.push({ edge, kind: 'sliding', pocket: 1 })
  return board
}

const take = (board: Board, changes: Partial<Board>) => ({ ...board, ...changes })
const blankPatch = (board: Board, n: number, cells: number[]) =>
  take(board, { roomTypes: board.roomTypes.map((type, i) => cells.includes(i % (n * n)) ? null : type) })
const withoutFurniture = (board: Board) => take(board, { furniture: [] })

function twoBedrooms(variant: number) {
  const board = layout(8, [['living', 8]])
  for (let y = 0; y < 8; y++) {
    for (let x = 4; x < 8; x++) {
      if (y <= 2 || y >= 4) board.roomTypes[y * 8 + x] = 'bedroom'
    }
  }
  if (variant) board.roomTypes[5 * 8 + 4] = 'living'
  board.openEdges = ['V:4:1', 'V:4:6']
  return board
}

function threeTypes(n: number, variant: number, third: RoomType = 'kitchen') {
  const first = Math.floor(n / 3)
  const second = Math.floor(n * 2 / 3)
  const board = layout(n, [['living', first], ['bedroom', second], [third, n]],
    Array.from({ length: n }, (_, y) => y === n - 1 && variant ? 1 : 0))
  board.openEdges = [`V:${first}:1`, `V:${second}:3`]
  return board
}

function withItems(board: Board, ...items: Furniture[]) {
  return take(board, { furniture: items })
}

const entries: Teaching[] = [
  {
    title: '第一张平面图', brief: '把未分配的格子划为客厅，完成一张可从主入口进入的平面图。',
    tip: '选中客厅，点按填充一格，或拖出矩形填充一块区域。',
    n: 8, types: ['living', 'hall'], constraints: [area('living', 46)],
    build: variant => {
      const board = layout(8, [['living', 8]])
      if (variant) {
        board.roomTypes[7] = 'hall'
        board.openEdges = ['V:7:0']
      }
      return board
    },
    draft: board => blankPatch(board, 8, [5, 6, 7, 13, 14, 15, 21, 22, 23, 29, 30, 31, 47, 55, 63]),
  },
  {
    title: '一室相连', brief: '连起客厅断开的部分。两块区域只在角上接触时，仍是两个房间。',
    tip: '补上两片客厅之间的空格，然后检查房间识别图层。',
    n: 8, types: ['living', 'hall'], constraints: [area('living', 52)],
    build: variant => {
      const board = layout(8, [['living', 8]])
      if (variant) {
        board.roomTypes[7] = 'hall'
        board.openEdges = ['H:7:1']
      }
      return board
    },
    draft: board => blankPatch(board, 8, [24, 25, 26, 27, 28, 29, 30, 31]),
  },
  {
    title: '两间卧室', brief: '安排两间互相独立的卧室。面积清单中的每一项都需要一间不同的卧室。',
    tip: '保留两片卧室之间的客厅带，并补齐空格。',
    n: 8, types: ['living', 'bedroom'], constraints: [
      { kind: 'rooms', type: 'bedroom', min: 2, label: '至少两间卧室' },
      { kind: 'slots', type: 'bedroom', slots: [[{ kind: 'area', min: 9 }], [{ kind: 'area', min: 12 }]], label: '两间卧室分别至少 9 格与 12 格' },
    ],
    build: twoBedrooms, draft: board => blankPatch(board, 8, [7, 15, 23, 45, 46, 47, 62]),
  },
  {
    title: '一笔成形', brief: '为客厅和餐厅分配面积，并把未完成的餐厅与既有开口接起来。',
    tip: '试试用矩形工具填完右下角。',
    n: 8, types: ['living', 'dining'], constraints: [area('living', 24), area('dining', 22)],
    build: variant => dual(8, 'dining', variant), draft: board => blankPatch(board, 8, [45, 46, 47, 53, 54, 55, 61, 62, 63]),
  },
  {
    title: '相邻与分隔', brief: '客厅需要紧挨卧室，厨房与客厅之间要留出缓冲区。',
    tip: '共享一段边才算相邻；边上有墙也计入相邻。',
    n: 8, types: ['living', 'bedroom', 'kitchen'], constraints: [
      area('kitchen', 16), relation('living', 'bedroom', 'adjacent', '客厅与卧室相邻'),
      relation('living', 'kitchen', 'separate', '客厅与厨房不得相邻'),
    ],
    build: variant => threeTypes(8, variant), draft: board => blankPatch(board, 8, [7, 15, 23, 31, 39, 47, 55, 63]),
  },
  {
    title: '小宅委托', brief: '在图纸上安排一间客厅和一间独立书房，给两间房留足空间。',
    tip: '保留开口一侧为书房。你可以把边界画成折线，只要两间房都达到面积要求。',
    n: 8, types: ['living', 'study'], constraints: [area('living', 22), area('study', 22)],
    build: variant => dual(8, 'study', variant), draft: board => blankPatch(board, 8, [6, 7, 14, 15, 22, 23, 30, 31, 38, 39, 46, 47, 54, 55, 62, 63]),
  },
  {
    title: '推门入室', brief: '给卧室加装一扇推门，确保洞口两侧可落脚。',
    tip: '选中推门，在客厅和卧室之间点一段墙。旋转切换开启侧，镜像切换铰链。',
    n: 10, types: ['living', 'bedroom'], constraints: [area('bedroom', 35), opening('swing', '新增至少一扇推门')],
    build: variant => dual(10, 'bedroom', variant, 'swing'), draft: board => take(board, { openings: [] }), openings: ['swing'],
  },
  {
    title: '透明拉门', brief: '用透明拉门连接客厅与餐厅，同时留出一段收纳墙。',
    tip: '拉门需要两段连续隔墙。只有蓝色洞口通行，虚线段用于收纳。',
    n: 10, types: ['living', 'dining'], constraints: [opening('sliding', '新增至少一扇拉门')],
    build: variant => dual(10, 'dining', variant, 'sliding'), draft: board => take(board, { openings: [] }), openings: ['sliding'],
  },
  {
    title: '一扇向外的窗', brief: '保留客厅的固定窗，为卧室安装一扇外窗，再增设一个室外出入口。',
    tip: '沿图纸外轮廓添加外窗和推门。所有房间仍从固定主入口检查动线。',
    n: 10, types: ['living', 'bedroom'], constraints: [
      opening('window', '新增至少一扇外窗', true), roomRule('bedroom', 'window', '每间卧室至少有一扇窗'),
      opening('swing', '新增至少一扇外门', true),
    ],
    fixed: [{ kind: 'window', edge: 'H:3:0' }], openings: ['window', 'swing'],
    build: variant => {
      const board = dual(10, 'bedroom', variant)
      board.openings = [{ kind: 'window', edge: `H:${6 + variant}:0` }, swing('V:10:6')]
      return board
    },
    draft: board => take(board, { openings: [] }),
  },
  {
    title: '开放餐厅', brief: '拆除一小段隔墙，保持客厅与餐厅独立计面积。',
    tip: '选择开放工具，在隔墙上涂一段。选择恢复隔墙可以补回墙段。',
    n: 10, types: ['living', 'dining'], constraints: [area('living', 36), area('dining', 34),
      relation('living', 'dining', 'open', '客厅与餐厅开放相通')],
    build: variant => dual(10, 'dining', variant), draft: board => take(board, { openEdges: [] }),
  },
  {
    title: '承重墙两侧', brief: '保留中间的承重墙，在墙的两侧布置卧室和客厅。',
    tip: '承重墙不能开门。图纸上方留有一段普通墙，可以用来连接。',
    n: 10, types: ['living', 'bedroom'], bearing: Array.from({ length: 6 }, (_, y): Edge => `V:5:${y + 4}`),
    constraints: [area('bedroom', 36), relation('living', 'bedroom', 'door', '卧室通过门连到客厅')],
    build: variant => take(dual(10, 'bedroom', 0, 'swing'), { openings: [swing(`V:5:${2 + variant}`)] }), draft: board => take(board, { openings: [] }), openings: ['swing'],
  },
  {
    title: '临风阳台', brief: '划出一片室外区域，用门把阳台与室内连起来。',
    tip: '阳台外缘自动生成栏杆，通往阳台的门放在室内外之间的普通墙段。',
    n: 10, types: ['living', 'balcony'], constraints: [area('balcony', 30), relation('living', 'balcony', 'door', '客厅通过门连到阳台')],
    build: variant => dual(10, 'balcony', variant, 'swing'), draft: board => take(board, { openings: [] }), openings: ['swing'],
  },
  {
    title: '客厅布置', brief: '把沙发、盆栽和地毯摆进客厅，保留家具使用空间。',
    tip: '沙发前留一格。地毯属于地面层，可以放在沙发下方。',
    n: 12, types: ['living', 'bedroom'], furniture: ['sofa', 'plant', 'rug', 'nightstand'],
    constraints: [quantity('sofa'), quantity('plant'), quantity('rug')],
    build: v => withItems(dual(12, 'bedroom', v), furniture('sofa', 1 + v, 1), furniture('plant', 4, 4), furniture('rug', 1, 1)),
  },
  {
    title: '靠窗写字', brief: '把书桌靠在书房的外窗下方，桌子正面朝南。',
    tip: '窗在图纸北侧。选书桌后按 R 旋转，箭头指向使用侧。',
    n: 12, types: ['living', 'study'], furniture: ['desk', 'bookcase', 'computer'], openings: ['window'],
    fixed: [{ kind: 'window', edge: 'H:9:0' }],
    constraints: [quantity('desk'), property('desk', 'window', '书桌背面临窗'), property('desk', 'direction', '书桌正面朝南')],
    build: v => withItems(dual(12, 'study', v), furniture('desk', 8 + v, 0)),
  },
  {
    title: '留一条动线', brief: '布置客厅和厨房，确保每件需要使用的家具都能从主入口走到。',
    tip: '打开动线图层，检查设备正面是否有可以到达的空格。',
    n: 12, types: ['living', 'kitchen'], furniture: ['sofa', 'stove', 'sink', 'fridge', 'coffeeTable'],
    constraints: ['sofa', 'stove', 'sink', 'fridge'].map(quantity),
    build: v => withItems(dual(12, 'kitchen', v), furniture('sofa', 1, 1 + v), furniture('stove', 7, 0), furniture('sink', 9, 0), furniture('fridge', 11, 0)),
  },
  {
    title: '入户有遮挡', brief: '布置客厅和卧室，进门时不能沿轴线看到床。',
    tip: '用视线图层观察主入口朝里的轴线。高柜、实墙可以挡住视线。',
    n: 12, types: ['living', 'bedroom'], furniture: ['bed', 'wardrobe', 'displayCabinet', 'tvStand'],
    constraints: [quantity('bed'), quantity('displayCabinet'), property('bed', 'privacy', '从主入口不可直视床')],
    build: v => withItems(dual(12, 'bedroom', v), furniture('bed', 7 + v, 1), furniture('displayCabinet', 1, 7)),
  },
  {
    title: '安置床榻', brief: '让床头靠实墙并避开窗，床尾也不要对着门洞。',
    tip: '床头在默认图标的上方。两段床头边都要贴实墙，床的侧边要能使用。',
    n: 12, types: ['living', 'bedroom'], furniture: ['bed', 'wardrobe', 'nightstand'],
    fixed: [{ kind: 'window', edge: 'H:10:0' }],
    constraints: [quantity('bed'), property('bed', 'headWall', '床头全段贴实墙'),
      property('bed', 'headNoWindow', '床头避开窗洞'), property('bed', 'footNoDoor', '床尾轴线避开门洞')],
    build: v => withItems(dual(12, 'bedroom', v), furniture('bed', 7 + v, 0)),
  },
  {
    title: '错开开口', brief: '加装外窗，为餐厅配置餐桌和餐椅，避开开口之间的无遮挡对冲。',
    tip: '主入口向北的直线穿过第 2 列；可以把窗放到别的列。',
    n: 12, types: ['living', 'dining'], furniture: ['diningTable', 'chair'], openings: ['window'],
    constraints: [quantity('diningTable'), quantity('chair'), opening('window', '新增至少一扇外窗', true),
      { kind: 'noFacing', label: '开口中心轴不可无遮挡对冲' }],
    build: v => take(withItems(dual(12, 'dining', v), furniture('diningTable', 7 + v, 1), furniture('chair', 10, 1)),
      { openings: [{ kind: 'window', edge: `H:${8 + v}:0` }] }),
    draft: board => take(board, { furniture: [], openings: [] }),
  },
  {
    title: '信号过墙', brief: '在客厅安装路由器，让卧室里也能使用智能灯。',
    tip: 'Wi-Fi 是以路由器为圆心的四格半径，墙壁不会阻断覆盖。',
    n: 12, types: ['living', 'bedroom'], furniture: ['router', 'smartLamp'],
    constraints: [quantity('router'), quantity('smartLamp'), roomRule('living', 'router', '客厅内有路由器'),
      property('smartLamp', 'privacy', '智能灯避开主入口视线')],
    build: v => withItems(dual(12, 'bedroom', v), furniture('router', 5, 5 + v), furniture('smartLamp', 7, 5)),
  },
  {
    title: '完整联网', brief: '摆放智能电视，让信号覆盖电视的每一格占地。',
    tip: '把路由器放到电视附近，切换 Wi-Fi 图层看每个占地格。',
    n: 14, types: ['living', 'bedroom'], furniture: ['router', 'smartTv'],
    constraints: [quantity('router'), quantity('smartTv')],
    build: v => withItems(dual(14, 'bedroom', v), furniture('router', 3 + v, 4), furniture('smartTv', 4, 2)),
  },
  {
    title: '阳台全覆盖', brief: '把室内的信号延伸到整片阳台，包括家具下方。',
    tip: '边角通常最难覆盖。可以添加多个路由器，覆盖范围取并集。',
    n: 14, types: ['living', 'balcony'], furniture: ['router', 'outdoorChair', 'planter'],
    constraints: [quantity('outdoorChair'), roomRule('balcony', 'wifi', '每个阳台全格覆盖 Wi-Fi')],
    build: v => withItems(dual(14, 'balcony', v), furniture('outdoorChair', 9, 3),
      ...[1, 5, 9, 12].map((y, i) => ({ ...furniture('router', 10, y + (i === 1 ? v : 0)), id: `router-${i}` }))),
  },
  {
    title: '设备留在室内', brief: '让厨房的智能冰箱接收信号，厨房内不放路由器。',
    tip: '路由器可以从客厅给厨房供信号，检查两件设备的格中心距离。',
    n: 14, types: ['living', 'kitchen'], furniture: ['router', 'smartFridge', 'robot'],
    constraints: [quantity('smartFridge'), quantity('robot'), roomRule('kitchen', 'noRouter', '每间厨房内禁止放路由器')],
    build: v => withItems(dual(14, 'kitchen', v), furniture('router', 6, 4 + v), furniture('smartFridge', 8, 5), furniture('robot', 5, 6)),
  },
  {
    title: '跨区组网', brief: '让书房全覆盖，路由器留在客厅或书房。卧室里也需要一盏联网的智能灯。',
    tip: '四格圆形覆盖可以跨越功能区；先安排书房边角，再处理智能灯。',
    n: 16, types: ['living', 'bedroom', 'study'], furniture: ['router', 'smartLamp', 'desk'],
    constraints: [quantity('smartLamp'), roomRule('study', 'wifi', '每间书房全格覆盖 Wi-Fi'),
      roomRule('bedroom', 'noRouter', '每间卧室内禁止放路由器'),
      { kind: 'furniture', type: 'router', min: 2, label: '至少两台路由器' }],
    build: v => withItems(threeTypes(16, v, 'study'), furniture('smartLamp', 8, 5 + v),
      ...[1, 5, 10, 14].map((y, i) => ({ ...furniture('router', 12, y + (i === 1 ? v : 0)), id: `router-${i}` }))),
  },
  {
    title: '完整住宅委托', brief: '完成一套有卧室、阳台和智能电视的小宅，保留既有承重墙和生活动线。',
    tip: '先完成门、窗和阳台，再用动线、视线和 Wi-Fi 图层检查家具位置。',
    n: 16, types: ['living', 'bedroom', 'balcony'], furniture: ['bed', 'router', 'smartTv', 'dryingRack'],
    bearing: ['V:5:8', 'V:5:9', 'V:5:10'], openings: ['swing', 'sliding', 'window'],
    constraints: [area('balcony', 50), opening('sliding', '新增至少一扇拉门'), opening('window', '新增至少一扇外窗', true),
      relation('bedroom', 'balcony', 'door', '卧室通过门连接阳台'),
      quantity('bed'), quantity('smartTv'), quantity('dryingRack'), property('bed', 'headWall', '床头全段贴实墙'),
      roomRule('balcony', 'noRouter', '阳台内禁止放路由器')],
    build: v => take(withItems(threeTypes(16, v, 'balcony'), furniture('bed', 6 + v, 0), furniture('smartTv', 2, 4),
      furniture('router', 3, 6), furniture('dryingRack', 12, 1)),
    { openEdges: ['V:5:1'], openings: [{ edge: 'V:10:3', kind: 'sliding', pocket: 1 }, { edge: 'H:2:0', kind: 'window' }] }),
    draft: board => take(board, { furniture: [], openings: [] }),
  },
]

const outlines: Shell[] = [
  '缺角', '双退台', '梯形退台', '侧凹口', '错层', '双缺角',
  '缺角', '侧凹口', '梯形退台', '双退台', '错层', '双缺角',
  '双退台', '梯形退台', '双缺角', '错层', '缺角', '侧凹口',
  '侧凹口', '缺角', '双退台', '双缺角', '错层', '梯形退台',
]

export const legacyTeaching = entries.map((entry, i) => {
  const usable = shellMask(entry.n, entry.n, outlines[i])
  const reference = maskBoard(entry.build(0), usable)
  const level: Level = {
    ...versions, id: `lesson-${String(i + 1).padStart(2, '0')}`, title: entry.title, brief: entry.brief,
    tip: entry.tip, width: entry.n, height: entry.n, usable,
    entrance: `H:1:${entry.n}`, bearing: entry.bearing ?? [], fixed: [swing(`H:1:${entry.n}`), ...(entry.fixed ?? [])],
    roomTypes: entry.types, furnitureTypes: entry.furniture ?? [], openingTypes: entry.openings ?? [],
    initial: entry.draft ? entry.draft(reference) : withoutFurniture(reference), constraints: entry.constraints,
  }
  return { level, reference, alternative: maskBoard(entry.build(1), usable) }
})
