import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const indexHtml = readFileSync(join(root, "index.html"), "utf8");
const faviconSvg = readFileSync(join(root, "public", "favicon.svg"), "utf8");

describe("favicon wiring", () => {
  it("references the shared SVG favicon from the app shell", () => {
    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/public/favicon.svg">');
  });

  it("ships the favicon asset from the public directory", () => {
    expect(existsSync(join(root, "public", "favicon.svg"))).toBe(true);
  });

  it("uses the simplified red tile with white TFU lettering", () => {
    expect(faviconSvg).toContain('fill="#ff1e14"');
    expect(faviconSvg).toContain('fill="#ffffff"');
    expect(faviconSvg).toContain("TFU");
    expect(faviconSvg).toContain("<rect");
  });
});
