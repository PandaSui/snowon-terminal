import {
  pgTable,
  varchar,
  text,
  integer,
  smallint,
  bigint,
  numeric,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

/**
 * 所有业务表强制带 chainId 维度(BSC 预留)。
 * 大额整数(wei、token base units)一律 numeric(78,0),JS 侧用 bigint 读写。
 * 价格类用 numeric(40,18) 存 ETH 计价,避免 Q 计价混入前端。
 */

// ──────────────────────────── 代币 ────────────────────────────
export const tokens = pgTable(
  "tokens",
  {
    chainId: integer("chain_id").notNull(),
    address: varchar("address", { length: 42 }).notNull(),
    platformId: varchar("platform_id", { length: 32 }).notNull(), // 'snowon'
    curveAddress: varchar("curve_address", { length: 42 }).notNull(),
    creator: varchar("creator", { length: 42 }).notNull(),
    feeReceiver: varchar("fee_receiver", { length: 42 }).notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    logoUri: text("logo_uri"),
    description: text("description"),
    skill: varchar("skill", { length: 64 }),
    website: text("website"),
    twitter: text("twitter"),
    telegram: text("telegram"),
    github: text("github"),
    /** 报价资产 Q;0x000...0 表示原生 ETH */
    quoteAsset: varchar("quote_asset", { length: 42 }).notNull(),
    quoteDecimals: smallint("quote_decimals").notNull().default(18),
    isRwa: boolean("is_rwa").notNull().default(false),

    buyTaxBps: smallint("buy_tax_bps").notNull().default(0),
    sellTaxBps: smallint("sell_tax_bps").notNull().default(0),
    antiSnipe: boolean("anti_snipe").notNull().default(false),
    antiBundle: boolean("anti_bundle").notNull().default(false),

    // 曲线参数快照(创建时从 registry 拷入,之后 immutable)
    curveP0: numeric("curve_p0", { precision: 78, scale: 0 }).notNull(),
    curveSlope: numeric("curve_slope", { precision: 78, scale: 0 }).notNull(),
    graduationThreshold: numeric("graduation_threshold", { precision: 78, scale: 0 }),

    // 毕业状态
    graduated: boolean("graduated").notNull().default(false),
    graduatedAt: timestamp("graduated_at", { withTimezone: true }),
    /** V4 池没有独立合约地址,用 poolId (bytes32) 定位 */
    poolId: varchar("pool_id", { length: 66 }),
    lpLockedForever: boolean("lp_locked_forever").notNull().default(true),
    /** 毕业建池锁定的 Q/ETH 数量(wei) */
    lpQuoteWei: numeric("lp_quote_wei", { precision: 78, scale: 0 }),
    /** 毕业建池锁定的代币数量(base units) */
    lpTokenWei: numeric("lp_token_wei", { precision: 78, scale: 0 }),

    createdAtBlock: bigint("created_at_block", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    createdTx: varchar("created_tx", { length: 66 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.address] }),
    index("tokens_chain_created_idx").on(t.chainId, t.createdAt),
    index("tokens_chain_graduated_idx").on(t.chainId, t.graduated),
    index("tokens_chain_curve_idx").on(t.chainId, t.curveAddress),
    index("tokens_chain_pool_idx").on(t.chainId, t.poolId),
  ],
);

// ──────────────────────────── 成交 ────────────────────────────
export const trades = pgTable(
  "trades",
  {
    chainId: integer("chain_id").notNull(),
    txHash: varchar("tx_hash", { length: 66 }).notNull(),
    logIndex: integer("log_index").notNull(),
    tokenAddress: varchar("token_address", { length: 42 }).notNull(),
    trader: varchar("trader", { length: 42 }).notNull(),
    isBuy: boolean("is_buy").notNull(),
    /** 用户实际支付/收到的 ETH(曲线阶段来自事件,池子阶段由路由换算) */
    ethAmount: numeric("eth_amount", { precision: 78, scale: 0 }).notNull(),
    /** 计价资产 Q 的数量(毕业前=曲线净额,毕业后=池子 Q 腿) */
    quoteAmount: numeric("quote_amount", { precision: 78, scale: 0 }).notNull(),
    tokenAmount: numeric("token_amount", { precision: 78, scale: 0 }).notNull(),
    /** 本笔成交均价,ETH / whole-token,K线和 PNL 统一用它 */
    priceEth: numeric("price_eth", { precision: 40, scale: 18 }).notNull(),
    /** 'curve' | 'pool' —— 毕业前后数据源标识 */
    phase: varchar("phase", { length: 8 }).notNull(),
    /** buy | sell | add | remove | burn | fee | in | out */
    kind: varchar("kind", { length: 12 }).notNull().default("buy"),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTimestamp: timestamp("block_timestamp", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.txHash, t.logIndex] }),
    index("trades_token_time_idx").on(t.chainId, t.tokenAddress, t.blockTimestamp),
    index("trades_trader_idx").on(t.chainId, t.trader),
    index("trades_token_block_idx").on(t.chainId, t.tokenAddress, t.blockNumber),
  ],
);

