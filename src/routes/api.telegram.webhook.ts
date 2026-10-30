import { createFileRoute } from "@tanstack/react-router";
import { handleTelegramWebhook } from "@/data/telegram-bot.server";

export const Route = createFileRoute("/api/telegram/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => handleTelegramWebhook(request),
    },
  },
});
