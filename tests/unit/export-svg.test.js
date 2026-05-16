import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

function analyzeLayout(layout) {
  const result = spawnSync("python", ["tools/export_svg.py"], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: JSON.stringify({
      mode: "analyze",
      layout,
    }),
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || "export_svg.py failed");
  }

  return JSON.parse(result.stdout);
}

function exportSvg(payload) {
  const result = spawnSync("python", ["tools/export_svg.py"], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: JSON.stringify(payload),
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || "export_svg.py failed");
  }

  return result.stdout;
}

describe("export_svg face tracing", () => {
  test("builds Candlepin face paths directly from font outlines", { timeout: 15000 }, () => {
    const analysis = analyzeLayout({
      text: "T",
      widthMm: 40,
      heightMm: 40,
      backingMm: 3.1,
      letters: [
        {
          character: "T",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 20,
          x: 5,
          y: 28,
        },
      ],
    });

    expect(analysis.facePath).toContain("M");
    expect(analysis.facePath).toContain("C");
    expect(analysis.facePath).not.toContain("Q");
  });

  test("switches exported face geometry between welded and direct outlines", { timeout: 15000 }, () => {
    const baseLayout = {
      text: "T",
      widthMm: 40,
      heightMm: 40,
      backingMm: 3.1,
      letters: [
        {
          character: "T",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 20,
          x: 5,
          y: 28,
        },
      ],
    };

    const welded = analyzeLayout({
      ...baseLayout,
      weldExportedDesign: true,
    });
    const unwelded = analyzeLayout({
      ...baseLayout,
      weldExportedDesign: false,
    });

    expect(welded.exportFacePath).toContain("L");
    expect(welded.exportFacePath).not.toContain("C");
    expect(unwelded.exportFacePath).toContain("C");
    expect(unwelded.exportFacePath).toBe(unwelded.facePath);
  });

  test("reuses precomputed export geometry without rebuilding outlines", () => {
    const svg = exportSvg({
      text: "Cached",
      widthMm: 40,
      heightMm: 20,
      analysis: {
        exportFacePath: "M0 0 L10 0 L10 10 Z",
        backingPath: "M20 0 L30 0 L30 10 Z",
        connectedComponentCount: 1,
      },
    });

    expect(svg).toContain('d="M0 0 L10 0 L10 10 Z"');
    expect(svg).toContain('d="M20 0 L30 0 L30 10 Z"');
    expect(svg).toContain('fill="rgb(255, 0, 0)"');
    expect(svg).toContain('stroke="none"');
    expect(svg).toContain("Text: Cached");
  });

  test("stacks batch exports on a 2 inch start-to-start pitch", () => {
    const svg = exportSvg({
      layouts: [
        {
          text: "First",
          widthMm: 40,
          heightMm: 20,
          analysis: {
            exportFacePath: "M0 0 L10 0 L10 10 Z",
            backingPath: "M20 0 L30 0 L30 10 Z",
            connectedComponentCount: 1,
          },
        },
        {
          text: "Second",
          widthMm: 40,
          heightMm: 20,
          analysis: {
            exportFacePath: "M0 0 L10 0 L10 10 Z",
            backingPath: "M20 0 L30 0 L30 10 Z",
            connectedComponentCount: 1,
          },
        },
      ],
    });

    expect(svg).toContain('height="70.800mm"');
    expect(svg).toContain('id="order-1-face-layer" transform="translate(0 0.000)"');
    expect(svg).toContain('id="order-2-face-layer" transform="translate(0 50.800)"');
    expect(svg).toContain('id="order-2-backing-layer" transform="translate(50.000 50.800)"');
  });
});
