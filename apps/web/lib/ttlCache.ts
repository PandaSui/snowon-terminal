/** 进程内 TTL 缓存,挡住发现页 5s 轮询打穿同一条重 SQL。 */

export function ttlCache<T>(ttlMs: number) {
  let hit: { at: number; value: T } | null = null;
  return {
    get(): T | undefined {
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
      return undefined;
    },
    set(value: T) {
      hit = { at: Date.now(), value };
    },
  };
}

export function ttlMap<K, V>(ttlMs: number, max = 256) {
  const m = new Map<K, { at: number; value: V }>();
  return {
    get(key: K): V | undefined {
      const h = m.get(key);
      if (!h) return undefined;
      if (Date.now() - h.at >= ttlMs) {
        m.delete(key);
        return undefined;
      }
      return h.value;
    },
    set(key: K, value: V) {
      if (m.size >= max) {
        const first = m.keys().next().value;
        if (first !== undefined) m.delete(first);
      }
      m.set(key, { at: Date.now(), value });
    },
  };
}
