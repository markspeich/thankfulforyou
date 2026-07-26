import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Vercel routing", () => {
  it("rewrites every bookmarkable workspace route to the app shell", async () => {
    const config = JSON.parse(await readFile("vercel.json", "utf8"));
    const appShellRewrite = config.rewrites.find((rewrite) => rewrite.destination === "/index.html");

    expect(appShellRewrite?.source).toContain("orders");
    expect(appShellRewrite?.source).toContain("production-batch");
    expect(appShellRewrite?.source).toContain("presets");
    expect(appShellRewrite?.source).toContain("fonts");
    expect(appShellRewrite?.source).toContain("fixed-designs");
    expect(appShellRewrite?.source).toContain("size-guides");
  });

  it("does not rewrite Etsy API endpoints to the app shell", async () => {
    const config = JSON.parse(await readFile("vercel.json", "utf8"));
    const appShellRewrites = config.rewrites.filter((rewrite) => rewrite.destination === "/index.html");

    for (const path of ["/api/etsy-connection", "/api/etsy-callback", "/api/etsy-import", "/api/amazon-import"]) {
      expect(appShellRewrites.every((rewrite) => !new RegExp(`^${rewrite.source}$`).test(path))).toBe(true);
    }
  });

  it("enables cancellation only for the Amazon import Node function", async () => {
    const config = JSON.parse(await readFile("vercel.json", "utf8"));

    expect(config.functions["api/amazon-import.js"]).toEqual({
      supportsCancellation: true,
    });
    expect(config.functions["api/**/*.py"]).toMatchObject({
      includeFiles: "public/fonts/**/*",
      maxDuration: 60,
    });
  });
});
