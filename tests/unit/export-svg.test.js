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

function runPythonSnippet(source) {
  const args = process.env.PYTHON
    ? ["-c", source]
    : process.platform === "win32"
      ? ["-3.11", "-c", source]
      : ["-c", source];
  const result = spawnSync(pythonCommand, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "python snippet failed");
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

  test("switches exported face geometry between welded and direct outlines", { timeout: 30000 }, () => {
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

  test("uses gentler one-pass smoothing for standard backing borders", { timeout: 30000 }, () => {
    const layout = {
      text: "MOM",
      widthMm: 60,
      heightMm: 30,
      backingMm: 3.1,
      letters: [
        {
          character: "M",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 4,
          y: 22,
        },
        {
          character: "O",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 16,
          y: 22,
        },
        {
          character: "M",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          x: 28,
          y: 22,
        },
      ],
    };

    const standard = analyzeLayout(layout);
    const onePass = analyzeLayout({
      ...layout,
      traceProfileOverrides: {
        backingSmoothIterations: 1,
      },
    });
    const twoPass = analyzeLayout({
      ...layout,
      traceProfileOverrides: {
        backingSmoothIterations: 2,
      },
    });

    expect(standard.backingEngine).toBe("shapely");
    expect(onePass.backingEngine).toBe("shapely");
    expect(twoPass.backingEngine).toBe("shapely");
    expect(standard.backingPath).toBe(onePass.backingPath);
    expect(standard.backingPath).toBe(twoPass.backingPath);
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

  test("keeps vertically stretched backing border at its physical size", { timeout: 30000 }, () => {
    const analysis = analyzeLayout({
      text: "T",
      widthMm: 60,
      heightMm: 60,
      backingMm: 3.1,
      letters: [
        {
          character: "T",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 20,
          horizontalScale: 1,
          verticalScale: 1.35,
          x: 20,
          y: 35,
        },
      ],
    });

    const face = pathBounds(analysis.exportFacePath);
    const backing = pathBounds(analysis.backingPath);

    expect(Math.abs(face.top - backing.top - 3.1)).toBeLessThanOrEqual(0.12);
    expect(Math.abs(backing.bottom - face.bottom - 3.1)).toBeLessThanOrEqual(0.12);
  });

  test("uses Shapely backing offset for unscaled text geometry", { timeout: 30000 }, () => {
    const analysis = analyzeLayout({
      text: "III",
      widthMm: 90,
      heightMm: 80,
      backingMm: 3.1,
      weldExportedDesign: true,
      letters: [
        {
          character: "I",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 48,
          x: 8,
          y: 62,
        },
        {
          character: "I",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 48,
          x: 32,
          y: 62,
        },
        {
          character: "I",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 48,
          x: 56,
          y: 62,
        },
      ],
    });

    expect(analysis.backingEngine).toBe("shapely");
    expect(analysis.backingPath).not.toContain("Q");
  });
  test("keeps stretched backing offset as solid polylines instead of smoothing into curves", { timeout: 30000 }, () => {
    const analysis = analyzeLayout({
      text: "O",
      widthMm: 80,
      heightMm: 80,
      backingMm: 3.1,
      letters: [
        {
          character: "O",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 48,
          horizontalScale: 1,
          verticalScale: 1.35,
          x: 20,
          y: 60,
        },
      ],
    });

    expect(analysis.backingEngine).toBe("shapely");
    expect(analysis.backingPath).not.toContain("Q");
    expect(countPathCommands(analysis.backingPath, "M")).toBe(1);
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

  test("keeps horizontally stretched backing anchored to the glyph origin", { timeout: 15000 }, () => {
    const baseLayout = {
      text: "S",
      widthMm: 25,
      heightMm: 25,
      backingMm: 3.1,
      letters: [
        {
          character: "S",
          fontId: "candlepin",
          fontPath: "public/fonts/Candlepin-Laser.otf",
          fontSizeMm: 18,
          horizontalScale: 1,
          verticalScale: 1,
          x: 5,
          y: 18,
        },
      ],
    };

    const base = pathBounds(analyzeLayout(baseLayout).backingPath);
    const stretched = pathBounds(analyzeLayout({
      ...baseLayout,
      letters: [
        {
          ...baseLayout.letters[0],
          horizontalScale: 1.25,
        },
      ],
    }).backingPath);

    expect(stretched.left).toBeLessThanOrEqual(base.left + 0.01);
    expect(stretched.right).toBeGreaterThan(base.right);
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
      fixedSvgs: [
        {
          id: "nurse-cross",
          name: "Nurse Cross",
          svgText: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 20 10\"><path id=\"cross-mark\" d=\"M8 0 H12 V4 H20 V6 H12 V10 H8 V6 H0 V4 H8 Z\"/></svg>",
          xMm: 17,
          yMm: 4,
          widthMm: 16,
          heightMm: 8,
        },
      ],
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
    expect(svg).toContain('width="206.248mm"');
    expect(svg).toContain('height="103.124mm"');
    expect(svg).toContain('id="order-1-copy-1-mirror-name-group" transform="translate(45.781 15.781) scale(-1 1)"');
    expect(svg).toContain('id="order-1-copy-1-name-group" transform="translate(57.343 15.781)"');
    expect(svg).toContain('id="order-1-copy-1-fixed-svg-nurse-cross"');
    expect(svg).toContain('transform="translate(74.343 19.781) scale(0.800000 0.800000)"');
    expect(svg).toContain('id="cross-mark"');
    expect(svg).toContain('id="order-1-copy-1-mirror-backing-border" d="M20 0 L30 0 L30 10 Z" transform="translate(148.905 15.781) scale(-1 1)"');
    expect(svg).not.toContain('id="order-1-copy-1-backing-border"');
    expect(svg).toContain('id="order-1-copy-2-mirror-name-group" transform="translate(45.781 67.343) scale(-1 1)"');
    expect(svg).toContain('id="order-1-copy-2-name-group" transform="translate(57.343 67.343)"');
    expect(svg).toContain('id="order-1-copy-2-fixed-svg-nurse-cross"');
    expect(svg).toContain('transform="translate(74.343 71.343) scale(0.800000 0.800000)"');
    expect(svg).toContain('id="order-1-copy-2-mirror-backing-border" d="M20 0 L30 0 L30 10 Z" transform="translate(148.905 67.343) scale(-1 1)"');
    expect(svg).toContain('id="order-1-copy-1-color-label"');
    expect(svg).toContain('font-family="Arial"');
    expect(svg).toContain(">Red</text>");
  });

  test("analyzes fixed SVG backing borders into reusable vector paths", () => {
    const analysis = analyzeLayout({
      text: "",
      widthMm: 40,
      heightMm: 24,
      backingMm: 3.1,
      letters: [],
      fixedSvgs: [
        {
          id: "badge-star",
          name: "Badge Star",
          svgText: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M10 0 L12 8 L20 8 L13 12 L16 20 L10 15 L4 20 L7 12 L0 8 L8 8 Z"/></svg>`,
          xMm: 8,
          yMm: 4,
          widthMm: 12,
          heightMm: 12,
          backingBorder: true,
          backingMm: 3.1,
        },
      ],
    });

    expect(analysis.fixedSvgBackingPaths).toEqual([
      expect.objectContaining({
        id: "badge-star",
        path: expect.stringMatching(/^M/),
      }),
    ]);
    expect(analysis.fixedSvgBackingPaths[0].path).toContain("Q");
  });
  test("traces fixed SVG backing across smooth curves without clipping at layout edges", () => {
    const analysis = analyzeLayout({
      text: "",
      widthMm: 20,
      heightMm: 20,
      backingMm: 3,
      letters: [],
      fixedSvgs: [
        {
          id: "smooth-edge",
          name: "Smooth Edge",
          svgText: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M1 10 C4 0 8 0 10 10 S16 20 19 10 Q19 4 12 2 T1 10 Z"/></svg>`,
          xMm: 0,
          yMm: 0,
          widthMm: 20,
          heightMm: 20,
          backingBorder: true,
          backingMm: 3,
        },
      ],
    });

    const backingPath = analysis.fixedSvgBackingPaths[0]?.path || "";
    const bounds = pathBounds(backingPath);

    expect(backingPath).toContain("Q");
    expect(bounds.left).toBeLessThan(0);
    expect(bounds.top).toBeLessThan(0);
    expect(bounds.right).toBeGreaterThan(20);
    expect(bounds.bottom).toBeGreaterThan(20);
  });

  test("exports backing borders for fixed SVG artwork when enabled", () => {
    const svg = exportSvg({
      text: "Fixed Border",
      widthMm: 40,
      heightMm: 20,
      fixedSvgs: [
        {
          id: "badge-star",
          name: "Badge Star",
          svgText: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path id="star-path" d="M10 0 L12 8 L20 8 L13 12 L16 20 L10 15 L4 20 L7 12 L0 8 L8 8 Z"/></svg>`,
          xMm: 8,
          yMm: 4,
          widthMm: 12,
          heightMm: 12,
          backingBorder: true,
          backingMm: 3,
        },
      ],
      analysis: {
        exportFacePath: "M0 0 L10 0 L10 10 Z",
        backingPath: "M20 0 L30 0 L30 10 Z",
        connectedComponentCount: 1,
      },
    });

    expect(svg).toContain('id="order-1-copy-1-fixed-svg-badge-star"');
    expect(svg).toContain('id="order-1-copy-1-mirror-fixed-svg-badge-star-backing-border"');
    expect(svg).not.toContain('d="M8.000 1.000 H20.000 Q23.000 1.000 23.000 4.000 V16.000 Q23.000 19.000 20.000 19.000 H8.000 Q5.000 19.000 5.000 16.000 V4.000 Q5.000 1.000 8.000 1.000 Z"');
    expect(svg).toMatch(/fixed-svg-badge-star-backing-border" d="[^"]*Q/);
    expect(svg).toContain('transform="translate(148.905 15.781) scale(-1 1)"');
  });

  test("sanitizes fixed SVG vector markup before export", () => {
    const svg = exportSvg({
      text: "Safe",
      widthMm: 40,
      heightMm: 20,
      fixedSvgs: [
        {
          id: "unsafe-art",
          name: "Unsafe Art",
          svgText: `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" onload="alert(1)">
              <style>path { fill: url(javascript:alert(1)); }</style>
              <g onclick="alert(2)" style="fill: url(https://evil.example/pattern.svg); stroke: blue">
                <script>alert(3)</script>
                <foreignObject><div>html</div></foreignObject>
                <image href="https://evil.example/pixel.png" />
                <path id="safe-path" d="M0 0 H20 V10 Z" fill="blue" stroke="green" onmouseover="alert(4)" />
              </g>
            </svg>`,
          xMm: 1,
          yMm: 2,
          widthMm: 20,
          heightMm: 10,
        },
      ],
      analysis: {
        exportFacePath: "M0 0 L10 0 L10 10 Z",
        backingPath: "M20 0 L30 0 L30 10 Z",
        connectedComponentCount: 1,
      },
    });

    expect(svg).toContain('id="safe-path"');
    expect(svg).not.toMatch(/script/i);
    expect(svg).not.toMatch(/foreignObject/i);
    expect(svg).not.toMatch(/<style/i);
    expect(svg).not.toMatch(/<image/i);
    expect(svg).not.toMatch(/\son[a-z]+=/i);
    expect(svg).not.toMatch(/javascript:/i);
    expect(svg).not.toMatch(/url\(/i);
    expect(svg).not.toContain('fill="blue"');
    expect(svg).not.toContain('stroke="green"');
    expect(svg).not.toContain('style=');
    expect(svg).toContain('fill="rgb(255, 0, 0)" stroke="none"');
  });

  test("skips fixed SVG public URLs that are not allowed for server-side fetch", () => {
    const svg = exportSvg({
      text: "Urls",
      widthMm: 40,
      heightMm: 20,
      fixedSvgs: [
        {
          id: "plain-http",
          name: "Plain HTTP",
          publicUrl: "http://127.0.0.1:9/internal.svg",
          xMm: 1,
          yMm: 2,
          widthMm: 20,
          heightMm: 10,
        },
        {
          id: "internal-https",
          name: "Internal HTTPS",
          publicUrl: "https://127.0.0.1/internal.svg",
          xMm: 1,
          yMm: 2,
          widthMm: 20,
          heightMm: 10,
        },
      ],
      analysis: {
        exportFacePath: "M0 0 L10 0 L10 10 Z",
        backingPath: "M20 0 L30 0 L30 10 Z",
        connectedComponentCount: 1,
      },
    });

    expect(svg).not.toContain("fixed-svg-plain-http");
    expect(svg).not.toContain("fixed-svg-internal-https");
  });

  test("rejects fixed SVG redirects before following them", () => {
    const stdout = runPythonSnippet(`
import urllib.error
import urllib.request
from email.message import Message
from tools.export_svg import FixedSvgNoRedirectHandler

request = urllib.request.Request("https://allowed.example/redirect.svg")
headers = Message()
headers["Location"] = "http://169.254.169.254/latest/meta-data"
try:
    FixedSvgNoRedirectHandler().http_error_302(
        request,
        None,
        302,
        "Found",
        headers,
    )
except urllib.error.HTTPError as error:
    print(f"{error.code} {error.headers.get('Location')}")
else:
    raise SystemExit("redirect was followed")
`);

    expect(stdout.trim()).toBe("302 http://169.254.169.254/latest/meta-data");
  });

  test("preserves rectangular fixed SVG aspect ratio with uniform export scaling", () => {
    const svg = exportSvg({
      text: "Rect",
      widthMm: 40,
      heightMm: 20,
      fixedSvgs: [
        {
          id: "wide-art",
          name: "Wide Art",
          svgText: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 20\"><rect id=\"wide-rect\" width=\"40\" height=\"20\" /></svg>",
          xMm: 4,
          yMm: 5,
          widthMm: 24,
          heightMm: 24,
        },
      ],
      analysis: {
        exportFacePath: "M0 0 L10 0 L10 10 Z",
        backingPath: "M20 0 L30 0 L30 10 Z",
        connectedComponentCount: 1,
      },
    });

    expect(svg).toContain('id="order-1-copy-1-fixed-svg-wide-art"');
    expect(svg).toContain('transform="translate(4.000 5.000) scale(0.600000 0.600000)"');
    expect(svg).toContain('id="wide-rect"');
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

    expect(svg).toContain('height="154.686mm"');
    expect(svg).toContain('width="206.248mm"');
    expect(svg).toContain('id="order-1-copy-1-mirror-name-group" transform="translate(45.781 15.781) scale(-1 1)"');
    expect(svg).toContain('id="order-1-copy-1-name-group" transform="translate(57.343 15.781)"');
    expect(svg).toContain('id="order-1-copy-2-mirror-name-group" transform="translate(45.781 67.343) scale(-1 1)"');
    expect(svg).toContain('id="order-1-copy-2-name-group" transform="translate(57.343 67.343)"');
    expect(svg).toContain('id="order-2-copy-1-mirror-name-group" transform="translate(45.781 118.905) scale(-1 1)"');
    expect(svg).toContain('id="order-2-copy-1-name-group" transform="translate(57.343 118.905)"');
    expect(svg).toContain('id="order-2-copy-1-mirror-backing-border" d="M20 0 L30 0 L30 10 Z" transform="translate(148.905 118.905) scale(-1 1)"');
    expect(svg).toContain(">Sage Green</text>");
    expect(svg).toContain(">Red</text>");
  });

  test("centers batch export items in fixed-width text backing and color columns", () => {
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
        },
        {
          text: "Second",
          widthMm: 30,
          heightMm: 20,
          analysis: {
            exportFacePath: "M0 0 L10 0 L10 10 Z",
            backingPath: "M20 0 L30 0 L30 10 Z",
            connectedComponentCount: 1,
          },
          colorName: "Red",
        },
      ],
    });

    expect(svg).toContain('width="206.248mm"');
    expect(svg).toContain('height="103.124mm"');
    expect(svg).toContain('id="order-1-copy-1-mirror-name-group" transform="translate(45.781 15.781) scale(-1 1)"');
    expect(svg).toContain('id="order-1-copy-1-name-group" transform="translate(57.343 15.781)"');
    expect(svg).toContain('id="order-1-copy-1-mirror-backing-border" d="M20 0 L30 0 L30 10 Z" transform="translate(148.905 15.781) scale(-1 1)"');
    expect(svg).toContain('id="order-2-copy-1-mirror-name-group" transform="translate(40.781 67.343) scale(-1 1)"');
    expect(svg).toContain('id="order-2-copy-1-name-group" transform="translate(62.343 67.343)"');
    expect(svg).toContain('id="order-2-copy-1-mirror-backing-border" d="M20 0 L30 0 L30 10 Z" transform="translate(143.905 67.343) scale(-1 1)"');
    expect(svg).toContain('id="order-1-copy-1-color-label" x="180.467" y="25.781"');
    expect(svg).toContain('id="order-2-copy-1-color-label" x="180.467" y="77.343"');
    expect(svg).toContain('font-size="9.000mm"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('dominant-baseline="middle"');
  });
});
