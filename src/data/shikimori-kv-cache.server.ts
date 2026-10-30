import { env as cloudflareEnv } from "cloudflare:workers";

type ShikimoriKVNamespace = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
};

type CacheEnvelope<T> = {
  expiresAt: number;
  value: T;
};

const CACHE_PREFIX = "yume:shikimori:v1:";

function getCacheNamespace(): ShikimoriKVNamespace | null {
  try {
    const bindings = cloudflareEnv as unknown as Record<string, unknown>;
    const binding = bindings.YUME_SHIKIMORI_CACHE;
    if (
      binding &&
      typeof binding === "object" &&
      "get" in binding &&
      typeof binding.get === "function" &&
      "put" in binding &&
      typeof binding.put === "function"
    ) {
      return binding as ShikimoriKVNamespace;
    }
  } catch {
    // Local tests and non-Workers previews do not provide Cloudflare bindings.
  }
  return null;
}

/**
 * Reads only public Shikimori data. KV is an optional shared cache, never a
 * source of truth; callers retain their isolate-local cache as an L1 fallback.
 */
export async function readShikimoriSharedCache<T>(key: string): Promise<T | null> {
  const namespace = getCacheNamespace();
  if (!namespace) return null;

  try {
    const value = await namespace.get(CACHE_PREFIX + key, "json");
    if (!value || typeof value !== "object") return null;

    const envelope = value as Partial<CacheEnvelope<T>>;
    if (
      typeof envelope.expiresAt !== "number" ||
      envelope.expiresAt <= Date.now() ||
      !("value" in envelope)
    ) {
      return null;
    }
    return envelope.value ?? null;
  } catch (error) {
    console.warn(
      "[YUME] Could not read Shikimori cache from Workers KV:",
      error instanceof Error ? error.message : "Unknown KV error",
    );
    return null;
  }
}

export async function writeShikimoriSharedCache<T>(
  key: string,
  value: T,
  ttlMs: number,
): Promise<void> {
  const namespace = getCacheNamespace();
  if (!namespace || !Number.isFinite(ttlMs) || ttlMs <= 0) return;

  try {
    const expiresAt = Date.now() + ttlMs;
    const expirationTtl = Math.max(60, Math.ceil(ttlMs / 1000));
    await namespace.put(
      CACHE_PREFIX + key,
      JSON.stringify({ expiresAt, value } satisfies CacheEnvelope<T>),
      { expirationTtl },
    );
  } catch (error) {
    // A cache write failure must never make Shikimori data unavailable.
    console.warn(
      "[YUME] Could not write Shikimori cache to Workers KV:",
      error instanceof Error ? error.message : "Unknown KV error",
    );
  }
}
