import { createFileRoute } from "@tanstack/react-router";
import { handleAdminTrailers } from "@/data/admin-trailers.server";

export const Route = createFileRoute("/api/admin/trailers")({
  server: {
    handlers: {
      GET: ({ request }) => handleAdminTrailers(request),
      POST: ({ request }) => handleAdminTrailers(request),
    },
  },
});
