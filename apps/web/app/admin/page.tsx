"use client";

import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { readJson } from "@/lib/http";
import { useIsMobile } from "@/lib/useIsMobile";

/** 与 /api/admin/chains GET 响应对应的行形状(BigInt 已 jsonSafe 成 string) */
interface AdminChain {
  chainId: number;
  platformId: string;
  name: string;
  rpcUrl: string;
  wsUrl: string | null;
  factory: string;
  hook: string;
  registry: string;
  swapRouter: string;
  poolManager: string;
  deployBlock: string;
  enabled: boolean;
  updatedAt: string;
  onchain: Record<string, unknown>;
}

interface ChainsResponse {
  chains: AdminChain[];
  adminWalletsConfigured: boolean;
  error?: string;
}

const CONTRACT_LABELS: Array<[keyof AdminChain & string, string]> = [
  ["factory", "发射工厂 Factory"],
  ["hook", "V4 Hook"],
  ["registry", "报价资产 Registry"],
  ["swapRouter", "Snow 路由"],
  ["poolManager", "V4 PoolManager"],
];

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12,
  background: "#0b0e11", border: "1px solid #2b3139", borderRadius: 6, color: "#eaecef",
  outline: "none", fontFamily: "monospace",
};

const btnGold: React.CSSProperties = {
  background: "#f0b90b", border: 0, borderRadius: 6, padding: "7px 14px",
  fontWeight: 700, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
};

const btnGhost: React.CSSProperties = {
  background: "transparent", border: "1px solid #2b3139", borderRadius: 6,
  padding: "6px 12px", fontSize: 12, color: "#848e9c", cursor: "pointer",
};

function shortAddr(a: string) {
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function CopyBtn({ value }: { value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }).catch(() => {})}
      style={{ ...btnGhost, padding: "2px 8px", fontSize: 11, color: ok ? "#0ecb81" : "#848e9c" }}
    >
      {ok ? "✓" : "复制"}
    </button>
  );
}

/** 单个参数格 */
function Param({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div style={{ padding: "8px 10px", border: "1px solid #161b22", borderRadius: 8, background: "#0b0e11" }}>
      <div style={{ fontSize: 10, color: "#5e6673" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, color: warn ? "#f0b90b" : "#eaecef" }}>{value}</div>
    </div>
  );
}

