// 文字犯罪 RPG 引擎：时间、旅行、犯罪、通缉、警察盘查、任务、存档。
import { nearbyPois, nearestPoi, routeBetween, streetNameAt, districtOf, POI_LABELS } from './mapdata.js'

const SAVE_PREFIX = 'cheyenne-text-slot-'
export const SAVE_SLOTS = 3

let mapRef = null
export function attachMap(map) { mapRef = map }
export function getMap() { return mapRef }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const rnd = (n) => Math.floor(Math.random() * n)
const chance = (p) => Math.random() < p
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`

// 虚构联系人（挂在真实地点上）
export const CONTACTS = [
  { id: 'c_rodeo', name: '马夫', x: 3400, y: 1600, role: '竞技场的地头蛇', desc: '认识所有赌马的人，也认识所有欠钱的人。' },
  { id: 'c_yard', name: '扳手', x: -1400, y: 2400, role: '调车场检修工', desc: '知道哪节车厢没上清单。' },
  { id: 'c_hill', name: '牧师', x: 6200, y: -2600, role: '山上的洗钱人', desc: '在小教堂里替人洗钱，也替人祷告。' },
]

export const VIRTUAL_POIS = [
  { id: 'v_depot', name: '联合太平洋调车场', t: 'yard', x: -900, y: 2300, desc: '货车比人多，夜里只有信号灯亮着。' },
  { id: 'v_refinery', name: '炼油厂大门', t: 'gate', x: 7800, y: 1800, desc: '烟囱二十四小时冒白汽，风一吹全城都是硫味。' },
  { id: 'v_afb', name: 'F.E. Warren 检查站', t: 'gate', x: -7200, y: -1800, desc: '再往前需要证件。哨兵会盯着你看。' },
  { id: 'v_motel', name: '草原汽车旅馆', t: 'motel', x: 2200, y: 2800, desc: '按周付现金，不问名字。' },
  { id: 'v_garage', name: 'High Plains 修车厂', t: 'garage', x: 1500, y: 3200, desc: '能修车、能换牌，也能把不该在路上的车改成能上路的。' },
  { id: 'v_gunshop', name: 'Frontier Arms（后门）', t: 'weapons', x: -1800, y: 900, desc: '店面卖猎枪，后门卖别的。' },
]

export function makeGame(map, name = '无名') {
  mapRef = map
  const center = { x: 0, y: 400 }
  const state = {
    version: 2,
    day: 1,
    time: 6 * 60,
    screen: 'game',
    player: {
      name,
      cash: 640,
      health: 100,
      heat: 0,
      weapon: null,
      ammo: 0,
      goods: 0,
      car: { name: '1998 福特 F-150', fuel: 62, condition: 74 },
      onFoot: false,
    },
    pos: { x: center.x, y: center.y },
    placeId: null,
    travel: null,
    log: [],
    pending: null,
    missions: [],
    completed: [],
    contactsMet: [],
    lastSave: null,
  }
  const start = nearestPoi(map, center.x, center.y, (p) => p.t === 'motel' || p.t === 'store' || p.t === 'fuel')
  pushLog(state, `你在夏延醒来。手机显示 ${formatClock(state)}，窗外是那种一年刮三百天的风。`, 'narration')
  pushLog(state, '口袋里有 $640、一把车钥匙和一张写着「去竞技场找马夫」的纸条。', 'narration')
  if (start) {
    state.pos = { x: start.x, y: start.y }
    state.placeId = start.id
    pushLog(state, `你站在 ${start.n} 门口。`, 'place')
  }
  return state
}

// ---------------------------------------------------------------- 基础
export function formatClock(state) {
  const total = Math.floor(state.time)
  const day = state.day
  const hh = String(Math.floor((total % 1440) / 60)).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `第${day}天 ${hh}:${mm}`
}

export function advanceTime(state, minutes) {
  state.time += minutes
  while (state.time >= 1440) {
    state.time -= 1440
    state.day += 1
  }
}

export function pushLog(state, text, kind = 'info') {
  state.log.unshift({ t: Date.now(), clock: formatClock(state), text, kind })
  state.log = state.log.slice(0, 200)
}

export function currentDistrict(state) {
  return districtOf(mapRef, state.pos.x, state.pos.y)
}

export function placeAtPlayer(state) {
  if (!state.placeId) return null
  const osm = mapRef.poisById[state.placeId]
  if (osm) return osm
  const virtual = VIRTUAL_POIS.find((p) => p.id === state.placeId)
  if (virtual) return virtual
  const contact = CONTACTS.find((c) => c.id === state.placeId)
  if (contact) return { ...contact, t: 'contact', n: contact.name }
  return null
}

export function visiblePois(state, radius = 1600) {
  const virtual = VIRTUAL_POIS.map((p) => ({ ...p, dist: Math.hypot(p.x - state.pos.x, p.y - state.pos.y) }))
  const contacts = CONTACTS.map((c) => ({
    id: c.id, name: c.name, t: 'contact', x: c.x, y: c.y, desc: c.desc,
    dist: Math.hypot(c.x - state.pos.x, c.y - state.pos.y),
  }))
  const osm = nearbyPois(mapRef, state.pos.x, state.pos.y, radius).map((p) => ({ ...p, name: p.n, t: p.kind }))
  return [...contacts.filter((c) => c.dist < radius), ...virtual.filter((p) => p.dist < radius), ...osm]
    .sort((a, b) => a.dist - b.dist)
}

export function labelsFor(poi) {
  return POI_LABELS[poi.t] || poi.t
}

// ---------------------------------------------------------------- 旅行
export function travelTo(state, target, options = {}) {
  if (state.pending) return { ok: false, reason: '先处理眼前的事。' }
  const p = state.player
  if (p.health <= 0) return { ok: false, reason: '你动不了，需要先去医院。' }
  const car = !options.walk && p.car && p.car.fuel > 0 && p.car.condition > 10
  const speed = car ? 620 : 80 // 米 / 游戏分钟
  const route = routeBetween(mapRef, state.pos, target)
  const minutes = Math.max(4, Math.round(route.distance / speed) + rnd(3))
  const before = { x: state.pos.x, y: state.pos.y }
  advanceTime(state, minutes)
  if (car) {
    p.car.fuel = clamp(p.car.fuel - route.distance / 900, 0, 100)
    p.car.condition = clamp(p.car.condition - (chance(0.12) ? 2 : 0), 0, 100)
  }
  state.pos = { x: target.x, y: target.y }
  state.travel = { from: before, to: { x: target.x, y: target.y }, points: route.points }
  state.placeId = target.id || null
  const street = streetNameAt(mapRef, target.x, target.y)
  pushLog(
    state,
    car
      ? `你开车沿 ${street} 过去，${minutes} 分钟。${target.name ? `停在了${target.name}。` : ''}`
      : `你步行穿过几个街区，${minutes} 分钟。${target.name ? `到了${target.name}。` : ''}`,
    'travel',
  )
  maybeEncounter(state, car)
  checkMissions(state)
  return { ok: true, minutes }
}

// ---------------------------------------------------------------- 通缉与盘查
export function addHeat(state, amount) {
  state.player.heat = clamp(state.player.heat + amount, 0, 100)
  if (amount > 0) pushLog(state, `通缉度 +${amount}（现在 ${Math.round(state.player.heat)}）。`, 'heat')
}

function policeChance(state) {
  const heat = state.player.heat
  if (heat <= 0) return 0
  return clamp(heat / 260, 0.02, 0.45)
}

function maybeEncounter(state, car) {
  const p = state.player
  if (chance(policeChance(state))) {
    state.pending = {
      type: 'police',
      title: '警车跟在后面',
      text: `一辆夏延警局的巡逻车亮起了灯，就在你${car ? '车' : '身'}后不到五十米。风向是从北边来的，路上没别的车。`,
      options: [
        { label: '靠边停下，配合检查', action: 'police_stop' },
        { label: `踩油门跑（车况 ${Math.round(p.car?.condition || 0)}）`, action: 'police_flee', disabled: !car },
        { label: '塞两百块现金', action: 'police_bribe', disabled: p.cash < 200 },
      ],
    }
  } else if (chance(0.12)) {
    state.pending = {
      type: 'road',
      title: '路上有人',
      text: '路边站着一个招手的人，穿着反光背心。身后的卡车熄着灯。',
      options: [
        { label: '停车看看', action: 'road_help' },
        { label: '直接开过去', action: 'road_ignore' },
      ],
    }
  }
}

export function resolvePending(state, action) {
  const p = state.player
  state.pending = null
  switch (action) {
    case 'police_stop': {
      if (p.heat > 45) {
        pushLog(state, '警察让你下车，手按在枪套上。你没有证件的部分被记进了系统。', 'police')
        arrest(state)
      } else {
        p.heat = clamp(p.heat - 25, 0, 100)
        pushLog(state, '警察看了看你的车和脸，问了两句，放你走了。', 'police')
      }
      break
    }
    case 'police_flee': {
      const success = chance(0.35 + (p.car?.condition || 0) / 200 - p.heat / 300)
      if (success) {
        p.heat = clamp(p.heat - 10, 0, 100)
        p.car.condition = clamp(p.car.condition - 6, 0, 100)
        pushLog(state, '你拐进小巷，从两条街之外绕了出去。后视镜里的灯远了。', 'police')
      } else {
        pushLog(state, '你在下一个路口被堵住了。两辆车，四个人。', 'police')
        arrest(state)
      }
      break
    }
    case 'police_bribe': {
      p.cash -= 200
      p.heat = clamp(p.heat - 60, 0, 100)
      pushLog(state, '你把两张一百的夹在驾照里递过去。警察看了一眼，挥手让你走。', 'police')
      break
    }
    case 'road_help': {
      if (chance(0.4)) {
        pushLog(state, '背心男人说他的卡车没油了。你分了他一点，他记下了你的车牌。', 'road')
      } else {
        const cash = 120 + rnd(180)
        p.cash += cash
        p.goods += 1
        addHeat(state, 8)
        pushLog(state, `他塞给你 ${money(cash)} 和一个小包裹：「别问，往北送。」`, 'road')
      }
      break
    }
    case 'road_ignore':
      pushLog(state, '你踩下油门。后视镜里，那个人一直站着没动。', 'road')
      break
    default:
      break
  }
}

function arrest(state) {
  const p = state.player
  const lost = Math.round(p.cash * 0.5)
  p.cash -= lost
  p.heat = 0
  advanceTime(state, 6 * 60)
  pushLog(state, `你被带进夏延警局，关了一夜。保释和「手续费」拿走了 ${money(lost)}。`, 'police')
}

// ---------------------------------------------------------------- 地点动作
export function actionsAt(state) {
  const place = placeAtPlayer(state)
  const p = state.player
  const list = []
  if (!place) {
    list.push({ id: 'look', label: '四处看看' })
    return list
  }
  const t = place.t
  if (t === 'store' || t === 'fuel') {
    list.push({ id: 'rob_store', label: '抢劫收银台' })
    list.push({ id: 'buy_supply', label: '买点补给（$40）' })
  }
  if (t === 'bank') list.push({ id: 'rob_bank', label: '抢银行' })
  if (t === 'pawn') {
    list.push({ id: 'sell_goods', label: `卖掉手里的货（${p.goods} 件）` })
    list.push({ id: 'buy_info', label: '打听消息（$60）' })
    list.push({ id: 'buy_gun', label: '问老板「有没有别的货」（$450）' })
  }
  if (t === 'weapons') list.push({ id: 'buy_gun', label: '买一把枪（$450）' })
  if (t === 'garage' || t === 'dealer') {
    list.push({ id: 'repair', label: '修车（$180）' })
    list.push({ id: 'replate', label: '换车牌（$260，降低通缉）' })
  }
  if (t === 'motel') {
    list.push({ id: 'sleep', label: '睡一觉（8 小时）' })
    list.push({ id: 'save', label: '存档' })
  }
  if (t === 'hospital' || t === 'clinic') list.push({ id: 'heal', label: '处理伤口（$220）' })
  if (t === 'contact') list.push({ id: 'talk', label: '和他谈谈' })
  if (t === 'yard') list.push({ id: 'scavenge', label: '翻找货场' })
  if (t === 'gate') list.push({ id: 'scout', label: '在外围踩点' })
  list.push({ id: 'look', label: '四处看看' })
  return list
}

export function doAction(state, actionId) {
  const p = state.player
  const place = placeAtPlayer(state)
  const name = place?.name || place?.n || '这里'
  switch (actionId) {
    case 'rob_store': {
      if (!p.weapon) {
        pushLog(state, '你摸了摸口袋，只有钥匙。空手抢便利店是另一种自杀方式。', 'crime')
        break
      }
      const take = 80 + rnd(220)
      p.cash += take
      addHeat(state, 22)
      advanceTime(state, 6)
      pushLog(state, `你把枪口对准收银员，抓走了 ${money(take)}。警报在第三分钟响起。`, 'crime')
      if (chance(0.5)) maybeEncounter(state, true)
      break
    }
    case 'rob_bank': {
      if (!p.weapon) { pushLog(state, '没有枪，银行保安会先笑，再报警。', 'crime'); break }
      if (p.heat > 25) { pushLog(state, '你太显眼了，柜台后面的人在看你。换个时间。', 'crime'); break }
      const take = 900 + rnd(1400)
      p.cash += take
      addHeat(state, 55)
      advanceTime(state, 12)
      pushLog(state, `你翻过柜台，把抽屉和保险柜里的 ${money(take)} 扫进包里。`, 'crime')
      state.pending = {
        type: 'police',
        title: '出城的路上',
        text: '两辆警车从北边的街口拐出来，警灯在风里晃。',
        options: [
          { label: '靠边停下', action: 'police_stop' },
          { label: '冲向 I-80 匝道', action: 'police_flee' },
          { label: '塞钱（$600）', action: 'police_bribe_big', disabled: p.cash < 600 },
        ],
      }
      break
    }
    case 'buy_supply': {
      if (p.cash < 40) { pushLog(state, '钱不够。', 'info'); break }
      p.cash -= 40
      p.health = clamp(p.health + 12, 0, 100)
      pushLog(state, '你买了两瓶水、一包创可贴和一罐能量饮料。', 'info')
      break
    }
    case 'sell_goods': {
      if (p.goods <= 0) { pushLog(state, '手里没货。', 'info'); break }
      const price = 140 + rnd(120)
      const total = price * p.goods
      p.cash += total
      pushLog(state, `当铺老板一件一件数过去，给了 ${money(total)}。`, 'info')
      p.goods = 0
      addHeat(state, 5)
      break
    }
    case 'buy_info': {
      if (p.cash < 60) { pushLog(state, '钱不够。', 'info'); break }
      p.cash -= 60
      pushLog(state, '老板压低声音：「南边货场这两天没人查，但别开自己的车去。」', 'info')
      break
    }
    case 'buy_gun': {
      if (p.cash < 450) { pushLog(state, '老板看了看你的钱包，摇头。', 'info'); break }
      p.cash -= 450
      p.weapon = 'pistol'
      p.ammo += 24
      pushLog(state, '你买了一把二手手枪和两盒子弹。老板没问用途。', 'info')
      break
    }
    case 'repair': {
      if (p.cash < 180) { pushLog(state, '钱不够。', 'info'); break }
      p.cash -= 180
      p.car.condition = clamp(p.car.condition + 25, 0, 100)
      p.car.fuel = 100
      pushLog(state, '修车厂换了机油、补了胎，油箱也满了。', 'info')
      break
    }
    case 'replate': {
      if (p.cash < 260) { pushLog(state, '钱不够。', 'info'); break }
      p.cash -= 260
      addHeat(state, -20)
      pushLog(state, '新牌照装上了。修车厂老板说这号码是「从一辆报废车上借的」。', 'info')
      break
    }
    case 'sleep': {
      advanceTime(state, 8 * 60)
      p.health = clamp(p.health + 35, 0, 100)
      p.heat = clamp(p.heat - 15, 0, 100)
      pushLog(state, '你睡了一觉。梦里有人在敲窗，醒来发现是风。', 'info')
      break
    }
    case 'save': {
      saveToSlot(state, 1)
      pushLog(state, '你把车钥匙和现金藏进床垫，记下了这一天的位置。', 'info')
      break
    }
    case 'heal': {
      if (p.cash < 220) { pushLog(state, '医院要先付钱。', 'info'); break }
      p.cash -= 220
      p.health = 100
      pushLog(state, '护士给你缝了几针，收了现金，没问是谁打的。', 'info')
      break
    }
    case 'talk': {
      const contact = CONTACTS.find((c) => c.id === state.placeId)
      if (!contact) break
      if (!state.contactsMet.includes(contact.id)) {
        state.contactsMet.push(contact.id)
        pushLog(state, `${contact.name}打量了你一会儿：「车不错，人一般。想挣钱？」`, 'contact')
      }
      const available = MISSIONS.filter((m) => m.giver === contact.id && !state.completed.includes(m.id) && !state.missions.some((a) => a.id === m.id))
      if (available.length) {
        const mission = available[0]
        state.missions.push({ ...mission, step: 0 })
        pushLog(state, `「${mission.brief}」`, 'mission')
        pushLog(state, `任务开始：${mission.title}。`, 'mission')
      } else {
        pushLog(state, `${contact.name}摊手：「现在没活儿。」`, 'contact')
      }
      break
    }
    case 'scavenge': {
      if (chance(0.55)) {
        const cash = 60 + rnd(140)
        p.cash += cash
        pushLog(state, `你在两节车厢之间找到一只没锁的工具箱，里面有 ${money(cash)}。`, 'info')
      } else {
        addHeat(state, 8)
        pushLog(state, '手电光扫过来。你贴着车厢蹲了半分钟，什么都没拿到。', 'info')
      }
      advanceTime(state, 20)
      break
    }
    case 'scout': {
      advanceTime(state, 25)
      addHeat(state, 4)
      pushLog(state, '你在外围转了一圈，记下了换班时间和摄像头死角。', 'info')
      break
    }
    case 'look':
    default: {
      advanceTime(state, 8)
      pushLog(state, `${name}：${place?.desc || '风把塑料袋吹到铁丝网上，挂在上面下不来。'}`, 'info')
      break
    }
  }
  checkMissions(state)
}

// ---------------------------------------------------------------- 任务
export const MISSIONS = [
  {
    id: 'm_boost', title: '借一辆车', giver: 'c_rodeo', reward: 900,
    brief: '竞技场东边停车场有辆没锁的银色皮卡。开走，停到铁路货场后门。别上高速。',
    steps: [
      { text: '去竞技场东侧停车场找到那辆皮卡', type: 'goto', pos: { x: 3600, y: 1500 } },
      { text: '把车开到铁路货场后门', type: 'goto', pos: { x: -900, y: 2300 } },
    ],
  },
  {
    id: 'm_store', title: '两分钟的活', giver: 'c_yard', reward: 1400,
    brief: '北边那家便利店盘账日现金最多。抢完别往家开，绕 I-80 转一圈再回。',
    steps: [
      { text: '抢劫一家便利店', type: 'rob_store' },
      { text: '甩掉通缉：把通缉度降到 20 以下', type: 'heat', value: 20 },
    ],
  },
  {
    id: 'm_cargo', title: '没上清单的车厢', giver: 'c_yard', reward: 1100,
    brief: '货场三号道有节车厢没登记。把里面的货带出来，卖给当铺。',
    steps: [
      { text: '到调车场翻货', type: 'scavenge' },
      { text: '把货卖到当铺', type: 'sell_goods' },
    ],
  },
  {
    id: 'm_refinery', title: '炼油厂的账', giver: 'c_hill', reward: 1600,
    brief: '去炼油厂大门外面踩点，回来告诉我他们几点换班。',
    steps: [{ text: '在炼油厂大门外围踩点', type: 'scout' }],
  },
]

function checkMissions(state) {
  if (!state.missions.length) return
  const mission = state.missions[0]
  const step = mission.steps[mission.step]
  if (!step) return
  let done = false
  if (step.type === 'goto') {
    done = Math.hypot(state.pos.x - step.pos.x, state.pos.y - step.pos.y) < 120
  } else if (step.type === 'rob_store') {
    done = state.log.some((entry) => entry.text.includes('抓走了') && entry.text.includes('警报'))
  } else if (step.type === 'heat') {
    done = state.player.heat <= step.value
  } else if (step.type === 'scavenge') {
    done = state.log.some((entry) => entry.text.includes('工具箱'))
  } else if (step.type === 'sell_goods') {
    done = state.log.some((entry) => entry.text.includes('当铺老板一件一件数'))
  } else if (step.type === 'scout') {
    done = state.log.some((entry) => entry.text.includes('摄像头死角'))
  }
  if (!done) return
  mission.step += 1
  pushLog(state, `进度：${step.text} —— 完成。`, 'mission')
  if (mission.step >= mission.steps.length) {
    state.player.cash += mission.reward
    state.completed.push(mission.id)
    state.missions = state.missions.filter((m) => m.id !== mission.id)
    pushLog(state, `任务完成：${mission.title}，报酬 ${money(mission.reward)}。`, 'mission')
  }
}

export function missionStatus(state) {
  return state.missions.map((mission) => ({
    id: mission.id,
    title: mission.title,
    step: mission.steps[mission.step]?.text || '完成',
    total: mission.steps.length,
    current: mission.step,
  }))
}

// ---------------------------------------------------------------- 商店补给
export function buySupplies(state) {
  return doAction(state, 'buy_supply')
}

// ---------------------------------------------------------------- 存档
export function saveToSlot(state, slot) {
  try {
    const payload = {
      version: 2,
      day: state.day,
      time: state.time,
      player: state.player,
      pos: state.pos,
      placeId: state.placeId,
      log: state.log.slice(0, 60),
      missions: state.missions,
      completed: state.completed,
      contactsMet: state.contactsMet,
      savedAt: Date.now(),
    }
    localStorage.setItem(`${SAVE_PREFIX}${slot}`, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function listSlots() {
  const out = []
  for (let i = 1; i <= SAVE_SLOTS; i += 1) {
    try {
      const raw = localStorage.getItem(`${SAVE_PREFIX}${i}`)
      if (!raw) { out.push({ slot: i, empty: true }); continue }
      const data = JSON.parse(raw)
      out.push({ slot: i, empty: false, day: data.day, cash: data.player?.cash || 0, savedAt: data.savedAt })
    } catch {
      out.push({ slot: i, empty: true })
    }
  }
  return out
}

export function loadFromSlot(map, slot) {
  try {
    const raw = localStorage.getItem(`${SAVE_PREFIX}${slot}`)
    if (!raw) return null
    const data = JSON.parse(raw)
    attachMap(map)
    const state = makeGame(map, data.player?.name || '无名')
    state.day = data.day || 1
    state.time = data.time || 360
    state.player = { ...state.player, ...data.player }
    state.pos = data.pos || state.pos
    state.placeId = data.placeId || null
    state.log = data.log || state.log
    state.missions = data.missions || []
    state.completed = data.completed || []
    state.contactsMet = data.contactsMet || []
    return state
  } catch {
    return null
  }
}

export function deleteSlot(slot) {
  localStorage.removeItem(`${SAVE_PREFIX}${slot}`)
}

export function resetGame(map) {
  return makeGame(map, '无名')
}
