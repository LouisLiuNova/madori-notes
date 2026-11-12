import { catalog } from '../packages/domain/catalog.ts'
import { sides } from '../packages/domain/geometry.ts'
import { blank, rooms, versions } from '../packages/domain/model.ts'
import type { Board, Constraint, Edge, Furniture, Level, Opening, RoomType } from '../packages/domain/model.ts'

export const chapters = ['平面入门', '墙与开口', '家具与居住', '智能住宅']

// 每行对应图纸的一行。点为建筑之外，字母为参考图的房间类型。
const types = {
  L: 'living', B: 'bedroom', D: 'dining', K: 'kitchen',
  T: 'bath', S: 'study', A: 'balcony', H: 'hall',
} as const
type Mark = keyof typeof types

function space(mark: Mark, min: number, daylight = false): Constraint {
  const type = types[mark]
  return {
    kind: 'slots', type, slots: [[{ kind: 'area', min }, ...(daylight ? [{ kind: 'window' } as const] : [])]],
    label: `${rooms[type]}至少 ${min} 格${daylight ? '，且有外窗' : ''}`,
  }
}

const link = (a: Mark, b: Mark, mode: Extract<Constraint, { kind: 'relation' }>['mode']): Constraint =>
  ({ kind: 'relation', types: [types[a], types[b]], mode,
    label: `${rooms[types[a]]}与${rooms[types[b]]}${{ adjacent: '相邻', separate: '不相邻', open: '开放相通', door: '以门相通', wall: '有共用实墙' }[mode]}` })
const quantity = (type: string, min = 1, mark?: Mark): Constraint => {
  const room = mark ? types[mark] : undefined
  return { kind: 'furniture', type, min, ...(room && { room }),
    label: `${room ? rooms[room] + '内的' : ''}${catalog[type].name}至少 ${min} 件` }
}
const rule = (type: string, condition: Extract<Constraint, { kind: 'furnitureRule' }>['rule'], label: string,
  direction?: Furniture['rotation']): Constraint => ({ kind: 'furnitureRule', type, rule: condition, label, ...(direction && { direction }) })
const network = (mark: Mark, kind: 'wifi' | 'router' | 'noRouter'): Constraint =>
  ({ kind: 'roomRule', type: types[mark], predicates: [{ kind }],
    label: `${rooms[types[mark]]}${{ wifi: '全格覆盖 Wi-Fi', router: '内有路由器', noRouter: '内禁止放路由器' }[kind]}` })
const addOpening = (type: Opening['kind'], label: string, exterior = false): Constraint =>
  ({ kind: 'opening', type, min: 1, player: true, exterior, label })

const door = (edge: Edge): Opening => ({ edge, kind: 'swing', side: 0, hinge: 0 })
const slide = (edge: Edge, pocket: -1 | 1 = 1): Opening => ({ edge, kind: 'sliding', pocket })
const windowAt = (edge: Edge): Opening => ({ edge, kind: 'window' })
const item = (type: string, x: number, y: number, rotation: Furniture['rotation'] = 'N', id = type): Furniture =>
  ({ id, type, x, y, rotation })

interface Commission {
  title: string
  brief: string
  tip: string
  plan: string[]
  entry: Edge
  clues: Constraint[]
  windows?: Edge[]
  bearing?: Edge[]
  open?: Edge[]
  doors?: Opening[]
  tools?: Opening['kind'][]
  furniture?: Furniture[]
  extraRooms?: RoomType[]
  keep?: string
  clear?: [number, number, number, number][]
  keepOpen?: boolean
  alternate: (board: Board) => void
}

const shiftItem = (type: string, x: number, y: number) => (board: Board) => {
  const object = board.furniture.find(object => object.type === type)!
  Object.assign(object, { x, y })
}
const changeOpen = (edge: Edge, next: Edge) => (board: Board) => {
  board.openEdges = board.openEdges.map(value => value === edge ? next : value)
}
const changeDoor = (edge: Edge, next: Edge) => (board: Board) => {
  board.openings = board.openings.map(value => value.edge === edge ? { ...value, edge: next } : value)
}
const alignment: Constraint = { kind: 'noFacing', label: '门窗中心轴不可无遮挡对冲' }

