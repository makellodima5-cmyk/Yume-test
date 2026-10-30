import { createFileRoute } from "@tanstack/react-router";
import { handleAnimeSubscriptions } from "@/data/anime-subscriptions.server";
export const Route = createFileRoute("/api/anime-subscriptions")({ server: { handlers: { GET: ({request}) => handleAnimeSubscriptions(request), POST: ({request}) => handleAnimeSubscriptions(request), DELETE: ({request}) => handleAnimeSubscriptions(request) } } });
