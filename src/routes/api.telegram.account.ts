import { createFileRoute } from "@tanstack/react-router";
import { handleTelegramAccountDelete } from "@/data/telegram-auth.server";

export const Route = createFileRoute("/api/telegram/account")({
  server: {
    handlers: {
      DELETE: ({ request }) => handleTelegramAccountDelete(request),
    },
  },
});
