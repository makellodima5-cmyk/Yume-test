import { enforceRateLimit } from "./rate-limit";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS_PER_BATCH = 20;
const MAX_FIELD_LENGTH = 80;

type RecordValue = Record<string, unknown>;
type ViolationSummary = {
  disposition?: string;
  effectiveDirective?: string;
  violatedDirective?: string;
  blockedOrigin?: string;
  sourceOrigin?: string;
  documentOrigin?: string;
  statusCode?: number;
};

function asRecord(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function firstString(
  record: RecordValue,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, MAX_FIELD_LENGTH);
    }
  }
  return undefined;
}

function firstDirective(
  record: RecordValue,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const directive = value.trim().split(/\s+/, 1)[0]?.toLowerCase();
    if (directive && /^[a-z][a-z0-9-]{0,63}$/.test(directive)) {
      return directive;
    }
  }
  return undefined;
}

function safeOrigin(
  value: unknown,
  documentOrigin?: string,
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = value.trim().slice(0, 2048).toLowerCase();

  if (["inline", "eval", "wasm-eval", "self"].includes(raw)) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "data:") return "data:";
    if (parsed.protocol === "blob:") return "blob:";
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "other";
    }
    if (documentOrigin && parsed.origin === documentOrigin) return "self";
    return parsed.origin;
  } catch {
    return raw === "null" ? "other" : undefined;
  }
}

function summarizeViolation(input: unknown): ViolationSummary | null {
  const record = asRecord(input);
  if (!record) return null;

  const disposition = firstString(record, "disposition");
  const documentOrigin = safeOrigin(
    record["document-uri"] ?? record.documentURL ?? record.documentUrl,
  );
  const effectiveDirective = firstDirective(
    record,
    "effective-directive",
    "effectiveDirective",
  );
  const violatedDirective = firstDirective(
    record,
    "violated-directive",
    "violatedDirective",
  );
  const blockedOrigin = safeOrigin(
    record["blocked-uri"] ?? record.blockedURL ?? record.blockedUrl,
    documentOrigin,
  );
  const sourceOrigin = safeOrigin(
    record["source-file"] ?? record.sourceFile,
    documentOrigin,
  );
  const statusValue = record["status-code"] ?? record.statusCode;
  const statusCode =
    typeof statusValue === "number" &&
    Number.isInteger(statusValue) &&
    statusValue >= 100 &&
    statusValue <= 599
      ? statusValue
      : undefined;

  const summary: ViolationSummary = {};
  if (disposition === "enforce" || disposition === "report") {
    summary.disposition = disposition;
  }
  if (effectiveDirective) summary.effectiveDirective = effectiveDirective;
  if (violatedDirective) summary.violatedDirective = violatedDirective;
  if (blockedOrigin) summary.blockedOrigin = blockedOrigin;
  if (sourceOrigin) summary.sourceOrigin = sourceOrigin;
  if (documentOrigin) summary.documentOrigin = documentOrigin;
  if (statusCode !== undefined) summary.statusCode = statusCode;

  return Object.keys(summary).length ? summary : null;
}

async function readLimitedBody(
  request: Request,
): Promise<{ text: string; tooLarge: boolean }> {
  if (!request.body) return { text: "", tooLarge: false };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { text: "", tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { text: new TextDecoder().decode(bytes), tooLarge: false };
}

function parseReports(payload: unknown): ViolationSummary[] {
  const outer = asRecord(payload);
  if (outer) {
    const legacy = asRecord(outer["csp-report"]);
    if (legacy) {
      return [summarizeViolation(legacy)].filter(
        (item): item is ViolationSummary => item !== null,
      );
    }
    const summary = summarizeViolation(outer);
    return summary ? [summary] : [];
  }

  if (!Array.isArray(payload)) return [];
  return payload
    .slice(0, MAX_REPORTS_PER_BATCH)
    .filter((item) => {
      const entry = asRecord(item);
      return (
        !!entry &&
        (entry.type === "csp-violation" || entry.type === undefined)
      );
    })
    .map((item) => {
      const entry = asRecord(item);
      return summarizeViolation(entry?.body ?? item);
    })
    .filter((item): item is ViolationSummary => item !== null);
}

function response(
  status: number,
  message?: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(message ?? null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

/**
 * Accept CSP reports without storing raw request bodies, URLs, query strings,
 * source snippets or client IPs. Only a small, normalized summary is emitted.
 */
export async function handleCspReport(
  request: Request,
  rateLimitBinding: unknown,
): Promise<Response> {
  if (request.method !== "POST") {
    return response(405, "Method not allowed.", { Allow: "POST" });
  }

  const rateLimit = await enforceRateLimit(
    rateLimitBinding,
    request,
    "csp-report",
  );
  if (rateLimit === "limited") {
    return response(429, "Too many reports.", { "Retry-After": "60" });
  }
  if (rateLimit !== "allowed") {
    return response(503, "Report endpoint temporarily unavailable.");
  }

  const contentType = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const supportedTypes = [
    "application/csp-report",
    "application/reports+json",
    "application/json",
  ];
  if (!supportedTypes.includes(contentType)) {
    return response(415, "Unsupported report content type.");
  }

  const body = await readLimitedBody(request);
  if (body.tooLarge) return response(413, "Report payload too large.");
  if (!body.text.trim()) return response(400, "Invalid report payload.");

  let payload: unknown;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return response(400, "Invalid report payload.");
  }

  const reports = parseReports(payload);
  if (!reports.length) return response(400, "No valid CSP reports found.");

  console.warn("[csp-report]", JSON.stringify(reports));
  return response(204);
}
