import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAVORITES_STORAGE_KEY,
  PROFILE_UPDATED_EVENT,
  WATCHLIST_STORAGE_KEY,
  readSavedAnimeIds,
  toggleSavedAnimeId,
  setProfileStorageAuthenticated,
  PROFILE_AUTH_REQUIRED_EVENT,
} from "@/data/profile-storage";

describe("local profile library", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setProfileStorageAuthenticated(false);
  });

  it("returns an empty list for missing, malformed, or non-array storage", () => {
    expect(readSavedAnimeIds(FAVORITES_STORAGE_KEY)).toEqual([]);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, "{");
    expect(readSavedAnimeIds(FAVORITES_STORAGE_KEY)).toEqual([]);
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify({ id: "1" }));
    expect(readSavedAnimeIds(FAVORITES_STORAGE_KEY)).toEqual([]);
  });

  it("keeps only string IDs when reading stored data", () => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(["a", 2, null, "b", {}]));
    expect(readSavedAnimeIds(FAVORITES_STORAGE_KEY)).toEqual(["a", "b"]);
  });

  it("adds an ID once and removes it on the next toggle for an authenticated account", () => {
    setProfileStorageAuthenticated(true);
    expect(toggleSavedAnimeId(FAVORITES_STORAGE_KEY, "123")).toBe(true);
    expect(toggleSavedAnimeId(FAVORITES_STORAGE_KEY, "123")).toBe(false);
    expect(readSavedAnimeIds(FAVORITES_STORAGE_KEY)).toEqual([]);
  });

  it("preserves other IDs and does not duplicate an existing ID for an authenticated account", () => {
    setProfileStorageAuthenticated(true);
    window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(["123"]));
    expect(readSavedAnimeIds(WATCHLIST_STORAGE_KEY)).toEqual(["123"]);
    expect(toggleSavedAnimeId(WATCHLIST_STORAGE_KEY, "456")).toBe(true);
    expect(readSavedAnimeIds(WATCHLIST_STORAGE_KEY)).toEqual(["123", "456"]);
  });

  it("dispatches the shared update event after a successful write", () => {
    setProfileStorageAuthenticated(true);
    const listener = vi.fn();
    window.addEventListener(PROFILE_UPDATED_EVENT, listener);
    toggleSavedAnimeId(FAVORITES_STORAGE_KEY, "123");
    window.removeEventListener(PROFILE_UPDATED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("blocks guest saves and asks the app to open authentication", () => {
    const listener = vi.fn();
    window.addEventListener(PROFILE_AUTH_REQUIRED_EVENT, listener);
    expect(toggleSavedAnimeId(FAVORITES_STORAGE_KEY, "123")).toBe(false);
    window.removeEventListener(PROFILE_AUTH_REQUIRED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(readSavedAnimeIds(FAVORITES_STORAGE_KEY)).toEqual([]);
  });

  it("fails safely when browser storage is unavailable", () => {
    setProfileStorageAuthenticated(true);
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(readSavedAnimeIds(FAVORITES_STORAGE_KEY)).toEqual([]);
    getItem.mockRestore();

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(toggleSavedAnimeId(FAVORITES_STORAGE_KEY, "123")).toBe(false);
    setItem.mockRestore();
  });
});
