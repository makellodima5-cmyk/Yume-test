/** Convert Retry-After delta-seconds or HTTP-date to a bounded positive delay. */
export function retryAfterMilliseconds(header: string | null, nowMs = Date.now()): number | null {
  if (!header?.trim()) return null;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1000, Math.ceil(seconds * 1000));
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(1000, date - nowMs) : null;
}
