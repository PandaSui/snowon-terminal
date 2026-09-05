/**
 * 前后端分离:前端(Vercel)与后端(EC2, api.snowon.fun)可分开部署。
 *
 *  - Vercel 构建:NEXT_PUBLIC_API_BASE=https://api.snowon.fun → 浏览器直连后端
 *  - EC2 / 本地构建:NEXT_PUBLIC_API_BASE 留空 → 同源相对路径,自己的 /api 直接用
 *
 * 所有对内部 `/api/*` 的 fetch 都经 apiUrl() 包一层。外部第三方 API 不走这里。
 */
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");

/** 给内部 API 路径加上后端 base(base 为空则返回相对路径)。 */
export function apiUrl(path: string): string {
  return API_BASE + path;
}
