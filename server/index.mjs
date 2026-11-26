// 跑团服务端：账号、玩家、管理员、行动裁定、信息不对等。
import http from 'http'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { judgeAction, CONTACT_LIST } from './judge.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_FILE = path.join(__dirname, 'db.json')
const MAP_FILE = path.join(__dirname, 'map.json')
const PORT = Number(process.env.PORT || 8788)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'cheyenne-admin'
const TICK_MINUTES = 30

// ---------------------------------------------------------------- 地图
const rawMap = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'))
const MAP = {
  pois: rawMap.pois.map((p) => ({ id: p.id, name: p.n, type: p.t, x: p.x, y: p.y })),
  center: rawMap.meta.center,
}
const POI_BY_ID = Object.fromEntries(MAP.pois.map((p) => [p.id, p]))

// ---------------------------------------------------------------- 存储
function loadDb() {
  const fresh = { accounts: [], players: [], sessions: {}, events: [], world: { day: 1, time: 6 * 60 }, nextPlayer: 1 }
  if (!fs.existsSync(DB_FILE)) return fresh
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
    return { ...fresh, ...raw, sessions: raw.sessions || {} }
  } catch (err) {
    console.error('db.json 损坏，备份后重建：', err.message)
    try { fs.copyFileSync(DB_FILE, `${DB_FILE}.broken-${Date.now()}`) } catch { /* ignore */ }
    return fresh
  }
}

let db = loadDb()

