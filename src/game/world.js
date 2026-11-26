// 夏延市：程序化城区、道路网、建筑、辖区与犯罪地点。
export const SIZE = { w: 4800, h: 3600 }
export const BLOCK = 300
export const ROAD = 30

export const DISTRICTS = [
  { id: 'capitol', name: '州议会区', en: 'CAPITOL HILL', color: '#c9a25a', x: 0, y: 0, w: 4800, h: 900 },
  { id: 'downtown', name: '市中心', en: 'DOWNTOWN', color: '#e08a2a', x: 0, y: 900, w: 3300, h: 1200 },
  { id: 'railyard', name: '铁路调车场', en: 'THE YARD', color: '#8a7a6a', x: 0, y: 2100, w: 2400, h: 900 },
  { id: 'refinery', name: '炼油区', en: 'REFINERY', color: '#c05a3a', x: 3300, y: 2100, w: 1500, h: 900 },
  { id: 'rodeo', name: '竞技场', en: 'RODEO GROUNDS', color: '#a88a5a', x: 2400, y: 2100, w: 900, h: 900 },
  { id: 'afb', name: '基地外围', en: 'AFB FRINGE', color: '#6a7a8a', x: 0, y: 0, w: 700, h: 3600 },
  { id: 'hills', name: '城郊丘陵', en: 'THE HILLS', color: '#5a6a4a', x: 3300, y: 0, w: 1500, h: 2100 },
]

const BUILDING_COLORS = {
  capitol: ['#3a3428', '#454032', '#2f2a20'],
  downtown: ['#2c2c30', '#3a3238', '#26262a', '#40382c'],
  railyard: ['#3a332a', '#2f2a22', '#454034'],
  refinery: ['#3a2a22', '#2f231c', '#443026'],
  rodeo: ['#3a3022', '#443a28'],
  afb: ['#2a3038', '#333a44'],
  hills: ['#2a2c24', '#33352a'],
}

const SOLID_POIS = new Set(['bank', 'store', 'gunshop', 'pawn', 'garage', 'hospital', 'police', 'safehouse', 'motel', 'dealer', 'depot'])

