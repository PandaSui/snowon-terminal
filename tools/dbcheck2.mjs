import postgres from 'postgres'
const sql = postgres('postgres://postgres:postgres@localhost:5432/terminal')
console.log('tokens:', (await sql`SELECT count(*)::int c FROM tokens`)[0].c)
const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='trades' ORDER BY ordinal_position`
console.log(cols.map(c=>c.column_name+':'+c.data_type).join('\n'))
const tok = await sql`SELECT address, name, symbol FROM tokens LIMIT 5`
console.log(JSON.stringify(tok, null, 1))
await sql.end()
