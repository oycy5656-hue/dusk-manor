// 持久隧道：localtunnel 断线自动重连，并把当前地址发布到 gh-pages 的 server.json。
import fs from 'fs'
import path from 'path'
import localtunnel from 'localtunnel'

const PORT = Number(process.env.PORT || 8788)
const OWNER = process.env.GH_OWNER || 'oycy5656-hue'
const REPO = process.env.GH_REPO || 'dusk-manor'
const BRANCH = 'gh-pages'
const FILE = 'server.json'

function readToken() {
  try {
    const env = fs.readFileSync(path.resolve('.env.deploy'), 'utf8')
    const match = env.match(/^\s*GH_TOKEN\s*=\s*(\S+)\s*$/m)
    return match ? match[1] : process.env.GH_TOKEN || ''
  } catch {
    return process.env.GH_TOKEN || ''
  }
}

async function publish(url) {
  const token = readToken()
  if (!token) {
    console.log('[publish] 没有 GH_TOKEN，跳过发布（玩家需要手动填地址）')
    return
  }
  const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'cheyenne-heat-tunnel',
    'content-type': 'application/json',
  }
  let sha = null
  try {
    const res = await fetch(`${api}?ref=${BRANCH}`, { headers })
    if (res.ok) sha = (await res.json()).sha
  } catch { /* ignore */ }
  const body = {
    message: `server: ${url}`,
    branch: BRANCH,
    content: Buffer.from(JSON.stringify({ url, at: new Date().toISOString() }, null, 2)).toString('base64'),
    ...(sha ? { sha } : {}),
  }
  const res = await fetch(api, { method: 'PUT', headers, body: JSON.stringify(body) })
  if (res.ok) console.log(`[publish] 已写入 ${FILE}: ${url}`)
  else console.log('[publish] 失败', res.status, (await res.text()).slice(0, 200))
}

let current = null

async function connect() {
  try {
    const tunnel = await localtunnel({ port: PORT })
    current = tunnel
    console.log(`[tunnel] ${tunnel.url} -> localhost:${PORT}`)
    publish(tunnel.url)
    tunnel.on('close', () => {
      console.log('[tunnel] closed, reconnecting…')
      current = null
      setTimeout(connect, 3000)
    })
    tunnel.on('error', (err) => console.log('[tunnel] error', err.message))
  } catch (err) {
    console.log('[tunnel] failed', err.message, 'retry in 5s')
    setTimeout(connect, 5000)
  }
}

connect()
setInterval(() => { if (current) console.log('[tunnel] up', current.url) }, 60_000)
