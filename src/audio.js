// 合成音效：枪声、警笛、引擎、环境风。
let ctx = null
let master = null
let muted = false
let engine = null
let siren = null
let wind = null

function ensure() {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return null
    ctx = new AudioCtx()
    master = ctx.createGain()
    master.gain.value = 0.2
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

export function setMuted(value) {
  muted = value
  if (master) master.gain.value = value ? 0 : 0.2
}

export function isMuted() {
  return muted
}

function noiseBurst({ dur = 0.16, gain = 0.3, freq = 900, type = 'lowpass' }) {
  const c = ensure()
  if (!c || muted) return
  const t0 = c.currentTime
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  const src = c.createBufferSource()
  src.buffer = buffer
  const filter = c.createBiquadFilter()
  filter.type = type
  filter.frequency.value = freq
  const env = c.createGain()
  env.gain.setValueAtTime(gain, t0)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter)
  filter.connect(env)
  env.connect(master)
  src.start(t0)
}

function tone(freq, dur, gain = 0.2, type = 'sine', slide = 0) {
  const c = ensure()
  if (!c || muted) return
  const t0 = c.currentTime
  const osc = c.createOscillator()
  const env = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur)
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.01)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(env)
  env.connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export function sfx(kind) {
  if (muted) return
  switch (kind) {
    case 'pistol':
      noiseBurst({ dur: 0.12, gain: 0.34, freq: 1800 })
      tone(150, 0.1, 0.2, 'square', -80)
      break
    case 'shotgun':
      noiseBurst({ dur: 0.3, gain: 0.42, freq: 900 })
      tone(90, 0.24, 0.24, 'sawtooth', -40)
      break
    case 'punch':
      noiseBurst({ dur: 0.09, gain: 0.2, freq: 420 })
      break
    case 'hit':
      noiseBurst({ dur: 0.12, gain: 0.2, freq: 600 })
      break
    case 'cash':
      tone(880, 0.1, 0.14, 'triangle')
      tone(1320, 0.12, 0.12, 'triangle')
      break
    case 'siren':
      tone(720, 0.4, 0.16, 'square', -180)
      break
    case 'wasted':
      tone(120, 1.2, 0.24, 'sine', -60)
      noiseBurst({ dur: 0.9, gain: 0.16, freq: 300 })
      break
    case 'click':
      tone(520, 0.05, 0.1, 'square')
      break
    case 'vehicle':
      noiseBurst({ dur: 0.2, gain: 0.18, freq: 260 })
      break
    default:
      tone(300, 0.07, 0.1)
  }
}

export function setEngine(speed) {
  const c = ensure()
  if (!c) return
  if (!engine) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sawtooth'
    osc.frequency.value = 60
    gain.gain.value = 0
    osc.connect(gain)
    gain.connect(master)
    osc.start()
    engine = { osc, gain }
  }
  const target = muted ? 0 : Math.min(0.09, 0.02 + Math.abs(speed) / 4000)
  engine.gain.gain.setTargetAtTime(target, c.currentTime, 0.1)
  engine.osc.frequency.setTargetAtTime(55 + Math.abs(speed) * 0.32, c.currentTime, 0.12)
}

export function setSiren(on) {
  const c = ensure()
  if (!c) return
  if (on && !siren) {
    const osc = c.createOscillator()
    const lfo = c.createOscillator()
    const lfoGain = c.createGain()
    const gain = c.createGain()
    osc.type = 'square'
    osc.frequency.value = 640
    lfo.frequency.value = 1.6
    lfoGain.gain.value = 90
    lfo.connect(lfoGain)
    lfoGain.connect(osc.frequency)
    gain.gain.value = muted ? 0 : 0.045
    osc.connect(gain)
    gain.connect(master)
    osc.start()
    lfo.start()
    siren = { osc, lfo, gain }
  } else if (!on && siren) {
    try {
      siren.osc.stop()
      siren.lfo.stop()
    } catch {
      /* ignore */
    }
    siren = null
  }
}

export function startWind() {
  const c = ensure()
  if (!c || wind) return
  const buffer = c.createBuffer(1, c.sampleRate * 3, c.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.5
  const src = c.createBufferSource()
  src.buffer = buffer
  src.loop = true
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 420
  filter.Q.value = 0.6
  const gain = c.createGain()
  gain.gain.value = muted ? 0 : 0.06
  src.connect(filter)
  filter.connect(gain)
  gain.connect(master)
  src.start()
  wind = { src, gain }
}
