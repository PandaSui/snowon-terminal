import path from "node:path";
import { config as loadEnv } from "dotenv";

// monorepo 单一配置源:先读本应用的 .env.local(覆盖层),
// 再用根 .env 兜底(dotenv 不覆盖已存在的值,先读优先)
loadEnv({ path: path.resolve(process.cwd(), ".env.local") });
loadEnv({ path: path.resolve(process.cwd(), "../../.env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@terminal/db", "@terminal/adapters"],
  webpack: (config) => {
    // workspace 包是 TS 源码,内部用 ESM 风格的 "./xxx.js" 引用 "./xxx.ts"
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;
