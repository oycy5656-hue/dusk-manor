import React, { useEffect, useRef } from 'react'
import { update } from '../game/game.js'
import { SIZE, BLOCK, ROAD, DISTRICTS, districtAt, poiAt } from '../game/world.js'

const ZOOM_FOOT = 0.62
const ZOOM_CAR = 0.46

export default function GameCanvas({ stateRef, inputRef, onHud, onInteract, onShoot, onPunch, onVehicle }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const camRef = useRef({ x: 0, y: 0, zoom: ZOOM_FOOT })
  const sizeRef = useRef({ w: 800, h: 600, dpr: 1 })
  const hoverRef = useRef({ x: 0, y: 0 })
  const cbRef = useRef({ onHud, onShoot, onPunch })
  cbRef.current = { onHud, onShoot, onPunch }

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return undefined
    const ctx = canvas.getContext('2d')
    let raf = 0
    let last = performance.now()
    let lastHud = 0
    let disposed = false

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const rect = wrap.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      if (sizeRef.current.w === width && sizeRef.current.h === height && sizeRef.current.dpr === dpr) return
      sizeRef.current = { w: width, h: height, dpr }
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)

    const frame = (now) => {
      if (disposed) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const state = stateRef.current
      window.__chFrames = (window.__chFrames || 0) + 1
      if (state) {
        window.__chOk = true
        try {
          update(state, dt, inputRef.current)
          draw(ctx, state, camRef.current, sizeRef.current, hoverRef.current, inputRef.current)
        } catch (err) {
          window.__chErr = String(err && err.stack || err).slice(0, 600)
        }
        if (now - lastHud > 180) {
          lastHud = now
          cbRef.current.onHud?.()
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [stateRef, inputRef])

  const toWorld = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const cam = camRef.current
    const { w, h } = sizeRef.current
    return {
      x: cam.x + (clientX - rect.left - w / 2) / cam.zoom,
      y: cam.y + (clientY - rect.top - h / 2) / cam.zoom,
    }
  }

  const handleClick = (event) => {
    const point = toWorld(event.clientX, event.clientY)
    const state = stateRef.current
    if (!state) return
    if (event.button === 2) {
      onPunch?.(point.x, point.y)
      return
    }
    if (state.player.weapon === 'fists') onPunch?.(point.x, point.y)
    else onShoot?.(point.x, point.y)
  }

  return (
    <div className="game-canvas" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onContextMenu={(e) => e.preventDefault()}
        onMouseMove={(e) => { hoverRef.current = toWorld(e.clientX, e.clientY) }}
      />
    </div>
  )
}

