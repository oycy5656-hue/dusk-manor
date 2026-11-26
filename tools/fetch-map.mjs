// 从 OpenStreetMap 拉取夏延真实路网/建筑/水系/绿地/POI，简化后打包成游戏地图。
import fs from 'fs'
import path from 'path'

const OUT = path.resolve('public/data/map.json')
const RAW = path.resolve('.tmp-build/osm')
fs.mkdirSync(RAW, { recursive: true })
fs.mkdirSync(path.dirname(OUT), { recursive: true })

// 城区约 1/4，周边草原约 3/4：约 24km × 22km
const BBOX = { s: 41.04, w: -104.98, n: 41.26, e: -104.62 }
const CORE = { s: 41.115, w: -104.855, n: 41.165, e: -104.775 }
const CENTER = { lat: 41.14, lon: -104.82 }

const UA = 'cheyenne-heat-map/0.1 (local game build; data © OpenStreetMap contributors)'
const ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

const bboxStr = (b) => `${b.s},${b.w},${b.n},${b.e}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function overpass(name, query) {
  const file = path.join(RAW, `${name}.json`)
  if (fs.existsSync(file) && fs.statSync(file).size > 200) {
    console.log(`· ${name} 已有缓存 ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  if (process.env.CACHED_ONLY) {
    console.log(`· ${name} 未缓存，跳过（CACHED_ONLY）`)
    return { elements: [] }
  }
  let lastErr = null
  for (let round = 0; round < 3; round += 1) {
    for (const endpoint of ENDPOINTS) {
      const url = `${endpoint}?data=${encodeURIComponent(query)}`
      try {
        console.log(`… ${name} @ ${new URL(endpoint).host}`)
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        if (!text.startsWith('{')) throw new Error('bad body')
        const json = JSON.parse(text)
        fs.writeFileSync(file, text)
        console.log(`· ${name} ${(text.length / 1024).toFixed(0)} KB, ${json.elements?.length || 0} 要素`)
        return json
      } catch (err) {
        lastErr = err
        console.log(`  × ${new URL(endpoint).host}: ${err.message}`)
        await sleep(4000 + round * 6000)
      }
    }
  }
  throw new Error(`${name}: ${lastErr?.message || 'failed'}`)
}

const Q = {
  roads: `[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|service|track)$"](${bboxStr(BBOX)});
  way["railway"~"^(rail|light_rail|yard|siding)$"](${bboxStr(BBOX)});
);
out geom tags;`,
  buildings: `[out:json][timeout:240];
(
  way["building"](41.115,-104.855,41.14,-104.815);
  way["building"](41.115,-104.815,41.14,-104.775);
  way["building"](41.14,-104.855,41.165,-104.815);
  way["building"](41.14,-104.815,41.165,-104.775);
);
out geom;`,
  nature: `[out:json][timeout:180];
(
  way["natural"~"^(water|wood|scrub|grassland)$"](${bboxStr(BBOX)});
  way["waterway"~"^(river|stream|canal|ditch)$"](${bboxStr(BBOX)});
  way["landuse"~"^(residential|commercial|industrial|retail|farmland|meadow|grass|quarry|cemetery)$"](${bboxStr(BBOX)});
  way["leisure"~"^(park|pitch|golf_course|sports_centre)$"](${bboxStr(BBOX)});
);
out geom tags;`,
  pois: `[out:json][timeout:180];
(
  nwr["amenity"~"^(bank|fuel|pharmacy|police|hospital|clinic|bar|pub|restaurant|fast_food|cafe|convenience|pawnbroker|car_rental|car_repair|parking|bus_station|courthouse|townhall|prison)$"](${bboxStr(BBOX)});
  nwr["shop"~"^(supermarket|convenience|car|weapons|alcohol|pawnbroker|hardware|department_store)$"](${bboxStr(BBOX)});
  nwr["tourism"~"^(hotel|motel|museum|attraction)$"](${bboxStr(BBOX)});
  nwr["historic"~"^(monument|memorial)$"](${bboxStr(BBOX)});
);
out center tags;`,
}

