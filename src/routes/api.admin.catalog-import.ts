import { createFileRoute } from "@tanstack/react-router";
import { handleAdminCatalogImport } from "@/data/admin-catalog-import.server";

export const Route = createFileRoute("/api/admin/catalog-import")({
  server: {
    handlers: {
      GET: ({ request }) => handleAdminCatalogImport(request),
      POST: ({ request }) => handleAdminCatalogImport(request),
    },
  },
});
