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
});
