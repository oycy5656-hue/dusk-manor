// 游戏状态与循环：步行、驾驶、枪战、通缉、犯罪、任务、存档。
import {
  generateCity, spawnTraffic, collide, poiAt, districtAt, isRoad, nearestRoad,
  SIZE, BLOCK, ROAD, pickColor, hash2,
} from './world.js'

const SAVE_PREFIX = 'cheyenne-heat-slot-'
const SAVE_SLOTS = 3

export const WEAPONS = {
  fists: { name: '拳头', dmg: 8, rate: 0.45, range: 28, ammo: false },
  pistol: { name: '手枪', dmg: 22, rate: 0.3, range: 520, ammo: true, price: 450 },
  shotgun: { name: '霰弹枪', dmg: 52, rate: 0.85, range: 260, ammo: true, price: 1200 },
}

export const MISSIONS = [
  {
    id: 'boost', title: '车行麻烦', giver: 'contact_rodeo',
    brief: '马夫要一辆停在拖车场的皮卡，原样开到修车厂。别刮花，别被拍照。',
    steps: [
      { poi: 'dealer', action: 'steal', label: '在拖车场把车开走' },
      { poi: 'garage', action: 'deliver', label: '把车开到 High Plains 修车厂' },
    ],
    reward: 900, heat: 1,
  },
  {
    id: 'store', title: '便利店的两分钟', giver: 'contact_yard',
    brief: '扳手说 Loaf \'n Jug 的保险柜里有一周的流水。两分钟，够不够？',
    steps: [
      { poi: 'store1', action: 'rob', label: '抢劫便利店收银台' },
      { poi: null, action: 'evade', label: '甩掉警察' },
    ],
    reward: 1400, heat: 3,
  },
  {
    id: 'cargo', title: '没人查的车厢', giver: 'contact_yard',
    brief: '调车场三号道有节车厢没上清单。把里面的货拉到当铺，别走大街。',
    steps: [
      { poi: 'depot', action: 'steal', label: '从车站货场取货' },
      { poi: 'pawn', action: 'deliver', label: '把货交给 Depot 当铺' },
    ],
    reward: 1100, heat: 2,
  },
  {
    id: 'shakedown', title: '炼油厂的账', giver: 'contact_hill',
    brief: '牧师想让人知道，炼油厂的账本不该只有一份。去门口谈，谈不拢就动手。',
    steps: [
      { poi: 'refinery_gate', action: 'interact', label: '去炼油厂大门找人谈' },
      { poi: 'contact_hill', action: 'deliver', label: '回山上的教堂复命' },
    ],
    reward: 1600, heat: 2,
  },
]

const WEATHERS = [
  { id: 'clear', name: '晴', fog: 0 },
  { id: 'wind', name: '大风', fog: 0.05 },
  { id: 'snow', name: '雪', fog: 0.12 },
  { id: 'storm', name: '暴风雪', fog: 0.22 },
]

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const rand = (n) => Math.floor(Math.random() * n)
const chance = (p) => Math.random() < p
let nextId = 1

export function newGame() {
  const city = generateCity()
  const state = {
    version: 1,
    city,
    cars: [...city.cars, ...spawnTraffic(city)],
    cops: [],
    peds: spawnPeds(city),
    bullets: [],
    particles: [],
    player: {
      x: 1515, y: 1515, angle: 0, hp: 100, armor: 0, cash: 750,
      wanted: 0, onFoot: true, carId: null, weapon: 'pistol', ammo: { pistol: 12, shotgun: 0 },
      contraband: 2, medkits: 1, stamina: 100, arrested: false, hospital: false,
      heat: 0, lastCrime: -999, district: 'downtown',
    },
    time: 8 * 60,
    weather: 'clear',
    mission: null,
    completed: [],
    log: [{ t: Date.now(), text: '你在草原汽车旅馆醒来。窗外风很大，手机里有一条没署名的短信：想挣钱，去竞技场找马夫。' }],
    prompt: null,
    screen: 'game',
    paused: false,
    lastSpawn: 0,
  }
  return state
}

