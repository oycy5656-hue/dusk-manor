import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { api, getServer, setServer, setToken, getToken, loadStaticMap, resolveServer } from './api.js'
import DashMap from './ui/DashMap.jsx'

const money = (n) => `$${Math.round(n || 0).toLocaleString('en-US')}`
const clock = (day, time) => {
  const hh = String(Math.floor((time % 1440) / 60)).padStart(2, '0')
  const mm = String(Math.floor(time % 60)).padStart(2, '0')
  return `第${day}天 ${hh}:${mm}`
}
const TYPE_LABEL = {
  bank: '银行', police: '警局', hospital: '医院', clinic: '诊所', store: '商店', fuel: '加油站',
  food: '餐馆', bar: '酒吧', pharmacy: '药房', pawn: '当铺', weapons: '枪店', garage: '修车厂',
  dealer: '车行', motel: '旅馆', hardware: '五金', court: '法院', civic: '市政', museum: '博物馆',
  monument: '纪念地', attraction: '景点', transit: '车站', contact: '联系人',
}

function Login({ onAuth }) {
  const [mode, setMode] = useState('player')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [adminToken, setAdminToken] = useState('')
  const [server, setServerState] = useState(getServer())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'player') {
        const res = await api.login(username.trim(), password)
        setToken(res.token)
        onAuth({ role: res.role, player: res.player })
      } else {
        const res = await api.adminLogin(adminToken.trim())
        setToken(res.token)
        onAuth({ role: 'admin' })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login__panel">
        <p className="eyebrow">CHEYENNE HEAT · 多人跑团</p>
        <h1>夏延热度</h1>
        <p className="muted small">
          管理员导入玩家，玩家提交行动，判官按规则与运气给出结果。每个账号知道的夏延都不一样。
        </p>
        <div className="tabs">
          <button className={mode === 'player' ? 'is-active' : ''} onClick={() => setMode('player')}>玩家</button>
          <button className={mode === 'admin' ? 'is-active' : ''} onClick={() => setMode('admin')}>管理员</button>
        </div>
        <form onSubmit={submit} className="form">
          {mode === 'player' ? (
            <>
              <label>账号<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
              <label>密码<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
            </>
          ) : (
            <label>管理员令牌<input value={adminToken} onChange={(e) => setAdminToken(e.target.value)} placeholder="默认 cheyenne-admin" /></label>
          )}
          <label className="server-field">
            服务器地址
            <div className="row">
              <input value={server} onChange={(e) => setServerState(e.target.value)} />
              <button type="button" className="btn btn--small" onClick={() => { setServer(server); setError('已保存服务器地址') }}>保存</button>
            </div>
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn--primary" disabled={busy}>{busy ? '连接中…' : '登录'}</button>
        </form>
        <p className="hint">
          本地启动：<code>node server/index.mjs</code>（默认 8788 端口）。线上页面需要把服务器地址指向可访问的隧道地址。
        </p>
      </div>
    </div>
  )
}

