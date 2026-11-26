import React, { useEffect, useRef } from 'react'
import { CONTACTS, VIRTUAL_POIS, currentDistrict } from '../game/engine.js'
import { POI_LABELS } from '../game/mapdata.js'

const ROAD_STYLE = {
  0: { w: 13, c: '#3a3a34' },
  1: { w: 10, c: '#35352f' },
  2: { w: 8, c: '#31312b' },
  3: { w: 6, c: '#2d2d27' },
  4: { w: 5, c: '#2a2a24' },
  5: { w: 3.4, c: '#262620' },
  6: { w: 2.2, c: '#22221d' },
  7: { w: 1.6, c: '#1e1e19' },
}

const LAND_COLORS = {
  residential: 'rgba(90, 82, 62, 0.16)',
  commercial: 'rgba(120, 96, 60, 0.2)',
  industrial: 'rgba(110, 80, 62, 0.22)',
  retail: 'rgba(130, 100, 70, 0.22)',
  farmland: 'rgba(74, 84, 56, 0.16)',
  meadow: 'rgba(78, 88, 58, 0.14)',
  grass: 'rgba(76, 88, 56, 0.12)',
  quarry: 'rgba(96, 88, 76, 0.24)',
  cemetery: 'rgba(60, 70, 58, 0.2)',
}

