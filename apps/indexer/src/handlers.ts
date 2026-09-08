import type { Address, Hex, Log, PublicClient } from "viem";
import { parseEventLogs, zeroAddress } from "viem";
import { eq, and, sql, inArray } from "drizzle-orm";
import type { Db } from "@terminal/db";
import { latestPrices, tokens, trades, wallets } from "@terminal/db";
import type { ChainConfig } from "@terminal/adapters";
import { poolIdOf, ponsAbis, readPoolSqrtP, snowAbis, snowCurveMath } from "@terminal/adapters";
import { applyTradeToPosition, applyTransferToPosition } from "./pnl.js";
import { enqueueFirstFunder } from "./funding.js";
import { formatPriceEth, shareDecimal } from "./price.js";
import { applyOffchainMeta } from "./meta.js";

type LogArgs = Record<string, unknown>;

type CurveToken = {
  address: string;
  graduationThreshold: string | null;
  graduated: boolean;
};

const BLOCK_CACHE_MAX = 80_000;
const BLOCK_CACHE_TRIM = 20_000;
const PREFETCH_CONCURRENCY = 12;
/** 单笔成交 ETH 上限。超过说明 hop 把另一腿代币数量误当成了 ETH */
const MAX_TRADE_ETH_WEI = 10n ** 22n;
const DEAD = "0x000000000000000000000000000000000000dead";
/** 同一笔 Transfer 拆成转出/转入两行时,转入行用 logIndex + 该偏移,避免主键冲突 */
const TRANSFER_IN_LOG_OFFSET = 1_000_000;

/**
 * 事件处理器:把链上事件写进数据库。
 * 曲线阶段的 Buy/Sell 事件直接带 ethIn/ethOut(用户视角的 ETH 数量),
 * 无需再做 Q 换算;priceEth = ethAmount / tokenAmount。
 */
export class EventHandlers {
  /** 同块多笔成交只打一次 eth_getBlockByNumber */
  private readonly blockTimeCache = new Map<string, Date>();
  private readonly tokenByCurve = new Map<string, CurveToken>();
  private readonly tokenByPool = new Map<string, (typeof tokens.$inferSelect)>();
  private readonly unknownCurves = new Set<string>();
  private readonly unknownPools = new Set<string>();
  private readonly tokenMeta = new Map<string, { curveAddress: string; graduated: boolean }>();
  private readonly unknownTokens = new Set<string>();
  /** 曲线买入累计 quote,避免每笔 SUM(trades) */
  private readonly quoteBought = new Map<string, bigint>();
  private readonly txFromCache = new Map<string, string>();
  private readonly quoteMeta = new Map<string, { quote: Address; fee: number; spacing: number }>();
  private readonly ethQSqrtP = new Map<string, { at: number; v: bigint | null }>();
  private readonly swapTxCache = new Map<string, {
    from: Address;
    value: bigint;
    swaps: Array<{ id: string; amount0: bigint; amount1: bigint; sqrtP: bigint }>;
  }>();

  constructor(
    private readonly db: Db,
    private readonly client: PublicClient,
    private readonly cfg: ChainConfig,
    /** Redis 发布器:把实时价格推给 web 层(K线 subscribeBars / 榜单) */
    private readonly publish: (channel: string, payload: unknown) => void,
    private readonly pons?: { factory: Address; hook: Address },
  ) {}

  private cacheBlockTime(blockNumber: bigint, ts: Date) {
    if (this.blockTimeCache.size >= BLOCK_CACHE_MAX) {
      let n = 0;
      for (const k of this.blockTimeCache.keys()) {
        this.blockTimeCache.delete(k);
        if (++n >= BLOCK_CACHE_TRIM) break;
      }
    }
    this.blockTimeCache.set(blockNumber.toString(), ts);
  }

  private async blockTime(blockNumber: bigint): Promise<Date> {
    const key = blockNumber.toString();
    const hit = this.blockTimeCache.get(key);
    if (hit) return hit;
    const b = await this.client.getBlock({ blockNumber });
    const ts = new Date(Number(b.timestamp) * 1000);
    this.cacheBlockTime(blockNumber, ts);
    return ts;
  }

  /** 一批日志先按唯一块号并发预取时间戳,后续 blockTime 全部命中缓存 */
  async prefetchBlockTimes(blockNumbers: Array<bigint | null | undefined>): Promise<void> {
    const missing: bigint[] = [];
    const seen = new Set<string>();
    for (const bn of blockNumbers) {
      if (bn == null) continue;
      const key = bn.toString();
      if (seen.has(key) || this.blockTimeCache.has(key)) continue;
      seen.add(key);
      missing.push(bn);
    }
    for (let i = 0; i < missing.length; i += PREFETCH_CONCURRENCY) {
      const slice = missing.slice(i, i + PREFETCH_CONCURRENCY);
      const blocks = await Promise.all(slice.map((bn) => this.client.getBlock({ blockNumber: bn })));
      for (let j = 0; j < slice.length; j++) {
        this.cacheBlockTime(slice[j], new Date(Number(blocks[j].timestamp) * 1000));
      }
    }
  }

