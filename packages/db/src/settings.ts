import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { appSettings } from "./schema.js";
import * as schema from "./schema.js";

type Db = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

/** SnowOn(SNOW)ERC-20 代币地址(付费叮住用它转账) */
export const SNOW_TOKEN = "0xb851CeBcBcf1Dc5F07D9F0a8276caE8D953B3713";

export type AppSettings = {
  pinPriceSnow: string; // 整数 SNOW 字符串,如 "100"
  pinDurationSec: number;
  pinMax: number;
  pinPayee: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  pinPriceSnow: "100",
  pinDurationSec: 3600, // 60 分钟
  pinMax: 5,
  pinPayee: "0xEC11B5bd5f863b588a66A97C1Eda6c47010Ca751",
};

/** 读全局设置(无行则返回默认值)。 */
export async function getAppSettings(db: Db): Promise<AppSettings> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  const r = rows[0];
  if (!r) return DEFAULT_SETTINGS;
  return {
    pinPriceSnow: String(r.pinPriceSnow ?? DEFAULT_SETTINGS.pinPriceSnow),
    pinDurationSec: Number(r.pinDurationSec ?? DEFAULT_SETTINGS.pinDurationSec),
    pinMax: Number(r.pinMax ?? DEFAULT_SETTINGS.pinMax),
    pinPayee: String(r.pinPayee ?? DEFAULT_SETTINGS.pinPayee),
  };
}

/** 写全局设置(单行 upsert,仅管理面板调用)。 */
export async function updateAppSettings(db: Db, patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await getAppSettings(db)), ...patch };
  const row = { id: 1 as const, ...next, updatedAt: new Date() };
  await db
    .insert(appSettings)
    .values(row)
    .onConflictDoUpdate({ target: appSettings.id, set: { ...next, updatedAt: new Date() } });
  return next;
}
