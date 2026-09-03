/** K 线周期 + 时段成交量共用。value 对齐 UDF resolution。 */
export const CHART_RESOLUTIONS = [
  { label: "1m", value: "1", statsKey: "1m" },
  { label: "5m", value: "5", statsKey: "5m" },
  { label: "15m", value: "15", statsKey: "15m" },
  { label: "1h", value: "60", statsKey: "1h" },
  { label: "4h", value: "240", statsKey: "4h" },
  { label: "1D", value: "1D", statsKey: "1D" },
] as const;

export type ChartResolution = (typeof CHART_RESOLUTIONS)[number]["value"];

export const RES_SECONDS: Record<string, number> = {
  "1": 60,
  "5": 300,
  "15": 900,
  "60": 3600,
  "240": 14400,
  "1D": 86400,
};

/** 各周期历史回看秒数,避免 from=0 每次拉全量成交 */
export const RES_LOOKBACK: Record<string, number> = {
  "1": 3 * 86400,
  "5": 14 * 86400,
  "15": 30 * 86400,
  "60": 90 * 86400,
  "240": 180 * 86400,
  "1D": 730 * 86400,
};
