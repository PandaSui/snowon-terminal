"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/apiBase";
import { readJson } from "@/lib/http";

/** 每个已连接钱包自己的追踪名单,落库,上限 10000。未连接不能添加/导出。 */

export const TRACK_LIMIT = 10_000;
export const TRACKED_CHANGED_EVENT = "tracked-wallets-changed";
const LS_LEGACY = "trackedWallets";

export interface TrackedWallet {
  address: string;
  label: string;
  note?: string;
  watching?: boolean;
  addedAt?: number;
}

export const IMPORT_SAMPLE = `# 每行一个钱包。以 # 开头的行是注释，导入时会跳过。
# 格式（任选一种）：
#   地址
#   地址,备注
#   地址 备注
# 上限 10000 个
0x1111111111111111111111111111111111111111,聪明钱
0x2222222222222222222222222222222222222222,项目方
`;

const ADDR_RE = /0x[a-fA-F0-9]{40}/;
const ADDR_OK = /^0x[0-9a-f]{40}$/;

export function shortAddr(a: string) {
  const s = a.toLowerCase();
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

export type AddResult = { added: number; skipped: number; limitHit: boolean; error?: string };

export type TrackedStore = {
  owner: string | null;
  list: TrackedWallet[];
  loading: boolean;
  login: () => void;
  add: (entries: Array<{ address: string; note?: string; label?: string }>) => Promise<AddResult>;
  patch: (address: string, patch: Partial<TrackedWallet>) => Promise<void>;
  remove: (address: string) => Promise<void>;
  setNote: (address: string, note: string) => Promise<void>;
  setWatching: (address: string, watching: boolean) => Promise<boolean>;
};

const emptyResult: AddResult = { added: 0, skipped: 0, limitHit: false, error: "connect wallet" };

const Ctx = createContext<TrackedStore | null>(null);

function loadLegacyLocal(): TrackedWallet[] {
  try {
    const list = JSON.parse(localStorage.getItem(LS_LEGACY) ?? "[]") as TrackedWallet[];
    if (!Array.isArray(list)) return [];
    const out: TrackedWallet[] = [];
    const seen = new Set<string>();
    for (const w of list) {
      const address = String(w?.address ?? "").toLowerCase();
      if (!ADDR_OK.test(address) || seen.has(address)) continue;
      seen.add(address);
      out.push({
        address,
        label: (w.label && String(w.label).trim()) || shortAddr(address),
        note: w.note ? String(w.note) : "",
        watching: w.watching ?? true,
        addedAt: typeof w.addedAt === "number" ? w.addedAt : undefined,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function TrackedWalletsProvider({ children }: { children: ReactNode }) {
  const { authenticated, user, login } = usePrivy();
  const owner = authenticated ? (user?.wallet?.address?.toLowerCase() ?? null) : null;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["tracked-wallets", owner],
    enabled: !!owner,
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/track/wallets?owner=${owner}`));
      const body = await readJson<{ wallets?: TrackedWallet[] }>(res);
      return Array.isArray(body.wallets) ? body.wallets : [];
    },
  });

  const refresh = useCallback(
    (wallets?: TrackedWallet[]) => {
      if (wallets) qc.setQueryData(["tracked-wallets", owner], wallets);
      else void qc.invalidateQueries({ queryKey: ["tracked-wallets", owner] });
      window.dispatchEvent(new Event(TRACKED_CHANGED_EVENT));
    },
    [qc, owner],
  );

  useEffect(() => {
    if (!owner) return;
    const flag = `trackedWallets.migrated.${owner}`;
    try {
      if (localStorage.getItem(flag)) return;
    } catch { return; }
    const local = loadLegacyLocal();
    if (local.length === 0) {
      try { localStorage.setItem(flag, "1"); } catch { /* ignore */ }
      return;
    }
    void (async () => {
      try {
        const res = await fetch(apiUrl("/api/track/wallets"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            owner,
            items: local.map((w) => ({ address: w.address, note: w.note, label: w.label, watching: w.watching })),
          }),
        });
        const body = await readJson<{ wallets?: TrackedWallet[] }>(res);
        if (Array.isArray(body.wallets)) refresh(body.wallets);
        localStorage.setItem(flag, "1");
      } catch { /* ignore */ }
    })();
  }, [owner, refresh]);

  const add = useCallback(async (entries: Array<{ address: string; note?: string; label?: string }>): Promise<AddResult> => {
    if (!owner) return emptyResult;
    const res = await fetch(apiUrl("/api/track/wallets"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, items: entries }),
    });
    const body = await readJson<AddResult & { wallets?: TrackedWallet[]; error?: string }>(res);
    if (Array.isArray(body.wallets)) refresh(body.wallets);
    return { added: body.added ?? 0, skipped: body.skipped ?? 0, limitHit: !!body.limitHit, error: body.error };
  }, [owner, refresh]);

  useEffect(() => {
    const onTrack = (e: Event) => {
      const addr = String((e as CustomEvent<string>).detail ?? "").toLowerCase();
      if (!ADDR_OK.test(addr)) return;
      if (!owner) {
        login();
        return;
      }
      void add([{ address: addr }]);
    };
    window.addEventListener("open-wallet-tracker", onTrack);
    return () => window.removeEventListener("open-wallet-tracker", onTrack);
  }, [owner, login, add]);

  const patch = useCallback(async (address: string, p: Partial<TrackedWallet>) => {
    if (!owner) return;
    const res = await fetch(apiUrl("/api/track/wallets"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, address, ...p }),
    });
    const body = await readJson<{ wallets?: TrackedWallet[] }>(res);
    if (Array.isArray(body.wallets)) refresh(body.wallets);
  }, [owner, refresh]);

  const remove = useCallback(async (address: string) => {
    if (!owner) return;
    const res = await fetch(apiUrl("/api/track/wallets"), {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, address }),
    });
    const body = await readJson<{ wallets?: TrackedWallet[] }>(res);
    if (Array.isArray(body.wallets)) refresh(body.wallets);
  }, [owner, refresh]);

  const setNote = useCallback(async (address: string, note: string) => {
    await patch(address, { note });
  }, [patch]);

  const setWatching = useCallback(async (address: string, watching: boolean) => {
    if (!owner) return false;
    await patch(address, { watching });
    return true;
  }, [owner, patch]);

  const value = useMemo<TrackedStore>(() => ({
    owner,
    list: owner ? (q.data ?? []) : [],
    loading: !!owner && q.isLoading,
    login,
    add,
    patch,
    remove,
    setNote,
    setWatching,
  }), [owner, q.data, q.isLoading, login, add, patch, remove, setNote, setWatching]);

  return createElement(Ctx.Provider, { value }, children);
}

export function useTrackedWallets(): TrackedStore {
  const s = useContext(Ctx);
  if (!s) {
    return {
      owner: null,
      list: [],
      loading: false,
      login: () => {},
      add: async () => emptyResult,
      patch: async () => {},
      remove: async () => {},
      setNote: async () => {},
      setWatching: async () => false,
    };
  }
  return s;
}

export function parseTrackedImport(text: string): {
  entries: Array<{ address: string; note: string }>;
  invalid: number;
} {
  const entries: Array<{ address: string; note: string }> = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    if (/^(address|钱包地址|addr)\s*[,，\t ]/i.test(line) && !ADDR_RE.test(line)) continue;
    const m = line.match(ADDR_RE);
    if (!m) {
      invalid += 1;
      continue;
    }
    const address = m[0].toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);
    const note = line.replace(m[0], "").replace(/^[\s,;|，]+|[\s,;|，]+$/g, "");
    entries.push({ address, note });
  }
  return { entries, invalid };
}

export function formatTrackedExport(list: TrackedWallet[]): string {
  const lines = ["address,note"];
  for (const w of list) {
    const note = (w.note ?? "").replace(/"/g, '""');
    const cell = /[",\n]/.test(note) ? `"${note}"` : note;
    lines.push(`${w.address},${cell}`);
  }
  return `\uFEFF${lines.join("\n")}\n`;
}
