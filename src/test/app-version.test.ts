import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "@/data/app-version";

describe("user-visible app version", () => {
  it("matches the package version", async () => {
    const pkg = JSON.parse(await readFile(resolve(process.cwd(), "package.json"), "utf8")) as { version?: string };
    expect(APP_VERSION).toBe(pkg.version);
  });
});