// ──────────────────────────── 钱包地址库 ────────────────────────────
export const wallets = pgTable(
  "wallets",
  {
    chainId: integer("chain_id").notNull(),
    address: varchar("address", { length: 42 }).notNull(),
    /** 第一笔入账 ETH 的来源地址(资金来源追踪) */
    firstFunder: varchar("first_funder", { length: 42 }),
    firstFundTx: varchar("first_fund_tx", { length: 66 }),
    firstFundAt: timestamp("first_fund_at", { withTimezone: true }),
    /**
     * 资金来源标签:'cex' | 'bridge' | 'mixer' | 'contract' | 'eoa' | null
     * 由离线打标任务填充(CEX 热钱包库等)
     */
    funderLabel: varchar("funder_label", { length: 16 }),
    /** 手工/启发式标签:'deployer' | 'sniper' | 'smart-money' | 'bundler' ... */
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.address] }),
    index("wallets_first_funder_idx").on(t.chainId, t.firstFunder),
  ],
);

// ──────────────────────── 持仓 & PNL ────────────────────────
export const positions = pgTable(
  "positions",
  {
    chainId: integer("chain_id").notNull(),
    wallet: varchar("wallet", { length: 42 }).notNull(),
    tokenAddress: varchar("token_address", { length: 42 }).notNull(),
    /** 当前持仓(base units) */
    balance: numeric("balance", { precision: 78, scale: 0 }).notNull().default("0"),
    /** 剩余持仓对应的成本(ETH wei),加权平均成本法滚动结转 */
    costBasisEth: numeric("cost_basis_eth", { precision: 78, scale: 0 }).notNull().default("0"),
    /** 已实现盈亏(ETH wei,可为负) */
    realizedPnlEth: numeric("realized_pnl_eth", { precision: 78, scale: 0 }).notNull().default("0"),
    totalBoughtEth: numeric("total_bought_eth", { precision: 78, scale: 0 }).notNull().default("0"),
    totalSoldEth: numeric("total_sold_eth", { precision: 78, scale: 0 }).notNull().default("0"),
    buyCount: integer("buy_count").notNull().default(0),
    sellCount: integer("sell_count").notNull().default(0),
    firstBuyAt: timestamp("first_buy_at", { withTimezone: true }),
    lastTradeAt: timestamp("last_trade_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.wallet, t.tokenAddress] }),
    index("positions_token_idx").on(t.chainId, t.tokenAddress),
    index("positions_token_bal_idx").on(t.chainId, t.tokenAddress, t.balance),
  ],
);

// ────────────────────── 捆绑/老鼠仓评分 ──────────────────────
export const bundleScores = pgTable(
  "bundle_scores",
  {
    chainId: integer("chain_id").notNull(),
    tokenAddress: varchar("token_address", { length: 42 }).notNull(),
    /** 0-100 综合分,越高越可疑 */
    score: smallint("score").notNull(),
    /** 启动区块起 N 个区块内买入占早期总买入比例 */
    launchBlockBuyShare: numeric("launch_block_buy_share", { precision: 6, scale: 4 }),
    /** firstFunder 相同的早期买入簇占比 */
    sameFunderShare: numeric("same_funder_share", { precision: 6, scale: 4 }),
    /** creator 自买占启动期比例 */
    creatorBuyShare: numeric("creator_buy_share", { precision: 6, scale: 4 }),
    top10HolderShare: numeric("top10_holder_share", { precision: 6, scale: 4 }),
    detail: jsonb("detail"), // 中间证据:地址簇、交易列表等
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.tokenAddress] })],
);

// ──────────────────────────── 聊天 ────────────────────────────
export const chatUsers = pgTable("chat_users", {
  id: varchar("id", { length: 64 }).notNull().primaryKey(), // privy user id 或 wallet
  username: varchar("username", { length: 32 }).notNull(),
  avatarUrl: text("avatar_url"),
  /** 绑定钱包(可选,用于持仓徽章) */
  walletAddress: varchar("wallet_address", { length: 42 }),
  walletChainId: integer("wallet_chain_id"),
  /** 隐私开关:是否在聊天室展示持仓 */
  showHoldings: boolean("show_holdings").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    chainId: integer("chain_id").notNull(),
    /** 房间 = 代币地址;'global' 为全站聊天室 */
    room: varchar("room", { length: 42 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    /** 发送时快照的持仓徽章(可选展示,百分比) */
    holdingShareBps: integer("holding_share_bps"),
    content: text("content").notNull(),
    replyTo: bigint("reply_to", { mode: "bigint" }),
    clientMsgId: varchar("client_msg_id", { length: 64 }), // 幂等去重
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }), // 软删=审核
  },
  (t) => [
    index("chat_room_time_idx").on(t.chainId, t.room, t.createdAt),
    index("chat_client_msg_idx").on(t.userId, t.clientMsgId),
  ],
);

// ──────────────────────── K线(物化聚合) ────────────────────────
/**
 * K线不落库计算,运行时由 trades 表按 resolution 聚合(ClickHouse 迁移预留)。
 * 这里只留一张 latest_price 快表供榜单/推送用。
 */
