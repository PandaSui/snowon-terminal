/* CDP 移动端截图:真实 420x880 视口(setDeviceMetricsOverride)+ 截屏 */
import WebSocket from '../apps/chat/node_modules/ws/wrapper.mjs'
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9334
const child = execFile(EDGE, ['--headless', '--disable-gpu', `--remote-debugging-port=${PORT}`, 'about:blank'], () => {})

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
await sleep(3000)

async function getWsUrl() {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
      const j = await r.json()
      return j.webSocketDebuggerUrl
    } catch { await sleep(1000) }
  }
  throw new Error('no CDP')
}

const ws = new WebSocket(await getWsUrl())
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((resolve) => {
  const mid = ++id
  pending.set(mid, resolve)
  ws.send(JSON.stringify({ id: mid, method, params }))
})
ws.on('message', (d) => {
  const m = JSON.parse(d.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id) }
})
await new Promise(r => ws.on('open', r))
await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 880, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: 'http://localhost:3100/' })
await sleep(10000)
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot?.data) {
  writeFileSync('E:/VS开发文件集合/NEW/snowon-terminal/homepage-mobile-final.png', Buffer.from(shot.data, 'base64'))
  console.log('saved homepage-mobile-final.png')
} else {
  console.log('FAILED', JSON.stringify(shot).slice(0, 200))
}
ws.close()
child.kill()
process.exit(0)
