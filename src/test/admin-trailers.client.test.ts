import { describe, expect, it } from "vitest";
import { runAdminTrailerUpdate, type AdminTrailerStats } from "@/data/admin-trailer-update";

type MockReply = {
  status: number;
  payload: Record<string, unknown>;
};

type RecordedRequest = {
  method: string | undefined;
  action: string | undefined;
};

function makeFetcher(replies: MockReply[], requests: RecordedRequest[]): typeof fetch {
  return async (_input, init) => {
    const action = typeof init?.body === "string"
      ? (JSON.parse(init.body) as { action?: string }).action
      : undefined;
    requests.push({ method: init?.method, action });
    const reply = replies.shift();
    if (!reply) throw new Error("No mock reply available");
    return new Response(JSON.stringify(reply.payload), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

const counts = (overrides: Partial<AdminTrailerStats> = {}): AdminTrailerStats => ({
  total: 2,
  pending: 0,
  checked: 0,
  found: 0,
  missing: 2,
  ...overrides,
});

describe("admin trailer update client workflow", () => {
  it("starts the queue, processes pending batches, and refreshes final counts", async () => {
    const requests: RecordedRequest[] = [];
    const stats: AdminTrailerStats[] = [];
    const messages: string[] = [];
    const waits: number[] = [];
    const fetcher = makeFetcher([
      { status: 200, payload: { isAdmin: true, total: 2, pending: 2, checked: 0, found: 0 } },
      { status: 200, payload: { isAdmin: true, total: 2, pending: 1, checked: 1, found: 1, delayMs: 2000 } },
      { status: 200, payload: { isAdmin: true, total: 2, pending: 0, checked: 2, found: 1, delayMs: 2000, done: true } },
      { status: 200, payload: { isAdmin: true, total: 2, pending: 0, checked: 2, found: 0, missing: 1, catalogTotal: 2, catalogWithTrailer: 1, missingTrailers: 1 } },
    ], requests);

    await runAdminTrailerUpdate({
      language: "ru",
      initialStats: counts(),
      fetcher,
      wait: async (milliseconds) => { waits.push(milliseconds); },
      onStats: (value) => stats.push(value),
      onMessage: (message) => messages.push(message),
    });

    expect(requests).toEqual([
      { method: "POST", action: "start" },
      { method: "POST", action: "step" },
      { method: "POST", action: "step" },
      { method: "GET", action: undefined },
    ]);
    expect(waits).toEqual([2000]);
    expect(stats.at(-1)).toEqual(counts({ pending: 0, checked: 2, found: 1, missing: 1 }));
    expect(messages.at(-1)).toContain("Обновление завершено");
  });

  it("preserves the queue and reports source throttling instead of looping indefinitely", async () => {
    const requests: RecordedRequest[] = [];
    const messages: string[] = [];
    const stats: AdminTrailerStats[] = [];
    const fetcher = makeFetcher([
      { status: 200, payload: { isAdmin: true, total: 2, pending: 1, checked: 1, found: 0 } },
      {
        status: 503,
        payload: {
          isAdmin: true,
          total: 2,
          pending: 1,
          checked: 1,
          found: 0,
          retryAfterMs: 60000,
          error: "Shikimori rate limited",
        },
      },
    ], requests);

    await runAdminTrailerUpdate({
      language: "ru",
      initialStats: counts({ pending: 1, checked: 1 }),
      fetcher,
      wait: async () => { throw new Error("Should not wait after a retryable server response"); },
      onStats: (value) => stats.push(value),
      onMessage: (message) => messages.push(message),
    });

    expect(requests).toHaveLength(2);
    expect(stats.at(-1)?.pending).toBe(1);
    expect(messages.at(-1)).toContain("Очередь сохранена");
    expect(messages.at(-1)).toContain("60 с");
  });

  it("does not process a queue when the server rejects administrator access", async () => {
    const requests: RecordedRequest[] = [];
    const messages: string[] = [];
    const fetcher = makeFetcher([
      { status: 403, payload: { isAdmin: false, error: "admin_required" } },
    ], requests);

    await runAdminTrailerUpdate({
      language: "ru",
      initialStats: counts(),
      fetcher,
      onStats: () => undefined,
      onMessage: (message) => messages.push(message),
    });

    expect(requests).toHaveLength(1);
    expect(messages.at(-1)).toContain("Сервер отклонил");
  });
});
