import { createFileRoute } from "@tanstack/react-router";
import { handleTelegramHistory } from "@/data/telegram-auth.server";

export const Route = createFileRoute("/api/telegram/history")({
  server: {
    handlers: {
      GET: ({ request }) => handleTelegramHistory(request),
      POST: ({ request }) => handleTelegramHistory(request),
      DELETE: ({ request }) => handleTelegramHistory(request),
    },
  },
});