export default function MapView({ map, state, onPick, onTravel, selectedId }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const camRef = useRef({ x: state.pos.x, y: state.pos.y, zoom: 0.22 })
  const sizeRef = useRef({ w: 900, h: 700, dpr: 1 })
  const hoverRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !map) return undefined
    const ctx = canvas.getContext('2d')
    let raf = 0
    let disposed = false

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = wrap.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      if (sizeRef.current.w === w && sizeRef.current.h === h && sizeRef.current.dpr === dpr) return
      sizeRef.current = { w, h, dpr }
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)

    const draw = () => {
      if (disposed) return
      const st = stateRef.current
      const { w, h, dpr } = sizeRef.current
      const cam = camRef.current
      const target = st.travel ? st.travel.to : st.pos
      if (!dragRef.current) {
        cam.x += (target.x - cam.x) * 0.12
        cam.y += (target.y - cam.y) * 0.12
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#0d0d0b'
      ctx.fillRect(0, 0, w, h)

      ctx.save()
      ctx.translate(w / 2, h / 2)
      ctx.scale(cam.zoom, cam.zoom)
      ctx.translate(-cam.x, -cam.y)

      const view = {
        x0: cam.x - w / 2 / cam.zoom,
        x1: cam.x + w / 2 / cam.zoom,
        y0: cam.y - h / 2 / cam.zoom,
        y1: cam.y + h / 2 / cam.zoom,
      }

      // 用地
      for (const land of map.land) {
        const color = LAND_COLORS[land.k]
        if (!color) continue
        ctx.fillStyle = color
        tracePolygon(ctx, land.p)
        ctx.fill()
      }
      // 绿地
      for (const green of map.green) {
        ctx.fillStyle = 'rgba(70, 92, 64, 0.22)'
        tracePolygon(ctx, green.p)
        ctx.fill()
      }
      // 水系
      for (const water of map.water) {
        if (water.k === 'lake') {
          ctx.fillStyle = 'rgba(50, 74, 88, 0.55)'
          tracePolygon(ctx, water.p)
          ctx.fill()
        } else {
          ctx.strokeStyle = 'rgba(60, 90, 110, 0.5)'
          ctx.lineWidth = Math.max(1, 4 / cam.zoom * 0.12)
          ctx.beginPath()
          water.p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
          ctx.stroke()
        }
      }
      // 建筑
      if (cam.zoom > 0.16) {
        for (const b of map.buildings) {
          if (b.p[0][0] < view.x0 || b.p[0][0] > view.x1) continue
          ctx.fillStyle = 'rgba(138, 124, 100, 0.62)'
          ctx.strokeStyle = 'rgba(40, 36, 30, 0.7)'
          ctx.lineWidth = 0.8 / cam.zoom
          tracePolygon(ctx, b.p)
          ctx.fill()
          if (cam.zoom > 0.5) ctx.stroke()
        }
      }
      // 铁路
      ctx.strokeStyle = 'rgba(140, 128, 108, 0.5)'
      ctx.lineWidth = 2 / cam.zoom * 0.9
      for (const rail of map.rails) {
        ctx.beginPath()
        rail.p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
      }
      // 道路
      for (const road of map.roads) {
        const style = ROAD_STYLE[road.k] || ROAD_STYLE[5]
        ctx.strokeStyle = style.c
        ctx.lineWidth = Math.max(0.8, style.w * Math.min(1, cam.zoom * 2.2))
        ctx.beginPath()
        road.p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
      }

      // 路线
      if (st.travel) {
        ctx.strokeStyle = 'rgba(224, 138, 42, 0.8)'
        ctx.lineWidth = 2.4 / cam.zoom
        ctx.setLineDash([10 / cam.zoom, 8 / cam.zoom])
        ctx.beginPath()
        st.travel.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
        ctx.stroke()
        ctx.setLineDash([])
      }

      // 地点
      const showLabels = cam.zoom > 0.5
      for (const poi of map.pois) {
        if (poi.x < view.x0 || poi.x > view.x1 || poi.y < view.y0 || poi.y > view.y1) continue
        const isSelected = poi.id === selectedId
        const color = poiColor(poi.t)
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(poi.x, poi.y, isSelected ? 9 / cam.zoom : 4.5 / cam.zoom, 0, Math.PI * 2)
        ctx.fill()
        if (showLabels) {
          ctx.font = `${10 / cam.zoom}px "Noto Sans SC", sans-serif`
          ctx.fillStyle = 'rgba(240, 232, 216, 0.7)'
          ctx.textAlign = 'center'
          ctx.fillText(poi.n, poi.x, poi.y - 10 / cam.zoom)
        }
      }
      for (const contact of CONTACTS) {
        ctx.fillStyle = '#d9a441'
        ctx.beginPath()
        ctx.arc(contact.x, contact.y, 6 / cam.zoom, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(217, 164, 65, 0.5)'
        ctx.lineWidth = 2 / cam.zoom
        ctx.beginPath()
        ctx.arc(contact.x, contact.y, 12 / cam.zoom, 0, Math.PI * 2)
        ctx.stroke()
        if (showLabels) {
          ctx.font = `${10 / cam.zoom}px "Noto Sans SC", sans-serif`
          ctx.fillStyle = '#f0d8a8'
          ctx.textAlign = 'center'
          ctx.fillText(contact.name, contact.x, contact.y - 18 / cam.zoom)
        }
      }
      for (const v of VIRTUAL_POIS) {
        ctx.fillStyle = '#8a9aa8'
        ctx.beginPath()
        ctx.arc(v.x, v.y, 5 / cam.zoom, 0, Math.PI * 2)
        ctx.fill()
        if (showLabels) {
          ctx.font = `${10 / cam.zoom}px "Noto Sans SC", sans-serif`
          ctx.fillStyle = 'rgba(200, 210, 216, 0.75)'
          ctx.textAlign = 'center'
          ctx.fillText(v.name, v.x, v.y - 12 / cam.zoom)
        }
      }

      // 玩家
      const p = st.pos
      ctx.fillStyle = '#e08a2a'
      ctx.beginPath()
      ctx.arc(p.x, p.y, 7 / cam.zoom, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(255, 220, 170, 0.9)'
      ctx.lineWidth = 2 / cam.zoom
      ctx.stroke()

      // 比例尺
      ctx.restore()
      drawScale(ctx, cam, w, h)
      drawCompass(ctx, w, h, cam)

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { disposed = true; cancelAnimationFrame(raf); observer.disconnect() }
  }, [map, selectedId])

  const toWorld = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const cam = camRef.current
    const { w, h } = sizeRef.current
    return {
      x: cam.x + (clientX - rect.left - w / 2) / cam.zoom,
      y: cam.y + (clientY - rect.top - h / 2) / cam.zoom,
    }
  }

  const handleDown = (e) => {
    dragRef.current = { x: e.clientX, y: e.clientY, moved: 0, cx: camRef.current.x, cy: camRef.current.y }
    canvasRef.current.setPointerCapture?.(e.pointerId)
  }
  const handleMove = (e) => {
    hoverRef.current = toWorld(e.clientX, e.clientY)
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy))
    if (drag.moved > 5) {
      camRef.current.x = drag.cx - dx / camRef.current.zoom
      camRef.current.y = drag.cy - dy / camRef.current.zoom
    }
  }
  const handleUp = (e) => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.moved > 5) return
    const point = toWorld(e.clientX, e.clientY)
    const threshold = 22 / camRef.current.zoom
    let best = null
    let bestDist = threshold
    for (const poi of map.pois) {
      const d = Math.hypot(poi.x - point.x, poi.y - point.y)
      if (d < bestDist) { bestDist = d; best = poi }
    }
    for (const contact of CONTACTS) {
      const d = Math.hypot(contact.x - point.x, contact.y - point.y)
      if (d < bestDist) { bestDist = d; best = { ...contact, t: 'contact', n: contact.name } }
    }
    for (const v of VIRTUAL_POIS) {
      const d = Math.hypot(v.x - point.x, v.y - point.y)
      if (d < bestDist) { bestDist = d; best = { ...v, n: v.name, t: v.t } }
    }
    if (best) onPick?.(best)
    else onTravel?.(point)
  }
  const handleWheel = (e) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.88 : 1.14
    camRef.current.zoom = Math.max(0.06, Math.min(1.6, camRef.current.zoom * factor))
  }

  return (
    <div className="map-view" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onWheel={handleWheel}
      />
      <div className="map-legend">
        <span style={{ color: '#e08a2a' }}>● 你</span>
        <span style={{ color: '#d9a441' }}>● 联系人</span>
        <span style={{ color: '#5a6a7a' }}>● 设施</span>
      </div>
    </div>
  )
}

