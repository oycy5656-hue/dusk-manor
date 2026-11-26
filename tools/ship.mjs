import fs from 'fs'
import { execFileSync } from 'child_process'

// 一条命令：带工作区临时目录构建，然后推到 gh-pages。
// 用法： node tools/ship.mjs  [--dry-run]

const dryRun = process.argv.includes('--dry-run')
const node = process.execPath
const tmp = '.tmp-build'
fs.mkdirSync(tmp, { recursive: true })

console.log('> vite build (TMP=' + tmp + ')')
execFileSync(node, ['node_modules/vite/bin/vite.js', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, TMP: tmp, TEMP: tmp },
})

console.log('> deploy to gh-pages')
execFileSync(node, ['tools/deploy-pages.mjs', ...(dryRun ? ['--dry-run'] : [])], {
  stdio: 'inherit',
  env: process.env,
})