function spawnPeds(city) {
  const peds = []
  for (let i = 0; i < 24; i += 1) {
    const poi = city.pois[rand(city.pois.length)]
    peds.push({
      x: poi.x + (Math.random() - 0.5) * 140,
      y: poi.y + (Math.random() - 0.5) * 140,
      angle: Math.random() * Math.PI * 2,
      speed: 35 + Math.random() * 25,
      color: ['#7a5a4a', '#5a6a7a', '#6a5a5a', '#4a5a4a'][rand(4)],
      panic: 0,
      alive: true,
    })
  }
  return peds
}

export function log(state, text) {
  state.log.unshift({ t: Date.now(), text })
  state.log = state.log.slice(0, 60)
}

// ---------------------------------------------------------------- 犯罪与通缉
export function addWanted(state, amount) {
  const p = state.player
  p.wanted = clamp(p.wanted + amount, 0, 5)
  p.lastCrime = state.time
  if (amount > 0) {
    log(state, amount >= 3 ? '事情闹大了，警笛已经在路上。' : '有人报了警。')
  }
}

export function decayWanted(state, dt) {
  const p = state.player
  if (p.wanted <= 0) return
  const nearCop = state.cops.some((cop) => Math.hypot(cop.x - p.x, cop.y - p.y) < 700)
  if (nearCop) return
  p.heat -= dt * 0.6
  if (p.heat <= -1) {
    p.wanted = Math.max(0, p.wanted - 1)
    p.heat = 0
    if (p.wanted === 0) log(state, '警笛声远了，暂时没人找你。')
  }
}

// ---------------------------------------------------------------- 输入与移动
export function update(state, dt, input) {
  if (state.screen !== 'game' || state.paused) return
  const p = state.player
  state.time += dt * 1.2 // 1 现实秒 = 1.2 游戏分钟
  while (state.time >= 1440) state.time -= 1440

  // 天气
  if (Math.random() < dt * 0.01) {
    state.weather = WEATHERS[rand(WEATHERS.length)].id
  }

  const car = p.onFoot ? null : state.cars.find((c) => c.id === p.carId)
  if (p.onFoot) {
    moveOnFoot(state, dt, input)
  } else if (car) {
    driveCar(state, car, dt, input)
  }

  updateCops(state, dt)
  updateTraffic(state, dt)
  updatePeds(state, dt)
  updateBullets(state, dt)
  decayWanted(state, dt)
  spawnCopsIfNeeded(state)
  updateMission(state)
  updatePrompt(state)

  if (p.hp <= 0) {
    if (p.onFoot) {
      p.hp = 0
      state.paused = true
      state.screen = 'wasted'
    }
  }
}

function moveOnFoot(state, dt, input) {
  const p = state.player
  let ax = 0
  let ay = 0
  if (input.keys.has('w') || input.keys.has('arrowup')) ay -= 1
  if (input.keys.has('s') || input.keys.has('arrowdown')) ay += 1
  if (input.keys.has('a') || input.keys.has('arrowleft')) ax -= 1
  if (input.keys.has('d') || input.keys.has('arrowright')) ax += 1
  const sprint = input.keys.has('shift') && p.stamina > 5
  const speed = (sprint ? 235 : 135) * dt
  if (sprint && (ax || ay)) p.stamina = clamp(p.stamina - dt * 22, 0, 100)
  else p.stamina = clamp(p.stamina + dt * 12, 0, 100)
  if (ax || ay) {
    const len = Math.hypot(ax, ay)
    const nx = p.x + (ax / len) * speed
    const ny = p.y + (ay / len) * speed
    if (!collide(state, nx, p.y)) p.x = nx
    if (!collide(state, p.x, ny)) p.y = ny
    p.angle = Math.atan2(ay, ax)
  }
  p.district = districtAt(p.x, p.y).id
}