/** 链编辑/新建表单 */
function ChainForm({
  initial, submitting, error, onSubmit, onCancel,
}: {
  initial: Partial<Record<"chainId" | "name" | "rpcUrl" | "wsUrl" | "factory" | "hook" | "registry" | "swapRouter" | "poolManager" | "deployBlock", string | number | null>>;
  submitting: boolean;
  error: string | null;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(() => ({
    chainId: String(initial.chainId ?? ""),
    name: String(initial.name ?? ""),
    rpcUrl: String(initial.rpcUrl ?? ""),
    wsUrl: String(initial.wsUrl ?? ""),
    factory: String(initial.factory ?? ""),
    hook: String(initial.hook ?? ""),
    registry: String(initial.registry ?? ""),
    swapRouter: String(initial.swapRouter ?? ""),
    poolManager: String(initial.poolManager ?? ""),
    deployBlock: String(initial.deployBlock ?? "0"),
  }));
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fields: Array<[string, string, boolean]> = [
    ["chainId", "链 ID(chainId)", true],
    ["name", "链名称", true],
    ["rpcUrl", "RPC URL", true],
    ["wsUrl", "WS URL(可选)", false],
    ["factory", "发射工厂地址", true],
    ["hook", "V4 Hook 地址", true],
    ["registry", "Registry 地址", true],
    ["swapRouter", "SnowSwapRouter 地址", true],
    ["poolManager", "PoolManager 地址", true],
    ["deployBlock", "索引起始区块(工厂部署块)", false],
  ];
  const isEdit = !!initial.chainId;
  return (
    <div style={{ borderTop: "1px solid #1e2329", padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
      {fields.map(([key, label, required]) => (
        <label key={key} style={{ display: "block", fontSize: 11, color: "#848e9c" }}>
          {label}{required && <span style={{ color: "#f6465d" }}> *</span>}
          <input
            value={form[key]}
            onChange={set(key)}
            disabled={key === "chainId" && isEdit}
            style={{ ...inputStyle, marginTop: 4, opacity: key === "chainId" && isEdit ? 0.5 : 1 }}
            spellCheck={false}
          />
        </label>
      ))}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <button onClick={() => onSubmit(form)} disabled={submitting} style={{ ...btnGold, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? "保存中…" : isEdit ? "保存修改" : "创建链配置"}
        </button>
        <button onClick={onCancel} style={btnGhost}>取消</button>
      </div>
      {error && <div style={{ gridColumn: "1 / -1", color: "#f6465d", fontSize: 12 }}>❌ {error}</div>}
    </div>
  );
}

function ChainCard({ chain, isAdmin }: { chain: AdminChain; isAdmin: boolean }) {
  const qc = useQueryClient();
  const { user } = usePrivy();
  const wallet = user?.wallet?.address ?? "";
  const [editing, setEditing] = useState(false);
  const oc = chain.onchain;

  const save = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const res = await fetch("/api/admin/chains", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-admin-wallet": wallet },
        body: JSON.stringify({ ...values, chainId: chain.chainId }),
      });
      const body = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? `保存失败(${res.status})`);
    },
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["admin-chains"] });
    },
  });

  const split = oc.protocolSplit as { creatorBps: number; snowBuyBps: number; revenueBps: number } | null | undefined;

  return (
    <section style={{ border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117", overflow: "hidden" }}>
      {/* 卡头:链名 + chainId + 状态 */}
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid #1e2329", flexWrap: "wrap" }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: chain.enabled ? "#0ecb81" : "#f6465d" }} />
        <span style={{ fontSize: 15, fontWeight: 800 }}>{chain.name}</span>
        <span style={{ fontSize: 11, color: "#5e6673", background: "#1e2329", borderRadius: 8, padding: "1px 8px" }}>
          chainId {chain.chainId}
        </span>
        <span style={{ fontSize: 11, color: "#5e6673", background: "#1e2329", borderRadius: 8, padding: "1px 8px" }}>
          {chain.platformId}
        </span>
        {!chain.enabled && <span style={{ fontSize: 11, color: "#f6465d" }}>已停用</span>}
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {isAdmin && !editing && (
            <button onClick={() => setEditing(true)} style={btnGhost}>✏️ 编辑参数</button>
          )}
        </span>
      </header>

      {/* 链上实时参数 */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #1e2329" }}>
        <div style={{ fontSize: 11, color: "#5e6673", fontWeight: 700, marginBottom: 8 }}>链上实时参数(只读)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          <Param label="已发射代币" value={oc.tokenCount != null ? `${oc.tokenCount} 个` : "读取失败"} />
          <Param
            label="毕业阈值(ETH)"
            value={typeof oc.graduationThresholdEth === "number" ? `${oc.graduationThresholdEth} ETH` : "读取失败"}
          />
          <Param
            label="协议分成 创建者/回购/营收"
            value={split ? `${split.creatorBps / 100}% / ${split.snowBuyBps / 100}% / ${split.revenueBps / 100}%` : "读取失败"}
          />
          <Param
            label="路由费"
            value={typeof oc.swapRouterFeeBps === "number" ? `${oc.swapRouterFeeBps / 100}%` : "读取失败"}
          />
          <Param
            label="报价资产白名单"
            value={oc.allowedPairs != null ? `${oc.allowedPairs} 个` : "读取失败"}
          />
        </div>
      </div>

      {/* 合约地址 + 部署状态 */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #1e2329" }}>
        <div style={{ fontSize: 11, color: "#5e6673", fontWeight: 700, marginBottom: 8 }}>合约地址</div>
        {CONTRACT_LABELS.map(([key, label]) => {
          const addr = chain[key] as string;
          const deployed = oc[`deployed_${key}`];
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12 }}>
              <span
                style={{
                  width: 7, height: 7, borderRadius: 4, flexShrink: 0,
                  background: deployed === true ? "#0ecb81" : deployed === false ? "#f6465d" : "#5e6673",
                }}
                title={deployed === true ? "链上有代码" : deployed === false ? "链上无代码!" : "未探测"}
              />
              <span style={{ width: 150, color: "#848e9c", flexShrink: 0 }}>{label}</span>
              <span style={{ fontFamily: "monospace", color: "#eaecef" }} className="addr-full">{addr}</span>
              <span style={{ fontFamily: "monospace", color: "#eaecef", display: "none" }} className="addr-short">{shortAddr(addr)}</span>
              <CopyBtn value={addr} />
            </div>
          );
        })}
        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "#5e6673", flexWrap: "wrap" }}>
          <span>RPC: <span style={{ fontFamily: "monospace", color: "#848e9c" }}>{chain.rpcUrl}</span></span>
          {chain.wsUrl && <span>WS: <span style={{ fontFamily: "monospace", color: "#848e9c" }}>{chain.wsUrl}</span></span>}
          <span>索引起始块: <span style={{ fontFamily: "monospace", color: "#848e9c" }}>{chain.deployBlock}</span></span>
        </div>
      </div>

      {editing && (
        <ChainForm
          initial={chain}
          submitting={save.isPending}
          error={save.error ? (save.error as Error).message : null}
          onSubmit={(v) => save.mutate(v)}
          onCancel={() => setEditing(false)}
        />
      )}
    </section>
  );
}

