import postgres from 'postgres'
const sql = postgres('postgres://postgres:postgres@localhost:5432/terminal')
const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`
console.log('tables:', tables.map(t=>t.table_name).join(', '))
for (const t of ['coins','trades','candle_points','indexer_state']) {
  try { const r = await sql.unsafe(`SELECT count(*)::int c FROM ${t}`); console.log(t, r[0].c) } catch(e){ console.log(t, 'ERR', e.message) }
}
try { const s = await sql`SELECT * FROM indexer_state`; console.log('indexer_state:', JSON.stringify(s)) } catch(e){}
const tr = await sql`SELECT count(*)::int c FROM trades WHERE tx_hash LIKE '0xtest%'`
console.log('test trades:', tr[0].c)
await sql.end()