function driveCar(state, car, dt, input) {
  const p = state.player
  const accel = input.keys.has('w') || input.keys.has('arrowup') ? 260 : input.keys.has('s') || input.keys.has('arrowdown') ? -160 : 0
  const steer = (input.keys.has('a') || input.keys.has('arrowleft') ? -1 : 0) + (input.keys.has('d') || input.keys.has('arrowright') ? 1 : 0)
  car.speed = clamp(car.speed + accel * dt, -80, 340)
  car.speed *= 1 - dt * 0.8
  if (Math.abs(car.speed) > 4) car.angle += steer * dt * 1.9 * Math.min(1, Math.abs(car.speed) / 120)
  const nx = car.x + Math.cos(car.angle) * car.speed * dt
  const ny = car.y + Math.sin(car.angle) * car.speed * dt
  const hit = collide(state, nx, ny, 12)
  if (hit) {
    if (Math.abs(car.speed) > 160) p.hp -= 4 * Math.min(1, Math.abs(car.speed) / 200)
    car.speed *= -0.18
  } else {
    car.x = nx
    car.y = ny
  }
  p.x = car.x
  p.y = car.y
  p.district = districtAt(p.x, p.y).id
}

export function toggleVehicle(state) {
  const p = state.player
  if (p.onFoot) {
    const near = state.cars
      .filter((c) => c.type !== 'police' || true)
      .map((c) => ({ car: c, dist: Math.hypot(c.x - p.x, c.y - p.y) }))
      .filter((entry) => entry.dist < 46 && !collide(state, entry.car.x, entry.car.y, 14))
      .sort((a, b) => a.dist - b.dist)[0]
    if (!near) return { ok: false, reason: '附近没有车。' }
    const car = near.car
    if (car.type === 'parked' || car.type === 'traffic') {
      addWanted(state, car.type === 'traffic' ? 1 : 1)
      log(state, '你把车主拽了出来。')
    }
    car.type = 'player'
    car.speed = 0
    car.id = car.id || nextId++
    p.onFoot = false
    p.carId = car.id
    return { ok: true }
  }
  const car = state.cars.find((c) => c.id === p.carId)
  if (car) {
    car.type = 'parked'
    car.speed = 0
    p.x = car.x + 30
    p.y = car.y + 20
  }
  p.onFoot = true
  p.carId = null
  return { ok: true }
}

// ---------------------------------------------------------------- 枪械
export function shoot(state, worldX, worldY) {
  const p = state.player
  if (!p.onFoot) return
  const weapon = WEAPONS[p.weapon]
  const now = performance.now() / 1000
  if (state.lastShot && now - state.lastShot < weapon.rate) return
  if (weapon.ammo && (p.ammo[p.weapon] || 0) <= 0) {
    log(state, '没子弹了。')
    return
  }
  state.lastShot = now
  if (weapon.ammo) p.ammo[p.weapon] -= 1
  const angle = Math.atan2(worldY - p.y, worldX - p.x)
  p.angle = angle
  const count = p.weapon === 'shotgun' ? 6 : 1
  for (let i = 0; i < count; i += 1) {
    const spread = p.weapon === 'shotgun' ? (Math.random() - 0.5) * 0.34 : (Math.random() - 0.5) * 0.04
    state.bullets.push({
      x: p.x + Math.cos(angle) * 20,
      y: p.y + Math.sin(angle) * 20,
      vx: Math.cos(angle + spread) * 900,
      vy: Math.sin(angle + spread) * 900,
      life: weapon.range / 900,
      dmg: weapon.dmg,
      from: 'player',
    })
  }
  addWanted(state, p.weapon === 'fists' ? 0 : 0.5)
  if (p.weapon === 'fists') return
}

export function punch(state, wx, wy) {
  const p = state.player
  const angle = Math.atan2(wy - p.y, wx - p.x)
  p.angle = angle
  for (const ped of state.peds) {
    if (!ped.alive) continue
    if (Math.hypot(ped.x - p.x, ped.y - p.y) < 34) {
      ped.alive = false
      ped.panic = 0
      addWanted(state, 3)
      log(state, '路人倒下了。')
      return
    }
  }
  for (const cop of state.cops) {
    if (Math.hypot(cop.x - p.x, cop.y - p.y) < 34) {
      cop.hp -= 20
      addWanted(state, 2)
      return
    }
  }
}

