import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { validateCatalogSearch } from "@/data/catalog-search";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("accepts the Telegram Mini App admin view and privacy policy, while rejecting removed auth views", () => {
    expect(validateCatalogSearch({ section: "admin" }).section).toBe("admin");
    expect(validateCatalogSearch({ section: "privacy-policy" }).section).toBe("privacy-policy");
    expect(validateCatalogSearch({ section: "login" }).section).toBeUndefined();
    expect(validateCatalogSearch({ section: "register" }).section).toBeUndefined();
  });

  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });
});