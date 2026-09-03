/* 通过 CDP 量出移动端布局的真实宽度,找出横向溢出源 */
import WebSocket from '../apps/chat/node_modules/ws/wrapper.mjs'
import { execFile } from 'node:child_process'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const PORT = 9333
const child = execFile(EDGE, ['--headless', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--force-device-scale-factor=1', '--window-size=420,880', 'about:blank'], () => {})

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

const wsUrl = await getWsUrl()
const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mid = ++id
  pending.set(mid, { resolve, reject })
  ws.send(JSON.stringify({ id: mid, method, params }))
})
ws.on('message', (d) => {
  const m = JSON.parse(d.toString())
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m.result ?? m.error); pending.delete(m.id) }
})
await new Promise(r => ws.on('open', r))
await send('Page.enable')
await send('Page.navigate', { url: 'http://localhost:3100/' })
await sleep(9000)

const expr = `(() => {
  const out = { innerWidth, docW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth, culprits: [] }
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width > innerWidth + 1) out.culprits.push({ tag: el.tagName, cls: String(el.className).slice(0,40), w: Math.round(r.width) })
  }
  out.culprits = out.culprits.slice(0, 12)
  return JSON.stringify(out)
})()`
const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
console.log(res.result?.value ?? JSON.stringify(res))
ws.close()
child.kill()
process.exit(0)