function updateBullets(state, dt) {
  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * dt
    bullet.y += bullet.vy * dt
    bullet.life -= dt
    if (bullet.life <= 0) {
      bullet.dead = true
      continue
    }
    if (collide(state, bullet.x, bullet.y, 2)) {
      bullet.dead = true
      continue
    }
    for (const cop of state.cops) {
      if (Math.hypot(cop.x - bullet.x, cop.y - bullet.y) < 14) {
        cop.hp -= bullet.dmg
        bullet.dead = true
        if (cop.hp <= 0) {
          cop.alive = false
          addWanted(state, 2)
          log(state, '一名警员倒下了。')
        }
        break
      }
    }
    if (bullet.dead) continue
    for (const ped of state.peds) {
      if (!ped.alive) continue
      if (Math.hypot(ped.x - bullet.x, ped.y - bullet.y) < 12) {
        ped.alive = false
        bullet.dead = true
        addWanted(state, 3)
        log(state, '流弹打中了路人。')
        break
      }
    }
    if (bullet.dead) continue
    if (bullet.from === 'cop') {
      const p = state.player
      if (Math.hypot(p.x - bullet.x, p.y - bullet.y) < 13) {
        const dmg = bullet.dmg * (1 - Math.min(0.7, p.armor / 100))
        p.hp -= dmg
        if (p.armor > 0) p.armor = Math.max(0, p.armor - 8)
        bullet.dead = true
      }
    }
  }
  state.bullets = state.bullets.filter((b) => !b.dead)
}

// ---------------------------------------------------------------- 警察
function spawnCopsIfNeeded(state) {
  const p = state.player
  if (p.wanted <= 0) return
  const target = p.wanted * 2
  if (state.cops.length >= target) return
  const police = state.city.pois.find((poi) => poi.id === 'police')
  const angle = Math.random() * Math.PI * 2
  state.cops.push({
    id: nextId++,
    x: police.x + Math.cos(angle) * 60,
    y: police.y + Math.sin(angle) * 60,
    angle: 0,
    hp: 60,
    speed: 105 + p.wanted * 12,
    fireAt: 0,
    alive: true,
    onFoot: true,
  })
}

function updateCops(state, dt) {
  const p = state.player
  for (const cop of state.cops) {
    if (!cop.alive) continue
    const dist = Math.hypot(p.x - cop.x, p.y - cop.y)
    if (dist > 1200) {
      cop.x += (p.x - cop.x) * dt * 0.3
      cop.y += (p.y - cop.y) * dt * 0.3
      continue
    }
    const angle = Math.atan2(p.y - cop.y, p.x - cop.x)
    cop.angle = angle
    if (dist > 46) {
      const nx = cop.x + Math.cos(angle) * cop.speed * dt
      const ny = cop.y + Math.sin(angle) * cop.speed * dt
      if (!collide(state, nx, ny)) {
        cop.x = nx
        cop.y = ny
      }
    } else if (state.time - (cop.fireAt || 0) > 30) {
      cop.fireAt = state.time
      const spread = (Math.random() - 0.5) * 0.18
      state.bullets.push({
        x: cop.x + Math.cos(angle) * 14,
        y: cop.y + Math.sin(angle) * 14,
        vx: Math.cos(angle + spread) * 700,
        vy: Math.sin(angle + spread) * 700,
        life: 0.8,
        dmg: 9,
        from: 'cop',
      })
    }
  }
  state.cops = state.cops.filter((c) => c.alive && Math.hypot(p.x - c.x, p.y - c.y) < 2600)
}

