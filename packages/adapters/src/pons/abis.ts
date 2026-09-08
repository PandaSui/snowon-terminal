/** Pons V2 最小 ABI:工厂 / 曲线 / 发射代币。 */

export const ponsFactoryAbi = [
  {
    type: "event",
    name: "TokenLaunched",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "curve", type: "address", indexed: true },
      { name: "deployer", type: "address", indexed: true },
      { name: "pairToken", type: "address", indexed: false },
      { name: "launchConfigId", type: "uint256", indexed: false },
      { name: "graduationThreshold", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LaunchSwept",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "quoteOut", type: "uint256", indexed: false },
      { name: "tokenOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PoolGraduated",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "positionId", type: "uint256", indexed: false },
      { name: "tokenAmount", type: "uint256", indexed: false },
      { name: "pairTokenAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "getLaunchedToken",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "curve", type: "address" },
          { name: "deployer", type: "address" },
          { name: "creatorFeeRecipient", type: "address" },
          { name: "pairToken", type: "address" },
          { name: "graduationThreshold", type: "uint256" },
          { name: "poolFee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "creatorTaxBps", type: "uint16" },
          { name: "buybackEnabled", type: "bool" },
          { name: "phase", type: "uint8" },
          { name: "sweptQuote", type: "uint256" },
          { name: "sweptTokens", type: "uint256" },
          { name: "sweptAt", type: "uint256" },
          { name: "exists", type: "bool" },
        ],
      },
    ],
  },
] as const;

export const ponsCurveAbi = [
  {
    type: "event",
    name: "CurveBuy",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "quoteIn", type: "uint256", indexed: false },
      { name: "tokensOut", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "tax", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "CurveSell",
    inputs: [
      { name: "seller", type: "address", indexed: true },
      { name: "recipient", type: "address", indexed: true },
      { name: "tokensIn", type: "uint256", indexed: false },
      { name: "quoteOut", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "tax", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "buy",
    stateMutability: "payable",
    inputs: [
      { name: "quoteIn", type: "uint256" },
      { name: "minTokensOut", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "sell",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokensIn", type: "uint256" },
      { name: "minQuoteOut", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "quoteReserve", type: "uint256" },
      { name: "tokenReserve", type: "uint256" },
    ],
  },
  { type: "function", name: "realQuoteReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduationThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creatorTaxBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isNativeQuote", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "pairToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "phantomQuote", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sellableTokens", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const ponsTokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "logo", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "description", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "curve", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "deployer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "socials",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "twitter", type: "string" },
          { name: "telegram", type: "string" },
          { name: "discord", type: "string" },
          { name: "website", type: "string" },
          { name: "farcaster", type: "string" },
        ],
      },
    ],
  },
] as const;
