import { createFileRoute } from "@tanstack/react-router";
import { handleNotifications } from "@/data/notifications.server";

export const Route = createFileRoute("/api/notifications")({
  server: {
    handlers: {
      GET: ({ request }) => handleNotifications(request),
      POST: ({ request }) => handleNotifications(request),
    },
  },
});
