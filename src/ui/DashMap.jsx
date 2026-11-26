import React, { useEffect, useRef } from 'react'

const ROAD_STYLE = {
  0: { w: 13, c: '#3a3a34' }, 1: { w: 10, c: '#35352f' }, 2: { w: 8, c: '#31312b' },
  3: { w: 6, c: '#2d2d27' }, 4: { w: 5, c: '#2a2a24' }, 5: { w: 3.4, c: '#262620' },
  6: { w: 2.2, c: '#22221d' }, 7: { w: 1.6, c: '#1e1e19' },
}
const LAND_COLORS = {
  residential: 'rgba(90, 82, 62, 0.16)', commercial: 'rgba(120, 96, 60, 0.2)',
  industrial: 'rgba(110, 80, 62, 0.22)', retail: 'rgba(130, 100, 70, 0.22)',
  farmland: 'rgba(74, 84, 56, 0.16)', meadow: 'rgba(78, 88, 58, 0.14)',
  grass: 'rgba(76, 88, 56, 0.12)', quarry: 'rgba(96, 88, 76, 0.24)', cemetery: 'rgba(60, 70, 58, 0.2)',
}

const TYPE_COLOR = {
  bank: '#d9b06a', police: '#5a7ab0', hospital: '#b05a5a', clinic: '#b05a5a',
  weapons: '#c08a4a', pawn: '#9a8ab0', store: '#8a8a6a', fuel: '#7a8a6a',
  food: '#8a7a5a', bar: '#9a6a5a', motel: '#7a9a8a', garage: '#8a8a5a',
  dealer: '#8a7a6a', pharmacy: '#6a9a8a', contact: '#d9a441',
}

