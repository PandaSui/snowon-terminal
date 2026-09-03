import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    // generate 不连接数据库;migrate 才需要真实 URL
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/terminal",
  },
});
