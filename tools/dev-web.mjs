/**
 * 前端开发服务器启动器(供根目录 `npm run dev` / 预览使用)。
 *
 * 不依赖 pnpm/npm 是否在 PATH:直接用当前 node 跑 apps/web 下的 Next.js,
 * 并把命令行参数原样转发给 `next dev`(预览系统会传 --port/--hostname)。
 *
 *   npm run dev                      # 默认 3000
 *   npm run dev -- --port 3100       # 指定端口
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(root, "apps", "web");
const nextBin = path.join(webDir, "node_modules", "next", "dist", "bin", "next");

const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  cwd: webDir,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
