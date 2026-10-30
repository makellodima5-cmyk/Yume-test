export type AdminTrailerStats = {
  total: number;
  pending: number;
  checked: number;
  found: number;
  missing: number;
};

type AdminTrailerPayload = {
  isAdmin?: boolean;
  error?: string;
  message?: string;
  total?: number;
  pending?: number;
  checked?: number;
  found?: number;
  missing?: number;
  catalogTotal?: number;
  catalogWithTrailer?: number;
  delayMs?: number;
  retryAfterMs?: number;
};

type AdminTrailerUpdateOptions = {
  language: "ru" | "en";
  initialStats?: AdminTrailerStats;
  onStats: (stats: AdminTrailerStats) => void;
  onMessage: (message: string) => void;
  fetcher?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
};

type AdminRequestResult = {
  response: Response;
  payload: AdminTrailerPayload;
};

const DEFAULT_DELAY_MS = 2000;
const MAX_BATCH_REQUESTS = 100;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function numericValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function failureMessage(
  language: "ru" | "en",
  result: AdminRequestResult,
): string {
  if (result.response.status === 403 || result.payload.error === "admin_required") {
    return language === "ru"
      ? "Сервер отклонил административный запрос. Обнови Mini App и повтори вход."
      : "The server rejected the admin request. Reload the Mini App and sign in again.";
  }
  if (result.payload.error === "database_unavailable" || result.payload.error === "auth_database_unavailable") {
    return language === "ru"
      ? "Административная база данных недоступна. Проверь binding YUME_DB в Cloudflare."
      : "The admin database is unavailable. Check the YUME_DB binding in Cloudflare.";
  }
  return language === "ru"
    ? "Не удалось выполнить операцию обновления трейлеров. Попробуй ещё раз."
    : "Could not update trailers. Please try again.";
}

/**
 * Runs the admin-only trailer queue API. The server remains responsible for
 * authorizing every action; the browser only sequences the start/step requests.
 */
export async function runAdminTrailerUpdate(options: AdminTrailerUpdateOptions): Promise<void> {
  const {
    language,
    onStats,
    onMessage,
    fetcher = fetch,
    wait = delay,
  } = options;

  let stats: AdminTrailerStats = options.initialStats ?? {
    total: 0,
    pending: 0,
    checked: 0,
    found: 0,
    missing: 0,
  };

  const publishStats = (payload: AdminTrailerPayload) => {
    const hasCatalogMetrics =
      typeof payload.catalogTotal === "number" &&
      typeof payload.catalogWithTrailer === "number";
    stats = {
      // Queue counters from POST responses are not the same as catalog totals.
      // Use current anime_catalog aggregates only when the API supplies them.
      total: hasCatalogMetrics ? numericValue(payload.catalogTotal, stats.total) : stats.total,
      pending: numericValue(payload.pending, stats.pending),
      checked: numericValue(payload.checked, stats.checked),
      found: hasCatalogMetrics ? numericValue(payload.catalogWithTrailer, stats.found) : stats.found,
      // POST responses omit the live missing count; the final GET refreshes it.
      missing: numericValue(payload.missing, stats.missing),
    };
    onStats({ ...stats });
  };

  const request = async (action?: "start" | "step"): Promise<AdminRequestResult> => {
    const response = await fetcher("/api/admin/trailers", {
      ...(action ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      } : { method: "GET" }),
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as AdminTrailerPayload;
    return { response, payload };
  };

  try {
    const started = await request("start");
    if (started.payload.isAdmin === true) publishStats(started.payload);
    if (!started.response.ok || started.payload.isAdmin !== true) {
      onMessage(failureMessage(language, started));
      return;
    }

    let pending = numericValue(started.payload.pending, stats.pending);
    let batchRequests = 0;

    while (pending > 0) {
      if (batchRequests >= MAX_BATCH_REQUESTS) {
        onMessage(language === "ru"
          ? "Очередь сохранена, но обработка остановлена после большого числа запросов. Нажми кнопку ещё раз, чтобы продолжить."
          : "The queue is saved, but processing stopped after many requests. Press the button again to continue.");
        return;
      }

      const step = await request("step");
      if (step.payload.isAdmin === true) publishStats(step.payload);

      // The server keeps the queue intact when the upstream source rate-limits
      // or fails, so stop here and let the administrator retry later.
      if (step.response.status === 503 && step.payload.isAdmin === true) {
        const retrySeconds = Math.ceil(numericValue(step.payload.retryAfterMs, 0) / 1000);
        const sourceError = step.payload.error ? " " + step.payload.error : "";
        onMessage(language === "ru"
          ? "Источник временно не обработал пакет. Очередь сохранена." +
            (retrySeconds > 0 ? ` Попробуй снова примерно через ${retrySeconds} с.` : " Попробуй позже.") +
            sourceError
          : "The source could not process this batch. The queue is saved." +
            (retrySeconds > 0 ? ` Try again in about ${retrySeconds} seconds.` : " Try again later.") +
            sourceError);
        return;
      }

      if (!step.response.ok || step.payload.isAdmin !== true) {
        onMessage(failureMessage(language, step));
        return;
      }

      pending = numericValue(step.payload.pending, 0);
      batchRequests += 1;
      onMessage(language === "ru"
        ? `Проверено ${stats.checked} из ${stats.total}. В очереди осталось: ${pending}.`
        : `Checked ${stats.checked} of ${stats.total}. Remaining in queue: ${pending}.`);

      if (pending > 0) {
        await wait(numericValue(step.payload.delayMs, DEFAULT_DELAY_MS));
      }
    }

    // Refresh the missing-trailer count because POST responses do not include it.
    const refreshed = await request();
    if (refreshed.response.ok && refreshed.payload.isAdmin === true) {
      publishStats(refreshed.payload);
    }

    onMessage(language === "ru"
      ? `Обновление завершено. Проверено: ${stats.checked}. Найдено трейлеров: ${stats.found}. Без трейлера осталось: ${stats.missing}.`
      : `Update complete. Checked: ${stats.checked}. Trailers found: ${stats.found}. Still missing: ${stats.missing}.`);
  } catch {
    onMessage(language === "ru"
      ? "Не удалось связаться с административным API. Очередь не удалена; попробуй повторить операцию."
      : "Could not reach the admin API. The queue was not deleted; try again.");
  }
}
