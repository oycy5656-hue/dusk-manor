// 真实地图数据加载与空间查询（OpenStreetMap 夏延数据）。
let MAP = null
let loading = null

export function loadMap(onProgress) {
  if (MAP) return Promise.resolve(MAP)
  if (loading) return loading
  loading = (async () => {
    onProgress?.('正在载入夏延地图…')
    const res = await fetch(`${import.meta.env.BASE_URL}data/map.json`)
    if (!res.ok) throw new Error(`map.json ${res.status}`)
    const json = await res.json()
    MAP = prepare(json)
    onProgress?.(`地图已载入：${MAP.roads.length} 条道路、${MAP.buildings.length} 栋建筑、${MAP.pois.length} 个地点`)
    return MAP
  })()
  return loading
}

function prepare(raw) {
  const roads = raw.roads.map((r) => ({
    ...r,
    bbox: bboxOf(r.p),
    length: lengthOf(r.p),
  }))
  const pois = raw.pois.map((p) => ({ ...p, kind: p.t }))
  const grid = buildGrid(pois, 1200)
  return {
    meta: raw.meta,
    roads,
    rails: raw.rails,
    buildings: raw.buildings,
    water: raw.water,
    green: raw.green,
    land: raw.land,
    pois,
    poisById: Object.fromEntries(pois.map((p) => [p.id, p])),
    grid,
  }
}

function bboxOf(points) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return [minX, minY, maxX, maxY]
}

function lengthOf(points) {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return total
}

function buildGrid(pois, cell) {
  const grid = new Map()
  for (const poi of pois) {
    const key = `${Math.floor(poi.x / cell)},${Math.floor(poi.y / cell)}`
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key).push(poi)
  }
  return { cell, map: grid }
}

export function nearbyPois(map, x, y, radius = 400) {
  const { cell, map: grid } = map.grid
  const out = []
  const cx = Math.floor(x / cell)
  const cy = Math.floor(y / cell)
  for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
    for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
      const list = grid.get(`${gx},${gy}`)
      if (!list) continue
      for (const poi of list) {
        const dist = Math.hypot(poi.x - x, poi.y - y)
        if (dist <= radius) out.push({ ...poi, dist })
      }
    }
  }
  return out.sort((a, b) => a.dist - b.dist)
}

export function nearestPoi(map, x, y, filter) {
  const list = nearbyPois(map, x, y, 1500).filter((p) => !filter || filter(p))
  return list[0] || null
}

export function nearestRoad(map, x, y) {
  let best = null
  let bestDist = Infinity
  for (const road of map.roads) {
    const [minX, minY, maxX, maxY] = road.bbox
    if (x < minX - 60 || x > maxX + 60 || y < minY - 60 || y > maxY + 60) continue
    for (let i = 1; i < road.p.length; i += 1) {
      const [x1, y1] = road.p[i - 1]
      const [x2, y2] = road.p[i]
      const dx = x2 - x1
      const dy = y2 - y1
      const len = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len))
      const px = x1 + t * dx
      const py = y1 + t * dy
      const dist = Math.hypot(px - x, py - y)
      if (dist < bestDist) {
        bestDist = dist
        best = { road, x: px, y: py, dist }
      }
    }
  }
  return best
}

export function streetNameAt(map, x, y) {
  const nearest = nearestRoad(map, x, y)
  return nearest?.road?.n || '无名道路'
}

export function districtOf(map, x, y) {
  const center = map.meta.center
  const dx = (x / 111320) / Math.cos((center.lat * Math.PI) / 180)
  const dy = -y / 111320
  const lat = center.lat + dy
  const lon = center.lon + dx
  const core = map.meta.core
  if (lat >= core.s && lat <= core.n && lon >= core.w && lon <= core.e) {
    if (y < -1200) return { id: 'north', name: '北区 / 州议会一带' }
    if (y > 1400) return { id: 'south', name: '南区 / 铁路与工业' }
    if (x > 1800) return { id: 'east', name: '东区 / 商业带' }
    if (x < -1800) return { id: 'west', name: '西区 / 住宅' }
    return { id: 'downtown', name: '市中心' }
  }
  if (Math.abs(x) > 8000 || Math.abs(y) > 7000) return { id: 'rural', name: '城外草原' }
  return { id: 'suburb', name: '城郊' }
}

// 沿道路估算旅行路线（取距离最近的两条路之间的折线近似）
export function routeBetween(map, from, to) {
  const a = nearestRoad(map, from.x, from.y)
  const b = nearestRoad(map, to.x, to.y)
  const points = [{ x: from.x, y: from.y }]
  if (a) points.push({ x: a.x, y: a.y })
  if (b && (!a || Math.hypot(a.x - b.x, a.y - b.y) > 40)) points.push({ x: b.x, y: b.y })
  points.push({ x: to.x, y: to.y })
  const distance = Math.hypot(to.x - from.x, to.y - from.y)
  return { points, distance }
}

export const POI_LABELS = {
  bank: '银行', fuel: '加油站', store: '商店', food: '餐馆', bar: '酒吧', pharmacy: '药房',
  pawn: '当铺', weapons: '枪店', garage: '修车厂', dealer: '车行', motel: '旅馆',
  police: '警察', hospital: '医院', clinic: '诊所', parking: '停车场', transit: '车站',
  court: '法院', civic: '市政', prison: '监狱', museum: '博物馆', monument: '纪念地',
  attraction: '景点', hardware: '五金店',
}