function PlayerDash({ player, auth, onLogout, onRefresh }) {
  const [mapData, setMapData] = useState(null)
  const [city, setCity] = useState(null)
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadStaticMap().then(setMapData).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    api.city().then(setCity).catch((e) => setError(e.message))
  }, [player.knowledge.places.length])

  const submit = async (actionText) => {
    const value = (actionText ?? text).trim()
    if (!value) return
    setBusy(true)
    setError('')
    try {
      const res = await api.act(value)
      setResult({ text: value, narration: res.result.narration })
      setText('')
      onRefresh(res.player)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const choose = async (choice) => {
    setBusy(true)
    try {
      const res = await api.choose(choice)
      setResult((old) => ({ text: old?.text || '', narration: `${old?.narration || ''}\n\n${res.outcome}` }))
      onRefresh(res.player)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const knownPlaces = city?.pois || []
  const contacts = city?.contacts || []

  return (
    <div className="dash">
      <header className="hud">
        <div className="hud__title"><strong>夏延热度</strong><small>{auth.player?.name || player.name} 的档案</small></div>
        <div className="hud__stat"><span>时间</span><b>{clock(player.day, player.time)}</b></div>
        <div className="hud__stat"><span>现金</span><b className="cash">{money(player.cash)}</b></div>
        <div className="hud__stat"><span>健康</span><b>{Math.round(player.health)}</b></div>
        <div className="hud__stat hud__stat--heat"><span>通缉</span><div className="heat"><i style={{ width: `${player.heat}%` }} /></div><b>{Math.round(player.heat)}</b></div>
        <div className="hud__stat"><span>位置</span><b>{player.place || '街上'}</b></div>
        <div className="hud__right">
          <button className="btn btn--small" onClick={() => api.me().then((r) => r.player && onRefresh(r.player))}>刷新</button>
          <button className="btn btn--small btn--danger" onClick={onLogout}>退出</button>
        </div>
      </header>

      <main className="layout">
        <div className="layout__map">
          <DashMap data={mapData} player={player} pois={knownPlaces} contacts={contacts} onPick={(poi) => setText(`去 ${poi.name}`)} />
          <div className="map-note">你只知道你去过或听说过的地方。地图上没标出来的，不代表不存在。</div>
        </div>

        <aside className="layout__panel">
          {player.pending ? (
            <section className="pending-card">
              <p className="eyebrow">需要你决定</p>
              <h2>{player.pending.title}</h2>
              <p className="muted small">{player.pending.text}</p>
              <div className="actions">
                {player.pending.options.map((option) => (
                  <button key={option.id} className="btn" disabled={busy} onClick={() => choose(option.id)}>{option.label}</button>
                ))}
              </div>
            </section>
          ) : (
            <section className="action-card">
              <p className="eyebrow">行动</p>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="用一句话描述你要做什么，例如：开车去 Nelson Museum of the West，然后打听消息"
                rows={3}
              />
              <div className="actions">
                <button className="btn btn--primary" disabled={busy} onClick={() => submit()}>{busy ? '判官思考中…' : '提交行动'}</button>
                <button className="btn btn--small" onClick={() => submit('打听消息')}>打听消息</button>
                <button className="btn btn--small" onClick={() => submit('躲起来避风头')}>避风头</button>
                <button className="btn btn--small" onClick={() => submit('找一个联系人接活')}>接活</button>
                <button className="btn btn--small" onClick={() => submit('原地观察一会儿')}>观察</button>
              </div>
              {error && <p className="error">{error}</p>}
            </section>
          )}

          {result && (
            <section className="outcome">
              <p className="eyebrow">判官回执</p>
              <p className="outcome__action">你：「{result.text}」</p>
              <pre className="outcome__text">{result.narration}</pre>
            </section>
          )}

          <section className="panel-block">
            <p className="eyebrow">任务</p>
            {player.missions.length === 0 && <p className="muted small">没有在身的任务。联系一个联系人试试。</p>}
            {player.missions.map((m) => (
              <div key={m.id} className="mission">
                <strong>{m.title}</strong>
                <small>{m.giver} · {m.step}</small>
              </div>
            ))}
          </section>

          <section className="panel-block">
            <p className="eyebrow">载具</p>
            {player.vehicle ? (
              <div className="vehicle">
                <strong>{player.vehicle.name}</strong>
                <div className="vehicle__stat"><span>油量</span><div className="bar"><i style={{ width: `${player.vehicle.fuel}%` }} /></div><b>{Math.round(player.vehicle.fuel)}%</b></div>
                <div className="vehicle__stat"><span>车况</span><div className="bar bar--blue"><i style={{ width: `${player.vehicle.condition}%` }} /></div><b>{Math.round(player.vehicle.condition)}%</b></div>
              </div>
            ) : <p className="muted small">你没有车。走路也行，就是慢。</p>}
          </section>

          <section className="panel-block">
            <p className="eyebrow">情报（{knownPlaces.length} 个已知地点）</p>
            <div className="rumors">
              {[...(player.knowledge.rumors || [])].reverse().slice(0, 6).map((r, i) => (
                <p key={i} className="rumor">{r.text}</p>
              ))}
              {(player.knowledge.notes || []).slice(-6).reverse().map((n, i) => (
                <p key={`n${i}`} className="rumor rumor--note">{n.text}</p>
              ))}
            </div>
          </section>

          <section className="panel-block panel-block--log">
            <p className="eyebrow">记录</p>
            <div className="history">
              {player.history.slice(0, 20).map((h, i) => (
                <p key={i} className={`history__line history__line--${h.kind}`}>
                  <span>{clock(h.day, h.time)}</span>{h.text}
                </p>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

function AdminDash({ onLogout }) {
  const [players, setPlayers] = useState([])
  const [world, setWorld] = useState(null)
  const [importText, setImportText] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    try {
      const res = await api.admin.players()
      setPlayers(res.players)
      setWorld(res.world)
    } catch (err) {
      setError(err.message)
    }
  }

  useEffect(() => { refresh() }, [])

  const doImport = async () => {
    setError('')
    setMessage('')
    try {
      const parsed = JSON.parse(importText)
      const list = Array.isArray(parsed) ? parsed : [parsed]
      const res = await api.admin.importPlayers(list)
      setMessage(`创建 ${res.created.length} 人${res.failed.length ? `，失败 ${res.failed.length} 人：${res.failed.map((f) => `${f.username}(${f.reason})`).join('、')}` : ''}`)
      setImportText('')
      refresh()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="admin">
      <header className="hud">
        <div className="hud__title"><strong>夏延热度</strong><small>管理员后台</small></div>
        {world && <div className="hud__stat"><span>时间</span><b>{clock(world.day, world.time)}</b></div>}
        <div className="hud__stat"><span>玩家</span><b>{players.length}</b></div>
        <div className="hud__right">
          <button className="btn btn--small" onClick={refresh}>刷新</button>
          <button className="btn btn--small btn--danger" onClick={onLogout}>退出</button>
        </div>
      </header>

      <main className="admin__grid">
        <section className="admin__card">
          <p className="eyebrow">导入玩家</p>
          <p className="muted small">粘贴 JSON 数组，例如：</p>
          <pre className="code">{'[{"username":"mike","password":"pass123","name":"迈克","cash":800}]'}</pre>
          <textarea rows={5} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='[{"username":"...","password":"...","name":"..."}]' />
          <button className="btn btn--primary" onClick={doImport}>导入</button>
          {message && <p className="ok">{message}</p>}
          {error && <p className="error">{error}</p>}
        </section>

        <section className="admin__card">
          <p className="eyebrow">世界时间</p>
          {world && <p className="muted">现在是 {clock(world.day, world.time)}</p>}
          <div className="actions">
            <button className="btn" onClick={() => api.admin.world({ tick: 1 }).then(refresh)}>推进 30 分钟</button>
            <button className="btn" onClick={() => api.admin.world({ tick: 6 }).then(refresh)}>推进 3 小时</button>
            <button className="btn" onClick={() => api.admin.world({ tick: 24 }).then(refresh)}>推进 12 小时</button>
          </div>
        </section>

        <section className="admin__card admin__card--wide">
          <p className="eyebrow">玩家列表</p>
          <table className="table">
            <thead>
              <tr><th>ID</th><th>账号</th><th>名字</th><th>现金</th><th>通缉</th><th>位置</th><th>任务</th><th>操作</th></tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.username}</td>
                  <td>{p.name}</td>
                  <td className="cash">{money(p.cash)}</td>
                  <td>{Math.round(p.heat)}</td>
                  <td>{p.place || '街上'}</td>
                  <td>{p.missions}</td>
                  <td className="admin__actions">
                    <button className="btn btn--small" onClick={async () => {
                      const text = window.prompt('要推送给这个玩家的情报：')
                      if (!text) return
                      await api.admin.intel(p.id, text)
                      refresh()
                    }}>推送情报</button>
                    <button className="btn btn--small" onClick={async () => {
                      const value = window.prompt('设置现金：', String(p.cash))
                      if (value === null) return
                      await api.admin.resolve(p.id, { cash: Number(value) })
                      refresh()
                    }}>改钱</button>
                    <button className="btn btn--small" onClick={async () => {
                      const value = window.prompt('设置通缉度（0-100）：', String(p.heat))
                      if (value === null) return
                      await api.admin.resolve(p.id, { heat: Number(value) })
                      refresh()
                    }}>改通缉</button>
                  </td>
                </tr>
              ))}
              {players.length === 0 && <tr><td colSpan={8} className="muted">还没有玩家。先导入。</td></tr>}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  )
}

function App() {
  const [auth, setAuth] = useState(null)
  const [booting, setBooting] = useState(!!getToken())
  const [serverReady, setServerReady] = useState(false)

  useEffect(() => {
    resolveServer().finally(() => setServerReady(true))
  }, [])

  useEffect(() => {
    if (!serverReady) return
    if (!getToken()) { setBooting(false); return }
    api.me().then((res) => {
      if (res.role === 'player') setAuth({ role: 'player', player: res.player })
      else setAuth({ role: 'admin' })
    }).catch(() => setToken('')).finally(() => setBooting(false))
  }, [serverReady])

  if (!serverReady || booting) return <div className="boot">正在连接服务器…</div>

  if (!auth) {
    return <Login onAuth={(next) => setAuth(next)} />
  }

  if (auth.role === 'admin') {
    return <AdminDash onLogout={() => { setToken(''); setAuth(null) }} />
  }

  return (
    <PlayerDash
      player={auth.player}
      auth={auth}
      onRefresh={(player) => setAuth((old) => ({ ...old, player }))}
      onLogout={() => { setToken(''); setAuth(null) }}
    />
  )
}

createRoot(document.getElementById('root')).render(<App />)
