export type RateLimitDecision = "allowed" | "limited" | "unavailable";

type RateLimiter = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

/**
 * Apply a Cloudflare Workers Rate Limiting binding to an anonymous endpoint.
 *
 * The client's IP is supplied by Cloudflare (CF-Connecting-IP), not by a
 * caller-controlled X-Forwarded-For header. If the binding or trusted IP is
 * missing, fail closed so a deployment/configuration mistake cannot silently
 * remove the protection from an upstream-costing endpoint.
 *
 * Cloudflare's rate-limit counters are approximate and local to each
 * Cloudflare location; this is an abuse-control layer, not exact accounting.
 */
export async function enforceRateLimit(
  binding: unknown,
  request: Pick<Request, "headers">,
  scope: string,
): Promise<RateLimitDecision> {
  if (
    !binding ||
    typeof binding !== "object" ||
    !("limit" in binding) ||
    typeof (binding as Partial<RateLimiter>).limit !== "function"
  ) {
    return "unavailable";
  }

  const ipAddress = request.headers.get("cf-connecting-ip")?.trim();
  if (!ipAddress) return "unavailable";

  try {
    const result = await (binding as RateLimiter).limit({
      key: `${scope}:${ipAddress}`,
    });
    return result?.success === true ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
}