  private async loadQuoteMeta(curveAddress: string): Promise<{ quote: Address; fee: number; spacing: number } | null> {
    const key = curveAddress.toLowerCase();
    const hit = this.quoteMeta.get(key);
    if (hit) return hit;
    try {
      const curve = key as Address;
      const [quote, fee, spacing] = await Promise.all([
        this.client.readContract({ address: curve, abi: snowAbis.snowBondingCurveAbi, functionName: "quote" }),
        this.client.readContract({ address: curve, abi: snowAbis.snowBondingCurveAbi, functionName: "quoteEthFee" }),
        this.client.readContract({ address: curve, abi: snowAbis.snowBondingCurveAbi, functionName: "quoteEthSpacing" }),
      ]);
      const meta = { quote: quote.toLowerCase() as Address, fee: Number(fee), spacing: Number(spacing) };
      this.quoteMeta.set(key, meta);
      return meta;
    } catch {
      return null;
    }
  }

  private async ethQSqrtPrice(quote: Address, fee: number, spacing: number): Promise<bigint | null> {
    if (quote === zeroAddress) return null;
    const cacheKey = `${quote}:${fee}:${spacing}`;
    const hit = this.ethQSqrtP.get(cacheKey);
    if (hit && Date.now() - hit.at < 4_000) return hit.v;
    try {
      const id = poolIdOf({
        currency0: zeroAddress,
        currency1: quote,
        fee,
        tickSpacing: spacing,
        hooks: zeroAddress,
      });
      const v = await readPoolSqrtP(this.client, this.cfg.poolManager, id);
      this.ethQSqrtP.set(cacheKey, { at: Date.now(), v });
      return v;
    } catch {
      this.ethQSqrtP.set(cacheKey, { at: Date.now(), v: null });
      return null;
    }
  }

  /** 把池子报价腿(ETH 或 Q)换成 ETH wei */
  private async quoteLegToEth(
    token: { quoteAsset: string; curveAddress: string },
    quoteWei: bigint,
  ): Promise<bigint> {
    const q = (token.quoteAsset || zeroAddress).toLowerCase();
    if (q === zeroAddress) return quoteWei;
    if (quoteWei === 0n) return 0n;
    const meta = await this.loadQuoteMeta(token.curveAddress);
    if (!meta) return 0n;
    const sqrtP = await this.ethQSqrtPrice(meta.quote, meta.fee, meta.spacing);
    if (!sqrtP) return 0n;
    return snowCurveMath.quoteToEthAtSpot(sqrtP, quoteWei);
  }

  private async loadSwapTx(hash: Hex) {
    const hit = this.swapTxCache.get(hash);
    if (hit) return hit;
    const [tx, receipt] = await Promise.all([
      this.client.getTransaction({ hash }),
      this.client.getTransactionReceipt({ hash }),
    ]);
    const parsed = parseEventLogs({
      abi: snowAbis.poolManagerAbi,
      logs: receipt.logs,
      eventName: "Swap",
    });
    const swaps = parsed.map((l) => ({
      id: String(l.args.id).toLowerCase(),
      amount0: l.args.amount0 as bigint,
      amount1: l.args.amount1 as bigint,
      sqrtP: l.args.sqrtPriceX96 as bigint,
    }));
    const row = { from: tx.from.toLowerCase() as Address, value: tx.value, swaps };
    this.swapTxCache.set(hash, row);
    if (this.swapTxCache.size > 4_000) {
      let n = 0;
      for (const k of this.swapTxCache.keys()) {
        this.swapTxCache.delete(k);
        if (++n >= 1_000) break;
      }
    }
    return row;
  }

  /**
   * Q 计价池:同笔交易里 ETH/Q hop 的 ETH 数量。
   * 代币↔代币多跳没有 ETH 腿,绝不能把另一池的 token amount0 当成 ETH
   * (否则 K 线会出现 1e6 ETH / 6 ETH 价这种尖刺,整图被压成一条线)。
   */
  private async ethFromRouterTx(
    txHash: Hex,
    token: { curveAddress: string; quoteAsset: string },
    tokenPoolId: string,
    quoteAmount: bigint,
    isBuy: boolean,
  ): Promise<bigint> {
    const tx = await this.loadSwapTx(txHash);
    const pid = tokenPoolId.toLowerCase();
    const hops = tx.swaps.filter((s) => s.id !== pid);

    let ethQId: string | null = null;
    const meta = await this.loadQuoteMeta(token.curveAddress);
    if (meta && meta.quote !== zeroAddress) {
      ethQId = poolIdOf({
        currency0: zeroAddress,
        currency1: meta.quote,
        fee: meta.fee,
        tickSpacing: meta.spacing,
        hooks: zeroAddress,
      }).toLowerCase();
    }

    const abs = (n: bigint) => (n < 0n ? -n : n);
    const looksLikeEthQ = (s: { id: string; amount0: bigint; amount1: bigint }) => {
      if (ethQId) return s.id === ethQId;
      const eth = abs(s.amount0);
      const q = abs(s.amount1);
      if (eth === 0n || eth > MAX_TRADE_ETH_WEI) return false;
      const d = q > quoteAmount ? q - quoteAmount : quoteAmount - q;
      return quoteAmount === 0n ? q > 0n : d * 10n <= quoteAmount;
    };

    const ethHop = (ethQId ? hops.find((s) => s.id === ethQId) : undefined) ?? hops.find(looksLikeEthQ);
    if (ethHop) {
      const eth = abs(ethHop.amount0);
      if (eth > 0n && eth <= MAX_TRADE_ETH_WEI) return eth;
      if (ethHop.sqrtP > 0n) {
        const conv = snowCurveMath.quoteToEthAtSpot(ethHop.sqrtP, quoteAmount);
        if (conv > 0n && conv <= MAX_TRADE_ETH_WEI) return conv;
      }
    }
    // 仅单 hop 买入可用 tx.value;代币↔代币多跳绝不能拿另一腿当 ETH
    if (isBuy && hops.length === 0 && tx.value > 0n && tx.value <= MAX_TRADE_ETH_WEI) return tx.value;
    return 0n;
  }

