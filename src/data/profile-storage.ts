import {
  normalizeSavedAnimeIds,
  normalizeSavedAnimeLibrary,
  type SavedAnimeLibrary,
} from "@/data/telegram-library.shared";

export const FAVORITES_STORAGE_KEY = "yume-favorite-anime-v1";
export const WATCHLIST_STORAGE_KEY = "yume-watchlist-anime-v1";
export const PROFILE_UPDATED_EVENT = "yume-profile-updated";
export const PROFILE_SYNC_ERROR_EVENT = "yume-profile-sync-error";
export const PROFILE_AUTH_REQUIRED_EVENT = "yume-profile-auth-required";

let accountAuthenticated = false;

export function setProfileStorageAuthenticated(authenticated: boolean): void {
  accountAuthenticated = authenticated;
  if (!authenticated) clearLocalAccountLibrary();
}

export function clearLocalAccountLibrary(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FAVORITES_STORAGE_KEY);
    window.localStorage.removeItem(WATCHLIST_STORAGE_KEY);
    for (let index = window.localStorage.length - 1; index >= 0; index--) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("yume-telegram-library-imported-v1:")) window.localStorage.removeItem(key);
    }
  } catch {
    // Local cache cleanup is best-effort; server account data remains authoritative.
  }
  notifyProfileUpdated();
}

const TELEGRAM_LIBRARY_ENDPOINT = "/api/telegram/library";
let telegramMutationQueue: Promise<void> = Promise.resolve();

export function readSavedAnimeIds(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function storeSavedAnimeIds(key: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Server-side storage remains authoritative in Telegram even if local storage is blocked.
  }
}

function notifyProfileUpdated(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
}

function listTypeForKey(key: string): "favorite" | "watchlist" | null {
  if (key === FAVORITES_STORAGE_KEY) return "favorite";
  if (key === WATCHLIST_STORAGE_KEY) return "watchlist";
  return null;
}

function applyServerLibrary(value: unknown): SavedAnimeLibrary {
  const library = normalizeSavedAnimeLibrary(value);
  if (!library) throw new Error("Invalid Telegram library response");
  storeSavedAnimeIds(FAVORITES_STORAGE_KEY, library.favoriteIds);
  storeSavedAnimeIds(WATCHLIST_STORAGE_KEY, library.watchlistIds);
  notifyProfileUpdated();
  return library;
}

async function fetchTelegramLibrary(): Promise<SavedAnimeLibrary> {
  const response = await fetch(TELEGRAM_LIBRARY_ENDPOINT, {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 401) setProfileStorageAuthenticated(false);
    throw new Error("Account library request failed: " + response.status);
  }
  const library = applyServerLibrary(await response.json());
  accountAuthenticated = true;
  return library;
}

/**
 * Hydrate lists from D1 on login. The import marker is scoped to the account and
 * browser, so legacy local lists are merged once rather than resurrected on every launch.
 */
export async function syncTelegramLibrary(accountId: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (typeof accountId !== "string" || !accountId.trim()) throw new Error("Missing Telegram account ID");
  // Never import guest-only local lists into an account. The signed-in server library is authoritative.
  await fetchTelegramLibrary();
  accountAuthenticated = true;
}

async function refreshTelegramLibraryAfterFailure(): Promise<void> {
  await fetchTelegramLibrary();
}

export function toggleSavedAnimeId(key: string, animeId: string): boolean {
  if (typeof window === "undefined") return false;
  const listType = listTypeForKey(key);
  if (!listType || !/^\d{1,12}$/.test(animeId)) return false;
  if (!accountAuthenticated) {
    window.dispatchEvent(new Event(PROFILE_AUTH_REQUIRED_EVENT));
    return false;
  }
  const current = readSavedAnimeIds(key);
  const alreadySaved = current.includes(animeId);
  const next = alreadySaved
    ? current.filter((id) => id !== animeId)
    : [...current, animeId];
  let localStorageWritten = false;
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
    localStorageWritten = true;
    notifyProfileUpdated();
  } catch {
    // A network save is still attempted below in Telegram even when local storage is full.
  }

  const canSyncToAccount = Boolean(listType && accountAuthenticated);
  if (canSyncToAccount && listType) {
    telegramMutationQueue = telegramMutationQueue
      .then(async () => {
        const response = await fetch(TELEGRAM_LIBRARY_ENDPOINT, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ list: listType, animeId, saved: !alreadySaved }),
        });
        if (!response.ok) {
          if (response.status === 401) throw new Error("AUTHENTICATION_REQUIRED");
          throw new Error("Account library save failed: " + response.status);
        }
        applyServerLibrary(await response.json());
      })
      .catch(async (error: unknown) => {
        if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
          setProfileStorageAuthenticated(false);
          window.dispatchEvent(new Event(PROFILE_AUTH_REQUIRED_EVENT));
          return;
        }
        try {
          await refreshTelegramLibraryAfterFailure();
        } catch {
          // Keep the last server-synchronized copy until the connection returns.
        }
        window.dispatchEvent(new Event(PROFILE_SYNC_ERROR_EVENT));
      });
  }
  if (!localStorageWritten) return alreadySaved;
  return !alreadySaved;
}

/**
 * Playback progress contract for a future authenticated video player.
 * The current YUME build has no episode player or authentication, so these
 * helpers deliberately remain opt-in and are not wired to demo data.
 */
export type PlaybackProgress = {
  animeId: string;
  episode: number;
  positionSeconds: number;
  durationSeconds: number | null;
  updatedAt: string;
  completed: boolean;
};

export const PLAYBACK_PROGRESS_STORAGE_KEY = "yume-playback-progress-v1";

export function normalizePlaybackProgress(value: unknown): PlaybackProgress | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<PlaybackProgress>;
  if (typeof item.animeId !== "string" || !item.animeId.trim()) return null;
  if (!Number.isInteger(item.episode) || (item.episode ?? 0) < 1) return null;
  if (!Number.isFinite(item.positionSeconds) || (item.positionSeconds ?? -1) < 0) return null;
  if (item.durationSeconds !== null && item.durationSeconds !== undefined &&
      (!Number.isFinite(item.durationSeconds) || item.durationSeconds < 0)) return null;
  if (typeof item.updatedAt !== "string" || !Number.isFinite(Date.parse(item.updatedAt))) return null;
  if (typeof item.completed !== "boolean") return null;
  const duration = item.durationSeconds ?? null;
  const position = item.positionSeconds ?? 0;
  return {
    animeId: item.animeId,
    episode: item.episode ?? 1,
    positionSeconds: duration !== null && duration > 0 ? Math.min(position, duration) : position,
    durationSeconds: duration,
    updatedAt: item.updatedAt,
    completed: item.completed || (duration !== null && duration > 0 && position / duration >= 0.95),
  };
}

export function getResumePosition(progress: PlaybackProgress | null | undefined): number {
  if (!progress || progress.completed) return 0;
  return Math.max(0, Math.floor(progress.positionSeconds));
}

/** Skip opening only when a valid, explicit interval is available. */
export function getOpeningSkipTarget(openingEndSeconds: number | null | undefined): number | null {
  return typeof openingEndSeconds === "number" &&
    Number.isFinite(openingEndSeconds) &&
    openingEndSeconds > 0
    ? Math.floor(openingEndSeconds)
    : null;
}
