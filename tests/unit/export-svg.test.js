import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vitest";

const pythonCommand = process.env.PYTHON || (process.platform === "win32" ? "py" : "python3");
const pythonScriptArgs = process.env.PYTHON
  ? ["tools/export_svg.py"]
  : process.platform === "win32"
    ? ["-3.11", "tools/export_svg.py"]
    : ["tools/export_svg.py"];

function analyzeLayout(layout) {
  const result = spawnSync(pythonCommand, pythonScriptArgs, {
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
  const result = spawnSync(pythonCommand, pythonScriptArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    input: JSON.stringify(payload),
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || "export_svg.py failed");
  }

  return result.stdout;
}

function countPathCommands(path, command) {
  const matches = path.match(new RegExp(command, "g"));
  return matches ? matches.length : 0;
}

function pathBounds(path) {
  const numbers = Array.from(path.matchAll(/-?\d+(?:\.\d+)?/g), (match) => Number(match[0]));
  const xs = [];
  const ys = [];

  for (let index = 0; index + 1 < numbers.length; index += 2) {
    xs.push(numbers[index]);
    ys.push(numbers[index + 1]);
  }

  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
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

  test("simplifies welded export paths without materially changing face bounds", { timeout: 15000 }, () => {
    const layout = {
      text: "RN",
      widthMm: 40,
      heightMm: 20,
      backingMm: 3.1,
      weldExportedDesign: true,
      letters: [
        {
          character: "R",
          fontId: "somekind",
          fontPath: "public/fonts/Somekind.ttf",
          fontSizeMm: 16,
          x: 4,
          y: 16,
        },
        {
          character: "N",
          fontId: "somekind",
          fontPath: "public/fonts/Somekind.ttf",
          fontSizeMm: 16,
          x: 14,
          y: 16,
        },
      ],
    };

    const simplified = analyzeLayout(layout);
    const baseline = analyzeLayout({
      ...layout,
      traceProfileOverrides: {
        faceToleranceMm: 0.012,
      },
    });

    const simplifiedSegments = countPathCommands(simplified.exportFacePath, "L");
    const baselineSegments = countPathCommands(baseline.exportFacePath, "L");
    const simplifiedBounds = pathBounds(simplified.exportFacePath);
    const baselineBounds = pathBounds(baseline.exportFacePath);

    expect(simplifiedSegments).toBeLessThan(baselineSegments * 0.2);
    expect(Math.abs(simplifiedBounds.left - baselineBounds.left)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(simplifiedBounds.top - baselineBounds.top)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(simplifiedBounds.right - baselineBounds.right)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(simplifiedBounds.bottom - baselineBounds.bottom)).toBeLessThanOrEqual(0.05);
  });

  test("applies per-letter vertical stretch without widening outline bounds", { timeout: 30000 }, () => {
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
          verticalScale: 1,
          x: 5,
          y: 28,
        },
      ],
    };

    const base = analyzeLayout(baseLayout);
    const stretched = analyzeLayout({
      ...baseLayout,
      letters: [
        {
          ...baseLayout.letters[0],
          verticalScale: 1.35,
        },
      ],
    });

    expect(base.faceBoundsMm).toBeTruthy();
    expect(stretched.faceBoundsMm).toBeTruthy();
    expect(stretched.faceBoundsMm.height).toBeGreaterThan(base.faceBoundsMm.height * 1.25);
    expect(stretched.faceBoundsMm.width).toBeLessThan(base.faceBoundsMm.width * 1.05);
    expect(stretched.facePath).not.toBe(base.facePath);
  });

  test("applies per-letter horizontal stretch without meaningfully increasing outline height", { timeout: 15000 }, () => {
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
          horizontalScale: 1,
          verticalScale: 1,
          x: 5,
          y: 28,
        },
      ],
    };

    const base = analyzeLayout(baseLayout);
    const stretched = analyzeLayout({
      ...baseLayout,
      letters: [
        {
          ...baseLayout.letters[0],
          horizontalScale: 1.35,
        },
      ],
    });

    expect(base.faceBoundsMm).toBeTruthy();
    expect(stretched.faceBoundsMm).toBeTruthy();
    expect(stretched.faceBoundsMm.width).toBeGreaterThan(base.faceBoundsMm.width * 1.25);
    expect(stretched.faceBoundsMm.height).toBeLessThan(base.faceBoundsMm.height * 1.05);
    expect(stretched.facePath).not.toBe(base.facePath);
  });

  test("analyzes multi-character letter tokens without crashing outline export", { timeout: 15000 }, () => {
    const analysis = analyzeLayout({
      text: "Chuck!",
      widthMm: 60,
      heightMm: 30,
      backingMm: 3.1,
      weldExportedDesign: false,
      letters: [
        {
          character: "Ch",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 4,
          y: 22,
        },
        {
          character: "u",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 18,
          y: 22,
        },
        {
          character: "ck!",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 28,
          y: 22,
        },
      ],
    });

    expect(analysis.facePath).toContain("M");
    expect(analysis.exportFacePath).toContain("M");
    expect(analysis.faceBoundsMm.width).toBeGreaterThan(0);
    expect(analysis.faceBoundsMm.height).toBeGreaterThan(0);
  });

  test("ignores hidden format characters inside analyzed letter tokens", { timeout: 15000 }, () => {
    const base = analyzeLayout({
      text: "j",
      widthMm: 30,
      heightMm: 30,
      backingMm: 3.1,
      weldExportedDesign: false,
      letters: [
        {
          character: "j",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 10,
          y: 22,
        },
      ],
    });

    const hidden = analyzeLayout({
      text: "j",
      widthMm: 30,
      heightMm: 30,
      backingMm: 3.1,
      weldExportedDesign: false,
      letters: [
        {
          character: "\u200Bj",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 10,
          y: 22,
        },
      ],
    });

    expect(hidden.facePath).toBe(base.facePath);
    expect(hidden.faceBoundsMm).toEqual(base.faceBoundsMm);
  });

  test("preserves utf-8 smart punctuation in analyzed payloads", { timeout: 15000 }, () => {
    const analysis = analyzeLayout({
      text: "That’s",
      widthMm: 40,
      heightMm: 20,
      backingMm: 3.1,
      weldExportedDesign: false,
      letters: [
        {
          character: "T",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 2,
          y: 16,
        },
        {
          character: "h",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 9,
          y: 16,
        },
        {
          character: "a",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 14,
          y: 16,
        },
        {
          character: "t",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 19,
          y: 16,
        },
        {
          character: "’",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 24,
          y: 16,
        },
        {
          character: "s",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 26,
          y: 16,
        },
      ],
    });

    expect(analysis.text).toBe("That’s");
    expect(analysis.facePath).not.toContain("â");
  });

  test("reuses precomputed export geometry without rebuilding outlines", () => {
    const svg = exportSvg({
      text: "Cached",
      widthMm: 40,
      heightMm: 20,
      colorName: "Red",
      quantity: "2",
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
    expect(svg).toContain('height="71.562mm"');
    expect(svg).toContain('id="order-1-copy-1-name-group" transform="translate(0 0.000)"');
    expect(svg).toContain('id="order-1-copy-1-backing-border" d="M20 0 L30 0 L30 10 Z" transform="translate(50.000 0.000)"');
    expect(svg).toContain('id="order-1-copy-2-name-group" transform="translate(0 51.562)"');
    expect(svg).toContain('id="order-1-copy-2-backing-border" d="M20 0 L30 0 L30 10 Z" transform="translate(50.000 51.562)"');
    expect(svg).toContain('id="order-1-copy-1-color-label"');
    expect(svg).toContain('font-family="Arial"');
    expect(svg).toContain(">Red</text>");
  });

  test("stacks batch exports on a 2.03 inch start-to-start pitch", () => {
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
          colorName: "Sage Green",
          quantity: "2",
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
          colorName: "Red",
          quantity: "1",
        },
      ],
    });

    expect(svg).toContain('height="123.124mm"');
    expect(svg).toContain('id="order-1-copy-1-name-group" transform="translate(0 0.000)"');
    expect(svg).toContain('id="order-1-copy-2-name-group" transform="translate(0 51.562)"');
    expect(svg).toContain('id="order-2-copy-1-name-group" transform="translate(0 103.124)"');
    expect(svg).toContain('id="order-2-copy-1-backing-border" d="M20 0 L30 0 L30 10 Z" transform="translate(50.000 103.124)"');
    expect(svg).toContain(">Sage Green</text>");
    expect(svg).toContain(">Red</text>");
  });
});