export const latestPrices = pgTable(
  "latest_prices",
  {
    chainId: integer("chain_id").notNull(),
    tokenAddress: varchar("token_address", { length: 42 }).notNull(),
    priceEth: numeric("price_eth", { precision: 40, scale: 18 }).notNull(),
    /** 曲线阶段:quoteReserve / threshold 进度;毕业后为 null */
    graduationProgress: numeric("graduation_progress", { precision: 6, scale: 4 }),
    volume24hEth: numeric("volume_24h_eth", { precision: 78, scale: 0 }).notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.tokenAddress] })],
);

// ──────────────────────── 索引器游标 ────────────────────────
export const indexerCursors = pgTable("indexer_cursors", {
  chainId: integer("chain_id").notNull().primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// ──────────────────────── 链级发射工厂配置(管理面板) ────────────────────────
/**
 * 每条链的发射工厂/合约群参数。管理面板(/admin)可编辑,DB 为权威来源;
 * 表为空时由 env(SNOWON_*_<chainId>)自动种子导入,现有部署零迁移。
 * Pons V2 工厂/Hook/起始块存在同表附加列(非第二行 PK),空则回退 env / 默认主网地址。
 * 注意:indexer 是长驻进程,启动时读 DB 覆盖 env——改配置后需重启 indexer 生效。
 */
export const chainConfigs = pgTable("chain_configs", {
  chainId: integer("chain_id").primaryKey(),
  platformId: varchar("platform_id", { length: 32 }).notNull().default("snowon"),
  name: text("name").notNull(),
  rpcUrl: text("rpc_url").notNull(),
  wsUrl: text("ws_url"),
  factory: varchar("factory", { length: 42 }).notNull(),
  hook: varchar("hook", { length: 42 }).notNull(),
  registry: varchar("registry", { length: 42 }).notNull(),
  swapRouter: varchar("swap_router", { length: 42 }).notNull(),
  poolManager: varchar("pool_manager", { length: 42 }).notNull(),
  /** 索引起始区块(工厂部署块) */
  deployBlock: bigint("deploy_block", { mode: "bigint" }).notNull().default(0n),
  /** Pons V2 发射工厂;空则回退 env PONS_FACTORY_* */
  ponsFactory: varchar("pons_factory", { length: 42 }),
  ponsHook: varchar("pons_hook", { length: 42 }),
  ponsDeployBlock: bigint("pons_deploy_block", { mode: "bigint" }).default(0n),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────── 用户资料(个人页) ────────────────────────
/** 用户名 + 推特绑定。钱包地址即身份,修改无需签名(本地终端信任模型)。 */
export const userProfiles = pgTable(
  "user_profiles",
  {
    chainId: integer("chain_id").notNull(),
    wallet: varchar("wallet", { length: 42 }).notNull(),
    username: varchar("username", { length: 32 }),
    /** 推特 handle(不含 @) */
    twitter: varchar("twitter", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.wallet] })],
);

// ──────────────────────── 用户追踪钱包 ────────────────────────
/** 每个已连接钱包自己的追踪名单,上限由 API 卡 10000。 */
export const trackedWallets = pgTable(
  "tracked_wallets",
  {
    chainId: integer("chain_id").notNull(),
    owner: varchar("owner", { length: 42 }).notNull(),
    address: varchar("address", { length: 42 }).notNull(),
    label: varchar("label", { length: 64 }),
    note: text("note"),
    watching: boolean("watching").notNull().default(true),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.owner, t.address] }),
    index("tracked_wallets_owner_idx").on(t.chainId, t.owner),
  ],
);

// ────────────────────────── 管理员名单 ──────────────────────────
/** env(ADMIN_WALLETS)为主管理员、不可移除;此表为可通过管理面板增删的协管员 */
export const adminWallets = pgTable("admin_wallets", {
  address: varchar("address", { length: 42 }).primaryKey(),
  /** 添加他的管理员地址 */
  addedBy: varchar("added_by", { length: 42 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ────────────────────────── 全局应用设置 ──────────────────────────
/** 单行(id=1)全局配置,管理面板可改。目前用于付费叮住的价格/时长/上限/收款地址。 */
export const appSettings = pgTable("app_settings", {
  id: smallint("id").primaryKey().default(1),
  /** 叮住一次的价格(整数 SNOW,如 100) */
  pinPriceSnow: numeric("pin_price_snow").notNull().default("100"),
  /** 叮住展示时长(秒),默认 3600=60 分钟 */
  pinDurationSec: integer("pin_duration_sec").notNull().default(3600),
  /** 每房间最多同时叮住条数 */
  pinMax: smallint("pin_max").notNull().default(5),
  /** SNOW 收款地址(付费叮住打到这里) */
  pinPayee: varchar("pin_payee", { length: 42 }).notNull().default("0xEC11B5bd5f863b588a66A97C1Eda6c47010Ca751"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ────────────────────── 登录 nonce(签名鉴权防重放)──────────────────────
/** 一次性 nonce:签发后写入,登录验签时消费(删除),5 分钟过期。 */
export const authNonces = pgTable("auth_nonces", {
  nonce: varchar("nonce", { length: 64 }).primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
