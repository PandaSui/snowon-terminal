"use client";

import { useEffect, useRef, useState } from "react";
import type { HomeToken } from "./TokenCard";

export type SecurityFilter = "all" | "safe" | "risky";
export type DevDumpFilter = "all" | "held" | "dumped";

export interface ColumnFilter {
  mcapMin: string;
  mcapMax: string;
  security: SecurityFilter;
  dedupe: boolean;
  devDump: DevDumpFilter;
  ageMin: string;
  ageMax: string;
}

export const EMPTY_FILTER: ColumnFilter = {
  mcapMin: "",
  mcapMax: "",
  security: "all",
  dedupe: false,
  devDump: "all",
  ageMin: "",
  ageMax: "",
};

export function filterActiveCount(f: ColumnFilter): number {
  let n = 0;
  if (f.mcapMin.trim() || f.mcapMax.trim()) n++;
  if (f.security !== "all") n++;
  if (f.dedupe) n++;
  if (f.devDump !== "all") n++;
  if (f.ageMin.trim() || f.ageMax.trim()) n++;
  return n;
}

function num(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function applyFilters(tokens: HomeToken[], f: ColumnFilter, ethUsd?: number): HomeToken[] {
  let list = tokens;
  const minUsd = Number(f.mcapMin);
  const maxUsd = Number(f.mcapMax);
  if (ethUsd && ethUsd > 0) {
    if (Number.isFinite(minUsd) && f.mcapMin.trim() !== "") {
      list = list.filter((t) => num(t.mcapEth) * ethUsd >= minUsd);
    }
    if (Number.isFinite(maxUsd) && f.mcapMax.trim() !== "") {
      list = list.filter((t) => num(t.mcapEth) * ethUsd <= maxUsd);
    }
  }
  if (f.security === "safe") {
    list = list.filter((t) => num(t.bundleShare) < 0.3 && num(t.phishShare) < 0.05 && (t.bundleScore == null || t.bundleScore < 60));
  } else if (f.security === "risky") {
    list = list.filter((t) => num(t.bundleShare) >= 0.3 || num(t.phishShare) >= 0.05 || (t.bundleScore != null && t.bundleScore >= 60));
  }
  if (f.devDump === "dumped") list = list.filter((t) => t.devDumped);
  if (f.devDump === "held") list = list.filter((t) => !t.devDumped);

  const now = Date.now();
  const ageMin = Number(f.ageMin);
  const ageMax = Number(f.ageMax);
  if (Number.isFinite(ageMin) && f.ageMin.trim() !== "") {
    list = list.filter((t) => (now - new Date(t.createdAt).getTime()) / 60_000 >= ageMin);
  }
  if (Number.isFinite(ageMax) && f.ageMax.trim() !== "") {
    list = list.filter((t) => (now - new Date(t.createdAt).getTime()) / 60_000 <= ageMax);
  }
  if (f.dedupe) {
    const seen = new Set<string>();
    list = list.filter((t) => {
      const key = (t.creator ?? t.address).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return list;
}

const input: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "5px 8px", fontSize: 11,
  background: "#0b0e11", border: "1px solid #2b3139", borderRadius: 6,
  color: "#eaecef", outline: "none",
};

const chip = (on: boolean): React.CSSProperties => ({
  padding: "3px 8px", fontSize: 11, fontWeight: 700, cursor: "pointer",
  borderRadius: 6, border: `1px solid ${on ? "#f0b90b" : "#2b3139"}`,
  background: on ? "#1c1f26" : "transparent", color: on ? "#f0b90b" : "#848e9c",
});

/** 栏目筛选弹层:市值区间 / 安全性 / 去重 / Dev 清仓 / 发布时长(分钟) */
export function ColumnFilterButton({
  value,
  onChange,
}: {
  value: ColumnFilter;
  onChange: (next: ColumnFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const n = filterActiveCount(value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function patch(p: Partial<ColumnFilter>) {
    onChange({ ...value, ...p });
  }

  return (
    <div ref={ref} style={{ position: "relative", marginLeft: 4 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="栏目筛选"
        style={{
          ...chip(open || n > 0), padding: "1px 7px", fontSize: 10,
        }}
      >
        筛选{n > 0 ? ` ${n}` : ""}
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30,
            width: 220, padding: 10, background: "#0d1117",
            border: "1px solid #2b3139", borderRadius: 10,
            boxShadow: "0 12px 32px rgba(0,0,0,0.55)", fontSize: 11, color: "#848e9c",
          }}
        >
          <div style={{ marginBottom: 6, color: "#eaecef", fontWeight: 700 }}>市值 (USD)</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input value={value.mcapMin} onChange={(e) => patch({ mcapMin: e.target.value })} placeholder="最低" style={input} />
            <input value={value.mcapMax} onChange={(e) => patch({ mcapMax: e.target.value })} placeholder="最高" style={input} />
          </div>

          <div style={{ marginBottom: 6, color: "#eaecef", fontWeight: 700 }}>安全性</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {(["all", "safe", "risky"] as const).map((k) => (
              <button key={k} type="button" onClick={() => patch({ security: k })} style={chip(value.security === k)}>
                {k === "all" ? "全部" : k === "safe" ? "安全" : "高风险"}
              </button>
            ))}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, cursor: "pointer", color: "#eaecef" }}>
            <input
              type="checkbox"
              checked={value.dedupe}
              onChange={(e) => patch({ dedupe: e.target.checked })}
            />
            去重(同创建者只留一条)
          </label>

          <div style={{ marginBottom: 6, color: "#eaecef", fontWeight: 700 }}>Dev 清仓</div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {(["all", "held", "dumped"] as const).map((k) => (
              <button key={k} type="button" onClick={() => patch({ devDump: k })} style={chip(value.devDump === k)}>
                {k === "all" ? "全部" : k === "held" ? "未清仓" : "已清仓"}
              </button>
            ))}
          </div>

          <div style={{ marginBottom: 6, color: "#eaecef", fontWeight: 700 }}>发布时间 (分钟)</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input value={value.ageMin} onChange={(e) => patch({ ageMin: e.target.value })} placeholder="最短" style={input} />
            <input value={value.ageMax} onChange={(e) => patch({ ageMax: e.target.value })} placeholder="最长" style={input} />
          </div>

          {n > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTER)}
              style={{ ...chip(false), width: "100%" }}
            >
              清除筛选
            </button>
          )}
        </div>
      )}
    </div>
  );
}
