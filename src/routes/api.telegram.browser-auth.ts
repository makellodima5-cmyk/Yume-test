import { createFileRoute } from "@tanstack/react-router";
import { handleTelegramBrowserAuth } from "@/data/telegram-auth.server";

export const Route = createFileRoute("/api/telegram/browser-auth")({
  server: {
    handlers: {
      GET: ({ request }) => handleTelegramBrowserAuth(request),
      POST: ({ request }) => handleTelegramBrowserAuth(request),
    },
  },
});