const commissions: Commission[] = [
  {
    title: '第一张平面图', brief: '把未分配的格子划为客厅，完成临街小宅的第一张图。', tip: '选中客厅，拖动画笔涂绘，或使用矩形工具一次填满一块区域。',
    plan: ['..LLLLLL', '..LLLLLL', '..LLLLLL', '..LLLLLL', 'LLLLLLLL', 'LLLLLLLL', 'LLLLLLLL', 'LLLLLLLL'],
    entry: 'H:1:8', clues: [space('L', 55)], keep: 'L', clear: [[5, 0, 7, 3], [7, 5, 7, 7]],
    extraRooms: ['hall'], alternate: board => { board.roomTypes[7] = 'hall'; board.openEdges.push('V:7:0') },
  },
  {
    title: '一室相连', brief: '入户转角连着向阳起居区。把两个涂过的区域接成一间客厅，玄关保留为走廊。', tip: '斜角接触的格子不会合并。先连通客厅，再检查玄关和客厅之间的开口。',
    plan: ['....LLLL', '....LLLL', '....LLLL', '....LLLL', 'LLLLLLLL', 'LLLLLLLL', 'LLHHH...', 'LLHHH...'],
    entry: 'H:3:8', clues: [space('L', 34), space('H', 6), link('H', 'L', 'open')], open: ['H:3:6'],
    keep: 'LH', clear: [[4, 4, 7, 4]], keepOpen: true, alternate: changeOpen('H:3:6', 'H:4:6'),
  },
  {
    title: '两间卧室', brief: '为一户人家分出一大一小两间卧室，每间都能从公共区域进入。', tip: '两间卧室都要有外窗。先看两侧窗位，再从剩余面积里留出走廊。',
    plan: ['BBBBHLLLL', 'BBBBHLLLL', 'BBBBHLLLL', 'BBBBHLLLL', 'HHHHHLLLL', 'BBBBHLLLL', 'BBBBHLLLL', 'BBBBHLLLL'],
    entry: 'H:4:8', windows: ['V:0:1', 'V:0:6', 'V:9:3'],
    clues: [{ kind: 'slots', type: 'bedroom', slots: [[{ kind: 'area', min: 12 }, { kind: 'window' }], [{ kind: 'area', min: 16 }, { kind: 'window' }]], label: '两间卧室分别至少 12 格和 16 格，各有外窗' },
      space('L', 31, true), space('H', 11), link('H', 'B', 'open')],
    open: ['H:1:4', 'H:1:5', 'V:5:4'], keep: 'H', alternate: changeOpen('H:1:4', 'H:2:4'),
  },
  {
    title: '一笔成形', brief: '为一套窄面宽住宅安排客厅、餐厅和厨房，让送菜路线经过餐厅。', tip: '厨房和餐厅合用一段侧翼。先估算两者总面积，再用矩形工具划出房间。',
    plan: ['...KKKKK', '...KKKKK', '...KKKKK', 'LLLDDDDD', 'LLLLDDDD', 'LLLLDDDD', 'LLLLDDDD', 'LLLL....', 'LLLL....'],
    entry: 'H:1:9', windows: ['H:6:0', 'V:0:5'],
    clues: [space('L', 23, true), space('D', 15), space('K', 14, true), link('K', 'D', 'open'), link('L', 'D', 'open'), link('K', 'L', 'separate')],
    open: ['H:5:3', 'V:4:5'], alternate: changeOpen('H:5:3', 'H:6:3'),
  },
  {
    title: '相邻与分隔', brief: '卧室和厨房都从走廊进入。卧室需要采光，也要远离厨房。', tip: '隔了一堵墙仍然相邻。用走廊把厨房和卧室隔开，再让厨房靠近餐厅。',
    plan: ['BBBB......', 'BBBB......', 'BBBBHHKKKK', 'BBBBHHKKKK', 'LLLLHHKKKK', 'LLLLHHDDDD', 'LLLLHHDDDD', 'LLLLHHDDDD'],
    entry: 'H:4:8', windows: ['H:1:0', 'V:10:3'],
    clues: [space('B', 16, true), space('H', 11), space('K', 12, true), space('D', 11), space('L', 16),
      link('B', 'K', 'separate'), link('B', 'H', 'open'), link('K', 'D', 'open'), link('L', 'H', 'open')],
    open: ['V:4:2', 'V:4:5', 'V:6:4', 'H:8:5'], alternate: changeOpen('H:8:5', 'H:9:5'),
  },
  {
    title: '小宅委托', brief: '把临街窗留给客厅和书房，安排一间靠走廊的卫生间。', tip: '卫生间的面积刚够填满门旁的小开间。先圈出三个需要独立出入口的区域。',
    plan: ['SSSSLLLLL', 'SSSSLLLLL', 'SSSSLLLLL', 'SSSSLLLLL', 'HHHHLLLLL', 'HHHHLLLLL', 'TTTHH....', 'TTTHH....'],
    entry: 'H:4:8', windows: ['H:0:0', 'V:9:2'],
    clues: [space('L', 29, true), space('S', 15, true), space('T', 6), space('H', 11),
      link('S', 'H', 'open'), link('T', 'H', 'open'), link('L', 'H', 'open'), link('T', 'L', 'separate')],
    open: ['H:1:4', 'V:4:5', 'V:3:7'], alternate: changeOpen('H:1:4', 'H:2:4'),
  },
  {
    title: '推门入室', brief: '为卧室留出临窗的整段墙，布置玄关和客厅。卧室通过推门连到玄关。', tip: '先给玄关留一个够用的开间，再沿卧室与玄关之间的墙试放推门。',
    plan: ['LLLLBBBBB', 'LLLLBBBBB', 'LLLLBBBBB', 'LLLLBBBBB', 'LLLLHHHHH', 'LLLLHHHHH', 'LLLLHH...', 'LLLLHH...'],
    entry: 'H:5:8', windows: ['H:7:0', 'V:0:5'], tools: ['swing'],
    clues: [space('L', 31, true), space('B', 19, true), space('H', 13), link('H', 'B', 'door'), link('L', 'H', 'open')],
    open: ['V:4:5'], doors: [door('H:6:4')], keep: 'LH', keepOpen: true, alternate: changeDoor('H:6:4', 'H:5:4'),
  },
  {
    title: '透明拉门', brief: '给临窗餐厅加一扇带收纳墙的拉门，让客厅、餐厅和厨房都能到达。', tip: '拉门跨两段连续隔墙。餐厅若在拐角被切得太窄，门扇就没有地方收进去。',
    plan: ['LLLLDDDD', 'LLLLDDDD', 'LLLLDDDD', 'LLLLDDDD', 'LLLLKKKK', 'LLLLKKKK', 'LLLLKKKK', 'LLLL....', 'LLLL....'],
    entry: 'H:1:9', windows: ['H:6:0'], tools: ['sliding'],
    clues: [space('L', 35), space('D', 15, true), space('K', 11), link('L', 'D', 'door'), link('D', 'K', 'open'),
      addOpening('sliding', '新增一扇透明拉门')],
    doors: [slide('V:4:1')], open: ['H:6:4'], keep: 'LDK', keepOpen: true, alternate: changeDoor('V:4:1', 'V:4:2'),
  },
  {
    title: '一扇向外的窗', brief: '卧室需要补窗，客厅沿用原窗，住宅还要增加一处室外出入口。', tip: '在厨房翼的侧墙上找外门位，卧室的窗放在另一个立面。',
    plan: ['BBBB.....', 'BBBB.....', 'BBBBLLLLL', 'BBBBLLLLL', 'HHHHLLLLL', 'HHHHLLLLL', '..KKKKKKK', '..KKKKKKK'],
    entry: 'V:0:5', windows: ['V:9:3'], tools: ['window', 'swing'],
    clues: [space('B', 16, true), space('L', 20, true), space('H', 7), space('K', 13), link('L', 'K', 'open'),
      addOpening('window', '新增一扇外窗', true), addOpening('swing', '增设一扇外门', true)],
    open: ['V:4:5', 'H:2:4', 'H:6:6'], doors: [windowAt('H:1:0'), door('V:9:7')],
    keep: 'LH', alternate: changeDoor('V:9:7', 'V:9:6'),
  },
  {
    title: '开放餐厅', brief: '把客厅和餐厅连成开放的公共空间，让卫生间从玄关进入。', tip: '开放的墙段仍然划分两个面积。卫生间应避开直接通向餐厅的动线。',
    plan: ['..LLLLLLLL', '..LLLLLLLL', '..LLLLLLLL', '..LLLLLLLL', 'HHHHDDDDDD', 'HHHHDDDDDD', 'TTTHDDDDDD', 'TTTH......'],
    entry: 'V:0:5', windows: ['H:7:0', 'V:10:5'], tools: ['swing'],
    clues: [space('L', 31, true), space('D', 17, true), space('T', 6), space('H', 9),
      link('L', 'D', 'open'), link('H', 'T', 'door'), link('D', 'T', 'separate')],
    open: ['H:3:4', 'H:7:4'], doors: [door('V:3:7')], alternate: changeOpen('H:7:4', 'H:8:4'),
  },
  {
    title: '承重墙两侧', brief: '把卧室和走廊放在承重墙两侧，让卧室门接到走廊的普通隔墙。', tip: '下方粗墙不能开门。先看北侧两格普通隔墙是否还连着走廊。',
    plan: ['....BBBBB', 'LLLHBBBBB', 'LLLHBBBBB', 'LLLHBBBBB', 'LLLHBBBBB', 'LLLHBBBBB', 'LLLLL....', 'LLLLL....'],
    entry: 'H:1:8', windows: ['H:6:0', 'V:0:3'], bearing: ['V:4:3', 'V:4:4', 'V:4:5'], tools: ['swing'],
    clues: [space('B', 29, true), space('L', 24, true), space('H', 5), link('H', 'B', 'door'), link('L', 'H', 'open')],
    doors: [door('V:4:2')], open: ['H:3:6'], keep: 'H', alternate: changeDoor('V:4:2', 'V:4:1'),
  },
  {
    title: '临风阳台', brief: '让起居室通往南面的窄阳台，卧室在另一侧保持独立。', tip: '阳台是突出外墙的窄带。先用固定窗辨认室内两翼，再为客厅和阳台留门。',
    plan: ['BBBB......', 'BBBBLLLLLL', 'BBBBLLLLLL', 'BBBBLLLLLL', 'HHHHLLLLLL', 'HHHHLLLLLL', '....AAAAAA', '....AAAAAA'],
    entry: 'V:0:5', windows: ['H:1:0', 'V:10:3'], tools: ['swing'],
    clues: [space('L', 29, true), space('B', 16, true), space('H', 8), space('A', 12),
      link('L', 'A', 'door'), link('H', 'B', 'door'), link('H', 'L', 'open')],
    doors: [door('H:2:4'), door('H:7:6')], open: ['V:4:5'], alternate: changeDoor('H:7:6', 'H:8:6'),
  },
  {
    title: '客厅布置', brief: '把沙发、盆栽和地毯布置在临窗客厅，保留通向餐厅的通道。', tip: '先保留门边和沙发前的空地，再铺地毯。地毯可以放在沙发下方。',
    plan: ['..LLLLLL', '..LLLLLL', '..LLLLLL', '..LLLLLL', 'HHHHDDDD', 'HHHHDDDD', 'HHHHDDDD', 'HHHHDDDD'],
    entry: 'H:1:8', windows: ['H:5:0', 'V:8:6'],
    clues: [space('L', 23, true), space('D', 15, true), space('H', 15), link('L', 'D', 'open'),
      quantity('sofa'), quantity('plant'), quantity('rug'), rule('sofa', 'wall', '沙发背面全段靠实墙')],
    open: ['H:3:4', 'H:6:4'], keep: 'HD',
    furniture: [item('sofa', 2, 0), item('rug', 3, 1), item('plant', 7, 2)], alternate: shiftItem('plant', 7, 3),
  },
  {
    title: '靠窗写字', brief: '把书房放在进深较浅的北翼，让书桌背窗、书柜靠实墙。', tip: '窗在北侧。桌子的使用侧朝向房间内部，书柜不能挤占通道。',
    plan: ['....SSSSSS', '....SSSSSS', '....SSSSSS', 'LLLLHHHHHH', 'LLLLHHHHHH', 'LLLLBBBBBB', 'LLLLBBBBBB', 'LLLLBBBBBB', 'LLLL......'],
    entry: 'H:1:9', windows: ['H:6:0', 'V:0:5', 'V:10:6'],
    clues: [space('S', 17, true), space('L', 23, true), space('H', 11), space('B', 17, true),
      link('S', 'H', 'open'), quantity('desk'), quantity('bookcase'), rule('desk', 'window', '书桌背面临窗'),
      rule('desk', 'direction', '书桌正面朝南', 'S'), rule('bookcase', 'wall', '书柜背面全段靠实墙')],
    open: ['H:6:3', 'V:4:4', 'H:8:5'], keep: 'LH', furniture: [item('desk', 5, 0), item('bookcase', 8, 0)],
    alternate: shiftItem('desk', 6, 0),
  },
  {
    title: '留一条动线', brief: '在紧凑厨房里放下灶台、水槽和冰箱，从客餐厅都能走到设备前。', tip: '厨房只有两到三格进深。给两件台面留下共用过道，避开进入厨房的开口。',
    plan: ['KKKKKK....', 'KKKKKK....', 'KKKKKKDDDD', 'LLLLLLDDDD', 'LLLLLLDDDD', 'LLLLLLDDDD', '....HHHH..', '....HHHH..'],
    entry: 'H:5:8', windows: ['H:2:0', 'V:10:4'],
    clues: [space('K', 17, true), space('D', 15, true), space('L', 17), space('H', 8), link('D', 'K', 'open'), link('L', 'D', 'open'),
      ...['sofa', 'stove', 'sink', 'fridge'].map(type => quantity(type)),
      rule('stove', 'wall', '灶台背面全段靠实墙'), rule('sink', 'window', '水槽背面临窗')],
    open: ['V:6:2', 'V:6:4', 'H:5:6'], keep: 'HD', furniture: [item('stove', 0, 0), item('sink', 2, 0), item('fridge', 4, 0), item('sofa', 0, 3)],
    alternate: shiftItem('fridge', 5, 0),
  },
  {
    title: '入户有遮挡', brief: '进门正对卧室墙面。安排卧室、客厅和玄关，让来客看不到床。', tip: '入口轴线正对卧室的一部分。可以错开卧室门，或在不堵住入口的地方用高柜遮挡。',
    plan: ['BBBBBB....', 'BBBBBB....', 'BBBBBBLLLL', 'BBBBBBLLLL', 'HHHHHHLLLL', 'HHHHHHLLLL', '..HHLLLLLL', '..HHLLLLLL'],
    entry: 'H:3:8', windows: ['H:1:0', 'V:10:4'], tools: ['swing'],
    clues: [space('B', 23, true), space('L', 27, true), space('H', 15), link('H', 'B', 'door'),
      quantity('bed'), quantity('displayCabinet'), rule('bed', 'privacy', '从主入口不可直视床')],
    doors: [door('H:3:4')], open: ['V:6:5'], keep: 'H', furniture: [item('bed', 0, 0), item('displayCabinet', 4, 4)],
    alternate: shiftItem('displayCabinet', 0, 5),
  },
  {
    title: '安置床榻', brief: '卧室沿外墙采光，床头要靠实墙避开窗，床尾要错开门洞。', tip: '先找能容纳整段床头的墙，再从床尾向前看门洞落在第几列。',
    plan: ['BBBBBB....', 'BBBBBB....', 'BBBBBBHHHH', 'BBBBBBHHHH', 'LLLLLLHHHH', 'LLLLLLHHHH', 'LLLLLL....', 'LLLLLL....'],
    entry: 'H:1:8', windows: ['H:2:0', 'H:3:0', 'V:0:5'], tools: ['swing'],
    clues: [space('B', 24, true), space('L', 23, true), space('H', 15), link('H', 'B', 'door'),
      quantity('bed'), quantity('wardrobe'), rule('bed', 'headWall', '床头全段贴实墙'),
      rule('bed', 'headNoWindow', '床头避开窗洞'), rule('bed', 'footNoDoor', '床尾轴线避开门洞')],
    doors: [door('V:6:3')], open: ['V:6:5'], keep: 'LH', furniture: [item('bed', 0, 0), item('wardrobe', 4, 0)],
    alternate: shiftItem('wardrobe', 3, 2),
  },
  {
    title: '错开开口', brief: '让两处外墙分别服务餐厅和客厅，同时让新增餐厅窗错开入户门轴线。', tip: '比较入户门和餐厅门的轴线。餐厅门上方若再正对一扇窗，也会形成对冲。',
    plan: ['DDDDLLLL', 'DDDDLLLL', 'DDDDLLLL', 'DDDDLLLL', 'HHHHLLLL', 'HHHHLLLL', '..HHKKKK', '..HHKKKK', '..HHKKKK'],
    entry: 'H:2:9', windows: ['V:8:3'], tools: ['window', 'swing'],
    clues: [space('D', 16, true), space('L', 23, true), space('H', 13), space('K', 11), link('H', 'D', 'door'),
      quantity('diningTable'), quantity('chair'), addOpening('window', '新增一扇外窗', true), alignment],
    doors: [door('H:1:4'), windowAt('V:0:1')], open: ['V:4:5', 'V:4:7'], keep: 'HL',
    furniture: [item('diningTable', 0, 0), item('chair', 3, 0)], alternate: changeDoor('V:0:1', 'V:0:3'),
  },
  {
    title: '信号过墙', brief: '路由器留在客厅，照亮与之隔墙相邻的卧室。', tip: 'Wi-Fi 能穿墙。先画出两间房的共用墙，再在墙的两侧试摆设备。',
    plan: ['......BBBB', '......BBBB', 'LLLLLLBBBB', 'LLLLLLBBBB', 'LLLLLLBBBB', 'LLLLLLHHHH', 'LLLLLLHHHH', '...HHHHHHH'],
    entry: 'H:7:8', windows: ['V:0:3', 'H:8:0'], tools: ['swing'],
    clues: [space('L', 29, true), space('B', 19, true), space('H', 14), link('L', 'B', 'wall'), link('H', 'B', 'door'),
      quantity('router'), quantity('smartLamp', 1, 'B'), network('L', 'router'), network('H', 'noRouter'), network('B', 'noRouter'),
      rule('smartLamp', 'privacy', '智能灯避开主入口视线')],
    doors: [door('H:8:5')], open: ['V:6:6'], keep: 'HL',
    furniture: [item('router', 5, 3), item('smartLamp', 7, 3)], alternate: shiftItem('router', 5, 2),
  },
  {
    title: '完整联网', brief: '给客厅的临墙智能电视接入网络，路由器放在走廊，保留两处房间的出入口。', tip: '电视的两格都要落在覆盖内。走廊和客厅共用的墙会挡住动线，但不会挡住信号。',
    plan: ['LLLLLL....', 'LLLLLL....', 'LLLLLLHHHH', 'LLLLLLHHHH', 'LLLLLLHHHH', 'LLLLLLHHHH', 'LLLLLLBBBB', 'LLLLLLBBBB', '......BBBB'],
    entry: 'H:8:9', windows: ['V:0:4', 'V:10:7'],
    clues: [space('L', 47, true), space('H', 15), space('B', 12, true), link('L', 'H', 'open'),
      quantity('router'), quantity('smartTv'), network('H', 'router'), network('L', 'noRouter'), network('B', 'noRouter'),
      rule('smartTv', 'wall', '智能电视背面全段靠实墙')],
    open: ['V:6:4', 'H:8:6'], keep: 'LHB', keepOpen: true,
    furniture: [item('smartTv', 5, 2, 'E'), item('router', 6, 3)], alternate: shiftItem('router', 6, 2),
  },
  {
    title: '阳台全覆盖', brief: '为南向阳台接入 Wi-Fi。路由器藏在客厅里，阳台上摆一把椅子。', tip: '阳台远端也要覆盖。沿室内侧的长墙分散布置路由器，给阳台门留出落脚格。',
    plan: ['..BBBBLLLLLL', '..BBBBLLLLLL', '..BBBBLLLLLL', '..HHHHLLLLLL', 'HHHHHHLLLLLL', 'HHHHHHLLLLLL', '....AAAAAAAA', '....AAAAAAAA'],
    entry: 'V:0:5', windows: ['H:3:0', 'V:12:3'], tools: ['swing'],
    clues: [space('A', 16), space('L', 35, true), space('B', 12, true), space('H', 15),
      link('H', 'B', 'door'), link('L', 'A', 'door'), quantity('outdoorChair'),
      network('A', 'wifi'), network('A', 'noRouter'), network('H', 'noRouter'), network('B', 'noRouter')],
    doors: [door('H:3:3'), door('H:8:6')], open: ['V:6:4'], keep: 'BH',
    furniture: [item('outdoorChair', 10, 6), item('router', 6, 5), item('router', 10, 5, 'N', 'router-2')],
    alternate: shiftItem('outdoorChair', 9, 6),
  },
  {
    title: '设备留在室内', brief: '把带窗的厨房留给智能冰箱，路由器和机器人基站放在客厅。', tip: '冰箱至少要留一侧可用通道。把路由器放在靠近厨房的客厅边缘，信号能越过隔墙。',
    plan: ['KKKKHHLLLL', 'KKKKHHLLLL', 'KKKKHHLLLL', 'KKKKHHLLLL', '....HHLLLL', '....HHLLLL', '....HHBBBB', '....HHBBBB', '....HHBBBB'],
    entry: 'V:4:7', windows: ['H:1:0', 'V:10:3', 'V:10:7'], tools: ['swing'],
    clues: [space('K', 16, true), space('L', 23, true), space('H', 17), space('B', 12, true),
      link('H', 'K', 'door'), link('H', 'B', 'door'), quantity('smartFridge'), quantity('robot', 1, 'L'),
      network('L', 'router'), network('K', 'noRouter'), network('H', 'noRouter'), network('B', 'noRouter')],
    doors: [door('V:4:2'), door('V:6:7')], open: ['V:6:3'], keep: 'H',
    furniture: [item('router', 6, 2), item('smartFridge', 3, 1), item('robot', 7, 4)], alternate: shiftItem('robot', 8, 4),
  },
  {
    title: '跨区组网', brief: '把住宅两端的书房和卧室接入网络，卧室里只留智能灯。', tip: '书房较长，一台路由器放在端头会漏掉另一端。先看书房的外角，再照顾卧室。',
    plan: ['SSSSSSSSSS..', 'SSSSSSSSSS..', 'SSSSSSSSSS..', 'LLLLLHHBBBBB', 'LLLLLHHBBBBB', 'LLLLLHHBBBBB', 'LLLLLHHBBBBB', 'LLLLLHH.....'],
    entry: 'H:5:8', windows: ['H:4:0', 'V:12:5', 'V:0:6'], tools: ['swing'],
    clues: [space('S', 29, true), space('L', 24, true), space('H', 9), space('B', 20, true), link('H', 'B', 'door'),
      quantity('router', 2), quantity('smartLamp', 1, 'B'), quantity('desk'), network('S', 'wifi'), network('B', 'noRouter'),
      network('H', 'noRouter'), rule('desk', 'window', '书桌背面临窗')],
    doors: [door('V:7:5')], open: ['V:5:6', 'H:6:3'], keep: 'H',
    furniture: [item('desk', 4, 0), item('router', 2, 1), item('router', 7, 1, 'N', 'router-2'), item('smartLamp', 8, 3)],
    alternate: shiftItem('smartLamp', 9, 3),
  },
  {
    title: '完整住宅委托', brief: '为一家人安排带厨房、卧室、卫生间和阳台的小宅。保留承重墙，把家具、采光和网络一起落位。', tip: '先用窗位定位厨房和卧室。客厅通往阳台的窄段既要留出通道，也要让路由器够得到阳台远角。',
    plan: ['..KKKKLLLLLL', '..KKKKLLLLLL', '..KKKKLLLLLL', 'HHHHHHLLLLLL', 'HHHHTTLLBBBB', 'HHHHTTLLBBBB', 'HHHHTTLLBBBB', '......LLBBBB', '......AAAAA.', '......AAAAA.'],
    entry: 'V:0:5', windows: ['H:3:0', 'V:12:6'], bearing: ['V:6:0', 'V:6:1'], tools: ['sliding', 'window', 'swing'],
    clues: [space('K', 12, true), space('H', 17), space('T', 6), space('L', 31, true), space('B', 16, true), space('A', 10),
      link('H', 'K', 'door'), link('H', 'T', 'door'), link('H', 'L', 'open'), link('L', 'B', 'door'), link('L', 'A', 'door'),
      addOpening('sliding', '新增一扇拉门'), addOpening('window', '给起居空间增设一扇外窗', true),
      quantity('bed'), quantity('smartTv'), quantity('dryingRack'), quantity('stove'), quantity('toilet'),
      rule('bed', 'headWall', '床头全段贴实墙'), rule('bed', 'footNoDoor', '床尾轴线避开门洞'),
      network('L', 'router'), network('A', 'wifi'), network('A', 'noRouter'), network('B', 'noRouter')],
    doors: [door('H:4:3'), door('V:4:5'), slide('V:8:6'), door('H:6:8'), windowAt('H:9:0')], open: ['V:6:3'], keep: 'H',
    furniture: [item('stove', 4, 0), item('toilet', 5, 4), item('bed', 9, 4), item('smartTv', 7, 4, 'E'),
      item('router', 7, 7), item('dryingRack', 9, 9, 'S')],
    alternate: shiftItem('smartTv', 7, 3),
  },
]

