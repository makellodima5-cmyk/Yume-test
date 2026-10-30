// Vitest runs outside the Cloudflare Workers runtime. The production Vite build
// keeps `cloudflare:workers` external so Workers provides the real request env.
export const env: Record<string, unknown> = {};
