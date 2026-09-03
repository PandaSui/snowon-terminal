import { createPublicClient, http, parseAbiItem, zeroAddress } from "viem";
import { poolIdOf, snowAbis } from "@terminal/adapters";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const PM = process.env.SNOWON_POOL_MANAGER_4663;
const CURVE = "0x3636d8d2936a7b54b54b15fa9959284e1bcc82a0";
const POOL = "0x972ad45febe3a4f4949e1f702c72c196e46271338c1a02d9c7949c3b9fc08f57";
const client = createPublicClient({
  transport: http(process.env.RPC_URL_4663, { batch: false, timeout: 20_000 }),
});
const evSwap = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

console.log("pm", PM);
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

try {
  const logs = await client.getLogs({
    address: PM, event: evSwap, fromBlock: 53377000n, toBlock: 53377600n,
  });
  console.log("swaps in recent range", logs.length);
  const ids = [...new Set(logs.map((l) => (l.args?.id || "").toLowerCase()))];
  console.log("unique pools", ids.length, ids.slice(0, 6));
  console.log("panda hits", logs.filter((l) => (l.args?.id || "").toLowerCase() === POOL).length);
} catch (e) {
  console.log("getLogs FAIL", e.shortMessage || e.message);
}