function saveDb() {
  const tmp = `${DB_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
  fs.renameSync(tmp, DB_FILE)
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex')
}

function newToken() {
  return crypto.randomBytes(24).toString('hex')
}

function publicPlayer(player) {
  return {
    id: player.id,
    username: player.username,
    name: player.name,
    cash: player.cash,
    health: player.health,
    heat: player.heat,
    day: db.world.day,
    time: db.world.time,
    pos: player.pos,
    place: player.placeId ? POI_BY_ID[player.placeId]?.name || null : null,
    vehicle: player.vehicle,
    inventory: player.inventory,
    missions: player.missions,
    knowledge: player.knowledge,
    history: player.history.slice(-60).reverse(),
    pending: player.pending || null,
    lastAction: player.lastAction || null,
  }
}

// ---------------------------------------------------------------- 工具
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const now = () => new Date().toISOString()

function advanceTime(minutes) {
  db.world.time += minutes
  while (db.world.time >= 1440) {
    db.world.time -= 1440
    db.world.day += 1
  }
}

function logTo(player, text, kind = 'judge') {
  player.history.push({ at: now(), day: db.world.day, time: db.world.time, text, kind })
  player.history = player.history.slice(-300)
}

function requireAuth(req) {
  const url = new URL(req.url, 'http://localhost')
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || ''
  const session = db.sessions[token]
  if (!session) return null
  if (session.role === 'admin') return { role: 'admin', token }
  const player = db.players.find((p) => p.id === session.playerId)
  if (!player) return null
  return { role: 'player', player, token }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk; if (data.length > 200_000) reject(new Error('too large')) })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------- 玩家创建
function makePlayer({ username, password, name, cash = 600, pos, placeId }) {
  const salt = crypto.randomBytes(8).toString('hex')
  const startPos = pos || { x: 0, y: 300 }
  const nearest = MAP.pois
    .map((p) => ({ p, d: Math.hypot(p.x - startPos.x, p.y - startPos.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4)
    .map((entry) => entry.p)
  const player = {
    id: db.nextPlayer++,
    username,
    salt,
    passwordHash: hashPassword(password, salt),
    name: name || username,
    cash,
    health: 100,
    heat: 0,
    pos: startPos,
    placeId: placeId || nearest[0]?.id || null,
    vehicle: { name: '1998 福特 F-150', fuel: 62, condition: 74 },
    inventory: { goods: 0, ammo: 0, medkits: 1 },
    missions: [],
    knowledge: {
      places: nearest.map((p) => p.id),
      contacts: [],
      rumors: [{ at: now(), text: '有人提到竞技场附近有个叫「马夫」的人。' }],
      notes: [],
    },
    history: [],
    pending: null,
    lastAction: null,
    createdAt: now(),
  }
  logTo(player, `你到达夏延。口袋里 $${cash}，车钥匙在手里。`, 'start')
  db.players.push(player)
  return player
}

function addAccount(username, password, role, playerId) {
  if (db.accounts.some((a) => a.username === username)) return null
  const salt = crypto.randomBytes(8).toString('hex')
  const account = {
    username,
    salt,
    passwordHash: hashPassword(password, salt),
    role,
    playerId: playerId || null,
    createdAt: now(),
  }
  db.accounts.push(account)
  return account
}

// ---------------------------------------------------------------- 路由
const DIST = path.join(__dirname, '..', 'dist')
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' }

function serveStatic(req, res, pathname) {
  let filePath = path.join(DIST, pathname === '/' ? 'index.html' : pathname)
  if (!filePath.startsWith(DIST)) { res.writeHead(403); res.end(); return true }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html')
    if (!fs.existsSync(filePath)) return false
  }
  const ext = path.extname(filePath)
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'access-control-allow-origin': '*' })
  fs.createReadStream(filePath).pipe(res)
  return true
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    json(res, 204, {})
    return
  }
  const url = new URL(req.url, `http://${req.headers.host}`)
  const route = `${req.method} ${url.pathname}`

  try {
    if (route === 'GET /api/health') {
      json(res, 200, { ok: true, players: db.players.length, day: db.world.day, time: db.world.time })
      return
    }

    if (route === 'POST /api/login') {
      const body = await readBody(req)
      const username = String(body.username || '').trim()
      const password = String(body.password || '')
      const account = db.accounts.find((a) => a.username === username)
      if (!account) return json(res, 401, { error: '账号或密码不对。' })
      if (hashPassword(password, account.salt) !== account.passwordHash) return json(res, 401, { error: '账号或密码不对。' })
      const token = newToken()
      db.sessions[token] = { role: account.role, playerId: account.playerId, at: now() }
      saveDb()
      if (account.role === 'admin') return json(res, 200, { role: 'admin', token, name: '管理员' })
      const player = db.players.find((p) => p.id === account.playerId)
      if (!player) return json(res, 401, { error: '玩家不存在。' })
      return json(res, 200, { role: 'player', token, player: publicPlayer(player) })
    }

    if (route === 'POST /api/admin/login') {
      const body = await readBody(req)
      if (String(body.token || '') !== ADMIN_TOKEN) return json(res, 401, { error: '管理员令牌不对。' })
      const token = newToken()
      db.sessions[token] = { role: 'admin', at: now() }
      saveDb()
      return json(res, 200, { role: 'admin', token })
    }

    if (route === 'GET /api/me') {
      const auth = requireAuth(req)
      if (!auth) return json(res, 401, { error: '未登录。' })
      if (auth.role === 'admin') return json(res, 200, { role: 'admin' })
      db.world.lastSeen = now()
      return json(res, 200, { role: 'player', player: publicPlayer(auth.player) })
    }

    if (route === 'GET /api/city') {
      const auth = requireAuth(req)
      if (!auth) return json(res, 401, { error: '未登录。' })
      if (auth.role === 'admin') {
        return json(res, 200, { pois: MAP.pois, known: MAP.pois.map((p) => p.id), admin: true })
      }
      const known = new Set(auth.player.knowledge.places)
      return json(res, 200, {
        pois: MAP.pois.filter((p) => known.has(p.id)),
        known: [...known],
        contacts: CONTACT_LIST,
        day: db.world.day,
        time: db.world.time,
      })
    }

    if (route === 'POST /api/action') {
      const auth = requireAuth(req)
      if (!auth || auth.role !== 'player') return json(res, 401, { error: '未登录。' })
      const body = await readBody(req)
      const text = String(body.text || '').trim()
      if (!text) return json(res, 400, { error: '行动不能为空。' })
      if (auth.player.pending) return json(res, 409, { error: '你还有没处理的事。', pending: auth.player.pending })
      const result = judgeAction({
        player: auth.player,
        text,
        db,
        map: MAP,
        poiById: POI_BY_ID,
        advanceTime,
        logTo,
      })
      auth.player.lastAction = { at: now(), text, outcome: result.narration }
      auth.player.pending = result.pending || null
      saveDb()
      return json(res, 200, { ok: true, result, player: publicPlayer(auth.player) })
    }

    if (route === 'POST /api/action/choose') {
      const auth = requireAuth(req)
      if (!auth || auth.role !== 'player') return json(res, 401, { error: '未登录。' })
      const body = await readBody(req)
      const choice = String(body.choice || '')
      const pending = auth.player.pending
      if (!pending) return json(res, 400, { error: '没有待处理事件。' })
      const option = (pending.options || []).find((o) => o.id === choice)
      if (!option) return json(res, 400, { error: '没有这个选项。' })
      const outcome = option.apply(auth.player, db, { advanceTime, logTo, map: MAP, poiById: POI_BY_ID })
      auth.player.pending = null
      logTo(auth.player, outcome, 'judge')
      saveDb()
      return json(res, 200, { ok: true, outcome, player: publicPlayer(auth.player) })
    }

    // ---------------------------------------------------------------- 管理端
    if (route === 'GET /api/admin/players') {
      const auth = requireAuth(req)
      if (!auth || auth.role !== 'admin') return json(res, 401, { error: '需要管理员。' })
      return json(res, 200, {
        players: db.players.map((p) => ({
          id: p.id, username: p.username, name: p.name, cash: p.cash, heat: p.heat,
          place: p.placeId ? POI_BY_ID[p.placeId]?.name : null,
          missions: p.missions.length, pending: !!p.pending, lastAction: p.lastAction,
        })),
        world: db.world,
      })
    }

    if (route === 'POST /api/admin/import') {
      const auth = requireAuth(req)
      if (!auth || auth.role !== 'admin') return json(res, 401, { error: '需要管理员。' })
      const body = await readBody(req)
      const list = Array.isArray(body.players) ? body.players : []
      const created = []
      const failed = []
      for (const item of list) {
        const username = String(item.username || '').trim()
        const password = String(item.password || '')
        if (!username || !password) { failed.push({ username, reason: '缺少账号或密码' }); continue }
        if (db.accounts.some((a) => a.username === username)) { failed.push({ username, reason: '账号已存在' }); continue }
        const player = makePlayer({
          username,
          password,
          name: item.name || username,
          cash: Number(item.cash) || 600,
          pos: item.pos,
          placeId: item.placeId,
        })
        addAccount(username, password, 'player', player.id)
        created.push({ id: player.id, username, name: player.name })
      }
      saveDb()
      return json(res, 200, { created, failed })
    }

    if (route === 'POST /api/admin/intel') {
      const auth = requireAuth(req)
      if (!auth || auth.role !== 'admin') return json(res, 401, { error: '需要管理员。' })
      const body = await readBody(req)
      const player = db.players.find((p) => p.id === Number(body.playerId))
      if (!player) return json(res, 404, { error: '找不到玩家。' })
      if (body.text) player.knowledge.rumors.push({ at: now(), text: String(body.text) })
      if (body.revealPlaceId && !player.knowledge.places.includes(body.revealPlaceId)) {
        player.knowledge.places.push(body.revealPlaceId)
      }
      logTo(player, body.text ? `情报：${body.text}` : '你收到一条匿名消息。', 'intel')
      saveDb()
      return json(res, 200, { ok: true })
    }

    if (route === 'POST /api/admin/resolve') {
      const auth = requireAuth(req)
      if (!auth || auth.role !== 'admin') return json(res, 401, { error: '需要管理员。' })
      const body = await readBody(req)
      const player = db.players.find((p) => p.id === Number(body.playerId))
      if (!player) return json(res, 404, { error: '找不到玩家。' })
      const patch = body.patch || {}
      if (typeof patch.cash === 'number') player.cash = patch.cash
      if (typeof patch.heat === 'number') player.heat = clamp(patch.heat, 0, 100)
      if (patch.text) logTo(player, String(patch.text), 'admin')
      saveDb()
      return json(res, 200, { ok: true })
    }

    if (route === 'POST /api/admin/world') {
      const auth = requireAuth(req)
      if (!auth || auth.role !== 'admin') return json(res, 401, { error: '需要管理员。' })
      const body = await readBody(req)
      if (typeof body.day === 'number') db.world.day = body.day
      if (typeof body.time === 'number') db.world.time = body.time
      if (typeof body.tick === 'number') advanceTime(body.tick * TICK_MINUTES)
      saveDb()
      return json(res, 200, { ok: true, world: db.world })
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      if (serveStatic(req, res, decodeURIComponent(url.pathname))) return
    }
    json(res, 404, { error: '没有这个接口。' })
  } catch (err) {
    console.error(err)
    json(res, 500, { error: err.message })
  }
})

// 初始管理员
if (!db.accounts.some((a) => a.role === 'admin')) {
  const username = process.env.ADMIN_USER || 'admin'
  const password = process.env.ADMIN_PASS || 'cheyenne'
  addAccount(username, password, 'admin', null)
  saveDb()
  console.log(`初始管理员：${username} / ${password}`)
}

server.listen(PORT, () => {
  console.log(`夏延跑团服务端：http://localhost:${PORT}`)
  console.log(`管理员令牌（用于 /api/admin/login）：${ADMIN_TOKEN}`)
  console.log(`玩家：${db.players.length} 人 · 第 ${db.world.day} 天 ${Math.floor(db.world.time / 60)}:${String(db.world.time % 60).padStart(2, '0')}`)
})
