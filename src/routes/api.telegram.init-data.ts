import { createFileRoute } from "@tanstack/react-router";
import { handleTelegramSession } from "@/data/telegram-auth.server";

export const Route = createFileRoute("/api/telegram/init-data")({
  server: {
    handlers: {
      GET: ({ request }) => handleTelegramSession(request),
      POST: ({ request }) => handleTelegramSession(request),
      DELETE: ({ request }) => handleTelegramSession(request),
    },
  },
});