// ---------------------------------------------------------------- 投影
const M_PER_DEG_LAT = 111320
const M_PER_DEG_LON = 111320 * Math.cos((CENTER.lat * Math.PI) / 180)
function project(lat, lon) {
  return [Math.round((lon - CENTER.lon) * M_PER_DEG_LON), Math.round(-(lat - CENTER.lat) * M_PER_DEG_LAT)]
}

// ---------------------------------------------------------------- 简化
function rdp(points, eps) {
  if (points.length < 4) return points
  const first = points[0]
  const last = points[points.length - 1]
  let maxDist = 0
  let index = 0
  const dx = last[0] - first[0]
  const dy = last[1] - first[1]
  const len = Math.hypot(dx, dy) || 1
  for (let i = 1; i < points.length - 1; i += 1) {
    const [x, y] = points[i]
    const dist = Math.abs(dy * x - dx * y + last[0] * first[1] - last[1] * first[0]) / len
    if (dist > maxDist) { maxDist = dist; index = i }
  }
  if (maxDist <= eps) return [first, last]
  const left = rdp(points.slice(0, index + 1), eps)
  const right = rdp(points.slice(index), eps)
  return [...left.slice(0, -1), ...right]
}

const ROAD_CLASS = {
  motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
  residential: 5, unclassified: 5, living_street: 5, service: 6, track: 7,
}

const quadrants = (b) => {
  const midLat = (b.s + b.n) / 2
  const midLon = (b.w + b.e) / 2
  return [
    { s: b.s, w: b.w, n: midLat, e: midLon },
    { s: b.s, w: midLon, n: midLat, e: b.e },
    { s: midLat, w: b.w, n: b.n, e: midLon },
    { s: midLat, w: midLon, n: b.n, e: b.e },
  ]
}

const poiQuery = (b) => `[out:json][timeout:90];
(
  nwr["amenity"~"^(bank|fuel|pharmacy|police|hospital|clinic|bar|pub|restaurant|fast_food|cafe|convenience|pawnbroker|car_repair|courthouse|townhall)$"](${bboxStr(b)});
  nwr["shop"~"^(supermarket|convenience|car|weapons|alcohol|pawnbroker|hardware|department_store)$"](${bboxStr(b)});
  nwr["tourism"~"^(hotel|motel|museum|attraction)$"](${bboxStr(b)});
);
out center tags;`

const buildingQuery = (b) => `[out:json][timeout:90];
way["building"](${bboxStr(b)});
out geom;`

