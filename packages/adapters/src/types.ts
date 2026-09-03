import type { Address, Hex } from "viem";

/** 一条待签名交易(adapter 只构造,不签名——签名交给钱包层:EOA / Privy / 会话密钥) */
export interface TxRequest {
  to: Address;
  data: Hex;
  value: bigint;
  chainId: number;
}

export interface CurveState {
  /** 已售出代币(base units) */
  sold: bigint;
  /** 曲线储备(Q 计价,wei-Q) */
  quoteReserve: bigint;
  /** 当前边际价格:wei-Q / whole token */
  priceQ: bigint;
  /** 毕业阈值(wei-Q,0 = 未设置) */
  graduationThreshold: bigint;
  /** 毕业进度 0..1 */
  graduationProgress: number;
  graduated: boolean;
  antiSnipe: boolean;
  /** 开启时毕业前仅 EOA 可买(4337/session-key/multicall 会被拒) */
  antiBundle: boolean;
  buyTaxBps: number;
  sellTaxBps: number;
}

export interface GraduationStatus {
  graduated: boolean;
  /** V4 池标识(V4 池无独立合约地址) */
  poolId?: Hex;
  dexType?: "univ4";
  graduatedAtBlock?: bigint;
}

export interface Quote {
  /** 输入:买 = ETH wei;卖 = token base units */
  amountIn: bigint;
  /** 输出:买 = token base units;卖 = ETH wei */
  amountOut: bigint;
  /** 本笔成交均价(ETH / whole token) */
  effectivePriceEth: bigint;
  /** 价格冲击,bps */
  priceImpactBps: number;
  /** 本笔路径总摩擦(协议费+税+路由费),bps */
  totalFeeBps: number;
}

export interface TokenMeta {
  chainId: number;
  token: Address;
  curve: Address;
  creator: Address;
  quoteAsset: Address; // address(0) = ETH
  quoteDecimals: number;
  p0: bigint;
  slope: bigint;
  buyTaxBps: number;
  sellTaxBps: number;
  antiSnipe: boolean;
  antiBundle: boolean;
}

export interface SwapRoute {
  /** 毕业前:1 跳(曲线);毕业后:V4 PoolKey 数组传给 SnowSwapRouter */
  kind: "curve" | "pool";
}

/**
 * 发射平台适配器统一接口。
 * 前端/后端只面向这个接口编程;接入新平台 = 新增实现 + 注册。
 */
export interface LaunchpadAdapter {
  readonly platformId: string;
  readonly chainId: number;

  // ── 只读 ──
  getCurveState(token: Address): Promise<CurveState>;
  getGraduationStatus(token: Address): Promise<GraduationStatus>;
  /** 买入报价:ETH wei in → token base units out(含全部费用和冲击) */
  quoteBuy(token: Address, ethIn: bigint): Promise<Quote>;
  /** 卖出报价:token base units in → ETH wei out */
  quoteSell(token: Address, tokenIn: bigint): Promise<Quote>;

  // ── 交易构造(自动按毕业状态路由:曲线 或 SnowSwapRouter) ──
  buildBuyTx(token: Address, ethIn: bigint, minTokensOut: bigint, recipient: Address): Promise<TxRequest>;
  buildSellTx(token: Address, tokenIn: bigint, minEthOut: bigint, recipient: Address): Promise<TxRequest[]>;
  //  ↑ 数组:sell 毕业前可能需要 approve + sell 两笔;毕业后 approve + swap
}

/** 链级配置(BSC 预留:同一结构多一条记录即可) */
export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  wsUrl?: string;
  platformId: string;
  factory: Address;
  hook: Address;
  registry: Address;
  swapRouter: Address;
  poolManager: Address;
  /** 索引起始区块(工厂部署块) */
  deployBlock: bigint;
}
