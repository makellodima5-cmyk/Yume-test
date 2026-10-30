import { createFileRoute } from "@tanstack/react-router";
import { handleTelegramSubscriptionCheck } from "@/data/telegram-subscription.server";

export const Route = createFileRoute("/api/telegram/subscription")({
  server: {
    handlers: {
      POST: ({ request }) => handleTelegramSubscriptionCheck(request),
    },
  },
});