  async refreshGraduatedSpotPrices(): Promise<void> {
    const rows = await this.db
      .select()
      .from(tokens)
      .where(and(eq(tokens.chainId, this.cfg.chainId), eq(tokens.graduated, true)));
    for (const t of rows) {
      if (!t.poolId) continue;
      try {
        const quote = (t.quoteAsset || zeroAddress).toLowerCase();
        const tokenIsC0 = t.address.toLowerCase() < quote;
        const sqrtP = await readPoolSqrtP(this.client, this.cfg.poolManager, t.poolId as Hex);
        if (!sqrtP) continue;
        let qSqrt = 0n;
        const quoteIsEth = quote === zeroAddress;
        if (!quoteIsEth) {
          const meta = await this.loadQuoteMeta(t.curveAddress);
          if (!meta) continue;
          const s = await this.ethQSqrtPrice(meta.quote, meta.fee, meta.spacing);
          if (!s) continue;
          qSqrt = s;
        }
        const priceWei = snowCurveMath.poolPriceEth(sqrtP, tokenIsC0, quoteIsEth, qSqrt);
        if (priceWei <= 0n) continue;
        await this.upsertLatestPrice(t.address, formatPriceEth(priceWei, 10n ** 18n), new Date(), null);
      } catch {
        /* 单个池失败不挡其余 */
      }
    }
  }

  private async upsertLatestPrice(
    tokenAddress: string,
    priceEth: string,
    ts: Date,
    graduationProgress: string | null,
  ) {
    const n = Number(priceEth);
    // 6 ETH / 1e-16 这种脏价不写 latest_prices,否则顶栏市值/涨跌/池子全坏
    if (!Number.isFinite(n) || n <= 1e-14 || n >= 0.01) return;
    await this.db
      .insert(latestPrices)
      .values({
        chainId: this.cfg.chainId,
        tokenAddress,
        priceEth,
        graduationProgress,
        updatedAt: ts,
      })
      .onConflictDoUpdate({
        target: [latestPrices.chainId, latestPrices.tokenAddress],
        set: { priceEth, graduationProgress, updatedAt: ts },
      });
  }

  private rememberCurveToken(curveAddr: string, token: CurveToken) {
    this.tokenByCurve.set(curveAddr, token);
    this.unknownCurves.delete(curveAddr);
  }

  private async lookupByCurve(curveAddr: string): Promise<CurveToken | null> {
    const cached = this.tokenByCurve.get(curveAddr);
    if (cached) return cached;
    if (this.unknownCurves.has(curveAddr)) return null;
    const [token] = await this.db
      .select({
        address: tokens.address,
        graduationThreshold: tokens.graduationThreshold,
        graduated: tokens.graduated,
      })
      .from(tokens)
      .where(and(eq(tokens.chainId, this.cfg.chainId), eq(tokens.curveAddress, curveAddr)))
      .limit(1);
    if (!token) {
      this.unknownCurves.add(curveAddr);
      return null;
    }
    this.rememberCurveToken(curveAddr, token);
    return token;
  }

  private async lookupTokenMeta(tokenAddr: string): Promise<{ curveAddress: string; graduated: boolean } | null> {
    const cached = this.tokenMeta.get(tokenAddr);
    if (cached) return cached;
    if (this.unknownTokens.has(tokenAddr)) return null;
    const [row] = await this.db
      .select({
        curveAddress: tokens.curveAddress,
        graduated: tokens.graduated,
      })
      .from(tokens)
      .where(and(eq(tokens.chainId, this.cfg.chainId), eq(tokens.address, tokenAddr)))
      .limit(1);
    if (!row) {
      this.unknownTokens.add(tokenAddr);
      return null;
    }
    const meta = { curveAddress: row.curveAddress.toLowerCase(), graduated: row.graduated };
    this.tokenMeta.set(tokenAddr, meta);
    return meta;
  }

  private async curveProgress(
    tokenAddress: string,
    threshold: string | null,
    addQuote?: bigint,
  ): Promise<string | null> {
    if (!threshold) return "0.0000";
    const th = BigInt(threshold);
    if (th === 0n) return "0.0000";
    let total = this.quoteBought.get(tokenAddress);
    if (total === undefined) {
      // 成交已入库,SUM 已含本笔,不要再加 addQuote
      const [row] = await this.db
        .select({
          q: sql<string>`coalesce(sum(${trades.quoteAmount}::numeric), 0)`,
        })
        .from(trades)
        .where(
          and(
            eq(trades.chainId, this.cfg.chainId),
            eq(trades.tokenAddress, tokenAddress),
            eq(trades.isBuy, true),
            eq(trades.phase, "curve"),
          ),
        );
      total = BigInt((row?.q ?? "0").split(".")[0] ?? "0");
    } else if (addQuote && addQuote > 0n) {
      total += addQuote;
    }
    this.quoteBought.set(tokenAddress, total);
    return shareDecimal(total, th);
  }

