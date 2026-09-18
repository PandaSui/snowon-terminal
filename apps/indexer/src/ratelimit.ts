import { http } from "viem";
import type { HttpTransport, HttpTransportConfig } from "viem";

/**
 * 全局 RPC 限流器 + viem transport 包装。
 *
 * 背景:免费官方 RPC(rpc.mainnet.chain.robinhood.com)对 getLogs 不限块范围也
 * 不限并发,但无 SLA、会间歇性抖动/限流;回填积压时请求密集。原来的做法是
 * 每个请求各自指数退避 + 命中 "exceeds limit" 递归对半拆分,并发无上限——一旦
 * 限流就"惊群":几十个在途请求同时退避又同时重试,把节点越打越死(线上 indexer
 * 因此重启了上千次)。
 *
 * 这里把限流收敛到 transport 一层,所有 RPC 请求(getLogs / getBlockNumber /
 * getBlock / eth_call ...)都经过它:
 *   1) 并发闸:同时在途请求数 ≤ maxConcurrent;
 *   2) 429 全局暂停:任一请求命中 429,整个队列暂停一段时间(指数退避、多个并发
 *      429 取 max 不累加),暂停期间不再有请求打到节点——从根上消除惊群;成功一次
 *      即把退避强度清零;
 *   3) 内部有限重试:429 在限流器内部等退避后自动重试,连没有重试包装的裸调用
 *      (prefetch getBlock、handlers 里的 eth_call)也一并受保护。
 *
 * 上层 index.ts 的 getLogsWithRetry 保留:它负责 "exceeds limit" 的区间对半拆分
 * (与 429 是不同错误),两者职责不重叠。
 */

export interface RpcLimiterOptions {
  /** 同时在途的 RPC 请求上限 */
  maxConcurrent: number;
  /** 首次 429 后的暂停时长(ms),之后指数增长 */
  baseBackoffMs: number;
  /** 单次暂停时长上限(ms) */
  maxBackoffMs: number;
  /** 限流器内部对 429 的最大重试次数,超过则把错误抛给上层 */
  maxRetries: number;
}

function is429(err: unknown): boolean {
  const code =
    (err as { code?: number })?.code ??
    (err as { status?: number })?.status ??
    (err as { cause?: { status?: number } })?.cause?.status;
  if (code === 429) return true;
  const text = `${(err as { details?: string })?.details ?? ""} ${
    (err as { shortMessage?: string })?.shortMessage ?? ""
  } ${(err as Error)?.message ?? ""}`;
  return /\b429\b|too many requests|rate ?limit/i.test(text);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RpcLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private pausedUntil = 0;
  private penalty = 0;

  constructor(private readonly opts: RpcLimiterOptions) {}

  /** 当前在途请求数(供日志/观测) */
  get inFlight(): number {
    return this.active;
  }
  /** 当前排队等待并发槽的请求数 */
  get queued(): number {
    return this.waiters.length;
  }
  /** 全局暂停还剩多少 ms(0 表示未暂停) */
  get pausedForMs(): number {
    return Math.max(0, this.pausedUntil - Date.now());
  }

  /** 把一个真正发 RPC 的函数排进限流器执行 */
  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      for (let attempt = 0; ; attempt++) {
        await this.waitForResume();
        try {
          const out = await fn();
          this.penalty = 0; // 成功一次即解除退避强度
          return out;
        } catch (err) {
          if (is429(err)) {
            this.applyBackoff(); // 任何 429 都置全局暂停,保护节点(与是否重试无关)
            if (attempt < this.opts.maxRetries) continue; // 还有重试额度 → 等暂停解除后重试
          }
          throw err; // 非 429、或重试用尽:抛给上层(上层重试时会被全局暂停挡住)
        }
      }
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.active < this.opts.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  private releaseSlot(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  private async waitForResume(): Promise<void> {
    let wait = this.pausedUntil - Date.now();
    while (wait > 0) {
      await sleep(wait);
      wait = this.pausedUntil - Date.now();
    }
  }

  private applyBackoff(): void {
    this.penalty = Math.min(this.penalty + 1, 8);
    const backoff = Math.min(
      this.opts.baseBackoffMs * 2 ** (this.penalty - 1),
      this.opts.maxBackoffMs,
    );
    // 多个并发 429 取 max、不累加,避免暂停被叠加成很长
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + backoff);
    console.log(
      `  [ratelimit] 429 → 全局暂停 ${(backoff / 1000).toFixed(1)}s (penalty=${this.penalty})`,
    );
  }
}

/** 进程级共享限流器:所有链、所有请求共用一个,严格约束打到节点的总并发。 */
export const sharedLimiter = new RpcLimiter({
  maxConcurrent: Math.max(1, Number(process.env.RPC_MAX_CONCURRENT ?? 4)),
  baseBackoffMs: Number(process.env.RPC_BACKOFF_MS ?? 1500),
  maxBackoffMs: Number(process.env.RPC_MAX_BACKOFF_MS ?? 30_000),
  maxRetries: Number(process.env.RPC_MAX_RETRIES ?? 8),
});

/**
 * http() 的限流版:每个 RPC request 都经过 limiter。用法与 viem http() 一致,
 * 额外传入一个 RpcLimiter。
 */
export function throttledHttp(
  url: string,
  limiter: RpcLimiter = sharedLimiter,
  config?: HttpTransportConfig,
): HttpTransport {
  const inner = http(url, config);
  return ((params) => {
    const transport = inner(params);
    const originalRequest = transport.request;
    return {
      ...transport,
      request: ((args: unknown, reqOpts: unknown) =>
        limiter.schedule(() =>
          (originalRequest as (a: unknown, o: unknown) => Promise<unknown>)(args, reqOpts),
        )) as typeof transport.request,
    };
  }) as HttpTransport;
}
