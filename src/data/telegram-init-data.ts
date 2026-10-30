const MAX_AUTH_AGE_SECONDS = 5 * 60;
const ALLOWED_FUTURE_SKEW_SECONDS = 30;
const MAX_INIT_DATA_LENGTH = 16_384;
const encoder = new TextEncoder();

export type TelegramValidatedUser = {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
};

export type TelegramInitDataResult =
  | { ok: true; authDate: number; user: TelegramValidatedUser }
  | { ok: false; error: "invalid_request" | "invalid_signature" | "auth_data_expired" | "invalid_user" };

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Validates Telegram.WebApp.initData using Telegram's documented HMAC-SHA-256 scheme. */
export async function validateTelegramInitData(
  initData: string,
  botToken: string,
  nowMs = Date.now(),
): Promise<TelegramInitDataResult> {
  if (
    typeof initData !== "string" ||
    !initData ||
    initData.length > MAX_INIT_DATA_LENGTH ||
    typeof botToken !== "string" ||
    !botToken.trim()
  ) {
    return { ok: false, error: "invalid_request" };
  }

  const params = new URLSearchParams(initData);
  const entries = Array.from(params.entries());
  if (entries.length === 0 || new Set(entries.map(([key]) => key)).size !== entries.length) {
    return { ok: false, error: "invalid_request" };
  }

  const suppliedHash = params.get("hash");
  if (!suppliedHash || !/^[a-f0-9]{64}$/i.test(suppliedHash)) {
    return { ok: false, error: "invalid_request" };
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw || !/^\d+$/.test(authDateRaw)) {
    return { ok: false, error: "invalid_request" };
  }
  const authDate = Number(authDateRaw);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    !Number.isSafeInteger(authDate) ||
    authDate > nowSeconds + ALLOWED_FUTURE_SKEW_SECONDS ||
    nowSeconds - authDate > MAX_AUTH_AGE_SECONDS
  ) {
    return { ok: false, error: "auth_data_expired" };
  }

  const checkString = entries
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => key + "=" + value)
    .join("\n");

  try {
    const secretKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const secret = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(botToken));
    const signingKey = await crypto.subtle.importKey(
      "raw",
      secret,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signatureIsValid = await crypto.subtle.verify(
      "HMAC",
      signingKey,
      hexToBytes(suppliedHash),
      encoder.encode(checkString),
    );
    if (!signatureIsValid) return { ok: false, error: "invalid_signature" };
  } catch {
    return { ok: false, error: "invalid_request" };
  }

  let rawUser: unknown;
  try {
    rawUser = JSON.parse(params.get("user") ?? "null");
  } catch {
    return { ok: false, error: "invalid_user" };
  }
  if (!rawUser || typeof rawUser !== "object" || Array.isArray(rawUser)) {
    return { ok: false, error: "invalid_user" };
  }

  const candidate = rawUser as Record<string, unknown>;
  if (typeof candidate.id !== "number" || !Number.isSafeInteger(candidate.id) || candidate.id <= 0) {
    return { ok: false, error: "invalid_user" };
  }
  const firstName = stringField(candidate.first_name);
  if (!firstName) return { ok: false, error: "invalid_user" };

  const lastName = stringField(candidate.last_name);
  const username = stringField(candidate.username);
  const languageCode = stringField(candidate.language_code);
  return {
    ok: true,
    authDate,
    user: {
      id: candidate.id,
      firstName,
      ...(lastName ? { lastName } : {}),
      ...(username ? { username } : {}),
      ...(languageCode ? { languageCode } : {}),
    },
  };
}
