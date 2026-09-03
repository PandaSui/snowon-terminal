import { createPublicClient, http, parseAbiItem, zeroAddress } from "viem";
import postgres from "../packages/db/node_modules/postgres/src/index.js";
import { poolIdOf, snowAbis } from "../packages/adapters/src/index.ts";
import { readFileSync } from "node:fs";

for (const line of readFileSync("apps/indexer/.env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const sql = postgres(process.env.DATABASE_URL);
const [tok] = await sql`select curve_address, pool_id from tokens where address = '0x4c67b87b83437c698a8a3a3777f20d81c58d8888'`;
console.log("db token", tok);
const PM = process.env.SNOWON_POOL_MANAGER_4663;
const CURVE = tok.curve_address;
const POOL = tok.pool_id;
const client = createPublicClient({
  transport: http(process.env.RPC_URL_4663, { batch: false, timeout: 20_000 }),
});

const evSwap = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

try {
  const [quote, fee, spacing] = await Promise.all([
    client.readContract({ address: CURVE, abi: snowAbis.snowBondingCurveAbi, functionName: "quote" }),
    client.readContract({ address: CURVE, abi: snowAbis.snowBondingCurveAbi, functionName: "quoteEthFee" }),
    client.readContract({ address: CURVE, abi: snowAbis.snowBondingCurveAbi, functionName: "quoteEthSpacing" }),
  ]);
  console.log({ quote, fee, spacing });
  const ethQId = poolIdOf({
    currency0: zeroAddress,
    currency1: quote,
    fee: Number(fee),
    tickSpacing: Number(spacing),
    hooks: zeroAddress,
  });
  console.log("ethQ poolId", ethQId);
  try {
    const slotQ = await client.readContract({
      address: PM, abi: snowAbis.poolManagerAbi, functionName: "getSlot0", args: [ethQId],
    });
    console.log("ethQ slot0", slotQ);
  } catch (e) {
    console.log("ethQ slot0 FAIL", e.shortMessage || e.message);
  }
} catch (e) {
  console.log("curve meta FAIL", e.shortMessage || e.message);
}

try {
  const slotT = await client.readContract({
    address: PM, abi: snowAbis.poolManagerAbi, functionName: "getSlot0", args: [POOL],
  });
  console.log("token pool slot0", slotT);
} catch (e) {
  console.log("token pool slot0 FAIL", e.shortMessage || e.message);
}

const from = 53377000n;
const to = 53377600n;
try {
  const logs = await client.getLogs({
    address: PM, event: evSwap, fromBlock: from, toBlock: to,
  });
  console.log("swaps in recent range", logs.length);
  const ids = [...new Set(logs.map((l) => l.args?.id))];
  console.log("pool ids sample", ids.slice(0, 8));
  const hit = logs.filter((l) => (l.args?.id || "").toLowerCase() === POOL);
  console.log("panda hits in recent", hit.length);
} catch (e) {
  console.log("getLogs FAIL", e.shortMessage || e.message);
}

try {
  const logs = await client.getLogs({
    address: PM, event: evSwap, args: { id: POOL },
    fromBlock: 52165115n,
    toBlock: 52165115n + 15000n,
  });
  console.log("panda swaps first 15k after create", logs.length);
} catch (e) {
  console.log("filtered getLogs FAIL", e.shortMessage || e.message);
}
