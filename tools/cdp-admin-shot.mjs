/* 管理页截图(桌面 1600x900) */
import WebSocket from '../apps/chat/node_modules/ws/wrapper.mjs'
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9344
const child = execFile(EDGE, ['--headless', '--disable-gpu', `--remote-debugging-port=${PORT}`, 'about:blank'], () => {})
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
await sleep(3000)

async function getWsUrl() {
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
      return (await r.json()).webSocketDebuggerUrl
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
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.enable')
await send('Page.navigate', { url: 'http://localhost:3000/admin' })
await sleep(20000)
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
if (shot?.data) {
  writeFileSync('E:/VS开发文件集合/NEW/snowon-terminal/admin-page.png', Buffer.from(shot.data, 'base64'))
  console.log('saved admin-page.png')
} else {
  console.log('FAILED')
}
ws.close()
child.kill()
process.exit(0)
