// AI 判官：把玩家的自然语言行动翻译成结果、代价、情报变化。
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const rnd = (n) => Math.floor(Math.random() * n)
const chance = (p) => Math.random() < p
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`

export const CONTACT_LIST = [
  { id: 'c_rodeo', name: '马夫', role: '竞技场地头蛇', x: 3400, y: 1600 },
  { id: 'c_yard', name: '扳手', role: '调车场检修工', x: -1400, y: 2400 },
  { id: 'c_hill', name: '牧师', role: '山上的洗钱人', x: 6200, y: -2600 },
]

const MISSION_POOL = [
  {
    id: 'm_boost', giver: '马夫', title: '借一辆车', reward: 900,
    brief: '竞技场东边停车场有辆没锁的银色皮卡。开走，停到铁路货场后门。',
    step: '把车开到铁路货场附近',
    check: (player) => player.placeId && Math.hypot(player.pos.x + 900, player.pos.y - 2300) < 400,
  },
  {
    id: 'm_store', giver: '扳手', title: '两分钟的活', reward: 1200,
    brief: '北边那家便利店盘账日现金最多。抢完别往家开。',
    step: '抢一家店，然后让通缉度低于 20',
    check: (player) => player.missions?.[0]?.robbed && player.heat <= 20,
  },
  {
    id: 'm_scout', giver: '牧师', title: '炼油厂的换班表', reward: 1500,
    brief: '去炼油厂大门外踩点，记下换班时间，回来告诉我。',
    step: '去炼油厂大门附近待一会儿',
    check: (player) => Math.hypot(player.pos.x - 7800, player.pos.y - 1800) < 500 && player.missions?.[0]?.scouted,
  },
]

function findPlace(text, map, player, poiById) {
  const known = new Set(player.knowledge.places)
  const candidates = map.pois.filter((p) => known.has(p.id))
  const cleaned = text.replace(/[，。！？,.!?]/g, ' ')
  let best = null
  let bestScore = 0
  for (const poi of candidates) {
    const name = poi.name
    if (cleaned.includes(name)) {
      return poi
    }
    // 关键词：店名里的词
    const tokens = name.split(/[\s&'’]+/).filter((t) => t.length >= 2)
    let score = 0
    for (const token of tokens) if (cleaned.includes(token)) score += token.length
    if (score > bestScore) { bestScore = score; best = poi }
  }
  if (best && bestScore >= 4) return best
  return null
}

function locateUnknown(text, map, player) {
  const known = new Set(player.knowledge.places)
  const cleaned = text.replace(/[，。！？,.!?]/g, ' ')
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2)
  for (const poi of map.pois) {
    if (known.has(poi.id)) continue
    const name = poi.name
    if (tokens.some((t) => name.includes(t)) || name.split(/\s+/).some((t) => t.length > 3 && cleaned.includes(t))) {
      return poi
    }
  }
  return null
}

function placeOf(player, poiById) {
  return player.placeId ? poiById[player.placeId] : null
}

function revealNearby(player, poi, map) {
  const radius = 700
  const known = new Set(player.knowledge.places)
  const found = map.pois
    .filter((p) => !known.has(p.id) && Math.hypot(p.x - poi.x, p.y - poi.y) < radius)
    .slice(0, 3)
  for (const p of found) player.knowledge.places.push(p.id)
  return found
}

function policeEvent(player, map) {
  return {
    type: 'police',
    title: '警车跟在后面',
    text: '一辆夏延警局的巡逻车亮起灯，跟在你后面不到五十米。',
    options: [
      {
        id: 'stop',
        label: '靠边停下，配合检查',
        apply: (p, db, { logTo }) => {
          if (p.heat > 45) {
            const lost = Math.round(p.cash * 0.4)
            p.cash -= lost
            p.heat = 0
            return `警察把你带到警局，关了一夜，保释拿走了 ${money(lost)}。`
          }
          p.heat = clamp(p.heat - 20, 0, 100)
          return '警察问了两个问题，没查出什么，放你走了。'
        },
      },
      {
        id: 'flee',
        label: '踩油门跑',
        apply: (p, db, { logTo }) => {
          if (chance(0.45 + (p.vehicle?.condition || 0) / 300 - p.heat / 300)) {
            p.heat = clamp(p.heat - 10, 0, 100)
            if (p.vehicle) p.vehicle.condition = clamp(p.vehicle.condition - 5, 0, 100)
            return '你拐进小巷，从两条街外绕了出去。后视镜里的灯远了。'
          }
          p.heat = 0
          const lost = Math.round(p.cash * 0.35)
          p.cash -= lost
          return `你在下一个路口被堵住，被带进警局。保释和「手续费」拿走了 ${money(lost)}。`
        },
      },
      {
        id: 'bribe',
        label: '塞两百块现金',
        apply: (p) => {
          if (p.cash < 200) return '你摸遍口袋也凑不出两百块。警察把你带走了。'
          p.cash -= 200
          p.heat = clamp(p.heat - 50, 0, 100)
          return '你把两张一百夹在驾照里递过去，警察看了一眼，挥手让你走。'
        },
      },
    ],
  }
}

export function judgeAction({ player, text, db, map, poiById, advanceTime, logTo }) {
  const raw = text.trim()
  const cleaned = raw.replace(/\s+/g, ' ')
  const place = placeOf(player, poiById)
  const lines = []
  let pending = null

  // ---------------------------------------------------------------- 交通
  if (/去|前往|开车|走到|回|到|出发|过去/.test(cleaned) && !/抢劫|抢|买|卖/.test(cleaned)) {
    const target = findPlace(cleaned, map, player, poiById) || (chance(0.15) ? locateUnknown(cleaned, map, player) : null)
    if (!target) {
      const unknown = locateUnknown(cleaned, map, player)
      if (unknown) {
        lines.push(`你知道${unknown.name}在哪，但没有人告诉过你细节。先得找个人问问。`)
        advanceTime(15)
        return { narration: lines.join('\n'), pending: null }
      }
      lines.push('你站在原地想了一会儿，不确定那地方在哪。也许该先问问人。')
      advanceTime(10)
      return { narration: lines.join('\n'), pending: null }
    }
    const dist = Math.hypot(target.x - player.pos.x, target.y - player.pos.y)
    const car = player.vehicle && player.vehicle.fuel > 0 && player.vehicle.condition > 10
    const minutes = Math.max(4, Math.round(dist / (car ? 620 : 80)))
    advanceTime(minutes)
    if (car) {
      player.vehicle.fuel = clamp(player.vehicle.fuel - dist / 900, 0, 100)
      player.vehicle.condition = clamp(player.vehicle.condition - (chance(0.15) ? 2 : 0), 0, 100)
    }
    player.pos = { x: target.x, y: target.y }
    player.placeId = target.id
    lines.push(car
      ? `你开车过去，用了 ${minutes} 分钟，停在 ${target.name} 门口。`
      : `你步行穿过几个街区，${minutes} 分钟后到了 ${target.name}。`)
    const discovered = revealNearby(player, target, map)
    if (discovered.length) {
      lines.push(`路上你记住了这附近有：${discovered.map((d) => d.name).join('、')}。`)
      player.knowledge.notes.push({ at: Date.now(), text: `发现：${discovered.map((d) => d.name).join('、')}` })
    }
    if (chance(player.heat / 320)) pending = policeEvent(player, map)
    return { narration: lines.join('\n'), pending }
  }

  // ---------------------------------------------------------------- 抢劫
  if (/抢|打劫|洗劫|动手/.test(cleaned)) {
    if (!place) {
      lines.push('你站在街上，没有可以抢的东西。先找个店。')
      advanceTime(5)
      return { narration: lines.join('\n'), pending: null }
    }
    if (place.type === 'bank') {
      if (!player.inventory.ammo && !player.inventory.weapon) {
        lines.push('银行门口的保安看了你一眼。你没有家伙，这件事只能想想。')
        advanceTime(5)
        return { narration: lines.join('\n'), pending: null }
      }
      if (player.heat > 30) {
        lines.push('你太显眼了，柜台后面的人在打电话。换个时间。')
        advanceTime(5)
        return { narration: lines.join('\n'), pending: null }
      }
      const take = 900 + rnd(1400)
      player.cash += take
      player.heat = clamp(player.heat + 55, 0, 100)
      advanceTime(12)
      lines.push(`你翻过柜台，把抽屉和保险柜里的 ${money(take)} 扫进包里。警报在第三分钟响起。`)
      logTo(player, `抢劫银行：+${money(take)}，通缉 ${Math.round(player.heat)}。`, 'crime')
      pending = policeEvent(player, map)
      return { narration: lines.join('\n'), pending }
    }
    if (['store', 'fuel', 'bar', 'pharmacy'].includes(place.type)) {
      const armed = player.inventory.ammo > 0 || player.inventory.weapon
      if (!armed) {
        lines.push('你摸了摸口袋，只有钥匙。空手抢店是另一种自杀方式。')
        advanceTime(5)
        return { narration: lines.join('\n'), pending: null }
      }
      const take = 80 + rnd(220)
      player.cash += take
      player.heat = clamp(player.heat + 22, 0, 100)
      advanceTime(6)
      player.missions = (player.missions || []).map((m) => ({ ...m, robbed: true }))
      lines.push(`你把枪口对准收银员，抓走了 ${money(take)}。警报在第三分钟响起。`)
      logTo(player, `抢劫 ${place.name}：+${money(take)}，通缉 ${Math.round(player.heat)}。`, 'crime')
      if (chance(0.5)) pending = policeEvent(player, map)
      return { narration: lines.join('\n'), pending }
    }
    lines.push('这个地方看起来抢不出什么。')
    advanceTime(5)
    return { narration: lines.join('\n'), pending: null }
  }

  // ---------------------------------------------------------------- 买卖
  if (/买枪|买把枪|买武器|搞把枪|弄把枪/.test(cleaned)) {
    if (place && !['weapons', 'pawn', 'hardware', 'store'].includes(place.type)) {
      lines.push('这里不卖枪。你得去枪店，或者找个愿意私下交易的人。')
      advanceTime(5)
      return { narration: lines.join('\n'), pending: null }
    }
    if (player.cash < 450) {
      lines.push('老板看了看你的钱包，摇头。')
      advanceTime(5)
      return { narration: lines.join('\n'), pending: null }
    }
    player.cash -= 450
    player.inventory.weapon = 'pistol'
    player.inventory.ammo += 24
    player.heat = clamp(player.heat + 4, 0, 100)
    advanceTime(10)
    lines.push('你买了一把二手手枪和两盒子弹。老板没问用途。')
    logTo(player, '购买手枪，弹药 +24。', 'buy')
    return { narration: lines.join('\n'), pending: null }
  }

  if (/卖|销赃|出手|脱手/.test(cleaned)) {
    if (!place || !['pawn', 'bar', 'garage', 'store'].includes(place.type)) {
      lines.push('这地方不收来路不明的东西。找当铺或者熟人。')
      advanceTime(5)
      return { narration: lines.join('\n'), pending: null }
    }
    if (player.inventory.goods <= 0) {
      lines.push('你手里没货。')
      advanceTime(5)
      return { narration: lines.join('\n'), pending: null }
    }
    const total = player.inventory.goods * (140 + rnd(120))
    player.cash += total
    player.inventory.goods = 0
    player.heat = clamp(player.heat + 5, 0, 100)
    advanceTime(15)
    lines.push(`当铺老板一件一件数过去，给了 ${money(total)}。`)
    logTo(player, `销赃：+${money(total)}。`, 'money')
    return { narration: lines.join('\n'), pending: null }
  }

  // ---------------------------------------------------------------- 情报
  if (/打听|问|消息|情报|听说|认识/.test(cleaned) && !/联系|打电话|接活|任务|马夫|扳手|牧师/.test(cleaned)) {
    advanceTime(20)
    const known = new Set(player.knowledge.places)
    const pool = map.pois.filter((p) => !known.has(p.id))
    if (!pool.length) {
      lines.push('你问了一圈，能知道的地方你都知道了。')
      return { narration: lines.join('\n'), pending: null }
    }
    const found = pool.sort(() => Math.random() - 0.5).slice(0, 2)
    for (const f of found) player.knowledge.places.push(f.id)
    lines.push(`有人压低声音告诉你：${found.map((f) => f.name).join('、')} 最近有点事。`)
    player.knowledge.notes.push({ at: Date.now(), text: `情报：${found.map((f) => f.name).join('、')}` })
    logTo(player, `获得地点情报：${found.map((f) => f.name).join('、')}。`, 'intel')
    return { narration: lines.join('\n'), pending: null }
  }

  // ---------------------------------------------------------------- 联系人
  if (/联系|打电话|发短信|找.*马夫|找.*扳手|找.*牧师|接活|任务/.test(cleaned)) {
    advanceTime(15)
    const contact = CONTACT_LIST.find((c) => cleaned.includes(c.name))
    if (contact && !player.knowledge.contacts.includes(contact.id)) {
      player.knowledge.contacts.push(contact.id)
      lines.push(`你拨通了${contact.name}的电话。他报了个地址，让你过去谈。`)
      return { narration: lines.join('\n'), pending: null }
    }
    const existing = player.missions || []
    if (existing.length >= 2) {
      lines.push('你手上的活已经够多了，先把手头的办完。')
      return { narration: lines.join('\n'), pending: null }
    }
    const mission = MISSION_POOL.find((m) => !existing.some((e) => e.id === m.id))
    if (!mission) {
      lines.push('暂时没有新活。城里的人都谨慎起来了。')
      return { narration: lines.join('\n'), pending: null }
    }
    player.missions = [...existing, { id: mission.id, title: mission.title, giver: mission.giver, step: mission.step, reward: mission.reward, progress: 0 }]
    lines.push(`${mission.giver}给了你一个活：「${mission.brief}」`)
    logTo(player, `接受任务：${mission.title}。`, 'mission')
    return { narration: lines.join('\n'), pending: null }
  }

  // ---------------------------------------------------------------- 隐匿
  if (/躲|藏|低调|换牌|甩掉|避风头|消停/.test(cleaned)) {
    advanceTime(60)
    const reduce = 12 + rnd(18)
    player.heat = clamp(player.heat - reduce, 0, 100)
    if (chance(0.12)) {
      lines.push('你在后巷待了一个小时，有人路过看了你两眼，但没报警。')
    } else {
      lines.push(`你躲了一个小时，风声小了点。通缉度降到 ${Math.round(player.heat)}。`)
    }
    return { narration: lines.join('\n'), pending: null }
  }

  // ---------------------------------------------------------------- 休息
  if (/睡|休息|住|躺|过夜/.test(cleaned)) {
    advanceTime(8 * 60)
    player.health = clamp(player.health + 30, 0, 100)
    player.heat = clamp(player.heat - 12, 0, 100)
    lines.push('你睡了一觉。醒来时天已经亮了，风还在刮。')
    return { narration: lines.join('\n'), pending: null }
  }

  // ---------------------------------------------------------------- 等待 / 观察
  if (/等|观察|踩点|看看|盯着|盯梢/.test(cleaned)) {
    advanceTime(45)
    lines.push('你在原地待了四十五分钟，记下了几个进出的面孔和时间。')
    player.missions = (player.missions || []).map((m) => ({ ...m, scouted: true }))
    if (place) {
      const discovered = revealNearby(player, place, map)
      if (discovered.length) lines.push(`顺便摸清了附近：${discovered.map((d) => d.name).join('、')}。`)
    }
    return { narration: lines.join('\n'), pending: null }
  }

  // ---------------------------------------------------------------- 默认
  advanceTime(10)
  const suggestions = ['开车去某个地方（说出去哪）', '抢劫你现在站的地方', '找人打听消息', '联系联系人接活', '躲起来降低通缉度']
  lines.push('判官没理解你想做什么。可以试试：')
  lines.push(suggestions.map((s) => `· ${s}`).join('\n'))
  return { narration: lines.join('\n'), pending: null }
}