  async onCoinCreated(log: Log & { args: LogArgs }) {
    const a = log.args as unknown as {
      creator: Address; token: Address; curve: Address; name: string; symbol: string;
      logoURI: string; pairAsset: Address; buyTaxBps: number; sellTaxBps: number;
      antiSnipe: boolean; antiBundle: boolean; feeReceiver: Address;
    };
    const ts = await this.blockTime(log.blockNumber!);

    const [p0, slope, quoteDecimals, threshold] = await Promise.all([
      this.client.readContract({ address: a.curve, abi: snowAbis.snowBondingCurveAbi, functionName: "p0" }),
      this.client.readContract({ address: a.curve, abi: snowAbis.snowBondingCurveAbi, functionName: "slope" }),
      this.client.readContract({ address: a.curve, abi: snowAbis.snowBondingCurveAbi, functionName: "quoteDecimals" }),
      this.client.readContract({
        address: this.cfg.factory, abi: snowAbis.snowOnFactoryAbi,
        functionName: "graduationThreshold", args: [a.pairAsset],
      }),
    ]);

    await this.db
      .insert(tokens)
      .values({
        chainId: this.cfg.chainId,
        address: a.token.toLowerCase(),
        platformId: this.cfg.platformId,
        curveAddress: a.curve.toLowerCase(),
        creator: a.creator.toLowerCase(),
        feeReceiver: a.feeReceiver.toLowerCase(),
        name: a.name,
        symbol: a.symbol,
        logoUri: a.logoURI,
        quoteAsset: a.pairAsset.toLowerCase(),
        quoteDecimals,
        buyTaxBps: a.buyTaxBps,
        sellTaxBps: a.sellTaxBps,
        antiSnipe: a.antiSnipe,
        antiBundle: a.antiBundle,
        curveP0: p0.toString(),
        curveSlope: slope.toString(),
        graduationThreshold: threshold.toString(),
        createdAtBlock: log.blockNumber!,
        createdAt: ts,
        createdTx: log.transactionHash!,
      })
      .onConflictDoNothing();

    await this.db
      .insert(wallets)
      .values({
        chainId: this.cfg.chainId,
        address: a.creator.toLowerCase(),
        firstSeenAt: ts,
        lastSeenAt: ts,
      })
      .onConflictDoNothing();

    this.rememberCurveToken(a.curve.toLowerCase(), {
      address: a.token.toLowerCase(),
      graduationThreshold: threshold.toString(),
      graduated: false,
    });
    this.tokenMeta.set(a.token.toLowerCase(), {
      curveAddress: a.curve.toLowerCase(),
      graduated: false,
    });
    this.unknownTokens.delete(a.token.toLowerCase());
    enqueueFirstFunder(this.db, this.client, this.cfg.chainId, a.creator);
    void applyOffchainMeta(this.db, this.cfg.chainId, a.token).catch((e) =>
      console.error(`[meta] ${a.token}`, e),
    );
  }

  async onCurveTrade(log: Log & { args: LogArgs }, isBuy: boolean) {
    const a = log.args as unknown as {
      buyer?: Address; seller?: Address;
      ethIn?: bigint; quoteIn?: bigint; tokensOut?: bigint;
      tokensIn?: bigint; quoteOut?: bigint; ethOut?: bigint;
    };
    const curveAddr = log.address.toLowerCase();
    const token = await this.lookupByCurve(curveAddr);
    if (!token) return;

    const trader = (isBuy ? a.buyer! : a.seller!).toLowerCase();
    const ethAmount = isBuy ? a.ethIn! : a.ethOut!;
    const quoteAmount = isBuy ? a.quoteIn! : a.quoteOut!;
    const tokenAmount = isBuy ? a.tokensOut! : a.tokensIn!;
    const priceStr = formatPriceEth(ethAmount, tokenAmount);
    const ts = await this.blockTime(log.blockNumber!);

    const inserted = await this.db.insert(trades).values({
      chainId: this.cfg.chainId,
      txHash: log.transactionHash!,
      logIndex: log.logIndex!,
      tokenAddress: token.address,
      trader,
      isBuy,
      ethAmount: ethAmount.toString(),
      quoteAmount: quoteAmount.toString(),
      tokenAmount: tokenAmount.toString(),
      priceEth: priceStr,
      phase: "curve",
      kind: isBuy ? "buy" : "sell",
      blockNumber: log.blockNumber!,
      blockTimestamp: ts,
    }).onConflictDoNothing().returning();
    if (inserted.length === 0) return;

    await applyTradeToPosition(this.db, {
      chainId: this.cfg.chainId, wallet: trader, token: token.address,
      isBuy, tokenAmount, ethAmount, blockTimestamp: ts,
    });
    enqueueFirstFunder(this.db, this.client, this.cfg.chainId, trader);

    this.publish(`price:${this.cfg.chainId}:${token.address}`, {
      priceEth: priceStr,
      isBuy,
      ethAmount: ethAmount.toString(),
      tokenAmount: tokenAmount.toString(),
      ts: ts.toISOString(),
      phase: "curve",
    });
    const progress = token.graduated
      ? null
      : await this.curveProgress(token.address, token.graduationThreshold, isBuy ? quoteAmount : 0n);
    await this.upsertLatestPrice(token.address, priceStr, ts, progress);
  }

