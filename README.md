# SnowOn Terminal

Robinhood Chain 上的聚合发射平台交易终端。首个接入平台:snowon.fun。
毕业前走各平台绑定曲线直购,毕业后自动路由到迁移后的 Uniswap V4 池(SnowSwapRouter)。

## 结构

```
apps/
  web/        Next.js 终端:五栏发现页(异动/新创建/即将毕业/毕业/公共聊天室)
              / 代币页(lightweight-charts K线 + 弹幕 + 买卖面板 + 聊天)
              / 管理页 /admin(每链发射工厂参数,chain_configs 表驱动)
              / 个人页 /profile(改名、绑推特、胜率、7d/30d/总 PNL、每日盈亏日历)
              └─ /api/udf/*  UDF 风格数据源(毕业前后价格无缝拼接)
              └─ lib/realtime.ts  WebSocket 单例客户端,K线实时 tick + 断线重连
  indexer/    多链事件索引:CoinCreated / Buy / Sell / Graduated / V4 Swap
              → trades / wallets / positions(PNL)/ bundleScores(捆绑评分)
  chat/       WebSocket 聊天 + 实时推送服务:聊天存库、price:* 价格 tick 扇出、持仓徽章
              └─ 付费叮住消息:20U/2分钟,Redis 存储,最多 5 条,顶部栏上翻轮换(炫彩字体)
              └─ K线弹幕:5U/条,3 秒/人限流
packages/
  db/         Drizzle schema。所有表带 chain_id(BSC 预留)
  adapters/   LaunchpadAdapter 统一接口 + SnowOn 实现
              (线性曲线本地报价、买/卖 calldata、毕业检测、V4 路由)
              └─ snowon/poolState.ts  池子价格/流动性读取(见下「extsload」)
```

## 关键设计决策

- **聊天存 Postgres + Redis,不用 IPFS**:审核/删除权必须在平台手里,聊天室是诈骗重灾区
- **持仓徽章**:默认显示持仓百分比(社交证明 + 反诈),用户可关
- **antiBundle 代币**:毕业前仅 EOA 可买;Privy 嵌入式钱包是 EOA 不受影响,
  但 4337 智能账户/会话密钥会被拒——TradePanel 已做提示
- **毕业后交易必须走 SnowSwapRouter**:标准 Universal Router 无法结算
  SnowLaunchHook 的 in-swap fee delta
- **K线无缝拼接**:合约按曲线终端价建池(零跳变),trades 表统一 ETH 计价,
  UDF history 聚合天然跨毕业点连续
- **池子读数走 extsload,不是 getSlot0**:Robinhood Chain 的 PoolManager 是标准
  V4 实现,getSlot0 是外围 StateView 的函数,链上 PM 直调必 revert。
  `readPoolSqrtP` / `readPoolLiquidity`(packages/adapters/src/snowon/poolState.ts)
  按 V4 存储布局直接解包 pools 映射槽(slot0 = keccak256(poolId, 6),
  liquidity 在 slot+3),失败才回退 getSlot0 兼容非标准 PM
- **安全面板为启发式检测**:貔貅(链上卖税 ≥99% 或黑名单+高税)、权限放弃
  (owner()/getOwner() 读零地址)、黑名单(字节码扫描已知函数选择器),
  结果仅供参考,页面已标注
- **管理面板**:`/admin` 可视化编辑每条链的工厂/曲线/路由/PM 参数;
  写操作校验 `x-admin-wallet` ∈ `NEXT_PUBLIC_ADMIN_WALLETS`;
  DB(chain_configs)为权威来源,表空时从 env 自动种子;indexer 读 env 启动,改配置后需重启
- **RPC 网关丢批量请求**:所有 viem http transport 必须 `batch:false`,
  链上 multicall3(0xca11…ca11)不受影响,已登记进链定义

完整说明（架构、功能、必填配置、未完成项、服务器部署步骤）见 **[docs/运营与部署.md](docs/运营与部署.md)**。

## 启动

```bash
cp .env.example .env   # 填 RPC、合约地址、Privy App ID
pnpm install
pnpm services          # 终端 0:一键启动本地 PostgreSQL 17 + Redis(免安装,见下)
pnpm db:generate && pnpm db:migrate   # 首次或 schema 变更后
pnpm dev:indexer       # 终端 1:索引器(需要真实 RPC 地址才能跑通回填)
pnpm dev:chat          # 终端 2:聊天服务
pnpm dev:web           # 终端 3:前端(3000 被占用时:pnpm dev:web -- -p 3100)
```

### 本地数据服务(pnpm services)

`tools/start-services.mjs` 启动真实 PostgreSQL 17(内嵌二进制,首次自动 initdb、
建 terminal 库)+ Redis 5,无需安装/Docker。注意:

- **PG 二进制不能位于中文路径**(GBK 代码页下 initdb post-bootstrap 必崩),
  所以二进制和数据目录都在 `%LOCALAPPDATA%\snowon-terminal\` 下
- `.env` 归各应用自己读:`apps/web/.env.local`(Next.js 只读本目录)、
  `apps/indexer/.env`、`apps/chat/.env`(dotenv 按进程工作目录读)
- 生产/联调换成系统级 Postgres 时,停掉本脚本、改 `.env` 指向即可

## TODO(骨架之后)

- [x] 填入 snowon.fun 在 Robinhood Chain 的实测合约地址(.env,chainId 4663 已验证)
- [x] ~~TradingView charting_library license~~ → 已改用 lightweight-charts(Apache 2.0,无需 license)
- [x] Privy JWT 服务端校验(apps/chat 已接入 @privy-io/server-auth,配上 PRIVY_APP_SECRET 即启用)
- [x] K线实时推送:indexer 发布 price:* → chat 服务 WebSocket 扇出 → 前端续画最后一根 bar(5s 轮询仍作兜底)
- [x] 毕业后非 ETH 报价资产的 Swap 事件 Q→ETH 换算(handlers.ethFromRouterTx,同笔 tx 匹配 ETH/Q hop)
- [x] 管理面板:每链发射工厂参数可视化配置(/admin,DB 驱动 + env 种子)
- [x] 个人页:用户名/推特绑定/胜率/7d/30d/总已实现 PNL/每日盈亏日历(月结)
- [ ] AI 入口:把 /api/token、/api/wallet/{addr}/pnl 包装成 MCP server
- [ ] BSC:部署后新增 ChainConfig + SnowOnBsc adapter(bsc/bscv4 合约差异)
- [ ] 推特 OAuth 真绑定(现为 handle 直填,无验证)