function draw(ctx, state, cam, size, hover, input) {
  const { w, h, dpr } = size
  const p = state.player
  const targetZoom = p.onFoot ? ZOOM_FOOT : ZOOM_CAR
  cam.zoom += (targetZoom - cam.zoom) * 0.04
  cam.x += (p.x - cam.x) * 0.12
  cam.y += (p.y - cam.y) * 0.12

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#141210'
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.translate(w / 2, h / 2)
  ctx.scale(cam.zoom, cam.zoom)
  ctx.translate(-cam.x, -cam.y)

  const view = {
    x0: cam.x - w / 2 / cam.zoom - 100,
    x1: cam.x + w / 2 / cam.zoom + 100,
    y0: cam.y - h / 2 / cam.zoom - 100,
    y1: cam.y + h / 2 / cam.zoom + 100,
  }

  // 地面
  for (const district of DISTRICTS) {
    if (district.x > view.x1 || district.x + district.w < view.x0) continue
    ctx.fillStyle = `${district.color}22`
    ctx.fillRect(district.x, district.y, district.w, district.h)
  }

  // 道路
  ctx.fillStyle = '#2a2826'
  for (let x = 0; x < SIZE.w; x += BLOCK) {
    ctx.fillRect(x, 0, ROAD, SIZE.h)
  }
  for (let y = 0; y < SIZE.h; y += BLOCK) {
    ctx.fillRect(0, y, SIZE.w, ROAD)
  }
  // 车道线
  ctx.strokeStyle = 'rgba(200, 180, 120, 0.25)'
  ctx.lineWidth = 1.4
  ctx.setLineDash([18, 22])
  for (let x = BLOCK / 2; x < SIZE.w; x += BLOCK) {
    if (x < view.x0 || x > view.x1) continue
    ctx.beginPath()
    ctx.moveTo(x, Math.max(0, view.y0))
    ctx.lineTo(x, Math.min(SIZE.h, view.y1))
    ctx.stroke()
  }
  for (let y = BLOCK / 2; y < SIZE.h; y += BLOCK) {
    if (y < view.y0 || y > view.y1) continue
    ctx.beginPath()
    ctx.moveTo(Math.max(0, view.x0), y)
    ctx.lineTo(Math.min(SIZE.w, view.x1), y)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // 道具
  for (const prop of state.city.props) {
    if (prop.x + 400 < view.x0 || prop.x - 400 > view.x1) continue
    if (prop.type === 'tank') {
      ctx.fillStyle = '#6a5a4a'
      ctx.beginPath()
      ctx.arc(prop.x, prop.y, prop.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.beginPath()
      ctx.arc(prop.x - prop.r * 0.25, prop.y - prop.r * 0.25, prop.r * 0.5, 0, Math.PI * 2)
      ctx.fill()
    } else if (prop.type === 'lot') {
      ctx.fillStyle = 'rgba(40, 40, 38, 0.6)'
      ctx.fillRect(prop.x, prop.y, prop.w, prop.h)
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.06)'
      ctx.strokeRect(prop.x + 6, prop.y + 6, prop.w - 12, prop.h - 12)
    } else if (prop.type === 'fence') {
      ctx.strokeStyle = 'rgba(120, 130, 140, 0.5)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(prop.x, prop.y)
      ctx.lineTo(prop.x + prop.w, prop.y)
      ctx.stroke()
    } else if (prop.type === 'track') {
      ctx.strokeStyle = 'rgba(150, 150, 150, 0.35)'
      ctx.lineWidth = 2
      for (let i = 0; i < 4; i += 1) {
        ctx.beginPath()
        ctx.moveTo(prop.x - prop.w / 2, prop.y + i * 8)
        ctx.lineTo(prop.x + prop.w / 2, prop.y + i * 8)
        ctx.stroke()
      }
    } else if (prop.type === 'dome') {
      ctx.fillStyle = '#6a6048'
      ctx.beginPath()
      ctx.arc(prop.x, prop.y, prop.r, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // 建筑
  for (const b of state.city.buildings) {
    if (b.x + b.w < view.x0 || b.x > view.x1 || b.y + b.h < view.y0 || b.y > view.y1) continue
    const shade = Math.min(0.5, b.h3d * 0.02)
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h)
    ctx.fillStyle = b.color
    ctx.fillRect(b.x, b.y, b.w, b.h)
    ctx.fillStyle = `rgba(255, 240, 210, ${0.04 + shade})`
    ctx.fillRect(b.x + 4, b.y + 4, b.w - 8, 6)
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 1
    ctx.strokeRect(b.x, b.y, b.w, b.h)
    // 窗户
    if (b.kind === 'block' && b.w > 60) {
      ctx.fillStyle = 'rgba(255, 210, 140, 0.10)'
      for (let wx = b.x + 10; wx < b.x + b.w - 10; wx += 18) {
        for (let wy = b.y + 16; wy < b.y + b.h - 10; wy += 22) {
          if ((wx + wy) % 3 === 0) ctx.fillRect(wx, wy, 6, 8)
        }
      }
    }
  }

  // 兴趣点
  for (const poi of state.city.pois) {
    if (poi.x < view.x0 || poi.x > view.x1 || poi.y < view.y0 || poi.y > view.y1) continue
    const color = poi.type === 'police' ? '#4a7ad0' : poi.type === 'hospital' ? '#d05a5a' : poi.type === 'contact' ? '#c9a25a' : '#d9b06a'
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.beginPath()
    ctx.arc(poi.x, poi.y, 15, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 2.4
    ctx.stroke()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(poi.x, poi.y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = '600 11px "Noto Sans SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(8,7,6,0.75)'
    const width = ctx.measureText(poi.name).width + 10
    ctx.fillRect(poi.x - width / 2, poi.y - 38, width, 16)
    ctx.fillStyle = '#e6dcc8'
    ctx.fillText(poi.name, poi.x, poi.y - 26)
  }

  // 任务标记
  if (state.mission) {
    const step = state.mission.steps[state.mission.step]
    if (step?.poi) {
      const poi = state.city.pois.find((item) => item.id === step.poi)
      if (poi) {
        ctx.strokeStyle = 'rgba(226, 138, 42, 0.9)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(poi.x, poi.y, 26 + Math.sin(Date.now() / 260) * 4, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  }

  // 子弹
  for (const bullet of state.bullets) {
    ctx.strokeStyle = bullet.from === 'cop' ? 'rgba(140, 190, 255, 0.9)' : 'rgba(255, 210, 120, 0.95)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(bullet.x, bullet.y)
    ctx.lineTo(bullet.x - bullet.vx * 0.012, bullet.y - bullet.vy * 0.012)
    ctx.stroke()
  }

  // 行人
  for (const ped of state.peds) {
    if (!ped.alive) continue
    if (ped.x < view.x0 || ped.x > view.x1 || ped.y < view.y0 || ped.y > view.y1) continue
    ctx.fillStyle = ped.color
    ctx.beginPath()
    ctx.arc(ped.x, ped.y, 5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // 车
  for (const car of state.cars) {
    if (car.x < view.x0 || car.x > view.x1 || car.y < view.y0 || car.y > view.y1) continue
    drawCar(ctx, car, p)
  }

  // 警察
  for (const cop of state.cops) {
    if (!cop.alive) continue
    ctx.fillStyle = '#33508a'
    ctx.beginPath()
    ctx.arc(cop.x, cop.y, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#9ab8ff'
    ctx.lineWidth = 1.6
    ctx.stroke()
    ctx.strokeStyle = 'rgba(200, 220, 255, 0.6)'
    ctx.beginPath()
    ctx.moveTo(cop.x, cop.y)
    ctx.lineTo(cop.x + Math.cos(cop.angle) * 14, cop.y + Math.sin(cop.angle) * 14)
    ctx.stroke()
  }

  // 玩家
  if (p.onFoot) {
    const angle = Math.atan2(hover.y - p.y, hover.x - p.x)
    ctx.fillStyle = '#e6dcc8'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#e08a2a'
    ctx.lineWidth = 2.4
    ctx.stroke()
    ctx.strokeStyle = 'rgba(224, 138, 42, 0.9)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x + Math.cos(angle) * 18, p.y + Math.sin(angle) * 18)
    ctx.stroke()
  }

  ctx.restore()

  // 光照与天气
  const hour = state.time / 60
  const night = hour < 6 || hour > 20 ? 0.55 : hour < 7.5 ? 0.55 - (hour - 6) * 0.3 : hour > 18.5 ? (hour - 18.5) * 0.3 : 0
  if (night > 0.02) {
    ctx.fillStyle = `rgba(8, 12, 26, ${Math.min(0.6, night)})`
    ctx.fillRect(0, 0, w, h)
  }
  if (state.weather === 'snow' || state.weather === 'storm') {
    ctx.fillStyle = 'rgba(240, 246, 250, 0.55)'
    const count = state.weather === 'storm' ? 160 : 90
    for (let i = 0; i < count; i += 1) {
      const seed = (i * 89) % 977
      const x = ((seed * 13 + performance.now() * 0.03) % (w + 40)) - 20
      const y = ((seed * 31 + performance.now() * 0.06) % (h + 40)) - 20
      ctx.beginPath()
      ctx.arc(x, y, 1.6 + (i % 3) * 0.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = 'rgba(200, 210, 220, 0.12)'
    ctx.fillRect(0, 0, w, h)
  } else if (state.weather === 'wind') {
    ctx.strokeStyle = 'rgba(200, 190, 160, 0.07)'
    ctx.lineWidth = 1
    for (let i = 0; i < 40; i += 1) {
      const y = (i * 37) % h
      const x = ((i * 113 + performance.now() * 0.4) % (w + 200)) - 100
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + 40, y + 3)
      ctx.stroke()
    }
  }

  // 准心
  ctx.strokeStyle = 'rgba(255, 220, 160, 0.5)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(hover.x, hover.y, 8, 0, Math.PI * 2)
  ctx.stroke()
}

function drawCar(ctx, car, player) {
  ctx.save()
  ctx.translate(car.x, car.y)
  ctx.rotate(car.angle)
  const isPlayer = car.type === 'player'
  const isCop = car.type === 'police'
  ctx.fillStyle = isCop ? '#e8e8ea' : car.color
  ctx.fillRect(-20, -9, 40, 18)
  ctx.fillStyle = 'rgba(20, 24, 30, 0.85)'
  ctx.fillRect(-6, -7, 14, 14)
  ctx.fillStyle = isCop ? '#2a3a5a' : 'rgba(0,0,0,0.35)'
  ctx.fillRect(-20, -3, 40, 6)
  if (isCop) {
    ctx.fillStyle = 'rgba(120, 170, 255, 0.9)'
    ctx.fillRect(-24, -3, 4, 6)
    ctx.fillStyle = 'rgba(255, 90, 90, 0.9)'
    ctx.fillRect(20, -3, 4, 6)
  }
  if (isPlayer) {
    ctx.strokeStyle = 'rgba(224, 138, 42, 0.8)'
    ctx.lineWidth = 2
    ctx.strokeRect(-20, -9, 40, 18)
  }
  ctx.restore()
}