  async onGraduated(log: Log & { args: LogArgs }): Promise<string | null> {
    const a = log.args as unknown as {
      poolId: string; quoteForLp?: bigint; tokenForLp?: bigint; burnedTokens?: bigint;
    };
    const curveAddr = log.address.toLowerCase();
    const ts = await this.blockTime(log.blockNumber!);
    const poolId = (a.poolId?.toLowerCase?.() ?? a.poolId) as string | undefined;
    const lpQuote = a.quoteForLp != null ? a.quoteForLp.toString() : null;
    const lpToken = a.tokenForLp != null ? a.tokenForLp.toString() : null;
    await this.db
      .update(tokens)
      .set({
        graduated: true,
        graduatedAt: ts,
        poolId,
        ...(lpQuote != null ? { lpQuoteWei: lpQuote } : {}),
        ...(lpToken != null ? { lpTokenWei: lpToken } : {}),
      })
      .where(and(eq(tokens.chainId, this.cfg.chainId), eq(tokens.curveAddress, curveAddr)));

    const cached = this.tokenByCurve.get(curveAddr);
    if (cached) cached.graduated = true;

    let tokAddr = cached?.address;
    if (!tokAddr) {
      const [tok] = await this.db
        .select({ address: tokens.address })
        .from(tokens)
        .where(and(eq(tokens.chainId, this.cfg.chainId), eq(tokens.curveAddress, curveAddr)))
        .limit(1);
      tokAddr = tok?.address;
    }
    if (tokAddr) {
      const meta = this.tokenMeta.get(tokAddr);
      if (meta) meta.graduated = true;
      await this.db
        .update(latestPrices)
        .set({ graduationProgress: null, updatedAt: ts })
        .where(and(eq(latestPrices.chainId, this.cfg.chainId), eq(latestPrices.tokenAddress, tokAddr)));
    }
    if (poolId) this.unknownPools.delete(poolId);

    if (tokAddr && (a.quoteForLp != null || a.tokenForLp != null || a.burnedTokens != null)) {
      const [tok] = await this.db
        .select()
        .from(tokens)
        .where(and(eq(tokens.chainId, this.cfg.chainId), eq(tokens.address, tokAddr)))
        .limit(1);
      const creator = tok?.creator ?? "0x0000000000000000000000000000000000000000";
      const qLp = a.quoteForLp ?? 0n;
      const tLp = a.tokenForLp ?? 0n;
      if (qLp > 0n || tLp > 0n) {
        const ethLp = tok ? await this.quoteLegToEth(tok, qLp) : qLp;
        await this.db.insert(trades).values({
          chainId: this.cfg.chainId,
          txHash: log.transactionHash!,
          logIndex: log.logIndex!,
          tokenAddress: tokAddr,
          trader: creator,
          isBuy: true,
          ethAmount: (ethLp > 0n ? ethLp : qLp).toString(),
          quoteAmount: qLp.toString(),
          tokenAmount: tLp.toString(),
          priceEth: formatPriceEth(ethLp > 0n ? ethLp : qLp, tLp),
          phase: "pool",
          kind: "add",
          blockNumber: log.blockNumber!,
          blockTimestamp: ts,
        }).onConflictDoNothing();
      }
      const burned = a.burnedTokens ?? 0n;
      if (burned > 0n) {
        await this.db.insert(trades).values({
          chainId: this.cfg.chainId,
          txHash: log.transactionHash!,
          logIndex: (log.logIndex ?? 0) + 1,
          tokenAddress: tokAddr,
          trader: creator,
          isBuy: false,
          ethAmount: "0",
          quoteAmount: "0",
          tokenAmount: burned.toString(),
          priceEth: "0",
          phase: "pool",
          kind: "burn",
          blockNumber: log.blockNumber!,
          blockTimestamp: ts,
        }).onConflictDoNothing();
      }
    }

    this.publish(`graduated:${this.cfg.chainId}`, { curve: curveAddr, poolId });
    return poolId ?? null;
  }

