/** 登录签名消息模板。客户端与服务端必须完全一致,否则验签失败。纯字符串,无 node 依赖,前端可安全导入。 */
export function buildLoginMessage(address: string, nonce: string): string {
  return [
    "SnowOn Terminal 登录",
    "",
    `地址: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    "",
    "此签名仅用于登录验证,不产生任何链上交易、不花费 gas。",
  ].join("\n");
}
