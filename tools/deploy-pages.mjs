// 把 dist/ 的内容整体推到 gh-pages：GitHub Pages 实际发布的就是这个分支。
//
//   先看计划： node tools/deploy-pages.mjs --dry-run
//   真正发布： $env:GH_TOKEN='ghp_xxx'; node tools/deploy-pages.mjs
//
// token 需要 repo 权限（classic PAT 勾 repo，或 fine-grained 给 Contents: Read and write）。

import fs from 'fs'
import path from 'path'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = argv[index + 1]
  return value && !value.startsWith('--') ? value : true
}

const owner = flag('owner', 'oycy5656-hue')
const repo = flag('repo', 'dusk-manor')
const branch = flag('branch', 'gh-pages')
const dist = path.resolve(flag('dist', 'dist'))
const dryRun = argv.includes('--dry-run')
const token = process.env.GH_TOKEN || readLocalToken()

function readLocalToken() {
  try {
    const text = fs.readFileSync(path.resolve('.env.deploy'), 'utf8')
    const match = text.match(/^\s*GH_TOKEN\s*=\s*(\S+)\s*$/m)
    return match ? match[1] : ''
  } catch {
    return ''
  }
}

const api = `https://api.github.com/repos/${owner}/${repo}`

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

async function send(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'dsh-dusk-manor',
      'content-type': 'application/json; charset=utf-8',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${url} -> ${response.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

const files = walk(dist).sort()
const plan = files.map((file) => ({
  file,
  rel: path.relative(dist, file).split(path.sep).join('/'),
  size: fs.statSync(file).size,
}))

console.log(`目标 ${owner}/${repo} -> ${branch}`)
for (const item of plan) console.log(`  ${String(item.size).padStart(9)} B  ${item.rel}`)

if (dryRun) {
  console.log('DRY RUN：没有调用任何 GitHub API。')
  process.exit(0)
}
if (!token) {
  console.error('缺少 GH_TOKEN：export GH_TOKEN=... 或 $env:GH_TOKEN="..." 后重跑。')
  process.exit(1)
}

const ref = await send('GET', `${api}/git/ref/heads/${branch}`)
const headSha = ref.object.sha
console.log(`remote head: ${headSha}`)

const tree = []
for (const item of plan) {
  const blob = await send('POST', `${api}/git/blobs`, {
    content: fs.readFileSync(item.file).toString('base64'),
    encoding: 'base64',
  })
  tree.push({ path: item.rel, mode: '100644', type: 'blob', sha: blob.sha })
  console.log(`  blob ${item.rel} -> ${blob.sha.slice(0, 7)}`)
}

// 不传 base_tree：整棵树只包含 dist 的内容，旧版资源会被一并清掉。
const newTree = await send('POST', `${api}/git/trees`, { tree })
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
const commit = await send('POST', `${api}/git/commits`, {
  message: `deploy: rebuild ${stamp}Z`,
  tree: newTree.sha,
  parents: [headSha],
})
await send('PATCH', `${api}/git/refs/heads/${branch}`, { sha: commit.sha, force: false })

console.log(`推送到 ${branch} 完成，等 Pages 重建（约 1 分钟）。`)
console.log(`校验：https://${owner}.github.io/${repo}/ 右下角 BUILD 时间应是刚构建的这一版。`)
