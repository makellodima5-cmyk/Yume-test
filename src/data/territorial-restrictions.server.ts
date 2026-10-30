import { setResponseHeader } from "@tanstack/react-start/server";

type CatalogWithItems<TItem extends { id: string }> = {
  items: TItem[];
};

/**
 * Kept for compatibility with existing server-function call sites.
 * YUME itself does not filter catalog entries based on visitor geography.
 */
export function filterCatalogForCurrentRequest<
  TItem extends { id: string },
  T extends CatalogWithItems<TItem>,
>(result: T): T {
  setResponseHeader("Cache-Control", "private, no-store");
  return {
    ...result,
    items: [...result.items],
  } as T;
}
