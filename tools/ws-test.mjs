import WebSocket from '../apps/chat/node_modules/ws/wrapper.mjs'
const ws = new WebSocket('ws://localhost:8080')
const timer = setTimeout(() => { console.log('TIMEOUT no message'); process.exit(1) }, 15000)
ws.on('open', () => {
  console.log('WS open')
  ws.send(JSON.stringify({ t: 'join', room: 'price:4663:0x2cac7a8f5cafe7815144252e949dec5c6d976666' }))
  setTimeout(async () => {
    const { execSync } = await import('node:child_process')
    execSync(`E:/VS开发文件集合/NEW/snowon-terminal/tools/bin/redis/redis-cli.exe PUBLISH "price:4663:0x2cac7a8f5cafe7815144252e949dec5c6d976666" "{\\"priceEth\\":\\"0.0000000020\\",\\"isBuy\\":true,\\"ethAmount\\":\\"2000000000000000\\",\\"tokenAmount\\":\\"1000000\\",\\"ts\\":\\"${new Date().toISOString()}\\",\\"phase\\":\\"curve\\"}"`)
    console.log('published')
  }, 1000)
})
ws.on('message', (d) => { console.log('GOT:', d.toString()); clearTimeout(timer); process.exit(0) })
ws.on('error', (e) => { console.log('WS error:', e.message); process.exit(1) })
