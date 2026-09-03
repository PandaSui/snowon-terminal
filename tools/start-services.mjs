/**
 * 本地开发数据服务一键启动:真实 PostgreSQL 17(内嵌二进制,免安装)+ Windows 便携版 Redis。
 *
 *   pnpm services        # 或 node tools/start-services.mjs
 *
 * - Postgres: postgres://postgres:postgres@localhost:5432/terminal(auth=trust,密码不校验)
 *   数据落盘在 %LOCALAPPDATA%/snowon-terminal/pg。
 * - Redis:    redis://localhost:6379(tporadowski Windows 移植版,见 tools/bin/redis)。
 *
 * 重要背景(别再踩坑):
 * 工作区路径含中文("VS开发文件集合"),GBK 代码页下 PostgreSQL 二进制
 * 若位于中文路径,initdb 的 post-bootstrap 阶段必然 FATAL
 * "invalid byte sequence for encoding UTF8: 0xbf"。因此首次运行时
 * 会把 PG 二进制复制到纯 ASCII 的 %LOCALAPPDATA%/snowon-terminal/pgbin。
 *
 * 以后装了系统级 Postgres/Redis(或 Docker),停掉本脚本、把 .env 指向真实实例即可。
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localBase = path.join(process.env.LOCALAPPDATA ?? root, "snowon-terminal");
const pgBin = path.join(localBase, "pgbin");
const pgData = path.join(localBase, "pg");
const pgLog = path.join(localBase, "pg-server.log");
const redisDir = path.join(root, ".data", "redis");
fs.mkdirSync(redisDir, { recursive: true });

const PG_PORT = 5432;
const REDIS_PORT = 6379;

// ── 首次:把 PG 二进制复制到 ASCII 路径 ───────────────
function ensurePgBinaries() {
  if (fs.existsSync(path.join(pgBin, "bin", "postgres.exe"))) return;
  console.log("[pg] copying PG binaries to ASCII path (first run only) ...");
  // embedded-postgres 包自带的平台二进制(见 tools/node_modules/.pnpm)
  const pnpmDir = path.join(root, "tools", "node_modules", ".pnpm");
  const pkg = fs.readdirSync(pnpmDir).find((d) => d.startsWith("@embedded-postgres+windows-x64@"));
  if (!pkg) throw new Error("PG binaries not found in tools/node_modules — run: cd tools && pnpm i");
  const native = path.join(pnpmDir, pkg, "node_modules", "@embedded-postgres", "windows-x64", "native");
  fs.cpSync(native, pgBin, { recursive: true });
  console.log(`[pg] binaries ready at ${pgBin}`);
}

function run(exe, args, opts = {}) {
  const r = spawnSync(exe, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  return { code: r.status, out: r.stdout?.toString() ?? "", err: r.stderr?.toString() ?? "" };
}

// ── Postgres ──────────────────────────────────────────
ensurePgBinaries();
const initdb = path.join(pgBin, "bin", "initdb.exe");
const postgresExe = path.join(pgBin, "bin", "postgres.exe");

if (!fs.existsSync(path.join(pgData, "PG_VERSION"))) {
  console.log("[pg] first run, initdb ...");
  const r = run(initdb, [
    "-D", pgData, "--locale=C", "--encoding=UTF8", "-U", "postgres", "--auth=trust",
  ], { env: { ...process.env, LC_ALL: "C" } });
  if (r.code !== 0) {
    console.error("[pg] initdb failed:", r.err || r.out);
    process.exit(1);
  }
}

console.log("[pg] starting postgres ...");
const pg = spawn(postgresExe, ["-D", pgData, "-p", String(PG_PORT)], {
  stdio: ["ignore", fs.openSync(pgLog, "a"), fs.openSync(pgLog, "a")],
  env: { ...process.env, LC_ALL: "C" },
});
pg.on("exit", (code) => console.log(`[pg] postgres exited (${code}), log: ${pgLog}`));

// 等端口起来(zonky 精简二进制不含 psql/pg_isready,用 postgres.js 探测)
const { default: postgresClient } = await import("postgres");
async function pgReady() {
  const sql = postgresClient({ host: "127.0.0.1", port: PG_PORT, user: "postgres", database: "postgres", connect_timeout: 3 });
  try { await sql`SELECT 1`; await sql.end(); return true; } catch { return false; }
}
async function waitFor(fn, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
const pgUp = await waitFor(pgReady);
if (!pgUp) {
  console.error(`[pg] failed to start, see ${pgLog}`);
  process.exit(1);
}
{
  const sql = postgresClient({ host: "127.0.0.1", port: PG_PORT, user: "postgres", database: "postgres" });
  await sql`CREATE DATABASE terminal`.catch((e) => {
    if (!String(e).includes("already exists")) throw e;
  });
  await sql.end();
}
console.log(`[pg] ready → postgres://postgres:postgres@localhost:${PG_PORT}/terminal`);

// ── Redis ─────────────────────────────────────────────
const redisExe = path.join(root, "tools", "bin", "redis", "redis-server.exe");
const redis = spawn(redisExe, ["--port", String(REDIS_PORT), "--dir", redisDir, "--appendonly", "no"], {
  stdio: ["ignore", "pipe", "pipe"],
});
redis.stdout.on("data", (d) => process.stdout.write(`[redis] ${d}`));
redis.stderr.on("data", (d) => process.stdout.write(`[redis!] ${d}`));
console.log(`[redis] ready → redis://localhost:${REDIS_PORT}`);
console.log("services up. Ctrl+C to stop.");

// ── 退出清理 ──────────────────────────────────────────
async function shutdown() {
  console.log("\nstopping services ...");
  run(path.join(pgBin, "bin", "pg_ctl.exe"), ["-D", pgData, "stop", "-m", "fast"]);
  redis.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
