import { afterEach, describe, expect, it, vi } from "vitest";
import { handleShikimoriImageProxy, toSameOriginShikimoriImage, toSameOriginShikimoriScreenshot } from "@/lib/shikimori-image-proxy";

describe("Shikimori image proxy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rewrites HTTPS static poster and system image assets on approved hosts", () => {
    expect(toSameOriginShikimoriImage("https://shikimori.io/uploads/poster/animes/52991/main-d1e1c7c50f69eee9033229dcdfda5e23.webp"))
      .toBe("/api/media/shikimori?src=https%3A%2F%2Fshikimori.io%2Fuploads%2Fposter%2Fanimes%2F52991%2Fmain-d1e1c7c50f69eee9033229dcdfda5e23.webp");
    expect(toSameOriginShikimoriImage("https://shikimori.one/system/animes/original/123.jpg"))
      .toBe("/api/media/shikimori?src=https%3A%2F%2Fshikimori.one%2Fsystem%2Fanimes%2Foriginal%2F123.jpg");
    expect(toSameOriginShikimoriImage("https://shikimori.io/system/animes/original/123.jpg?v=99"))
      .toBe("/api/media/shikimori?src=https%3A%2F%2Fshikimori.io%2Fsystem%2Fanimes%2Foriginal%2F123.jpg");
    expect(toSameOriginShikimoriImage("https://shikimori.one/api/animes/123")).toBeUndefined();
    expect(toSameOriginShikimoriImage("https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/1.jpg"))
      .toBe("https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/1.jpg");
  });

  it("rewrites screenshot preview and original URLs together so browser requests stay same-origin", () => {
    expect(toSameOriginShikimoriScreenshot({
      previewUrl: "https://shikimori.one/uploads/screenshots/preview.jpg",
      originalUrl: "https://shikimori.one/uploads/screenshots/original.jpg",
    })).toEqual({
      previewUrl: "/api/media/shikimori?src=https%3A%2F%2Fshikimori.one%2Fuploads%2Fscreenshots%2Fpreview.jpg",
      originalUrl: "/api/media/shikimori?src=https%3A%2F%2Fshikimori.one%2Fuploads%2Fscreenshots%2Foriginal.jpg",
    });
    expect(toSameOriginShikimoriScreenshot({
      previewUrl: "https://shikimori.one/api/animes/1",
      originalUrl: "https://shikimori.one/uploads/screenshots/original.jpg",
    })).toBeNull();
    expect(toSameOriginShikimoriScreenshot({
      previewUrl: "https://attacker.example/uploads/screenshots/preview.jpg",
      originalUrl: "https://shikimori.one/uploads/screenshots/original.jpg",
    })).toBeNull();
  });

  it("rejects unsafe hosts, non-HTTPS sources, queries, and non-image paths", async () => {
    expect((await handleShikimoriImageProxy("https://attacker.example/system/a.jpg")).status).toBe(400);
    expect((await handleShikimoriImageProxy("http://shikimori.one/system/a.jpg")).status).toBe(400);
    expect((await handleShikimoriImageProxy("https://shikimori.one/api/animes/1")).status).toBe(400);
    expect((await handleShikimoriImageProxy("https://shikimori.one/system/a.jpg?redirect=https://attacker.example")).status).toBe(400);
  });

  it("returns bounded image responses without forwarding cookies or following redirects", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "image/jpeg", "Content-Length": "3", "Set-Cookie": "vendor=secret" },
    }));
    const response = await handleShikimoriImageProxy("https://shikimori.one/system/a.jpg");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://shikimori.one/system/a.jpg",
      expect.objectContaining({ redirect: "manual", method: "GET" }),
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("does not serve redirects or non-image upstream content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, {
      status: 302, headers: { Location: "https://attacker.example/image.jpg" },
    }));
    expect((await handleShikimoriImageProxy("https://shikimori.one/system/a.jpg")).status).toBe(502);
  });
});