function tracePolygon(ctx, points) {
  ctx.beginPath()
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
}

function poiColor(t) {
  if (t === 'bank') return '#d9b06a'
  if (t === 'police') return '#5a7ab0'
  if (t === 'hospital' || t === 'clinic') return '#b05a5a'
  if (t === 'weapons') return '#b07a4a'
  if (t === 'pawn') return '#9a8ab0'
  if (t === 'contact') return '#d9a441'
  if (t === 'motel') return '#7a9a8a'
  return '#8a8a7a'
}

function drawScale(ctx, cam, w, h) {
  const meters = 2000
  const px = meters * cam.zoom
  if (px < 30) return
  ctx.strokeStyle = 'rgba(240, 232, 216, 0.5)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(w - 40 - px, h - 30)
  ctx.lineTo(w - 40, h - 30)
  ctx.stroke()
  ctx.fillStyle = 'rgba(240, 232, 216, 0.55)'
  ctx.font = '10px "Cascadia Mono", monospace'
  ctx.textAlign = 'right'
  ctx.fillText(`${meters / 1000} km`, w - 40, h - 34)
}

function drawCompass(ctx, w, h, cam) {
  ctx.strokeStyle = 'rgba(240, 232, 216, 0.28)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(46, 46, 22, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = 'rgba(240, 232, 216, 0.55)'
  ctx.font = '11px "Cascadia Mono", monospace'
  ctx.textAlign = 'center'
  ctx.fillText('N', 46, 30)
  ctx.beginPath()
  ctx.moveTo(46, 34)
  ctx.lineTo(42, 48)
  ctx.lineTo(46, 45)
  ctx.lineTo(50, 48)
  ctx.closePath()
  ctx.fill()
}
