/**
 * Small, dependency-free Telegram Mini App bridge.
 *
 * This intentionally does not change YUME's existing palette or component styling.
 * Authentication must be implemented separately on the server by validating initData.
 */
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
    start_param?: string;
  };
  platform?: string;
  colorScheme?: "light" | "dark";
  viewportHeight?: number;
  viewportStableHeight?: number;
  safeAreaInset?: { top?: number; right?: number; bottom?: number; left?: number };
  contentSafeAreaInset?: { top?: number; right?: number; bottom?: number; left?: number };
  ready(): void;
  expand(): void;
  openTelegramLink?(url: string): void;
  disableVerticalSwipes?(): void;
  HapticFeedback?: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  onEvent?(eventType: string, eventHandler: () => void): void;
  offEvent?(eventType: string, eventHandler: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

function setInsetVariables(webApp: TelegramWebApp): void {
  const root = document.documentElement;
  const safe = webApp.safeAreaInset ?? {};
  const content = webApp.contentSafeAreaInset ?? {};
  root.style.setProperty("--yume-tg-safe-top", `${safe.top ?? 0}px`);
  root.style.setProperty("--yume-tg-safe-right", `${safe.right ?? 0}px`);
  root.style.setProperty("--yume-tg-safe-bottom", `${safe.bottom ?? 0}px`);
  root.style.setProperty("--yume-tg-safe-left", `${safe.left ?? 0}px`);
  root.style.setProperty("--yume-tg-content-safe-top", `${content.top ?? safe.top ?? 0}px`);
  root.style.setProperty("--yume-tg-content-safe-right", `${content.right ?? safe.right ?? 0}px`);
  root.style.setProperty("--yume-tg-content-safe-bottom", `${content.bottom ?? safe.bottom ?? 0}px`);
  root.style.setProperty("--yume-tg-content-safe-left", `${content.left ?? safe.left ?? 0}px`);
  const height = webApp.viewportStableHeight ?? webApp.viewportHeight;
  if (typeof height === "number" && Number.isFinite(height) && height > 0) {
    root.style.setProperty("--yume-tg-viewport-height", `${height}px`);
  }
}

/**
 * Trigger tactile feedback only when the Telegram client exposes the official
 * HapticFeedback bridge. Web browsers and unsupported clients safely do nothing.
 */
export function telegramHapticImpact(style: "light" | "medium" | "heavy" | "rigid" | "soft" = "light"): void {
  try {
    getTelegramWebApp()?.HapticFeedback?.impactOccurred(style);
  } catch {
    // Haptic feedback is a progressive enhancement; never interrupt an action.
  }
}

export function telegramHapticSelection(): void {
  try {
    getTelegramWebApp()?.HapticFeedback?.selectionChanged();
  } catch {
    // Ignore unsupported or unavailable haptics.
  }
}

export function telegramHapticNotification(type: "error" | "success" | "warning"): void {
  try {
    getTelegramWebApp()?.HapticFeedback?.notificationOccurred(type);
  } catch {
    // Ignore unsupported or unavailable haptics.
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export function initializeTelegramMiniApp(): (() => void) | undefined {
  const webApp = getTelegramWebApp();
  if (!webApp) return;

  document.documentElement.classList.add("telegram-mini-app");
  // ready() hides Telegram's loading placeholder; expand() requests the available height.
  webApp.ready();
  webApp.expand();
  // Prevent Telegram's vertical swipe gesture from collapsing the Mini App while
  // the user scrolls the page. Older Telegram clients may not expose this method.
  webApp.disableVerticalSwipes?.();
  setInsetVariables(webApp);

  const refreshViewport = () => setInsetVariables(webApp);
  const events = ["viewportChanged", "safeAreaChanged", "contentSafeAreaChanged"];
  events.forEach((eventName) => webApp.onEvent?.(eventName, refreshViewport));

  return () => {
    events.forEach((eventName) => webApp.offEvent?.(eventName, refreshViewport));
    document.documentElement.classList.remove("telegram-mini-app");
    [
      "--yume-tg-safe-top",
      "--yume-tg-safe-right",
      "--yume-tg-safe-bottom",
      "--yume-tg-safe-left",
      "--yume-tg-content-safe-top",
      "--yume-tg-content-safe-right",
      "--yume-tg-content-safe-bottom",
      "--yume-tg-content-safe-left",
      "--yume-tg-viewport-height",
    ].forEach((property) => document.documentElement.style.removeProperty(property));
  };
}
