// 前端 API 客户端：服务器地址自动从 server.json 解析，也可手动覆盖。
const KEY = 'cheyenne-server-v2'
export const DEFAULT_SERVER = ''

let resolved = null

export async function resolveServer() {
  if (resolved) return resolved
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}server.json?t=${Date.now()}`, { signal: AbortSignal.timeout(6000) })
    if (res.ok) {
      const data = await res.json()
      if (data.url) {
        resolved = String(data.url).replace(/\/+$/, '')
        return resolved
      }
    }
  } catch {
    /* 忽略：回退到本地保存的地址 */
  }
  resolved = localStorage.getItem(KEY) || DEFAULT_SERVER
  return resolved
}

export function getServer() {
  return resolved || localStorage.getItem(KEY) || DEFAULT_SERVER
}

export function setServer(url) {
  resolved = url.replace(/\/+$/, '')
  localStorage.setItem(KEY, resolved)
}

let token = localStorage.getItem('cheyenne-token') || ''

export function getToken() {
  return token
}

export function setToken(value) {
  token = value || ''
  if (value) localStorage.setItem('cheyenne-token', value)
  else localStorage.removeItem('cheyenne-token')
}

async function request(path, options = {}) {
  const server = await resolveServer()
  // 空地址表示与页面同源（服务端自己托管前端时）
  if (!server && typeof location !== 'undefined' && location.hostname.endsWith('github.io') && !options.allowStatic) {
    throw new Error('这是静态预览站，没有服务端。账号系统需要运行服务端：本地执行 node server/index.mjs 后打开 http://localhost:8788，或部署仓库里的 Dockerfile。')
  }

  const query = token ? `${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : ''
  let res
  try {
    res = await fetch(`${server}${path}${query}`, {
      ...options,
      signal: AbortSignal.timeout(25000),
      headers: { 'content-type': 'text/plain;charset=UTF-8', ...(options.headers || {}) },
    })
  } catch {
    throw new Error(`连不上服务器（${server || '同源'}）。可能服务器已停止，请让管理员重启后再试。`)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export const api = {
  health: () => request('/api/health'),
  login: (username, password) => request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  adminLogin: (adminToken) => request('/api/admin/login', { method: 'POST', body: JSON.stringify({ token: adminToken }) }),
  me: () => request('/api/me'),
  city: () => request('/api/city'),
  act: (text) => request('/api/action', { method: 'POST', body: JSON.stringify({ text }) }),
  choose: (choice) => request('/api/action/choose', { method: 'POST', body: JSON.stringify({ choice }) }),
  admin: {
    players: () => request('/api/admin/players'),
    importPlayers: (players) => request('/api/admin/import', { method: 'POST', body: JSON.stringify({ players }) }),
    intel: (playerId, text, revealPlaceId) => request('/api/admin/intel', { method: 'POST', body: JSON.stringify({ playerId, text, revealPlaceId }) }),
    resolve: (playerId, patch) => request('/api/admin/resolve', { method: 'POST', body: JSON.stringify({ playerId, patch }) }),
    world: (payload) => request('/api/admin/world', { method: 'POST', body: JSON.stringify(payload) }),
  },
}

// 地图静态数据（真实 OSM 夏延）
let staticMap = null
export async function loadStaticMap() {
  if (staticMap) return staticMap
  const res = await fetch(`${import.meta.env.BASE_URL}data/map.json`)
  if (!res.ok) throw new Error(`地图数据 ${res.status}`)
  staticMap = await res.json()
  return staticMap
}