  /**
   * 毕业后 PoolManager Swap → trades 表(phase='pool')。
   * 本链 PoolManager 的 amount0/amount1 是「调用方视角」的 delta(正 = 交易者收到),
   * 与 V3 的池子视角相反:报价腿为负(付出报价)= 买入代币。
   * 已对链上 Transfer 逐笔验证(2026-09-03)。
   * quote != ETH 时用 ETH/Q 池 spot 把 Q 腿换成 ETH,写入 ethAmount/priceEth。
   */
  async onPoolSwap(log: Log & { args: LogArgs }) {
    const a = log.args as unknown as { id: string; amount0: bigint; amount1: bigint };
    const poolId = (a.id?.toLowerCase?.() ?? a.id) as string;
    let token = this.tokenByPool.get(poolId);
    if (!token) {
      if (this.unknownPools.has(poolId)) return;
      const [row] = await this.db
        .select()
        .from(tokens)
        .where(and(eq(tokens.chainId, this.cfg.chainId), eq(tokens.poolId, poolId)))
        .limit(1);
      if (!row) {
        this.unknownPools.add(poolId);
        return;
      }
      token = row;
      this.tokenByPool.set(poolId, row);
    }

    const quote = (token.quoteAsset || zeroAddress).toLowerCase();
    const tokenIsC1 = token.address.toLowerCase() > quote;
    const quoteDelta = tokenIsC1 ? a.amount0 : a.amount1;
    const tokenDelta = tokenIsC1 ? a.amount1 : a.amount0;
    // 调用方视角:quoteDelta < 0 = 付出报价资产 = 买入
    const isBuy = quoteDelta < 0n;
    const quoteAmount = quoteDelta > 0n ? quoteDelta : -quoteDelta;
    const tokenAmount = tokenDelta > 0n ? tokenDelta : -tokenDelta;
    if (tokenAmount === 0n) return;
    const ts = await this.blockTime(log.blockNumber!);
    const txHash = log.transactionHash!;
    let ethAmount = quoteAmount;
    if (quote !== zeroAddress) {
      const fromHop = await this.ethFromRouterTx(txHash as Hex, token, poolId, quoteAmount, isBuy);
      const fromSpot = await this.quoteLegToEth(token, quoteAmount);
      if (fromHop > 0n && fromHop <= MAX_TRADE_ETH_WEI) {
        if (fromSpot > 0n) {
          const ratio = fromHop > fromSpot ? fromHop / fromSpot : fromSpot / fromHop;
          // hop 与 spot 差 1 万倍以上 = 把另一腿代币/粉尘 wei 当成了 ETH
          ethAmount = ratio > 10_000n ? fromSpot : fromHop;
        } else {
          ethAmount = fromHop;
        }
      } else {
        ethAmount = fromSpot;
      }
    }
    if (ethAmount > MAX_TRADE_ETH_WEI) ethAmount = 0n;
    const priceStr = ethAmount > 0n ? formatPriceEth(ethAmount, tokenAmount) : "0";
    let trader = this.txFromCache.get(txHash);
    if (!trader) {
      const tx = await this.loadSwapTx(txHash as Hex);
      trader = tx.from;
      this.txFromCache.set(txHash, trader);
    }

    const inserted = await this.db.insert(trades).values({
      chainId: this.cfg.chainId,
      txHash: log.transactionHash!,
      logIndex: log.logIndex!,
      tokenAddress: token.address,
      trader,
      isBuy,
      ethAmount: ethAmount.toString(),
      quoteAmount: quoteAmount.toString(),
      tokenAmount: tokenAmount.toString(),
      priceEth: priceStr,
      phase: "pool",
      kind: isBuy ? "buy" : "sell",
      blockNumber: log.blockNumber!,
      blockTimestamp: ts,
    }).onConflictDoNothing().returning();
    if (inserted.length === 0) return;
    enqueueFirstFunder(this.db, this.client, this.cfg.chainId, trader);

    if (ethAmount > 0n) {
      await applyTradeToPosition(this.db, {
        chainId: this.cfg.chainId, wallet: trader, token: token.address,
        isBuy, tokenAmount, ethAmount, blockTimestamp: ts,
      });
    }

    if (ethAmount > 0n) {
      this.publish(`price:${this.cfg.chainId}:${token.address}`, {
        priceEth: priceStr,
        isBuy, ethAmount: ethAmount.toString(), tokenAmount: tokenAmount.toString(),
        ts: ts.toISOString(), phase: "pool",
      });
      await this.upsertLatestPrice(token.address, priceStr, ts, null);
    }
  }

  /** V4 加/减仓。SnowOn 毕业池 hook 通常禁止撤流动性,减仓行可能很少。 */
  async onModifyLiquidity(log: Log & { args: LogArgs }) {
    const a = log.args as unknown as { id: string; sender?: Address; liquidityDelta?: bigint };
    const poolId = (a.id?.toLowerCase?.() ?? a.id) as string;
    let token = this.tokenByPool.get(poolId);
    if (!token) {
      if (this.unknownPools.has(poolId)) return;
      const [row] = await this.db
        .select()
        .from(tokens)
        .where(and(eq(tokens.chainId, this.cfg.chainId), eq(tokens.poolId, poolId)))
        .limit(1);
      if (!row) {
        this.unknownPools.add(poolId);
        return;
      }
      token = row;
      this.tokenByPool.set(poolId, row);
    }
    const delta = a.liquidityDelta ?? 0n;
    if (delta === 0n) return;
    const add = delta > 0n;
    const liq = add ? delta : -delta;
    const ts = await this.blockTime(log.blockNumber!);
    const trader = (a.sender ?? "0x0000000000000000000000000000000000000000").toLowerCase();
    await this.db.insert(trades).values({
      chainId: this.cfg.chainId,
      txHash: log.transactionHash!,
      logIndex: log.logIndex!,
      tokenAddress: token.address,
      trader,
      isBuy: add,
      ethAmount: "0",
      quoteAmount: "0",
      tokenAmount: liq.toString(),
      priceEth: "0",
      phase: "pool",
      kind: add ? "add" : "remove",
      blockNumber: log.blockNumber!,
      blockTimestamp: ts,
    }).onConflictDoNothing();
  }

