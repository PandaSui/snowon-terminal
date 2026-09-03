"use client";

import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";

export interface AdminInfo {
  address: string;
  source: "env" | "db";
  addedBy?: string | null;
  createdAt?: string | null;
}

interface AdminsResponse {
  admins: AdminInfo[];
  error?: string;
}

/** 管理员合并名单(env 主管理员 ∪ DB 协管员);接口公开只读,增删仍需服务端鉴权 */
export function useAdmins(wallet?: string) {
  const query = useQuery({
    queryKey: ["admin-wallets"],
    queryFn: async () => {
      const res = await fetch("/api/admin/admins");
      const body = await readJson<AdminsResponse>(res);
      if (!res.ok) throw new Error(body.error ?? `加载失败(${res.status})`);
      return body.admins;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const w = (wallet ?? "").toLowerCase();
  const isAdmin = !!w && (query.data ?? []).some((a) => a.address === w);
  return { ...query, admins: query.data ?? [], isAdmin };
}