const main = async () => {
  const layer = async (name, query) => {
    try {
      return await overpass(name, query)
    } catch (err) {
      console.log(`! ${name} 失败：${err.message}，该层留空`)
      return { elements: [] }
    }
  }
  const roads = await layer('roads', Q.roads)
  const nature = await layer('nature', Q.nature)
  const poisParts = []
  for (const [i, b] of quadrants(BBOX).entries()) {
    const part = await layer(`pois_${i}`, poiQuery(b))
    poisParts.push(...part.elements)
  }
  const pois = { elements: poisParts }
  const buildingParts = []
  for (const [i, b] of quadrants(CORE).entries()) {
    const part = await layer(`buildings_${i}`, buildingQuery(b))
    buildingParts.push(...part.elements)
  }
  const buildings = { elements: buildingParts }

  // 道路 / 铁路
  const roadOut = []
  const railOut = []
  for (const way of roads.elements) {
    if (!way.geometry || way.geometry.length < 2) continue
    const tags = way.tags || {}
    const pts = rdp(way.geometry.map((g) => project(g.lat, g.lon)), 6)
    if (pts.length < 2) continue
    if (tags.railway) {
      railOut.push({ k: tags.railway === 'yard' ? 'yard' : 'rail', p: pts })
      continue
    }
    const cls = ROAD_CLASS[tags.highway]
    if (cls === undefined) continue
    roadOut.push({
      k: cls,
      p: pts,
      n: tags.name || null,
      w: tags.lanes ? Math.min(6, Number(tags.lanes) || 2) : undefined,
    })
  }

  // 建筑
  const buildingOut = []
  for (const way of buildings.elements) {
    if (!way.geometry || way.geometry.length < 3) continue
    let poly = way.geometry.map((g) => project(g.lat, g.lon))
    if (poly.length > 3 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) {
      poly = poly.slice(0, -1)
    }
    let pts = rdp(poly, 2.5)
    if (pts.length < 3) pts = poly.slice(0, Math.min(poly.length, 16))
    if (pts.length < 3) continue
    let area = 0
    for (let i = 0; i < pts.length; i += 1) {
      const [x1, y1] = pts[i]
      const [x2, y2] = pts[(i + 1) % pts.length]
      area += x1 * y2 - x2 * y1
    }
    area = Math.abs(area) / 2
    if (area < 35) continue
    const tags = way.tags || {}
    buildingOut.push({
      p: pts,
      h: tags.height ? parseFloat(tags.height) || 0 : tags['building:levels'] ? Number(tags['building:levels']) * 3 : 0,
      k: tags.building === 'yes' ? 'b' : tags.building,
      n: tags.name || null,
    })
  }

  // 水系 / 绿地 / 用地
  const waterOut = []
  const greenOut = []
  const landOut = []
  for (const way of nature.elements) {
    if (!way.geometry || way.geometry.length < 2) continue
    const tags = way.tags || {}
    const isArea = way.geometry.length > 3 && (way.geometry[0].lat === way.geometry[way.geometry.length - 1].lat)
    const pts = rdp(way.geometry.map((g) => project(g.lat, g.lon)), isArea ? 8 : 4)
    if (tags.waterway) { waterOut.push({ k: 'stream', p: pts }); continue }
    if (tags.natural === 'water' && isArea) { waterOut.push({ k: 'lake', p: pts }); continue }
    if (tags.landuse) { landOut.push({ k: tags.landuse, p: pts }); continue }
    if (tags.leisure || tags.natural) {
      greenOut.push({ k: tags.leisure || tags.natural, p: pts })
    }
  }

  // POI
  const poiOut = []
  const seen = new Set()
  const TYPE_MAP = {
    bank: 'bank', fuel: 'fuel', pharmacy: 'pharmacy', police: 'police', hospital: 'hospital', clinic: 'clinic',
    bar: 'bar', pub: 'bar', restaurant: 'food', fast_food: 'food', cafe: 'food', convenience: 'store',
    pawnbroker: 'pawn', car_rental: 'dealer', car_repair: 'garage', parking: 'parking', bus_station: 'transit',
    courthouse: 'court', townhall: 'civic', prison: 'prison', supermarket: 'store', car: 'dealer',
    weapons: 'weapons', alcohol: 'store', hardware: 'hardware', department_store: 'store',
    hotel: 'motel', motel: 'motel', museum: 'museum', attraction: 'attraction', monument: 'monument', memorial: 'monument',
  }
  for (const el of pois.elements) {
    const tags = el.tags || {}
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    if (lat === undefined) continue
    const name = tags.name || tags.brand
    if (!name) continue
    const raw = tags.amenity || tags.shop || tags.tourism || tags.historic
    const type = TYPE_MAP[raw]
    if (!type) continue
    const key = `${name}|${Math.round(lat * 10000)}|${Math.round(lon * 10000)}`
    if (seen.has(key)) continue
    seen.add(key)
    const [x, y] = project(lat, lon)
    poiOut.push({ id: `osm-${el.type}-${el.id}`, n: name, t: type, x, y, tags: tags.amenity || tags.shop || tags.tourism || tags.historic })
  }

  const map = {
    meta: {
      city: 'Cheyenne, Wyoming',
      source: 'OpenStreetMap contributors (ODbL)',
      center: CENTER,
      bbox: BBOX,
      core: CORE,
      fetchedAt: new Date().toISOString().slice(0, 10),
      counts: { roads: roadOut.length, buildings: buildingOut.length, water: waterOut.length, green: greenOut.length, land: landOut.length, pois: poiOut.length },
    },
    roads: roadOut,
    rails: railOut,
    buildings: buildingOut,
    water: waterOut,
    green: greenOut,
    land: landOut,
    pois: poiOut,
  }
  fs.writeFileSync(OUT, JSON.stringify(map))
  const size = fs.statSync(OUT).size
  console.log('\n写入', OUT)
  console.log('大小', (size / 1024 / 1024).toFixed(2), 'MB')
  console.log('要素', map.meta.counts)
}

main().catch((err) => { console.error(err); process.exit(1) })
