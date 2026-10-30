import { createFileRoute } from "@tanstack/react-router";
import { handleTelegramLibrary } from "@/data/telegram-auth.server";

export const Route = createFileRoute("/api/telegram/library")({
  server: {
    handlers: {
      GET: ({ request }) => handleTelegramLibrary(request),
      POST: ({ request }) => handleTelegramLibrary(request),
    },
  },
});
