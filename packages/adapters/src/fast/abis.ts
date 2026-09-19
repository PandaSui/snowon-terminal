/** Fast Launch(SNOW 配对 + SnowConfigHook 池,无绑定曲线)最小 ABI。 */

/** SnowLaunchWrapper.launch() 发射,emit Launched;像 CoinCreated 一样 append-only。 */
export const fastWrapperAbi = [
  {
    type: "event",
    name: "Launched",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "buyTaxBps", type: "uint16", indexed: false },
      { name: "sellTaxBps", type: "uint16", indexed: false },
    ],
  },
] as const;

/** Fast Launch 币无 CoinCreated 事件,name/symbol/decimals 从 ERC20 读。 */
export const fastTokenAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  // logo 在这里(data:application/json;base64,{...,"image":"ipfs://…"}),Launched 事件不带
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;
