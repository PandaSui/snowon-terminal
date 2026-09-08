import { SNOW_TOKEN } from "@terminal/db";

const RPC = process.env.RPC_URL_4663 || "https://rpc.mainnet.chain.robinhood.com";
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function topicAddr(addr: string): string {
  return "0x" + addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

type Receipt = {
  status: string;
  logs: { address: string; topics: string[]; data: string }[];
} | null;

/**
 * 验证一笔 SNOW 付款。txHash 必须是一笔成功交易,内含一条 SNOW Transfer 日志:
 * to == payee 且金额 >= priceWei;可选校验 from == payer(付款人须为叮住者本人)。
 */
export async function verifySnowPayment(opts: {
  txHash: string;
  payee: string;
  priceWei: bigint;
  payer?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { txHash, payee, priceWei, payer } = opts;
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, reason: "txHash 格式错误" };
  let receipt: Receipt;
  try {
    receipt = await rpc<Receipt>("eth_getTransactionReceipt", [txHash]);
  } catch (e) {
    return { ok: false, reason: "RPC 查询失败: " + (e as Error).message };
  }
  if (!receipt) return { ok: false, reason: "交易未找到或未上链" };
  if (receipt.status !== "0x1") return { ok: false, reason: "交易失败" };

  const snow = SNOW_TOKEN.toLowerCase();
  const payeeTopic = topicAddr(payee);
  const payerTopic = payer && /^0x[0-9a-fA-F]{40}$/.test(payer) ? topicAddr(payer) : null;

  for (const log of receipt.logs || []) {
    if ((log.address || "").toLowerCase() !== snow) continue;
    if ((log.topics?.[0] || "").toLowerCase() !== TRANSFER_TOPIC) continue;
    if ((log.topics?.[2] || "").toLowerCase() !== payeeTopic) continue; // to == payee
    let value: bigint;
    try {
      value = BigInt(log.data || "0x0");
    } catch {
      continue;
    }
    if (value < priceWei) continue;
    if (payerTopic && (log.topics?.[1] || "").toLowerCase() !== payerTopic) continue; // from == payer
    return { ok: true };
  }
  return { ok: false, reason: "未找到转给收款地址且金额足够的 SNOW 转账" };
}

/** 整数 SNOW 字符串 → wei(18 位) */
export function snowToWei(price: string): bigint {
  const whole = String(price).trim().split(".")[0] || "0";
  return BigInt(whole) * 10n ** 18n;
}

// Pixel Bears (SnowPass) NFT 合约。持有者可免费叮住。
const PIXEL_BEARS = (process.env.PIXEL_BEARS_ADDRESS || "0x8bA05220210bCBA1335451175f8581BF1C82Ab99").toLowerCase();

/**
 * 是否持有至少一枚 Pixel Bears NFT。读链 balanceOf(owner) > 0。
 * owner 应为经 verifySession 得到的可信钱包地址,不可用前端传入的地址(可伪造)。
 */
export async function hasPixelBears(owner: string): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return false;
  // balanceOf(address) — selector 0x70a08231
  const data = "0x70a08231" + owner.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  try {
    const result = await rpc<string>("eth_call", [{ to: PIXEL_BEARS, data }, "latest"]);
    return BigInt(result || "0x0") > 0n;
  } catch {
    return false;
  }
}