export default function DashMap({ data, player, pois, contacts, onPick }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const camRef = useRef({ x: player?.pos.x || 0, y: player?.pos.y || 0, zoom: 0.22 })
  const sizeRef = useRef({ w: 900, h: 700, dpr: 1 })
  const dragRef = useRef(null)
  const dataRef = useRef(data)
  const playerRef = useRef(player)
  const poisRef = useRef(pois)
  const contactsRef = useRef(contacts)
  dataRef.current = data
  playerRef.current = player
  poisRef.current = pois
  contactsRef.current = contacts

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return undefined
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
      const p = playerRef.current
      const cam = camRef.current
      if (p && !dragRef.current) {
        cam.x += (p.pos.x - cam.x) * 0.12
        cam.y += (p.pos.y - cam.y) * 0.12
      }
      const { w, h, dpr } = sizeRef.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#0d0d0b'
      ctx.fillRect(0, 0, w, h)
      ctx.save()
      ctx.translate(w / 2, h / 2)
      ctx.scale(cam.zoom, cam.zoom)
      ctx.translate(-cam.x, -cam.y)

      const map = dataRef.current
      if (map) {
        for (const land of map.land) {
          const color = LAND_COLORS[land.k]
          if (!color) continue
          ctx.fillStyle = color
          poly(ctx, land.p)
          ctx.fill()
        }
        for (const green of map.green) {
          ctx.fillStyle = 'rgba(70, 92, 64, 0.2)'
          poly(ctx, green.p)
          ctx.fill()
        }
        for (const water of map.water) {
          if (water.k === 'lake') {
            ctx.fillStyle = 'rgba(50, 74, 88, 0.5)'
            poly(ctx, water.p)
            ctx.fill()
          } else {
            ctx.strokeStyle = 'rgba(60, 90, 110, 0.45)'
            ctx.lineWidth = 1.6
            line(ctx, water.p)
            ctx.stroke()
          }
        }
        if (cam.zoom > 0.15) {
          ctx.fillStyle = 'rgba(138, 124, 100, 0.6)'
          for (const b of map.buildings) {
            poly(ctx, b.p)
            ctx.fill()
          }
        }
        ctx.strokeStyle = 'rgba(140, 128, 108, 0.4)'
        ctx.lineWidth = 2
        for (const rail of map.rails) { line(ctx, rail.p); ctx.stroke() }
        for (const road of map.roads) {
          const style = ROAD_STYLE[road.k] || ROAD_STYLE[5]
          ctx.strokeStyle = style.c
          ctx.lineWidth = Math.max(0.8, style.w * Math.min(1, cam.zoom * 2.2))
          line(ctx, road.p)
          ctx.stroke()
        }
      }

      // 已知地点
      const list = poisRef.current || []
      const showLabels = cam.zoom > 0.4
      for (const poi of list) {
        ctx.fillStyle = TYPE_COLOR[poi.t] || '#8a8a7a'
        ctx.beginPath()
        ctx.arc(poi.x, poi.y, 5 / cam.zoom, 0, Math.PI * 2)
        ctx.fill()
        if (showLabels) {
          ctx.font = `${10 / cam.zoom}px "Noto Sans SC", sans-serif`
          ctx.fillStyle = 'rgba(240, 232, 216, 0.7)'
          ctx.textAlign = 'center'
          ctx.fillText(poi.name, poi.x, poi.y - 10 / cam.zoom)
        }
      }
      for (const c of contactsRef.current || []) {
        ctx.fillStyle = '#d9a441'
        ctx.beginPath()
        ctx.arc(c.x, c.y, 6 / cam.zoom, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(217,164,65,0.45)'
        ctx.lineWidth = 2 / cam.zoom
        ctx.beginPath()
        ctx.arc(c.x, c.y, 12 / cam.zoom, 0, Math.PI * 2)
        ctx.stroke()
      }

      if (p) {
        ctx.fillStyle = '#e08a2a'
        ctx.beginPath()
        ctx.arc(p.pos.x, p.pos.y, 7 / cam.zoom, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,220,170,0.9)'
        ctx.lineWidth = 2 / cam.zoom
        ctx.stroke()
      }
      ctx.restore()

      // 比例尺
      const meters = 2000
      const px = meters * cam.zoom
      if (px > 30) {
        ctx.strokeStyle = 'rgba(240,232,216,0.4)'
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(w - 40 - px, h - 28)
        ctx.lineTo(w - 40, h - 28)
        ctx.stroke()
        ctx.fillStyle = 'rgba(240,232,216,0.5)'
        ctx.font = '10px "Cascadia Mono", monospace'
        ctx.textAlign = 'right'
        ctx.fillText('2 km', w - 40, h - 32)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => { disposed = true; cancelAnimationFrame(raf); observer.disconnect() }
  }, [])

  const toWorld = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const cam = camRef.current
    const { w, h } = sizeRef.current
    return {
      x: cam.x + (clientX - rect.left - w / 2) / cam.zoom,
      y: cam.y + (clientY - rect.top - h / 2) / cam.zoom,
    }
  }

  return (
    <div className="dash-map" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          dragRef.current = { x: e.clientX, y: e.clientY, moved: 0, cx: camRef.current.x, cy: camRef.current.y }
          e.currentTarget.setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current
          if (!drag) return
          const dx = e.clientX - drag.x
          const dy = e.clientY - drag.y
          drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy))
          if (drag.moved > 5) {
            camRef.current.x = drag.cx - dx / camRef.current.zoom
            camRef.current.y = drag.cy - dy / camRef.current.zoom
          }
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current
          dragRef.current = null
          if (!drag || drag.moved > 5) return
          const point = toWorld(e.clientX, e.clientY)
          const threshold = 26 / camRef.current.zoom
          let best = null
          let bestDist = threshold
          for (const poi of poisRef.current || []) {
            const d = Math.hypot(poi.x - point.x, poi.y - point.y)
            if (d < bestDist) { bestDist = d; best = poi }
          }
          for (const c of contactsRef.current || []) {
            const d = Math.hypot(c.x - point.x, c.y - point.y)
            if (d < bestDist) { bestDist = d; best = { ...c, type: 'contact', name: c.name } }
          }
          if (best) onPick?.(best)
        }}
        onWheel={(e) => {
          e.preventDefault()
          camRef.current.zoom = Math.max(0.06, Math.min(1.6, camRef.current.zoom * (e.deltaY > 0 ? 0.88 : 1.14)))
        }}
      />
    </div>
  )
}

function poly(ctx, points) {
  ctx.beginPath()
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.closePath()
}
function line(ctx, points) {
  ctx.beginPath()
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
}
