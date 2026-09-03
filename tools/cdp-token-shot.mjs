/* 代币页 CDP 截图:桌面 1600x900,加载后发 3 条弹幕再截屏,验证弹幕层 */
import WebSocket from '../apps/chat/node_modules/ws/wrapper.mjs'
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9335
const TOKEN = '0x2cac7a8f5cafe7815144252e949dec5c6d976666'
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
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `http://localhost:3100/token/${TOKEN}` })
await sleep(16000)

// 往代币房间发 3 条弹幕(不同用户,避开服务端 3s/人限流),让截图时正在飘
const room = `4663:${TOKEN}`
async function sendDmk(user, content) {
  const c = new WebSocket('ws://localhost:8080')
  await new Promise(r => c.on('open', r))
  c.send(JSON.stringify({ t: 'auth', token: null, userId: `test:${user}` }))
  c.send(JSON.stringify({ t: 'join', room }))
  await sleep(500)
  c.send(JSON.stringify({ t: 'danmaku', room, content }))
  return c
}
const c1 = await sendDmk('shot1', '🚀 STREETPI 起飞!')
await sleep(500)
const c2 = await sendDmk('shot2', '弹幕已上线,5U 一条飘到 K 线')
await sleep(500)
const c3 = await sendDmk('shot3', 'LFG!!! 冲鸭 🦆')
await sleep(2500)

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
if (shot?.data) {
  writeFileSync('E:/VS开发文件集合/NEW/snowon-terminal/token-page-desktop.png', Buffer.from(shot.data, 'base64'))
  console.log('saved token-page-desktop.png')
} else {
  console.log('FAILED', JSON.stringify(shot).slice(0, 200))
}
ws.close()
c1.close()
c2.close()
c3.close()
child.kill()
process.exit(0)
