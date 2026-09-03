/** 把空 body / HTML 错误页转成可读异常,避免 JSON.parse 抛 Unexpected end of JSON input */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) throw new Error(res.ok ? "empty response" : `server error (${res.status})`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`invalid json (${res.status})`);
  }
}