  /**
   * ERC20 Transfer:钱包互转记为 kind=out / in,并滚动持仓。
   * 曲线/池子/铸造相关 Transfer 已由 Buy/Sell/Swap/Graduated 记账,这里跳过以免双计。
   */
  async onTokenTransfer(log: Log & { args: LogArgs }) {
    const a = log.args as unknown as { from: Address; to: Address; value: bigint };
    const value = a.value ?? 0n;
    const from = (a.from ?? zeroAddress).toLowerCase();
    const to = (a.to ?? zeroAddress).toLowerCase();
    if (value === 0n || from === to) return;

    const tokenAddr = log.address.toLowerCase();
    const meta = await this.lookupTokenMeta(tokenAddr);
    if (!meta) return;

    const burnSet = new Set([zeroAddress.toLowerCase(), DEAD]);
    const protocol = new Set<string>([
      meta.curveAddress,
      this.cfg.poolManager.toLowerCase(),
      this.cfg.swapRouter.toLowerCase(),
      this.cfg.hook.toLowerCase(),
      this.cfg.factory.toLowerCase(),
    ]);
    if (this.pons) {
      protocol.add(this.pons.factory.toLowerCase());
      protocol.add(this.pons.hook.toLowerCase());
    }
    if (protocol.has(from) || protocol.has(to)) return;
    if (burnSet.has(from)) return;

    const txHash = log.transactionHash!;
    const [tradeHit] = await this.db
      .select({ kind: trades.kind })
      .from(trades)
      .where(
        and(
          eq(trades.chainId, this.cfg.chainId),
          eq(trades.txHash, txHash),
          eq(trades.tokenAddress, tokenAddr),
          inArray(trades.kind, ["buy", "sell", "add", "remove"]),
        ),
      )
      .limit(1);
    if (tradeHit) return;

    const ts = await this.blockTime(log.blockNumber!);
    const phase = meta.graduated ? "pool" : "curve";
    const logIndex = log.logIndex ?? 0;

    const writeLeg = async (trader: string, isIn: boolean, idx: number) => {
      const inserted = await this.db.insert(trades).values({
        chainId: this.cfg.chainId,
        txHash,
        logIndex: idx,
        tokenAddress: tokenAddr,
        trader,
        isBuy: isIn,
        ethAmount: "0",
        quoteAmount: "0",
        tokenAmount: value.toString(),
        priceEth: "0",
        phase,
        kind: isIn ? "in" : "out",
        blockNumber: log.blockNumber!,
        blockTimestamp: ts,
      }).onConflictDoNothing().returning();
      if (inserted.length === 0) return;
      await applyTransferToPosition(this.db, {
        chainId: this.cfg.chainId,
        wallet: trader,
        token: tokenAddr,
        isIn,
        tokenAmount: value,
        blockTimestamp: ts,
      });
      enqueueFirstFunder(this.db, this.client, this.cfg.chainId, trader);
    };

    await writeLeg(from, false, logIndex);
    if (!burnSet.has(to)) {
      await writeLeg(to, true, logIndex + TRANSFER_IN_LOG_OFFSET);
    }
  }

  /** Pons V2 TokenLaunched → tokens(platformId=pons) */
  async onPonsLaunched(log: Log & { args: LogArgs }): Promise<{ token: Address; curve: Address } | null> {
    if (!this.pons) return null;
    const a = log.args as unknown as {
      token: Address; curve: Address; deployer: Address; pairToken: Address; graduationThreshold: bigint;
    };
    const token = a.token.toLowerCase() as Address;
    const curve = a.curve.toLowerCase() as Address;
    const ts = await this.blockTime(log.blockNumber!);
    const pair = (a.pairToken ?? zeroAddress).toLowerCase() as Address;

    let name = "Token";
    let symbol = "TKN";
    let logoUri: string | null = null;
    let description: string | null = null;
    let twitter: string | null = null;
    let telegram: string | null = null;
    let website: string | null = null;
    let feeReceiver = a.deployer.toLowerCase();
    let taxBps = 0;
    let phantom = 0n;
    let quoteDecimals = 18;
    try {
      const [nm, sy, logo, desc, phantomQ, tax, launch] = await Promise.all([
        this.client.readContract({ address: token, abi: ponsAbis.ponsTokenAbi, functionName: "name" }).catch(() => "Token"),
        this.client.readContract({ address: token, abi: ponsAbis.ponsTokenAbi, functionName: "symbol" }).catch(() => "TKN"),
        this.client.readContract({ address: token, abi: ponsAbis.ponsTokenAbi, functionName: "logo" }).catch(() => ""),
        this.client.readContract({ address: token, abi: ponsAbis.ponsTokenAbi, functionName: "description" }).catch(() => ""),
        this.client.readContract({ address: curve, abi: ponsAbis.ponsCurveAbi, functionName: "phantomQuote" }).catch(() => 0n),
        this.client.readContract({ address: curve, abi: ponsAbis.ponsCurveAbi, functionName: "creatorTaxBps" }).catch(() => 0n),
        this.client.readContract({ address: this.pons.factory, abi: ponsAbis.ponsFactoryAbi, functionName: "getLaunchedToken", args: [token] }).catch(() => null),
      ]);
      name = String(nm || "Token");
      symbol = String(sy || "TKN");
      logoUri = logo ? String(logo) : null;
      description = desc ? String(desc) : null;
      phantom = typeof phantomQ === "bigint" ? phantomQ : 0n;
      taxBps = Number(tax ?? 0);
      if (launch && launch.exists) feeReceiver = (launch.creatorFeeRecipient || a.deployer).toLowerCase();
      if (pair !== zeroAddress) {
        const d = await this.client.readContract({ address: pair, abi: ponsAbis.ponsTokenAbi, functionName: "decimals" }).catch(() => 18);
        quoteDecimals = Number(d ?? 18);
      }
      const socials = await this.client.readContract({ address: token, abi: ponsAbis.ponsTokenAbi, functionName: "socials" }).catch(() => null);
      if (socials) {
        twitter = socials.twitter || null;
        telegram = socials.telegram || null;
        website = socials.website || null;
      }
    } catch (e) {
      console.error(`[pons] meta ${token}`, e);
    }

    await this.db.insert(tokens).values({
      chainId: this.cfg.chainId,
      address: token,
      platformId: "pons",
      curveAddress: curve,
      creator: a.deployer.toLowerCase(),
      feeReceiver,
      name,
      symbol,
      logoUri,
      description,
      twitter,
      telegram,
      website,
      quoteAsset: pair,
      quoteDecimals,
      buyTaxBps: taxBps,
      sellTaxBps: taxBps,
      antiSnipe: true,
      antiBundle: false,
      curveP0: phantom.toString(),
      curveSlope: "0",
      graduationThreshold: (a.graduationThreshold ?? 0n).toString(),
      createdAtBlock: log.blockNumber!,
      createdAt: ts,
      createdTx: log.transactionHash!,
    }).onConflictDoNothing();

    this.rememberCurveToken(curve, {
      address: token,
      graduationThreshold: (a.graduationThreshold ?? 0n).toString(),
      graduated: false,
    });
    this.tokenMeta.set(token, { curveAddress: curve, graduated: false });
    enqueueFirstFunder(this.db, this.client, this.cfg.chainId, a.deployer);
    return { token, curve };
  }