export function generateCity() {
  const buildings = []
  const blocks = []
  const props = []
  const lamps = []
  const cars = []

  for (let by = 0; by < Math.floor(SIZE.h / BLOCK); by += 1) {
    for (let bx = 0; bx < Math.floor(SIZE.w / BLOCK); bx += 1) {
      const x = bx * BLOCK + ROAD / 2
      const y = by * BLOCK + ROAD / 2
      const bw = BLOCK - ROAD
      const bh = BLOCK - ROAD
      const district = districtAt(x + bw / 2, y + bh / 2)
      blocks.push({ x, y, w: bw, h: bh, district: district.id })
      const roll = hash2(bx, by)
      // 特殊地块
      if (district.id === 'railyard') {
        const sheds = 2 + Math.round(roll * 2)
        for (let i = 0; i < sheds; i += 1) {
          buildings.push({
            x: x + 8, y: y + 16 + i * ((bh - 30) / sheds), w: bw - 16, h: (bh - 40) / sheds - 6,
            color: BUILDING_COLORS.railyard[i % 3], h3d: 6 + i, district: 'railyard', kind: 'shed',
          })
        }
        props.push({ type: 'track', x: x + bw / 2, y, w: bw, h: 4 })
      } else if (district.id === 'refinery') {
        const tanks = 3 + Math.round(roll * 3)
        for (let i = 0; i < tanks; i += 1) {
          props.push({
            type: 'tank',
            x: x + 30 + (i % 3) * ((bw - 60) / 2.6),
            y: y + 30 + Math.floor(i / 3) * ((bh - 60) / 1.6),
            r: 18 + roll * 10,
          })
        }
        buildings.push({ x: x + 10, y: y + bh - 44, w: bw - 20, h: 34, color: BUILDING_COLORS.refinery[0], h3d: 8, district: 'refinery', kind: 'plant' })
      } else if (district.id === 'capitol' && by === 0 && bx === 3) {
        buildings.push({ x: x + 40, y: y + 50, w: bw - 80, h: bh - 100, color: '#4a4234', h3d: 20, district: 'capitol', kind: 'capitol' })
        props.push({ type: 'dome', x: x + bw / 2, y: y + bh / 2, r: 44 })
      } else if (district.id === 'afb') {
        props.push({ type: 'fence', x, y, w: bw, h: 3 })
        if (roll > 0.6) buildings.push({ x: x + 20, y: y + 30, w: bw - 40, h: bh - 70, color: BUILDING_COLORS.afb[0], h3d: 5, district: 'afb', kind: 'barracks' })
      } else if (roll > 0.82) {
        // 停车场/空地
        props.push({ type: 'lot', x, y, w: bw, h: bh })
      } else {
        const count = 1 + Math.round(roll * 3)
        for (let i = 0; i < count; i += 1) {
          const cols = BUILDING_COLORS[district.id] || BUILDING_COLORS.downtown
          const w = count === 1 ? bw - 30 : (bw - 40) / 2 - 6
          const h = count <= 2 ? bh - 40 : (bh - 50) / 2 - 6
          const gx = x + 15 + (i % 2) * (w + 10)
          const gy = y + 15 + Math.floor(i / 2) * (h + 10)
          buildings.push({
            x: gx, y: gy, w, h,
            color: cols[Math.floor(hash2(bx + i, by) * cols.length)],
            h3d: 3 + Math.floor(hash2(bx, by + i) * 10) + (district.id === 'downtown' ? 8 : 0),
            district: district.id,
            kind: 'block',
          })
        }
      }
      // 路灯
      lamps.push({ x: x - 2, y: y - 2 }, { x: x + bw + 2, y: y + bh + 2 })
    }
  }

  const pois = buildPois()

  // 路边停车
  for (const poi of pois) {
    if (poi.parking) {
      for (let i = 0; i < 3; i += 1) {
        cars.push({
          x: poi.x + (i - 1) * 70,
          y: poi.y + 60,
          angle: 0,
          color: pickColor(),
          speed: 0,
          type: 'parked',
          driver: null,
        })
      }
    }
  }

  return { size: SIZE, buildings, blocks, props, lamps, pois, cars }
}

export function hash2(x, y) {
  let h = x * 374761393 + y * 668265263
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) >>> 0) / 4294967296
}

const CAR_COLORS = ['#8a3a2a', '#3a4a5a', '#5a5a52', '#7a6a3a', '#2f3a34', '#6a3a3a', '#3a3a44']

export function pickColor() {
  return CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]
}

export function districtAt(x, y) {
  for (const district of DISTRICTS) {
    if (x >= district.x && x < district.x + district.w && y >= district.y && y < district.y + district.h) {
      return district
    }
  }
  return DISTRICTS[1]
}

