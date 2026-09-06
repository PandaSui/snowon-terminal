"use client";

/** 用户追踪钱包:localStorage,跟着浏览器走,上限 10000。 */

export const TRACK_LIMIT = 10_000;
export const TRACKED_LS_KEY = "trackedWallets";
export const TRACKED_CHANGED_EVENT = "tracked-wallets-changed";

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

export function loadTrackedWallets(): TrackedWallet[] {
  try {
    const list = JSON.parse(localStorage.getItem(TRACKED_LS_KEY) ?? "[]") as TrackedWallet[];
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

export function saveTrackedWallets(next: TrackedWallet[]) {
  const clipped = next.slice(0, TRACK_LIMIT);
  localStorage.setItem(TRACKED_LS_KEY, JSON.stringify(clipped));
  window.dispatchEvent(new Event(TRACKED_CHANGED_EVENT));
}

export function addTrackedWallets(
  entries: Array<{ address: string; note?: string; label?: string }>,
): { added: number; skipped: number; limitHit: boolean; list: TrackedWallet[] } {
  const list = loadTrackedWallets();
  const by = new Map(list.map((w) => [w.address, w] as const));
  let added = 0;
  let skipped = 0;
  let limitHit = false;
  let dirty = false;
  for (const e of entries) {
    const address = e.address.trim().toLowerCase();
    if (!ADDR_OK.test(address)) {
      skipped += 1;
      continue;
    }
    const exist = by.get(address);
    if (exist) {
      const note = e.note?.trim();
      if (note && !exist.note) {
        exist.note = note;
        dirty = true;
      }
      skipped += 1;
      continue;
    }
    if (by.size >= TRACK_LIMIT) {
      limitHit = true;
      skipped += 1;
      continue;
    }
    by.set(address, {
      address,
      label: (e.label && e.label.trim()) || shortAddr(address),
      note: e.note?.trim() ?? "",
      watching: true,
      addedAt: Date.now(),
    });
    added += 1;
    dirty = true;
  }
  const next = [...by.values()];
  if (dirty) saveTrackedWallets(next);
  return { added, skipped, limitHit, list: next };
}

export function removeTrackedWallet(address: string) {
  const addr = address.toLowerCase();
  saveTrackedWallets(loadTrackedWallets().filter((w) => w.address !== addr));
}

export function patchTrackedWallet(address: string, patch: Partial<TrackedWallet>) {
  const addr = address.toLowerCase();
  saveTrackedWallets(
    loadTrackedWallets().map((w) => (w.address === addr ? { ...w, ...patch, address: w.address } : w)),
  );
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
