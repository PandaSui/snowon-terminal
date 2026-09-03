import postgres from 'postgres'
const sql = postgres('postgres://postgres:postgres@localhost:5432/terminal')
const r = await sql`DELETE FROM trades WHERE tx_hash LIKE '0xtest%'`
console.log('deleted test trades:', r.count)
console.log('remaining trades:', (await sql`SELECT count(*)::int c FROM trades`)[0].c)
await sql.end()