// ---------------------------------------------------------------- 交通与行人
function updateTraffic(state, dt) {
  for (const car of state.cars) {
    if (car.type === 'player') continue
    if (car.type === 'parked') continue
    car.x += Math.cos(car.angle) * car.speed * dt
    car.y += Math.sin(car.angle) * car.speed * dt
    // 到路口随机转向
    const onGrid = Math.abs((car.x % BLOCK) - BLOCK / 2) < 6 && Math.abs((car.y % BLOCK) - BLOCK / 2) < 6
    if (onGrid && chance(0.25)) {
      car.angle += (chance(0.5) ? 1 : -1) * Math.PI / 2
    }
    if (car.x < 40 || car.y < 40 || car.x > SIZE.w - 40 || car.y > SIZE.h - 40) {
      car.angle += Math.PI
    }
    const hit = collide(state, car.x, car.y, 10)
    if (hit) {
      car.angle += Math.PI * 0.75
      car.speed = Math.max(40, car.speed * 0.6)
    }
  }
}

function updatePeds(state, dt) {
  const p = state.player
  for (const ped of state.peds) {
    if (!ped.alive) continue
    const dist = Math.hypot(ped.x - p.x, ped.y - p.y)
    if (p.wanted > 0 && dist < 260) ped.panic = 2
    if (ped.panic > 0) {
      ped.panic -= dt
      const angle = Math.atan2(ped.y - p.y, ped.x - p.x)
      ped.x += Math.cos(angle) * 120 * dt
      ped.y += Math.sin(angle) * 120 * dt
    } else {
      if (Math.random() < dt * 0.6) ped.angle += (Math.random() - 0.5) * 1.4
      ped.x += Math.cos(ped.angle) * ped.speed * dt
      ped.y += Math.sin(ped.angle) * ped.speed * dt
    }
    if (collide(state, ped.x, ped.y, 6)) {
      ped.angle += Math.PI
      ped.x -= Math.cos(ped.angle) * 20
      ped.y -= Math.sin(ped.angle) * 20
    }
  }
}

// ---------------------------------------------------------------- 交互
function updatePrompt(state) {
  const p = state.player
  const poi = poiAt(state, p.x, p.y, 80)
  state.prompt = poi ? { poi, text: promptFor(state, poi) } : null
}

function promptFor(state, poi) {
  switch (poi.type) {
    case 'store':
      return 'E：抢劫 / B：购买补给'
    case 'bank':
      return 'E：抢银行（高风险）'
    case 'gunshop':
      return 'E：买枪 / B：买弹药'
    case 'pawn':
      return 'E：销赃'
    case 'garage':
      return 'E：修车改车 / B：存车'
    case 'hospital':
      return 'E：治疗（$250）'
    case 'safehouse':
      return 'E：存档 / 睡觉'
    case 'dealer':
      return 'E：看车'
    case 'contact':
      return 'E：交谈'
    case 'police':
      return '你在警局门口。别做傻事。'
    default:
      return 'E：查看'
  }
}

export function interact(state) {
  const p = state.player
  const poi = poiAt(state, p.x, p.y, 80)
  if (!poi) return
  switch (poi.type) {
    case 'contact': {
      const mission = MISSIONS.find((m) => m.giver === poi.id && !state.completed.includes(m.id) && !state.mission)
      if (mission) {
        state.mission = { ...mission, step: 0, started: state.time }
        log(state, `接受任务：${mission.title}`)
      } else if (state.mission) {
        log(state, '「先把手上的事办完。」')
      } else {
        log(state, '「暂时没活儿。过两天再来。」')
      }
      break
    }
    case 'store': {
      state.player.cash += 120 + rand(120)
      addWanted(state, 2)
      log(state, '你抓走了收银机里的现金。')
      break
    }
    case 'bank': {
      if (p.wanted < 2) {
        log(state, '银行保安盯着你。先搞把枪，或者换个方式。')
        break
      }
      state.player.cash += 900 + rand(600)
      addWanted(state, 3)
      log(state, '你从银行柜台扫走了一大把钱。')
      break
    }
    case 'pawn': {
      const value = p.contraband * 140
      state.player.cash += value
      p.contraband = 0
      log(state, `当铺老板数了数货，给了 ₡${value}。`)
      break
    }
    case 'gunshop': {
      if (p.cash < 450) {
        log(state, '枪店老板看了看你的钱包，摇头。')
        break
      }
      p.cash -= 450
      p.weapon = 'pistol'
      p.ammo.pistol = (p.ammo.pistol || 0) + 24
      log(state, '你买了一把二手手枪和两盒子弹。')
      break
    }
    case 'hospital': {
      if (p.cash < 250) {
        log(state, '医院要先付钱。')
        break
      }
      p.cash -= 250
      p.hp = 100
      p.armor = 50
      log(state, '急诊室给你缝了几针，收了现金。')
      break
    }
    case 'safehouse': {
      p.hp = 100
      state.time += 6 * 60
      saveToSlot(state, 1)
      log(state, '你在汽车旅馆睡了一觉，顺手存了档。')
      break
    }
    case 'garage': {
      p.cash += 300
      log(state, '修车厂老板收下了你带来的零件，付了现金。')
      break
    }
    case 'dealer': {
      log(state, '拖车场里停着几辆没牌照的车。')
      break
    }
    default:
      log(state, poi.blurb || '没什么特别的。')
  }
}

