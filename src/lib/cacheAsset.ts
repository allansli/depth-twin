const CACHE_NAME = 'depth-twin-v1';

/** Fetch a model once and keep it in the Cache API. Camera frames are never stored. */
export async function cachedBytes(url: string): Promise<Uint8Array> {
  const cache = 'caches' in globalThis ? await caches.open(CACHE_NAME).catch(() => null) : null;
  if (cache) {
    const hit = await cache.match(url).catch(() => undefined);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  if (cache) await cache.put(url, res.clone()).catch(() => undefined);
  return new Uint8Array(await res.arrayBuffer());
}