export const teaching = commissions.map((commission, i) => {
  const { plan, entry, clues, windows, bearing, open, doors, tools, furniture, extraRooms, keep, clear, keepOpen } = commission
  const width = plan[0].length
  const marks = plan.flatMap(row => [...row])
  const roomTypes = marks.map(mark => mark === '.' ? null : types[mark as Mark])
  const reference: Board = { roomTypes, openEdges: open ?? [], openings: doors ?? [], furniture: furniture ?? [] }
  const initial = blank(marks.length)
  initial.roomTypes = roomTypes.map((type, cell) => {
    const x = cell % width
    const y = Math.floor(cell / width)
    return keep?.includes(marks[cell]) && !clear?.some(([left, top, right, bottom]) =>
      x >= left && x <= right && y >= top && y <= bottom) ? type : null
  })
  if (keepOpen) initial.openEdges = [...reference.openEdges]
  const level: Level = {
    ...versions, id: `lesson-${String(i + 1).padStart(2, '0')}-2`,
    title: commission.title, brief: commission.brief, tip: commission.tip,
    width, height: plan.length, usable: marks.map(mark => mark !== '.'),
    entrance: entry, bearing: bearing ?? [], fixed: (windows ?? []).map(windowAt),
    roomTypes: [...new Set([...roomTypes.filter(type => type !== null), ...(extraRooms ?? [])])],
    furnitureTypes: [...new Set(reference.furniture.map(object => object.type))],
    openingTypes: tools ?? [], initial, constraints: clues,
  }
  level.fixed.unshift({ edge: entry, kind: 'swing', side: sides(level, entry)[0] === -1 ? 1 : 0, hinge: 0 })
  const alternative = structuredClone(reference)
  commission.alternate(alternative)
  return { level, reference, alternative }
})