// ---------------------------------------------------------------- 任务
function updateMission(state) {
  const mission = state.mission
  if (!mission) return
  const step = mission.steps[mission.step]
  if (!step) {
    finishMission(state)
    return
  }
  if (step.action === 'evade') {
    if (state.player.wanted === 0) {
      mission.step += 1
      log(state, '警笛声消失了。')
    }
    return
  }
  if (!step.poi) return
  const poi = state.city.pois.find((item) => item.id === step.poi)
  if (!poi) return
  const dist = Math.hypot(poi.x - state.player.x, poi.y - state.player.y)
  if (dist < 90 && !step.done) {
    step.done = true
    mission.step += 1
    log(state, `完成：${step.label}`)
    if (step.action === 'rob') addWanted(state, 3)
    if (step.action === 'steal') addWanted(state, 1)
    if (step.action === 'deliver') addWanted(state, 1)
    if (mission.step >= mission.steps.length) finishMission(state)
  }
}

function finishMission(state) {
  const mission = state.mission
  if (!mission) return
  state.player.cash += mission.reward
  state.completed.push(mission.id)
  log(state, `任务完成：${mission.title}，报酬 ₡${mission.reward}。`)
  state.mission = null
}

// ---------------------------------------------------------------- 存档
export function saveToSlot(state, slot) {
  try {
    const payload = {
      version: 1,
      player: state.player,
      time: state.time,
      weather: state.weather,
      mission: state.mission,
      completed: state.completed,
      log: state.log.slice(0, 30),
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
      if (!raw) {
        out.push({ slot: i, empty: true })
        continue
      }
      const data = JSON.parse(raw)
      out.push({ slot: i, empty: false, cash: data.player?.cash || 0, wanted: data.player?.wanted || 0, savedAt: data.savedAt })
    } catch {
      out.push({ slot: i, empty: true })
    }
  }
  return out
}

export function loadFromSlot(slot) {
  try {
    const raw = localStorage.getItem(`${SAVE_PREFIX}${slot}`)
    if (!raw) return null
    const data = JSON.parse(raw)
    const state = newGame()
    state.player = { ...state.player, ...data.player, carId: null, onFoot: true }
    state.time = data.time || state.time
    state.weather = data.weather || 'clear'
    state.mission = data.mission || null
    state.completed = data.completed || []
    state.log = data.log || state.log
    return state
  } catch {
    return null
  }
}

export function deleteSlot(slot) {
  localStorage.removeItem(`${SAVE_PREFIX}${slot}`)
}

export function formatTime(time) {
  const minutes = Math.floor(time)
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0')
  const mm = String(minutes % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

export function weatherName(id) {
  return WEATHERS.find((w) => w.id === id)?.name || '晴'
}

export function districtName(state) {
  return state.city.pois ? districtAt(state.player.x, state.player.y).name : '夏延'
}
