import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTelegramWebApp,
  initializeTelegramMiniApp,
  telegramHapticImpact,
  telegramHapticNotification,
  telegramHapticSelection,
  type TelegramWebApp,
} from "@/lib/telegram-mini-app";

function mockWebApp(): TelegramWebApp {
  return {
    initData: "test-init-data",
    ready: vi.fn(),
    expand: vi.fn(),
    HapticFeedback: {
      impactOccurred: vi.fn(),
      notificationOccurred: vi.fn(),
      selectionChanged: vi.fn(),
    },
  };
}

afterEach(() => {
  delete window.Telegram;
  document.documentElement.className = "";
  vi.restoreAllMocks();
});

describe("Telegram Mini App haptics", () => {
  it("uses the official Telegram haptic bridge when available", () => {
    const webApp = mockWebApp();
    window.Telegram = { WebApp: webApp };

    telegramHapticImpact("light");
    telegramHapticSelection();
    telegramHapticNotification("success");

    expect(webApp.HapticFeedback?.impactOccurred).toHaveBeenCalledWith("light");
    expect(webApp.HapticFeedback?.selectionChanged).toHaveBeenCalledTimes(1);
    expect(webApp.HapticFeedback?.notificationOccurred).toHaveBeenCalledWith("success");
  });

  it("safely does nothing when Telegram haptics are unavailable", () => {
    window.Telegram = { WebApp: { initData: "", ready: vi.fn(), expand: vi.fn() } };

    expect(() => {
      telegramHapticImpact();
      telegramHapticSelection();
      telegramHapticNotification("error");
    }).not.toThrow();
  });

  it("does not throw outside Telegram", () => {
    expect(getTelegramWebApp()).toBeNull();
    expect(() => telegramHapticImpact()).not.toThrow();
    expect(() => telegramHapticSelection()).not.toThrow();
    expect(() => telegramHapticNotification("warning")).not.toThrow();
  });

  it("keeps Mini App initialization and cleanup working alongside haptic support", () => {
    const webApp = mockWebApp();
    window.Telegram = { WebApp: webApp };

    const cleanup = initializeTelegramMiniApp();

    expect(webApp.ready).toHaveBeenCalledTimes(1);
    expect(webApp.expand).toHaveBeenCalledTimes(1);
    expect(document.documentElement).toHaveClass("telegram-mini-app");

    cleanup?.();

    expect(document.documentElement).not.toHaveClass("telegram-mini-app");
  });
});