function buildPois() {
  return [
    { id: 'bank', name: '第一夏延银行', type: 'bank', x: 1560, y: 600, district: 'capitol', parking: true, blurb: '州里一半的牧场贷款都在这栋楼里。' },
    { id: 'capitol', name: '州议会大厦', type: 'landmark', x: 1050, y: 300, district: 'capitol', parking: true, blurb: '圆顶刚刷过漆，油漆钱是从教育预算里挪的。' },
    { id: 'police', name: '夏延警局', type: 'police', x: 750, y: 1250, district: 'downtown', parking: true, blurb: '三层楼，六十个警员，其中十二个真的干活。' },
    { id: 'hospital', name: '纪念医院', type: 'hospital', x: 2350, y: 1250, district: 'downtown', parking: true, blurb: '急诊室夜班只有两个护士。' },
    { id: 'store1', name: 'Loaf \'n Jug 便利店', type: 'store', x: 1350, y: 1500, district: 'downtown', parking: true, blurb: '收银台后面有摄像头，柜台下面有霰弹枪。' },
    { id: 'store2', name: 'Depot 杂货', type: 'store', x: 450, y: 1900, district: 'downtown', parking: true, blurb: '卖弹药、罐头和冷冻披萨。' },
    { id: 'gunshop', name: 'Frontier Arms', type: 'gunshop', x: 2550, y: 1650, district: 'downtown', parking: true, blurb: '老板不问用途，只问现金还是刷卡。' },
    { id: 'pawn', name: 'Depot 当铺', type: 'pawn', x: 1650, y: 2400, district: 'railyard', parking: true, blurb: '铁路工人发薪日之后，这里最热闹。' },
    { id: 'garage', name: 'High Plains 修车厂', type: 'garage', x: 3150, y: 2400, district: 'refinery', parking: true, blurb: '能改车、能销赃车、能喷漆换牌。' },
    { id: 'depot', name: '联合太平洋车站', type: 'depot', x: 900, y: 2700, district: 'railyard', parking: true, blurb: '货运比客运多，夜里更忙。' },
    { id: 'safehouse', name: '草原汽车旅馆', type: 'safehouse', x: 2700, y: 2950, district: 'rodeo', parking: true, blurb: '按周付现金，不问名字。' },
    { id: 'rodeo', name: '边疆竞技场', type: 'landmark', x: 2850, y: 2400, district: 'rodeo', parking: true, blurb: '七月的两周里，全州的人都挤在这里。' },
    { id: 'afb', name: 'F.E. Warren 检查站', type: 'landmark', x: 380, y: 300, district: 'afb', parking: false, blurb: '再往前就需要证件了。' },
    { id: 'refinery_gate', name: '炼油厂大门', type: 'landmark', x: 3600, y: 2400, district: 'refinery', parking: true, blurb: '烟囱二十四小时冒白汽，空气里有硫味。' },
    { id: 'dealer', name: '拖车场', type: 'dealer', x: 3900, y: 3300, district: 'hills', parking: true, blurb: '卖二手车，也卖不该在路上的车。' },
    { id: 'contact_rodeo', name: '联络人：马夫', type: 'contact', x: 2850, y: 2700, district: 'rodeo', blurb: '竞技场的马夫，认识所有赌马的人。' },
    { id: 'contact_yard', name: '联络人：扳手', type: 'contact', x: 1200, y: 2400, district: 'railyard', blurb: '调车场的检修工，知道哪节车厢没人查。' },
    { id: 'contact_hill', name: '联络人：牧师', type: 'contact', x: 3600, y: 900, district: 'hills', blurb: '在山上开小教堂，也替人洗钱。' },
  ]
}

export function isRoad(x, y) {
  return x % BLOCK < ROAD || y % BLOCK < ROAD
}

export function collide(state, x, y, radius = 9) {
  for (const building of state.city.buildings) {
    if (
      x + radius > building.x &&
      x - radius < building.x + building.w &&
      y + radius > building.y &&
      y - radius < building.y + building.h
    ) {
      return building
    }
  }
  if (x < 40 || y < 40 || x > SIZE.w - 40 || y > SIZE.h - 40) return { boundary: true }
  return null
}

export function nearestRoad(x, y) {
  const rx = Math.round(x / BLOCK) * BLOCK
  const ry = Math.round(y / BLOCK) * BLOCK
  return { x: Math.min(SIZE.w - 60, Math.max(60, rx)), y: Math.min(SIZE.h - 60, Math.max(60, ry)) }
}

export function poiAt(state, x, y, radius = 70) {
  let best = null
  let bestDist = radius
  for (const poi of state.city.pois) {
    const dist = Math.hypot(poi.x - x, poi.y - y)
    if (dist < bestDist) {
      bestDist = dist
      best = poi
    }
  }
  return best
}

export function spawnTraffic(city) {
  const cars = []
  for (let i = 0; i < 14; i += 1) {
    const horizontal = Math.random() > 0.5
    const lane = Math.floor(Math.random() * 12) * BLOCK + BLOCK / 2
    const along = Math.random() * (horizontal ? SIZE.w : SIZE.h)
    cars.push({
      x: horizontal ? along : lane,
      y: horizontal ? lane : along,
      angle: horizontal ? (Math.random() > 0.5 ? 0 : Math.PI) : (Math.random() > 0.5 ? Math.PI / 2 : -Math.PI / 2),
      speed: 60 + Math.random() * 40,
      color: pickColor(),
      type: 'traffic',
      dir: horizontal ? 'h' : 'v',
      parked: false,
    })
  }
  return cars
}