export default function AdminPage() {
  const { login, logout, authenticated, user } = usePrivy();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const wallet = user?.wallet?.address?.toLowerCase() ?? "";

  const adminList = useMemo(
    () => (process.env.NEXT_PUBLIC_ADMIN_WALLETS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    [],
  );
  const isAdmin = !!wallet && adminList.includes(wallet);

  const { data, isLoading, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ["admin-chains"],
    queryFn: async () => {
      const res = await fetch("/api/admin/chains");
      const body = await readJson<ChainsResponse>(res);
      if (!res.ok) throw new Error(body.error ?? `加载失败(${res.status})`);
      return body;
    },
    refetchInterval: 15_000,
  });

  const create = useMutation({
    mutationFn: async (values: Record<string, string>) => {
      const res = await fetch("/api/admin/chains", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-wallet": wallet },
        body: JSON.stringify(values),
      });
      const body = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? `创建失败(${res.status})`);
    },
    onSuccess: () => {
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["admin-chains"] });
    },
  });

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "8px 8px" : "10px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* 顶栏:与全站一致 */}
      <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
          <h1 style={{ fontSize: isMobile ? 15 : 18, margin: 0, fontWeight: 800, whiteSpace: "nowrap" }}>
            SnowOn <span style={{ color: "#f0b90b" }}>Terminal</span>
          </h1>
        </Link>
        <nav style={{ display: "flex", gap: 14, fontSize: 13, color: "#848e9c" }}>
          <Link href="/" style={{ color: "#848e9c", textDecoration: "none" }}>主页</Link>
          <Link href="/" style={{ color: "#848e9c", textDecoration: "none" }}>发现</Link>
          <a
            href="https://www.snowon.fun/create"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#f0b90b", textDecoration: "none", fontWeight: 600 }}
          >
            Launch Token
          </a>
          <span style={{ color: "#f0b90b", fontWeight: 700 }}>管理</span>
        </nav>
        <div style={{ flex: 1 }} />
        <button onClick={authenticated ? logout : login} style={btnGold}>
          {authenticated ? `${user?.wallet?.address?.slice(0, 6) ?? user?.email ?? ""}…` : "钱包链接"}
        </button>
      </header>

      {/* 标题 + 状态说明 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>⚙️ 发射工厂参数配置</h2>
        <span style={{ fontSize: 11, color: "#5e6673" }}>
          每条链的工厂/合约群参数 · DB 为权威来源 · 15s 自动刷新({new Date(dataUpdatedAt).toLocaleTimeString()})
        </span>
      </div>

      {!isAdmin && (
        <div style={{ padding: "8px 12px", border: "1px solid #f0b90b44", borderRadius: 8, background: "rgba(240,185,11,0.06)", fontSize: 12, color: "#f0b90b" }}>
          {authenticated
            ? "当前钱包不在管理员名单(NEXT_PUBLIC_ADMIN_WALLETS),查看模式。"
            : "连接管理员钱包后可编辑参数;当前为查看模式。"}
        </div>
      )}
      <div style={{ fontSize: 11, color: "#5e6673" }}>
        ⚠ 链上参数(协议分成/毕业阈值等)为合约实时只读;此处编辑的是终端侧链配置(RPC/合约地址/索引起块)。indexer 仍读 env 启动,改配置后需重启 indexer 生效。
      </div>

      {isLoading && <div style={{ color: "#848e9c", padding: 20 }}>加载中…</div>}
      {isError && <div style={{ color: "#f6465d", padding: 20 }}>加载失败:{(error as Error).message}</div>}

      {data?.chains.map((c) => <ChainCard key={c.chainId} chain={c} isAdmin={isAdmin} />)}
      {data && data.chains.length === 0 && (
        <div style={{ color: "#848e9c", padding: 20, textAlign: "center" }}>还没有链配置,点下方新增第一条。</div>
      )}

      {/* 新增链 */}
      {isAdmin && !creating && (
        <button onClick={() => setCreating(true)} style={{ ...btnGhost, padding: "12px", fontSize: 13, borderStyle: "dashed" }}>
          + 新增链配置
        </button>
      )}
      {isAdmin && creating && (
        <section style={{ border: "1px solid #1e2329", borderRadius: 10, background: "#0d1117" }}>
          <header style={{ padding: "12px 14px", borderBottom: "1px solid #1e2329", fontWeight: 700, fontSize: 14 }}>新增链配置</header>
          <ChainForm
            initial={{}}
            submitting={create.isPending}
            error={create.error ? (create.error as Error).message : null}
            onSubmit={(v) => create.mutate(v)}
            onCancel={() => setCreating(false)}
          />
        </section>
      )}
    </main>
  );
}
