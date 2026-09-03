import postgres from 'postgres'
const sql = postgres('postgres://postgres:postgres@localhost:5432/terminal')
const token = '0x2cac7a8f5cafe7815144252e949dec5c6d976666'
const now = Math.floor(Date.now()/1000)
const rows = []
for (let i = 0; i < 12; i++) {
  const ts = now - (12 - i) * 600 // 每10分钟一笔
  const price = (1e-9 * (1 + Math.sin(i/2)*0.3 + i*0.02))
  const tokenAmt = 1000000 * (1 + (i%3))
  rows.push({
    chain_id: 4663,
    tx_hash: '0xtest' + String(i).padStart(60,'0'),
    log_index: 0,
    token_address: token,
    trader: '0x0000000000000000000000000000000000000001',
    is_buy: i % 2 === 0,
    eth_amount: price * tokenAmt,
    quote_amount: price * tokenAmt,
    token_amount: tokenAmt,
    price_eth: price,
    phase: 'curve',
    block_number: 51970000 + i,
    block_timestamp: new Date(ts*1000),
  })
}
await sql`INSERT INTO trades ${sql(rows)}`
console.log('inserted', rows.length)
await sql.end()