  async onPonsCurveTrade(log: Log & { args: LogArgs }, isBuy: boolean) {
    const a = log.args as unknown as {
      buyer?: Address; seller?: Address; recipient?: Address;
      quoteIn?: bigint; tokensOut?: bigint; tokensIn?: bigint; quoteOut?: bigint;
    };
    const curveAddr = log.address.toLowerCase();
    const token = await this.lookupByCurve(curveAddr);
    if (!token) return;
    const trader = (isBuy ? a.buyer! : a.seller!).toLowerCase();
    const quoteAmount = isBuy ? a.quoteIn! : a.quoteOut!;
    const tokenAmount = isBuy ? a.tokensOut! : a.tokensIn!;
    if (tokenAmount === 0n) return;
    const ts = await this.blockTime(log.blockNumber!);
    const [tokRow] = await this.db
      .select({ quoteAsset: tokens.quoteAsset })
      .from(tokens)
      .where(and(eq(tokens.chainId, this.cfg.chainId), eq(tokens.address, token.address)))
      .limit(1);
    const native = !tokRow?.quoteAsset || tokRow.quoteAsset === zeroAddress;
    const ethAmount = native ? quoteAmount : 0n;
    const priceStr = ethAmount > 0n ? formatPriceEth(ethAmount, tokenAmount) : "0";

    const inserted = await this.db.insert(trades).values({
      chainId: this.cfg.chainId,
      txHash: log.transactionHash!,
      logIndex: log.logIndex!,
      tokenAddress: token.address,
      trader,
      isBuy,
      ethAmount: ethAmount.toString(),
      quoteAmount: quoteAmount.toString(),
      tokenAmount: tokenAmount.toString(),
      priceEth: priceStr,
      phase: "curve",
      kind: isBuy ? "buy" : "sell",
      blockNumber: log.blockNumber!,
      blockTimestamp: ts,
    }).onConflictDoNothing().returning();
    if (inserted.length === 0) return;

    if (ethAmount > 0n) {
      await applyTradeToPosition(this.db, {
        chainId: this.cfg.chainId, wallet: trader, token: token.address,
        isBuy, tokenAmount, ethAmount, blockTimestamp: ts,
      });
    }
    enqueueFirstFunder(this.db, this.client, this.cfg.chainId, trader);
    if (ethAmount > 0n) {
      this.publish(`price:${this.cfg.chainId}:${token.address}`, {
        priceEth: priceStr, isBuy, ethAmount: ethAmount.toString(), tokenAmount: tokenAmount.toString(),
        ts: ts.toISOString(), phase: "curve",
      });
      const progress = token.graduated
        ? null
        : await this.curveProgress(token.address, token.graduationThreshold, isBuy ? quoteAmount : 0n);
      await this.upsertLatestPrice(token.address, priceStr, ts, progress);
    }
  }

  async onPonsPoolGraduated(log: Log & { args: LogArgs }): Promise<string | null> {
    if (!this.pons) return null;
    const a = log.args as unknown as { token: Address; tokenAmount?: bigint; pairTokenAmount?: bigint };
    const tokenAddr = a.token.toLowerCase();
    const ts = await this.blockTime(log.blockNumber!);
    const launch = await this.client.readContract({
      address: this.pons.factory,
      abi: ponsAbis.ponsFactoryAbi,
      functionName: "getLaunchedToken",
      args: [tokenAddr as Address],
    }).catch(() => null);
    const pair = (launch?.pairToken ?? zeroAddress).toLowerCase() as Address;
    const token = tokenAddr as Address;
    const c0 = token.toLowerCase() < pair ? token : pair;
    const c1 = token.toLowerCase() < pair ? pair : token;
    const poolId = poolIdOf({
      currency0: c0,
      currency1: c1,
      fee: Number(launch?.poolFee ?? 0),
      tickSpacing: Number(launch?.tickSpacing ?? 200),
      hooks: this.pons.hook,
    });
    await this.db.update(tokens).set({
      graduated: true,
      graduatedAt: ts,
      poolId,
      lpTokenWei: (a.tokenAmount ?? 0n).toString(),
      lpQuoteWei: (a.pairTokenAmount ?? 0n).toString(),
      lpLockedForever: true,
    }).where(and(eq(tokens.chainId, this.cfg.chainId), eq(tokens.address, tokenAddr)));
    const cached = this.tokenByCurve.get((launch?.curve ?? "").toLowerCase());
    if (cached) cached.graduated = true;
    const meta = this.tokenMeta.get(tokenAddr);
    if (meta) meta.graduated = true;
    await this.db.update(latestPrices).set({ graduationProgress: null, updatedAt: ts })
      .where(and(eq(latestPrices.chainId, this.cfg.chainId), eq(latestPrices.tokenAddress, tokenAddr)));
    this.unknownPools.delete(poolId);
    this.publish(`graduated:${this.cfg.chainId}`, { token: tokenAddr, poolId, platform: "pons" });
    return poolId;
  }
}
