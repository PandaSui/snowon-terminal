/**
 * SnowOn 最小 ABI —— 只含终端需要的函数与事件。
 * 源码: app/chain/contracts/snow/(snowon.fun-all 仓库)
 */
export const snowOnFactoryAbi = [
  {
    type: "event",
    name: "CoinCreated",
    inputs: [
      { name: "creator", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "curve", type: "address", indexed: false },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "logoURI", type: "string", indexed: false },
      { name: "pairAsset", type: "address", indexed: false },
      { name: "buyTaxBps", type: "uint16", indexed: false },
      { name: "sellTaxBps", type: "uint16", indexed: false },
      { name: "divShareBps", type: "uint16", indexed: false },
      { name: "buybackShareBps", type: "uint16", indexed: false },
      { name: "lpShareBps", type: "uint16", indexed: false },
      { name: "minHold", type: "uint256", indexed: false },
      { name: "antiSnipe", type: "bool", indexed: false },
      { name: "antiBundle", type: "bool", indexed: false },
      { name: "loyaltyVest", type: "bool", indexed: false },
      { name: "feeReceiver", type: "address", indexed: false },
    ],
  },
  {
    type: "function",
    name: "graduationThreshold",
    stateMutability: "view",
    inputs: [{ name: "quote", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenToCurve",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "allTokens",
    stateMutability: "view",
    inputs: [{ name: "i", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "allTokensLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "protocolSplit",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "creatorBps", type: "uint16" },
      { name: "snowBuyBps", type: "uint16" },
      { name: "revenueBps", type: "uint16" },
    ],
  },
] as const;

export const snowBondingCurveAbi = [
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [{ name: "minTokensOut", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokensIn", type: "uint256" },
      { name: "minEthOut", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "migrate",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  { type: "function", name: "sold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "quoteReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "canGraduate", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "quote", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "quoteDecimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "quoteEthFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "quoteEthSpacing", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
  { type: "function", name: "p0", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "slope", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "buyTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "sellTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "antiSnipe", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "antiBundle", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "bought", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "gradPoolKey",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "Buy",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "ethIn", type: "uint256", indexed: false },
      { name: "quoteIn", type: "uint256", indexed: false },
      { name: "tokensOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Sell",
    inputs: [
      { name: "seller", type: "address", indexed: true },
      { name: "tokensIn", type: "uint256", indexed: false },
      { name: "quoteOut", type: "uint256", indexed: false },
      { name: "ethOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Graduated",
    inputs: [
      { name: "poolId", type: "bytes32", indexed: true },
      { name: "quoteForLp", type: "uint256", indexed: false },
      { name: "tokenForLp", type: "uint256", indexed: false },
      { name: "dividendLeftoverQ", type: "uint256", indexed: false },
      { name: "burnedTokens", type: "uint256", indexed: false },
    ],
  },
] as const;

export const snowPairRegistryAbi = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "allowed", type: "bool" },
          { name: "isRwa", type: "bool" },
          { name: "decimals", type: "uint8" },
          { name: "ethPoolFee", type: "uint24" },
          { name: "ethPoolSpacing", type: "int24" },
          { name: "p0", type: "uint256" },
          { name: "slope", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "allowedPairs",
    stateMutability: "view",
    inputs: [{ name: "i", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "allowedPairsLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** 毕业后交易入口。标准 Universal Router 无法结算 hook 的 in-swap fee delta,必须走它。 */
export const snowSwapRouterAbi = [
  {
    type: "function",
    name: "swapExactIn",
    stateMutability: "payable",
    inputs: [
      {
        name: "pools",
        type: "tuple[]",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "inputCurrency", type: "address" },
      { name: "amountIn", type: "uint128" },
      { name: "minOut", type: "uint128" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
] as const;

/** V4 PoolManager:价格源(毕业后)与 ETH/Q 汇率 */
export const poolManagerAbi = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
  {
    // 标准 V4 PM 只有 extsload 裸存储读取(getSlot0 在链上并不存在,
    // 那是 StateView 的函数)。slot0 = pools[id] 映射槽,见 readPoolSqrtP。
    type: "function",
    name: "extsload",
    stateMutability: "view",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "getLiquidity",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes32" }],
    outputs: [{ type: "uint128" }],
  },
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "sender", type: "address", indexed: true },
      { name: "amount0", type: "int128", indexed: false },
      { name: "amount1", type: "int128", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
      { name: "tick", type: "int24", indexed: false },
      { name: "fee", type: "uint24", indexed: false },
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;
