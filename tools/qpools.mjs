import postgres from "../packages/db/node_modules/postgres/src/index.js";
const sql = postgres("postgres://postgres:postgres@localhost:5432/terminal");
const rows = await sql`
  select address, symbol, curve_address, pool_id, quote_asset, created_at_block::text, graduated, graduated_at
  from tokens order by created_at
`;
console.log(JSON.stringify(rows, null, 2));
const trades = await sql`
  select phase, kind, count(*)::int as n
  from trades
  where token_address = '0x4c67b87b83437c698a8a3a3777f20d81c58d8888'
  group by 1, 2
`;
console.log("panda trades", trades);
const last = await sql`
  select block_number::text, tx_hash, block_timestamp
  from trades
  where token_address = '0x4c67b87b83437c698a8a3a3777f20d81c58d8888'
  order by block_timestamp desc limit 3
`;
console.log("panda last trades", last);
await sql.end();
