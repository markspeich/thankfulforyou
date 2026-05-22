import { expect, test } from "playwright/test";

test.describe.configure({ mode: "serial" });

function completeButton(page) {
  return page.locator("#captureButton");
}

function completeAndNextButton(page) {
  return page.locator("#completeNextButton");
}

function queueToolsToggle(page) {
  return page.locator(".queue-tools-toggle");
}

async function openQueueTools(page) {
  const menu = page.locator(".queue-tools-menu");
  if (await menu.evaluate((node) => node.hasAttribute("open"))) {
    return;
  }

  await queueToolsToggle(page).click();
  await expect(menu).toHaveAttribute("open", "");
}

async function clickQueueAction(page, name) {
  await openQueueTools(page);
  await page.getByRole("button", { name }).click();
}

async function completeDesign(page, queueLabel) {
  const row = page.locator("#orderList .order-row").filter({ hasText: queueLabel });

  await completeButton(page).click();
  await expect(row).toContainText("Complete");
  await expect.poll(async () => {
    return row.locator(".order-analysis-indicator.ok, .order-analysis-indicator.warning").count();
  }, { timeout: 20000 }).toBe(1);
}

function buildMockAnalysisResponse(overrides = {}) {
  return {
    isConnected: true,
    connectedComponentCount: 1,
    facePath: "M0 0 L10 0 L10 10 L0 10 Z",
    exportFacePath: "M0 0 L10 0 L10 10 L0 10 Z",
    backingPath: "M-1 -1 L11 -1 L11 11 L-1 11 Z",
    faceBoundsMm: {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    },
    ...overrides,
  };
}

async function measureVisibleTextBounds(page) {
  return page.evaluate(async () => {
    const guide = document.querySelector("#preview .preview-guide-box");
    const face = document.querySelector("#preview .face-layer");
    if (!(guide instanceof SVGRectElement) || !face) {
      return null;
    }

    const guideX = Number(guide.getAttribute("x"));
    const guideY = Number(guide.getAttribute("y"));
    const guideWidthMm = Number(guide.getAttribute("width"));
    const guideHeightMm = Number(guide.getAttribute("height"));
    let textLeftMm = 0;
    let textRightMm = 0;
    let textTopMm = 0;
    let textBottomMm = 0;

    if (face instanceof SVGPathElement) {
      const faceRect = face.getBoundingClientRect();
      const guideRect = guide.getBoundingClientRect();
      const scaleX = guideWidthMm / guideRect.width;
      const scaleY = guideHeightMm / guideRect.height;

      textLeftMm = guideX + (faceRect.left - guideRect.left) * scaleX;
      textRightMm = guideX + (faceRect.right - guideRect.left) * scaleX;
      textTopMm = guideY + (faceRect.top - guideRect.top) * scaleY;
      textBottomMm = guideY + (faceRect.bottom - guideRect.top) * scaleY;
    } else if (face instanceof SVGImageElement) {
      const href = face.getAttribute("href");
      const imageWidthMm = Number(face.getAttribute("width"));
      const imageHeightMm = Number(face.getAttribute("height"));
      const imageX = Number(face.getAttribute("x"));
      const imageY = Number(face.getAttribute("y"));
      const image = new Image();
      image.src = href;
      await image.decode();

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);

      let minX = width;
      let maxX = -1;
      let minY = height;
      let maxY = -1;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const alpha = data[(y * width + x) * 4 + 3];
          if (alpha <= 32) {
            continue;
          }

          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }

      textLeftMm = imageX + (minX / width) * imageWidthMm;
      textRightMm = imageX + ((maxX + 1) / width) * imageWidthMm;
      textTopMm = imageY + (minY / height) * imageHeightMm;
      textBottomMm = imageY + ((maxY + 1) / height) * imageHeightMm;
    } else {
      return null;
    }

    return {
      guideWidthMm,
      guideHeightMm,
      textWidthMm: textRightMm - textLeftMm,
      textHeightMm: textBottomMm - textTopMm,
      deltaX: (textLeftMm + textRightMm) / 2 - (guideX + guideWidthMm / 2),
      deltaY: (textTopMm + textBottomMm) / 2 - (guideY + guideHeightMm / 2),
    };
  });
}

test.beforeEach(async ({ page }) => {
  async function waitForStartup() {
    await expect.poll(async () => {
      const value = await page.locator("#importStatus").textContent();
      return value === null
        || value === ""
        || value.includes("Restored");
    }).toBe(true);
  }

  await page.goto("/");
  await waitForStartup();
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.reload();
  await waitForStartup();

  const orderCount = page.locator("#orderCountOutput");

  if ((await orderCount.textContent()) !== "0") {
    page.once("dialog", (dialog) => dialog.accept());
    await clickQueueAction(page, "Clear Batch");
    await expect(orderCount).toHaveText("0");
  }

  await clickQueueAction(page, "Add Design");
});

test("shows the production defaults", async ({ page }) => {
  await expect(page.locator("#globalHorizontalScaleInput")).toHaveValue("1");
  await expect(page.locator("#globalHorizontalScaleInput")).toHaveAttribute("max", "2");
  await expect(page.locator("#globalHorizontalScaleOutput")).toHaveText("100%");
  await expect(page.locator("#globalVerticalScaleInput")).toHaveValue("1");
  await expect(page.locator("#globalVerticalScaleInput")).toHaveAttribute("max", "1.5");
  await expect(page.locator("#globalVerticalScaleOutput")).toHaveText("100%");
  await expect(page.locator("#backingInput")).toHaveValue("2.2");
  await expect(page.locator("#backingInput")).toHaveAttribute("min", "0");
  await expect(page.locator("#backingInput")).toHaveAttribute("step", "0.1");
  await expect(page.locator("#backingOutput")).toHaveText("2.2 mm");
  await expect(page.locator("#weldExportedDesignInput")).toBeChecked();
  await expect(page.locator("#preview .preview-guide-label").first()).toHaveText('2.2"');
  await expect(page.locator("#preview circle.preview-guide-box")).toHaveCount(1);

  const guideMetrics = await page.evaluate(() => {
    const guide = document.querySelector("#preview rect.preview-guide-box");
    const circle = document.querySelector("#preview circle.preview-guide-box");
    const labels = Array.from(document.querySelectorAll("#preview .preview-guide-label"));
    if (!(guide instanceof SVGRectElement) || !(circle instanceof SVGCircleElement) || labels.length !== 2) {
      return null;
    }

    return {
      guideCenterX: Number(guide.getAttribute("x")) + Number(guide.getAttribute("width")) / 2,
      guideCenterY: Number(guide.getAttribute("y")) + Number(guide.getAttribute("height")) / 2,
      circleCenterX: Number(circle.getAttribute("cx")),
      circleCenterY: Number(circle.getAttribute("cy")),
      circleDiameter: Number(circle.getAttribute("r")) * 2,
      labelFills: labels.map((label) => window.getComputedStyle(label).fill),
    };
  });

  expect(guideMetrics.guideCenterX).toBeCloseTo(guideMetrics.circleCenterX, 6);
  expect(guideMetrics.guideCenterY).toBeCloseTo(guideMetrics.circleCenterY, 6);
  expect(guideMetrics.circleDiameter).toBeCloseTo(1.25 * 25.4, 6);
  expect(guideMetrics.labelFills).toEqual(["rgb(12, 150, 217)", "rgb(12, 150, 217)"]);
});

test("applies the global horizontal stretch slider to every line and persists the result", async ({ page }) => {
  await page.locator("#textInput").fill("Savannah\nRN");

  const firstLineHorizontalStretch = page.locator('.line-control-card[data-line-index="0"] [data-setting="horizontalScale"]');
  const secondLineHorizontalStretch = page.locator('.line-control-card[data-line-index="1"] [data-setting="horizontalScale"]');
  const globalHorizontalStretch = page.locator("#globalHorizontalScaleInput");
  const globalHorizontalStretchOutput = page.locator("#globalHorizontalScaleOutput");

  await firstLineHorizontalStretch.fill("1.12");
  await expect(globalHorizontalStretchOutput).toHaveText("Mixed");

  await globalHorizontalStretch.fill("2");

  await expect(globalHorizontalStretchOutput).toHaveText("200%");
  await expect(firstLineHorizontalStretch).toHaveValue("2");
  await expect(secondLineHorizontalStretch).toHaveValue("2");

  await page.waitForTimeout(250);
  await page.reload();

  await expect(page.locator("#textInput")).toHaveValue("Savannah\nRN");
  await expect(globalHorizontalStretchOutput).toHaveText("200%");
  await expect(firstLineHorizontalStretch).toHaveValue("2");
  await expect(secondLineHorizontalStretch).toHaveValue("2");
});

test("applies the global vertical stretch slider to every line and persists the result", async ({ page }) => {
  await page.locator("#textInput").fill("Savannah\nRN");

  const firstLineVerticalStretch = page.locator('.line-control-card[data-line-index="0"] [data-setting="verticalScale"]');
  const secondLineVerticalStretch = page.locator('.line-control-card[data-line-index="1"] [data-setting="verticalScale"]');
  const globalVerticalStretch = page.locator("#globalVerticalScaleInput");
  const globalVerticalStretchOutput = page.locator("#globalVerticalScaleOutput");

  await firstLineVerticalStretch.fill("1.12");
  await expect(globalVerticalStretchOutput).toHaveText("Mixed");

  await globalVerticalStretch.fill("1.4");

  await expect(globalVerticalStretchOutput).toHaveText("140%");
  await expect(firstLineVerticalStretch).toHaveValue("1.4");
  await expect(secondLineVerticalStretch).toHaveValue("1.4");

  await page.waitForTimeout(250);
  await page.reload();

  await expect(page.locator("#textInput")).toHaveValue("Savannah\nRN");
  await expect(globalVerticalStretchOutput).toHaveText("140%");
  await expect(firstLineVerticalStretch).toHaveValue("1.4");
  await expect(secondLineVerticalStretch).toHaveValue("1.4");
});

test("coalesces rapid slider input into a single deferred preview rebuild", async ({ page }) => {
  await page.addInitScript(() => {
    const originalToDataUrl = HTMLCanvasElement.prototype.toDataURL;
    let toDataUrlCount = 0;

    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      toDataUrlCount += 1;
      return originalToDataUrl.apply(this, args);
    };

    window.__previewPerf = {
      read() {
        return { toDataUrlCount };
      },
      reset() {
        toDataUrlCount = 0;
      },
    };
  });

  await page.reload();

  const orderCount = page.locator("#orderCountOutput");
  if ((await orderCount.textContent()) !== "0") {
    page.once("dialog", (dialog) => dialog.accept());
    await clickQueueAction(page, "Clear Batch");
    await expect(orderCount).toHaveText("0");
  }

  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Savannah\nRN");
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__previewPerf.reset());

  await page.evaluate(async () => {
    const slider = document.querySelector('.line-control-card[data-line-index="0"] [data-setting="horizontalScale"]');
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error("Expected the first line horizontal stretch slider.");
    }

    for (const value of ["1.05", "1.1", "1.2", "1.35"]) {
      slider.value = value;
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }

    await new Promise((resolve) => window.setTimeout(resolve, 300));
  });

  const perf = await page.evaluate(() => window.__previewPerf.read());
  expect(perf.toDataUrlCount).toBeLessThanOrEqual(6);
  await expect(page.locator('.line-control-card[data-line-index="0"] [data-setting="horizontalScale"]')).toHaveValue("1.35");
});

test("avoids redundant preview image encodes during a settled slider render", async ({ page }) => {
  await page.addInitScript(() => {
    const originalToDataUrl = HTMLCanvasElement.prototype.toDataURL;
    let toDataUrlCount = 0;

    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      toDataUrlCount += 1;
      return originalToDataUrl.apply(this, args);
    };

    window.__previewPerf = {
      read() {
        return { toDataUrlCount };
      },
      reset() {
        toDataUrlCount = 0;
      },
    };
  });

  await page.reload();

  const orderCount = page.locator("#orderCountOutput");
  if ((await orderCount.textContent()) !== "0") {
    page.once("dialog", (dialog) => dialog.accept());
    await clickQueueAction(page, "Clear Batch");
    await expect(orderCount).toHaveText("0");
  }

  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Savannah\nRN");
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__previewPerf.reset());

  await page.evaluate(async () => {
    const slider = document.querySelector('.line-control-card[data-line-index="0"] [data-setting="horizontalScale"]');
    if (!(slider instanceof HTMLInputElement)) {
      throw new Error("Expected the first line horizontal stretch slider.");
    }

    slider.value = "1.35";
    slider.dispatchEvent(new Event("input", { bubbles: true }));

    await new Promise((resolve) => window.setTimeout(resolve, 300));
  });

  const perf = await page.evaluate(() => window.__previewPerf.read());
  expect(perf.toDataUrlCount).toBeLessThanOrEqual(3);
});

test("refines auto-fit against the rendered face ink bounds", async ({ page }) => {
  await page.locator("#textInput").fill("PT\nCyndie");
  await page.locator("#presetInput").selectOption("skywalk-candlepin");

  const bounds = await measureVisibleTextBounds(page);

  expect(bounds).not.toBeNull();
  expect(bounds.textHeightMm).toBeGreaterThan(bounds.guideHeightMm - 0.25);
  expect(bounds.textHeightMm).toBeLessThanOrEqual(bounds.guideHeightMm);
});

test("keeps the queue sync status hidden until there is a message", async ({ page }) => {
  await expect(page.locator("#queueSyncStatus")).toBeHidden();
  await expect(page.locator("#orderSearchInput")).toBeVisible();
});

test("keeps the preview title above the scrollable pane", async ({ page }) => {
  const previewPanel = page.locator(".preview-panel");
  const previewTitle = page.locator(".preview-title");

  const layout = await page.evaluate(() => {
    const panel = document.querySelector(".preview-panel");
    const title = document.querySelector(".preview-title");
    if (!(panel instanceof HTMLElement) || !(title instanceof HTMLElement)) {
      return null;
    }

    const panelRect = panel.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();

    return {
      panelContainsTitle: panel.contains(title),
      titleBottom: titleRect.bottom,
      panelTop: panelRect.top,
    };
  });

  expect(layout).not.toBeNull();
  expect(layout.panelContainsTitle).toBe(false);
  expect(layout.titleBottom).toBeLessThanOrEqual(layout.panelTop);

  await previewPanel.hover();
  await page.mouse.wheel(0, -800);

  const afterZoom = await page.evaluate(() => {
    const panel = document.querySelector(".preview-panel");
    const title = document.querySelector(".preview-title");
    if (!(panel instanceof HTMLElement) || !(title instanceof HTMLElement)) {
      return null;
    }

    const panelRect = panel.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();

    return {
      titleBottom: titleRect.bottom,
      panelTop: panelRect.top,
    };
  });

  expect(afterZoom).not.toBeNull();
  expect(afterZoom.titleBottom).toBeLessThanOrEqual(afterZoom.panelTop);
  await expect(previewTitle).toHaveText("Preview");
});

test("uses the refined desktop B1 workspace proportions", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });

  const layout = await page.evaluate(() => {
    const workspace = document.querySelector(".production-workspace");
    const queue = document.querySelector(".orders-panel");
    const topCard = document.querySelector(".editor-top-card");
    const editorWorkspace = document.querySelector(".editor-workspace");
    const previewWorkspace = document.querySelector(".preview-workspace");
    const lineRail = document.querySelector(".line-controls-rail");
    const previewPanel = document.querySelector(".preview-panel");
    const queueMenu = document.querySelector(".queue-tools-menu");
    const stats = Array.from(document.querySelectorAll(".order-stats > div"));
    const rect = (node) => {
      if (!(node instanceof HTMLElement)) {
        return null;
      }

      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height, top: box.top, left: box.left };
    };

    return {
      workspace: rect(workspace),
      queue: rect(queue),
      topCard: rect(topCard),
      editorWorkspace: rect(editorWorkspace),
      previewWorkspace: rect(previewWorkspace),
      lineRail: rect(lineRail),
      previewPanel: rect(previewPanel),
      hasQueueMenu: queueMenu instanceof HTMLElement,
      visibleStatCount: stats.length,
    };
  });

  expect(layout.workspace).not.toBeNull();
  expect(layout.queue.width / layout.workspace.width).toBeGreaterThan(0.24);
  expect(layout.queue.width / layout.workspace.width).toBeLessThan(0.31);
  expect(layout.previewWorkspace.width).toBeGreaterThan(layout.lineRail.width);
  expect(layout.previewPanel.height).toBeGreaterThan(420);
  expect(layout.visibleStatCount).toBe(2);
  expect(layout.hasQueueMenu).toBe(true);
});

test("keeps additional line control groups reachable in the right-side inspector", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator("#textInput").fill("DPT\nRN\nBSN");

  const lineTitles = page.locator(".line-control-title");
  await expect(lineTitles).toHaveCount(3);
  await expect(lineTitles.nth(2)).toHaveText("Line 3");

  const inspector = page.locator("#lineControls");
  const beforeScrollTop = await inspector.evaluate((node) => node.scrollTop);
  await lineTitles.nth(2).scrollIntoViewIfNeeded();
  await expect(lineTitles.nth(2)).toBeVisible();
  await expect.poll(async () => {
    return inspector.evaluate((node) => node.scrollTop);
  }).toBeGreaterThanOrEqual(beforeScrollTop);

  const inspectorMetrics = await inspector.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    overflowY: getComputedStyle(node).overflowY,
  }));

  expect(inspectorMetrics.overflowY).toBe("auto");
  expect(inspectorMetrics.scrollHeight).toBeGreaterThanOrEqual(inspectorMetrics.clientHeight);
});

test("keeps wheel zoom without rendering floating zoom controls", async ({ page }) => {
  await expect(page.locator(".zoom-controls")).toHaveCount(0);
  await expect(page.locator("#zoomOutButton")).toHaveCount(0);
  await expect(page.locator("#zoomInButton")).toHaveCount(0);
  await expect(page.locator("#zoomResetButton")).toHaveCount(0);
  await expect(page.locator("#zoomOutput")).toHaveCount(0);

  const previewPanel = page.locator(".preview-panel");
  const previewSizeBefore = await page.locator("#preview").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
    };
  });

  await previewPanel.hover();
  await page.mouse.wheel(0, -500);

  await expect.poll(async () => {
    return page.locator("#preview").evaluate((element) => element.getBoundingClientRect().width);
  }).toBeGreaterThan(previewSizeBefore.width);

  const previewSizeAfter = await page.locator("#preview").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
    };
  });

  expect(previewSizeAfter.height).toBeGreaterThan(previewSizeBefore.height);
});

test("pans the preview with middle-click drag", async ({ page }) => {
  const previewPanel = page.locator(".preview-panel");

  await previewPanel.hover();
  await page.mouse.wheel(0, -1000);

  const panelBox = await previewPanel.boundingBox();
  expect(panelBox).not.toBeNull();

  const beforePan = await previewPanel.evaluate((element) => ({
    cursor: window.getComputedStyle(element).cursor,
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  }));

  const startX = panelBox.x + (panelBox.width * 0.65);
  const startY = panelBox.y + (panelBox.height * 0.65);

  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: "middle" });

  await expect.poll(async () => {
    return previewPanel.evaluate((element) => window.getComputedStyle(element).cursor);
  }).toBe("grabbing");

  await page.mouse.move(startX - 120, startY - 90, { steps: 8 });

  await expect.poll(async () => {
    return previewPanel.evaluate((element) => ({
      scrollLeft: element.scrollLeft,
      scrollTop: element.scrollTop,
    }));
  }).not.toEqual({
    scrollLeft: beforePan.scrollLeft,
    scrollTop: beforePan.scrollTop,
  });

  await page.mouse.up({ button: "middle" });

  await expect.poll(async () => {
    return previewPanel.evaluate((element) => window.getComputedStyle(element).cursor);
  }).toBe(beforePan.cursor);
});

test("allows the backing border slider to reach 0 mm", async ({ page }) => {
  await page.locator("#backingInput").fill("0");
  await expect(page.locator("#backingInput")).toHaveValue("0");
  await expect(page.locator("#backingOutput")).toHaveText("0.0 mm");
});

test("renders lock text height inline without its own bordered section", async ({ page }) => {
  await page.locator("#textInput").fill("Savannah\nRN");

  const firstLineLockStyles = await page.locator('.line-control-card[data-line-index="0"] .line-control-toggle').evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      backgroundColor: styles.backgroundColor,
      borderTopWidth: styles.borderTopWidth,
      borderRightWidth: styles.borderRightWidth,
      borderBottomWidth: styles.borderBottomWidth,
      borderLeftWidth: styles.borderLeftWidth,
      paddingTop: styles.paddingTop,
      paddingRight: styles.paddingRight,
      paddingBottom: styles.paddingBottom,
      paddingLeft: styles.paddingLeft,
    };
  });

  expect(firstLineLockStyles).toEqual({
    backgroundColor: "rgba(0, 0, 0, 0)",
    borderTopWidth: "0px",
    borderRightWidth: "0px",
    borderBottomWidth: "0px",
    borderLeftWidth: "0px",
    paddingTop: "0px",
    paddingRight: "0px",
    paddingBottom: "0px",
    paddingLeft: "0px",
  });
});

test("renders the preview guide with thin solid blue outer and inner lines", async ({ page }) => {
  const guideStyles = await page.evaluate(() => {
    const box = document.querySelector("#preview rect.preview-guide-box");
    const circle = document.querySelector("#preview circle.preview-guide-box");
    const innerLines = Array.from(document.querySelectorAll("#preview line.preview-guide-inner-line"));
    if (!(box instanceof SVGRectElement) || !(circle instanceof SVGCircleElement)) {
      return null;
    }

    const boxStyle = window.getComputedStyle(box);
    const circleStyle = window.getComputedStyle(circle);
    const lineStyle = innerLines.length ? window.getComputedStyle(innerLines[0]) : null;
    const verticalLines = innerLines
      .filter((line) => line.getAttribute("x1") === line.getAttribute("x2"))
      .sort((left, right) => Number(left.getAttribute("x1")) - Number(right.getAttribute("x1")));
    const horizontalLines = innerLines
      .filter((line) => line.getAttribute("y1") === line.getAttribute("y2"))
      .sort((top, bottom) => Number(top.getAttribute("y1")) - Number(bottom.getAttribute("y1")));

    return {
      boxStroke: boxStyle.stroke,
      circleStroke: circleStyle.stroke,
      boxDashArray: boxStyle.strokeDasharray,
      circleDashArray: circleStyle.strokeDasharray,
      boxStrokeWidth: boxStyle.strokeWidth,
      circleStrokeWidth: circleStyle.strokeWidth,
      innerLineCount: innerLines.length,
      innerLineStroke: lineStyle?.stroke ?? null,
      innerLineDashArray: lineStyle?.strokeDasharray ?? null,
      innerLineStrokeWidth: lineStyle?.strokeWidth ?? null,
      verticalSpacingMm: verticalLines.length === 2
        ? Number(verticalLines[1].getAttribute("x1")) - Number(verticalLines[0].getAttribute("x1"))
        : null,
      horizontalSpacingMm: horizontalLines.length === 2
        ? Number(horizontalLines[1].getAttribute("y1")) - Number(horizontalLines[0].getAttribute("y1"))
        : null,
    };
  });

  expect(guideStyles.boxStroke).toBe("rgb(12, 150, 217)");
  expect(guideStyles.circleStroke).toBe("rgb(12, 150, 217)");
  expect(guideStyles.boxDashArray).toBe("none");
  expect(guideStyles.circleDashArray).toBe("none");
  expect(guideStyles.boxStrokeWidth).toBe("0.05px");
  expect(guideStyles.circleStrokeWidth).toBe("0.05px");
  expect(guideStyles.innerLineCount).toBe(4);
  expect(guideStyles.innerLineStroke).toBe("rgb(12, 150, 217)");
  expect(guideStyles.innerLineDashArray).toBe("none");
  expect(guideStyles.innerLineStrokeWidth).toBe("0.05px");
  expect(guideStyles.verticalSpacingMm).toBeCloseTo(1.6 * 25.4, 6);
  expect(guideStyles.horizontalSpacingMm).toBeCloseTo(1.1 * 25.4, 6);
});

test("renders the analyzed backing preview in red", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Savannah");
  await completeDesign(page, "Design 1");

  const backingFill = await page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll("#preview path"));
    const backing = paths.find((path) => !path.classList.contains("face-layer"));
    return backing?.getAttribute("fill") ?? null;
  });

  expect(backingFill).toBe("rgb(255, 0, 0)");

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("renders the live backing preview in red while editing", async ({ page }) => {
  await page.locator("#textInput").fill("Savannah");
  await expect(page.locator("#connectionStatusLabel")).not.toHaveText("Analyzing layout...", { timeout: 15000 });

  const backingPixel = await page.evaluate(async () => {
    const backingImage = document.querySelector("#preview image");
    if (!(backingImage instanceof SVGImageElement)) {
      return null;
    }

    const href = backingImage.getAttribute("href");
    if (!href) {
      return null;
    }

    const image = new Image();
    image.src = href;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        if (data[offset + 3] < 240) {
          continue;
        }

        return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
      }
    }

    return null;
  });

  expect(backingPixel).toEqual([255, 0, 0, 255]);
});

test("keeps descenders inside the live face preview image", async ({ page }) => {
  await page.locator("#textInput").fill("Mackenzie");
  await page.locator('.line-control-card[data-line-index="0"] [data-setting="fontSizeMm"]').fill("28");
  await expect(page.locator("#preview .face-layer")).toHaveCount(1);

  const edgeContact = await page.evaluate(async () => {
    const face = document.querySelector("#preview .face-layer");
    if (!(face instanceof SVGImageElement)) {
      return null;
    }

    const href = face.getAttribute("href");
    if (!href) {
      return null;
    }

    const image = new Image();
    image.src = href;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);

    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] <= 32) {
          continue;
        }

        maxY = Math.max(maxY, y);
      }
    }

    return {
      height,
      maxY,
      touchesBottom: maxY === height - 1,
    };
  });

  expect(edgeContact).not.toBeNull();
  expect(edgeContact.touchesBottom).toBe(false);
});

test("keeps text inside the guide and centered for Mark RN", async ({ page }) => {
  await page.locator("#textInput").fill("Mark\nRN");
  await expect(page.locator("#connectionStatusLabel")).not.toHaveText("Analyzing layout...", { timeout: 15000 });

  const metrics = await measureVisibleTextBounds(page);

  expect(metrics.textWidthMm).toBeLessThanOrEqual(metrics.guideWidthMm + 0.01);
  expect(metrics.textHeightMm).toBeLessThanOrEqual(metrics.guideHeightMm + 0.01);
  expect(Math.abs(metrics.deltaX)).toBeLessThanOrEqual(0.05);
  expect(Math.abs(metrics.deltaY)).toBeLessThanOrEqual(0.05);
});

test("keeps a longer two-line layout inside the guide", async ({ page }) => {
  await page.locator("#textInput").fill("Christopher\nMSN RN");
  await expect(page.locator("#connectionStatusLabel")).not.toHaveText("Analyzing layout...", { timeout: 15000 });

  const metrics = await measureVisibleTextBounds(page);

  expect(metrics.textWidthMm).toBeLessThanOrEqual(metrics.guideWidthMm + 0.01);
  expect(metrics.textHeightMm).toBeLessThanOrEqual(metrics.guideHeightMm + 0.01);
});

test("restores the current batch after refresh and clears it when requested", async ({ page }) => {
  await page.locator("#textInput").fill("Savannah\nRN");
  await page.locator("#backingInput").fill("4.2");
  await page.locator("#weldExportedDesignInput").uncheck();
  await expect(page.locator("#orderCountOutput")).toHaveText("1");

  await page.reload();

  await expect(page.locator("#importStatus")).toBeHidden();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 1");
  await expect(page.locator("#textInput")).toHaveValue("Savannah\nRN");
  await expect(page.locator("#backingInput")).toHaveValue("4.2");
  await expect(page.locator("#weldExportedDesignInput")).not.toBeChecked();

  page.once("dialog", (dialog) => dialog.accept());
  await clickQueueAction(page, "Clear Batch");

  await expect(page.locator("#orderCountOutput")).toHaveText("0");
  await expect(page.locator("#importStatus")).toContainText("Batch cleared");
  await expect(page.locator(".editor-panel")).toHaveClass(/is-hidden/);

  await page.reload();

  await expect(page.locator("#orderCountOutput")).toHaveText("0");
  await expect(page.locator("#importStatus")).not.toContainText("Restored");
});

test("keeps the design queue scroll position when selecting a row", async ({ page }) => {
  for (let index = 0; index < 14; index += 1) {
    await clickQueueAction(page, "Add Design");
  }

  await expect(page.locator("#orderCountOutput")).toHaveText("15");

  const queue = page.locator("#orderList");
  const targetRow = page.locator("#orderList .order-row").filter({ hasText: "Design 13" });

  await targetRow.scrollIntoViewIfNeeded();

  const scrollTopBefore = await queue.evaluate((node) => {
    node.scrollTop = Math.max(0, node.scrollTop - 40);
    return node.scrollTop;
  });

  expect(scrollTopBefore).toBeGreaterThan(0);

  await targetRow.getByRole("button").click();

  const scrollTopAfter = await queue.evaluate((node) => node.scrollTop);

  expect(scrollTopAfter).toBeGreaterThan(0);
  expect(Math.abs(scrollTopAfter - scrollTopBefore)).toBeLessThanOrEqual(4);
});

test("uses a lighter hover color for inactive design queue rows", async ({ page }) => {
  await clickQueueAction(page, "Add Design");

  const firstRow = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  const secondRow = page.locator("#orderList .order-row").filter({ hasText: "Design 2" });
  const secondItem = secondRow.locator(".order-item");

  await firstRow.locator(".order-item").click();

  const activeBackground = await firstRow.evaluate((element) => window.getComputedStyle(element).backgroundColor);
  await secondItem.hover();
  await expect.poll(async () => {
    return secondRow.evaluate((element) => window.getComputedStyle(element).backgroundColor);
  }).toBe("rgb(244, 251, 250)");
  const hoveredBackground = await secondRow.evaluate((element) => window.getComputedStyle(element).backgroundColor);
  const hoveredItemBackground = await secondItem.evaluate((element) => window.getComputedStyle(element).backgroundColor);

  expect(activeBackground).toBe("rgb(234, 247, 246)");
  expect(hoveredBackground).not.toBe(activeBackground);
  expect(hoveredItemBackground).toBe("rgba(0, 0, 0, 0)");
});

test("persists per-line lock text height state across refresh for multi-line designs", async ({ page }) => {
  await page.locator("#textInput").fill("Savannah\nRN");

  const firstLineCard = page.locator('.line-control-card[data-line-index="0"]');
  const secondLineCard = page.locator('.line-control-card[data-line-index="1"]');
  const firstLineLock = firstLineCard.locator('[data-setting="lockTextHeight"]');
  const secondLineLock = secondLineCard.locator('[data-setting="lockTextHeight"]');
  const firstLineHeight = firstLineCard.locator('[data-setting="fontSizeMm"]');
  const secondLineHeight = secondLineCard.locator('[data-setting="fontSizeMm"]');

  await firstLineLock.check();
  await expect(firstLineHeight).toBeEnabled();
  await firstLineHeight.fill("41");
  await secondLineHeight.fill("29");
  await expect(secondLineLock).not.toBeChecked();

  await page.reload();

  await expect(page.locator("#importStatus")).toBeHidden();
  await expect(page.locator("#textInput")).toHaveValue("Savannah\nRN");
  await expect(firstLineLock).toBeChecked();
  await expect(secondLineLock).not.toBeChecked();
  await expect(firstLineHeight).toBeEnabled();
  await expect(firstLineHeight).toHaveValue("41");
  await expect(secondLineHeight).toHaveValue("29");
});

test("requires re-complete when lock text height changes a scaled design", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Savannah\nRN");
  await completeDesign(page, "Design 1");

  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  const firstLineLock = page.locator('.line-control-card[data-line-index="0"] [data-setting="lockTextHeight"]');

  await expect(page.getByRole("button", { name: "Export This Design" })).toBeEnabled();
  await firstLineLock.check();

  await expect(firstLineLock).toBeChecked();
  await expect(row).toContainText("In progress");
  await expect(completeButton(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeDisabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("shows copy and paste layout control actions in the selected-order header", async ({ page }) => {
  const copyLayoutControlsButton = page.getByRole("button", { name: "Copy Layout Controls" });
  const pasteLayoutControlsButton = page.getByRole("button", { name: "Paste Layout Controls" });

  await expect(copyLayoutControlsButton).toBeVisible();
  await expect(pasteLayoutControlsButton).toBeVisible();
  await expect(copyLayoutControlsButton).toBeDisabled();
  await expect(pasteLayoutControlsButton).toBeDisabled();
});

test("does not restore a stale completed analysis badge after geometry changes during analysis", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Savannah\nRN");
  await completeButton(page).click();

  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  const card = page.locator("#connectionStatus");
  await expect(row.locator(".order-analysis-indicator.running")).toBeVisible();
  await expect(card.locator(".order-analysis-indicator.running")).toBeVisible();

  await page.locator('.line-control-card[data-line-index="0"] [data-setting="lockTextHeight"]').check();
  await expect(row).toContainText("In progress");
  await expect(completeButton(page)).toBeEnabled();
  await expect(row.locator(".order-analysis-indicator.running")).toHaveCount(0);
  await expect(card.locator(".order-analysis-indicator.running")).toHaveCount(0);
  await expect(card.locator(".order-analysis-indicator.ok")).toHaveCount(0);
  await expect(card.locator(".order-analysis-indicator.warning")).toHaveCount(0);

  await expect(row.locator(".order-analysis-indicator.ok")).toHaveCount(0, { timeout: 20000 });
  await expect(row.locator(".order-analysis-indicator.warning")).toHaveCount(0);
  await expect(row.locator(".order-analysis-indicator.running")).toHaveCount(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("downgrades an abandoned first-time in-flight analysis to a retryable draft after refresh", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Savannah\nRN");
  await completeButton(page).click();
  await page.reload();

  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await expect(page.locator("#importStatus")).toBeHidden();
  await expect(row).toContainText("In progress");
  await expect(completeButton(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeDisabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("clears stale saved geometry signatures that have no completed build after refresh", async ({ page }) => {
  await page.locator("#textInput").fill("Savannah\nRN");
  await page.evaluate(() => {
    const raw = window.localStorage.getItem("thankfulforyou.designQueue");
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.orders) || !parsed.orders.length) {
      return;
    }

    const [order] = parsed.orders;
    order.savedSettingsSignature = JSON.stringify(order.settings);
    order.pendingAnalysisSignature = null;
    order.analysisBadge = null;
    order.cachedBuild = null;
    order.previousCompletedBuild = null;
    order.status = "in-progress";
    window.localStorage.setItem("thankfulforyou.designQueue", JSON.stringify(parsed));
  });

  await page.reload();

  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await expect(page.locator("#importStatus")).toBeHidden();
  await expect(row).toContainText("In progress");
  await expect(completeButton(page)).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeDisabled();
});

test("keeps the newest analysis request authoritative when Complete is clicked twice", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/layout-analyze", async (route) => {
    requestCount += 1;
    await new Promise((resolve) => setTimeout(resolve, requestCount === 1 ? 700 : 1400));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Savannah\nRN");
  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  const firstLineLock = page.locator('.line-control-card[data-line-index="0"] [data-setting="lockTextHeight"]');

  await completeButton(page).click();
  await firstLineLock.check();
  await completeButton(page).click();
  await expect(row.locator(".order-analysis-indicator.running")).toBeVisible();

  await page.waitForTimeout(900);
  await expect(row.locator(".order-analysis-indicator.running")).toBeVisible();

  await expect(row).toContainText("Complete", { timeout: 20000 });
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeEnabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("keeps the newest same-geometry analysis retry authoritative", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/layout-analyze", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({
        status: 500,
        contentType: "text/plain; charset=utf-8",
        body: "forced analysis failure",
      });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Savannah\nRN");
  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });

  await completeButton(page).click();
  await expect(row.locator(".order-analysis-indicator.running")).toBeVisible();
  await expect(completeButton(page)).toBeDisabled();
  await expect(page.locator("#connectionStatusLabel")).toContainText("Analysis failed", { timeout: 20000 });
  await expect(completeButton(page)).toBeEnabled();

  await completeButton(page).click();
  await expect(row.locator(".order-analysis-indicator.running")).toBeVisible();
  await expect(page.locator("#connectionStatusLabel")).not.toContainText("Analysis failed", { timeout: 2000 });

  await expect(row).toContainText("Complete", { timeout: 20000 });
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeEnabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("restores the completed state when geometry is reverted before analysis finishes", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Savannah\nRN");
  await completeButton(page).click();

  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  const firstLineLock = page.locator('.line-control-card[data-line-index="0"] [data-setting="lockTextHeight"]');

  await firstLineLock.check();
  await expect(row).toContainText("In progress");

  await firstLineLock.uncheck();

  await expect(row).toContainText("Complete");
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeEnabled({ timeout: 20000 });
  await expect(completeButton(page)).toBeDisabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("ignores an abandoned analysis failure after reverting to a completed geometry", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/layout-analyze", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(buildMockAnalysisResponse()),
      });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 500,
      contentType: "text/plain; charset=utf-8",
      body: "forced analysis failure",
    });
  });

  await page.locator("#textInput").fill("Savannah\nRN");
  await completeDesign(page, "Design 1");
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeEnabled();

  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  const firstLineLock = page.locator('.line-control-card[data-line-index="0"] [data-setting="lockTextHeight"]');

  await firstLineLock.check();
  await completeButton(page).click();
  await expect(row.locator(".order-analysis-indicator.running")).toBeVisible();

  await firstLineLock.uncheck();
  await expect(row).toContainText("Complete");
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeEnabled();
  await expect(page.locator("#connectionStatusLabel")).not.toContainText("Analysis failed", { timeout: 20000 });

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("restores the previous completed geometry after refresh during a newer in-flight analysis", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/layout-analyze", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(buildMockAnalysisResponse()),
      });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Savannah\nRN");
  await completeDesign(page, "Design 1");

  const firstLineLock = page.locator('.line-control-card[data-line-index="0"] [data-setting="lockTextHeight"]');
  await firstLineLock.check();
  await completeButton(page).click();
  await page.reload();

  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  const restoredFirstLineLock = page.locator('.line-control-card[data-line-index="0"] [data-setting="lockTextHeight"]');
  await expect(page.locator("#importStatus")).toBeHidden();
  await expect(row).toContainText("In progress");
  await expect(completeButton(page)).toBeEnabled();

  await restoredFirstLineLock.uncheck();
  await expect(row).toContainText("Complete");
  await expect(completeButton(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeEnabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("preserves the newest completed geometry across refresh after the operator moves on to a newer draft", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/api/layout-analyze", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(buildMockAnalysisResponse()),
      });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Savannah\nRN");
  await completeDesign(page, "Design 1");

  const firstLineLock = page.locator('.line-control-card[data-line-index="0"] [data-setting="lockTextHeight"]');
  const secondLineHeight = page.locator('.line-control-card[data-line-index="1"] [data-setting="fontSizeMm"]');

  await firstLineLock.check();
  await completeButton(page).click();
  await secondLineHeight.fill("29");
  await page.waitForTimeout(1200);
  await page.reload();

  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await expect(page.locator("#importStatus")).toBeHidden();
  await expect(row).toContainText("In progress");

  await secondLineHeight.fill("34");
  await expect(row).toContainText("Complete", { timeout: 20000 });
  await expect(completeButton(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeEnabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("restores the previous completed geometry when a newer in-flight analysis is abandoned", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Savannah\nRN");
  await completeDesign(page, "Design 1");
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeEnabled();

  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  const firstLineLock = page.locator('.line-control-card[data-line-index="0"] [data-setting="lockTextHeight"]');

  await firstLineLock.check();
  await expect(row).toContainText("In progress");
  await completeButton(page).click();
  await expect(row.locator(".order-analysis-indicator.running")).toBeVisible();

  await firstLineLock.uncheck();
  await expect(row).toContainText("Complete", { timeout: 20000 });
  await expect(completeButton(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeEnabled();
  await expect(page.locator("#connectionStatusLabel")).toContainText("Single connected face piece");
  await expect(page.locator("#connectionStatus .order-analysis-indicator.ok")).toBeVisible();

  await clickQueueAction(page, "Add Design");
  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-item").click();
  await expect(page.locator("#connectionStatusLabel")).toContainText("Single connected face piece");
  await expect(page.getByRole("button", { name: "Export This Design" })).toBeEnabled();
  await expect(page.locator("#connectionStatus .order-analysis-indicator.ok")).toBeVisible();

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("shows guide overflow when a locked line prevents fit", async ({ page }) => {
  await page.locator("#textInput").fill("Mark\nRN");

  const firstLineCard = page.locator('.line-control-card[data-line-index="0"]');
  const secondLineCard = page.locator('.line-control-card[data-line-index="1"]');
  await firstLineCard.locator('[data-setting="lockTextHeight"]').check();
  await firstLineCard.locator('[data-setting="fontSizeMm"]').fill("55");
  await secondLineCard.locator('[data-setting="fontSizeMm"]').fill("30");

  await expect.poll(async () => {
    return page.evaluate(() => document.body.innerText);
  }).toContain("Guide overflow");
});

test("deletes a single design from the queue", async ({ page }) => {
  await clickQueueAction(page, "Add Design");
  await expect(page.locator("#orderCountOutput")).toHaveText("2");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete Design 1" }).click();

  await expect(page.locator("#orderCountOutput")).toHaveText("1");
  await expect(page.locator("#orderList .order-row")).toHaveCount(1);
  await expect(page.locator("#activeOrderName")).toHaveText("Design 1");
});

test("skips already imported Etsy line items when importing another batch", async ({ page }) => {
  const firstPayload = JSON.stringify({
    items: [
      {
        orderNumber: "4057600528",
        listingId: "1884223710",
        transactionId: "5078093505",
        buyerName: "Marilyn Lopez",
        personalization: "Yohanna APN",
      },
      {
        orderNumber: "4057629148",
        listingId: "1884223710",
        transactionId: "5078133859",
        buyerName: "Mallory Braun",
        personalization: "Mallory R.T.(R)",
      },
    ],
  });

  const secondPayload = JSON.stringify({
    items: [
      {
        orderNumber: "4057629148",
        listingId: "1884223710",
        transactionId: "5078133859",
        buyerName: "Mallory Braun",
        personalization: "Mallory R.T.(R)",
      },
      {
        orderNumber: "4062879351",
        listingId: "4465975709",
        transactionId: "5077938715",
        buyerName: "Lori Morgan",
        personalization: "Lori",
      },
    ],
  });

  await page.evaluate((payload) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => payload,
      },
    });
  }, firstPayload);

  await clickQueueAction(page, "Import Clipboard");

  await expect(page.locator("#orderCountOutput")).toHaveText("3");
  await expect(page.locator(".queue-tools-menu")).not.toHaveAttribute("open", "");
  await expect(page.locator("#importStatus")).toBeVisible();
  await expect(page.locator("#importStatus")).toContainText("Imported 2 Etsy designs from the clipboard.");
  await expect.poll(async () => {
    return page.locator("#importStatus").evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return {
        position: style.position,
        bottomGap: Math.round(window.innerHeight - rect.bottom),
        centerOffset: Math.round(Math.abs(window.innerWidth / 2 - (rect.left + rect.width / 2))),
      };
    });
  }).toEqual({
    position: "fixed",
    bottomGap: 24,
    centerOffset: 0,
  });
  await expect(page.locator("#importStatus")).toBeHidden({ timeout: 5000 });

  await page.evaluate((payload) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => payload,
      },
    });
  }, secondPayload);

  await clickQueueAction(page, "Import Clipboard");

  await expect(page.locator("#orderCountOutput")).toHaveText("4");
  await expect(page.locator(".queue-tools-menu")).not.toHaveAttribute("open", "");
  await expect(page.locator("#importStatus")).toBeVisible();
  await expect(page.locator("#importStatus")).toContainText("Imported 1 new Etsy design and skipped 1 already in the queue.");
  await expect(page.locator("#orderList .order-row")).toContainText([
    "#4057600528",
    "#4057629148",
    "#4062879351",
  ]);
  await expect(page.locator("#importStatus")).toBeHidden({ timeout: 5000 });
});

test("shows labeled buyer, listing, and emphasized personalization lines in queue rows", async ({ page }) => {
  const payload = JSON.stringify({
    items: [
      {
        orderNumber: "4057600528",
        listingId: "1884223710",
        listingTitle: "Custom Badge Reel for Nurse Practitioner with Floral Backing and Glitter Accent",
        transactionId: "5078093505",
        buyerName: "Marilyn Lopez",
        personalization: "Yohanna APN",
      },
    ],
  });

  await page.evaluate((clipboardPayload) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => clipboardPayload,
      },
    });
  }, payload);

  await clickQueueAction(page, "Import Clipboard");

  const row = page.locator("#orderList .order-row").filter({ hasText: "#4057600528" });
  const buyerLine = row.locator(".order-item-recipient");
  const listingLine = row.locator(".order-item-listing");
  const personalizationLine = row.locator(".order-item-personalization");

  await expect(row).toContainText("#4057600528");
  await expect(buyerLine).toHaveText("Buyer: Marilyn Lopez");
  await expect(listingLine).toHaveText("Listing: Custom Badge Reel for Nurse Practitioner with Floral Backing and Glitter Accent");
  await expect(personalizationLine).toHaveText("Personalization: Yohanna APN");

  const lineMetrics = await page.evaluate(() => {
    const buyerLine = document.querySelector(".order-item-recipient");
    const listingLine = document.querySelector(".order-item-listing");
    const personalizationLine = document.querySelector(".order-item-personalization");

    if (!(buyerLine instanceof HTMLElement) || !(listingLine instanceof HTMLElement) || !(personalizationLine instanceof HTMLElement)) {
      return null;
    }

    return {
      buyerSize: window.getComputedStyle(buyerLine).fontSize,
      listingSize: window.getComputedStyle(listingLine).fontSize,
      personalizationSize: window.getComputedStyle(personalizationLine).fontSize,
    };
  });

  expect(lineMetrics).toEqual({
    buyerSize: "12.8px",
    listingSize: "11.68px",
    personalizationSize: "14.4px",
  });
});

test("shows imported Etsy color and quantity below design text and highlights white colors", async ({ page }) => {
  const payload = JSON.stringify({
    items: [
      {
        orderNumber: "4057600528",
        listingId: "1884223710",
        transactionId: "5078093505",
        buyerName: "Marilyn Lopez",
        colorName: "White Glitter",
        quantity: "2",
        personalization: "Yohanna APN",
      },
      {
        orderNumber: "4057629148",
        listingId: "1884223710",
        transactionId: "5078133859",
        buyerName: "Mallory Braun",
        colorName: "Red",
        quantity: "1",
        personalization: "Mallory R.T.(R)",
      },
    ],
  });

  await page.evaluate((clipboardPayload) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => clipboardPayload,
      },
    });
  }, payload);

  await clickQueueAction(page, "Import Clipboard");

  await expect(page.locator("#importedColorField")).toBeVisible();
  await expect(page.locator("#importedColorValue")).toHaveText("White Glitter");
  await expect(page.locator("#importedColorValue")).toHaveClass(/highlight-light-color/);
  await expect(page.locator("#importedQuantityField")).toBeVisible();
  await expect(page.locator("#importedQuantityValue")).toHaveText("2");

  await page.locator("#orderList .order-row").filter({ hasText: "#4057629148" }).click();

  await expect(page.locator("#importedColorField")).toBeVisible();
  await expect(page.locator("#importedColorValue")).toHaveText("Red");
  await expect(page.locator("#importedColorValue")).not.toHaveClass(/highlight-light-color/);
  await expect(page.locator("#importedQuantityField")).toBeVisible();
  await expect(page.locator("#importedQuantityValue")).toHaveText("1");

  await page.reload();

  await expect(page.locator("#importedColorField")).toBeVisible();
  await expect(page.locator("#importedColorValue")).toHaveText("Red");
  await expect(page.locator("#importedQuantityField")).toBeVisible();
  await expect(page.locator("#importedQuantityValue")).toHaveText("1");
});

test("includes imported color and quantity in the export payload", async ({ page }) => {
  const payload = JSON.stringify({
    items: [
      {
        orderNumber: "4057600528",
        listingId: "1884223710",
        transactionId: "5078093505",
        buyerName: "Marilyn Lopez",
        colorName: "White Glitter",
        quantity: "2",
        personalization: "Yohanna APN",
      },
    ],
  });
  let exportPayload = null;

  await page.evaluate((clipboardPayload) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => clipboardPayload,
      },
    });
  }, payload);

  await page.route("**/api/export-svg", async (route) => {
    exportPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml; charset=utf-8",
      body: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    });
  });
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await clickQueueAction(page, "Import Clipboard");
  await completeDesign(page, "#4057600528");
  await page.locator("#orderList .order-row").filter({ hasText: "#4057600528" }).locator(".order-item").click();
  await page.getByRole("button", { name: "Export This Design" }).click();

  await expect.poll(() => exportPayload, { timeout: 20000 }).not.toBeNull();
  expect(exportPayload.colorName).toBe("White Glitter");
  expect(exportPayload.quantity).toBe("2");

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("copies the current design and all queued designs to the clipboard", async ({ page }) => {
  await page.evaluate(() => {
    window.__copiedSvgPayloads = [];
    window.ClipboardItem = class ClipboardItem {
      constructor(data) {
        this.data = data;
      }
    };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => "",
        write: async (items) => {
          const [item] = items;
          const svgBlob = item.data["image/svg+xml"];
          const svgText = await svgBlob.text();
          window.__copiedSvgPayloads.push(svgText);
        },
      },
    });
  });

  await page.route("**/api/export-svg", async (route) => {
    const postData = route.request().postDataJSON();
    const body = postData.layouts
      ? "<svg xmlns=\"http://www.w3.org/2000/svg\" data-export-kind=\"batch\"></svg>"
      : "<svg xmlns=\"http://www.w3.org/2000/svg\" data-export-kind=\"single\"></svg>";

    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml; charset=utf-8",
      body,
    });
  });
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await completeDesign(page, "Design 1");
  await page.getByRole("button", { name: "Copy This Design" }).click();

  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Beta");
  await completeDesign(page, "Design 2");
  await clickQueueAction(page, "Copy All Designs");

  await expect.poll(async () => {
    return page.evaluate(() => window.__copiedSvgPayloads);
  }, { timeout: 20000 }).toEqual([
    "<svg xmlns=\"http://www.w3.org/2000/svg\" data-export-kind=\"single\"></svg>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" data-export-kind=\"batch\"></svg>",
  ]);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("runs face analysis only when completing", async ({ page }) => {
  const analyzeCounts = new Map();

  await page.route("**/api/layout-analyze", async (route) => {
    const postData = route.request().postDataJSON();
    const text = postData?.layout?.text || "";
    analyzeCounts.set(text, (analyzeCounts.get(text) || 0) + 1);

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await page.waitForTimeout(400);
  expect(Object.fromEntries(analyzeCounts)).toEqual({});

  await completeDesign(page, "Design 1");
  await expect.poll(() => Object.fromEntries(analyzeCounts), { timeout: 20000 }).toEqual({
    Alpha: 1,
  });

  await page.locator("#textInput").fill("Alpha RN");
  await page.waitForTimeout(400);
  expect(Object.fromEntries(analyzeCounts)).toEqual({
    Alpha: 1,
  });

  await completeDesign(page, "Design 1");
  await expect.poll(() => Object.fromEntries(analyzeCounts), { timeout: 20000 }).toEqual({
    Alpha: 1,
    "Alpha RN": 1,
  });

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("keeps Complete button state independent from background analysis", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Beta");

  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-item").click();
  await completeAndNextButton(page).click();

  const completedRow = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await expect(completedRow).toContainText("Complete");
  await expect(completedRow.locator(".order-analysis-indicator.running")).toBeVisible();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 2");
  await expect(completeButton(page)).toBeEnabled();
  await expect(completeButton(page)).not.toHaveText(/Saving/);
  await expect(completedRow.locator(".order-analysis-indicator.ok")).toBeVisible({ timeout: 20000 });

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Complete marks the active design finished without advancing to the next design", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Beta");
  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-item").click();

  await completeButton(page).click();

  const firstRow = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await expect(firstRow).toContainText("Complete");
  await expect(firstRow.locator(".order-analysis-indicator.running")).toBeVisible();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 1");
  await expect(completeButton(page)).toBeDisabled();
  await expect(completeAndNextButton(page)).toBeDisabled();
  await expect(firstRow.locator(".order-analysis-indicator.ok")).toBeVisible({ timeout: 20000 });

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("Complete & Next marks the current design finished and advances to the next design", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Beta");
  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-item").click();

  await completeAndNextButton(page).click();

  const firstRow = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await expect(firstRow).toContainText("Complete");
  await expect(firstRow.locator(".order-analysis-indicator.running")).toBeVisible();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 2");
  await expect(completeButton(page)).toBeEnabled();
  await expect(completeAndNextButton(page)).toBeDisabled();
  await expect(firstRow.locator(".order-analysis-indicator.ok")).toBeVisible({ timeout: 20000 });

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("disables Complete & Next when every other design is already complete", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Beta");
  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Gamma");

  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-item").click();
  await completeAndNextButton(page).click();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 2");

  await completeButton(page).click();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 2");

  await page.locator("#orderList .order-row").filter({ hasText: "Design 3" }).locator(".order-item").click();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 3");
  await expect(completeButton(page)).toBeEnabled();
  await expect(completeAndNextButton(page)).toBeDisabled();

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("disables Complete while the active design analysis is still running", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await completeButton(page).click();

  const activeRow = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await expect(activeRow.locator(".order-analysis-indicator.running")).toBeVisible();
  await expect(page.locator("#captureButton")).toBeDisabled();
  await expect(page.locator("#captureButton")).toHaveText("Complete");
  await expect(activeRow.locator(".order-analysis-indicator.ok")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#captureButton")).toBeDisabled();
  await expect(page.locator("#captureButton")).toHaveText("Complete");

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("keeps Complete disabled when reselecting a design whose analysis is still running", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Beta");

  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-item").click();
  await completeAndNextButton(page).click();

  const firstRow = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await expect(firstRow.locator(".order-analysis-indicator.running")).toBeVisible();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 2");

  await firstRow.locator(".order-item").click();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 1");
  await expect(page.locator("#captureButton")).toBeDisabled();
  await expect(page.locator("#captureButton")).toHaveText("Complete");
  await expect(firstRow.locator(".order-analysis-indicator.ok")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#captureButton")).toBeDisabled();
  await expect(page.locator("#captureButton")).toHaveText("Complete");

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("does not allow a second Complete run while the same design analysis is still running", async ({ page }) => {
  let analyzeCalls = 0;

  await page.route("**/api/layout-analyze", async (route) => {
    analyzeCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Beta");

  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-item").click();
  await completeAndNextButton(page).click();

  const firstRow = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await firstRow.locator(".order-item").click();
  await expect(page.locator("#captureButton")).toBeDisabled();
  await expect(page.locator("#captureButton")).toHaveText("Complete");
  await expect.poll(() => analyzeCalls).toBe(1);
  await expect(firstRow.locator(".order-analysis-indicator.ok")).toBeVisible({ timeout: 20000 });
  await expect.poll(() => analyzeCalls).toBe(1);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("shows queue analysis indicators for running, connected, and multi-piece completions", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    const postData = route.request().postDataJSON();
    const text = postData?.layout?.text || "";

    if (text === "Alpha") {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({
        status: 200,
        contentType: "application/json; charset=utf-8",
        body: JSON.stringify(buildMockAnalysisResponse()),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse({
        isConnected: false,
        connectedComponentCount: 3,
      })),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  const saveAlpha = completeButton(page).click();
  await expect(page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-analysis-indicator.running")).toBeVisible();
  await expect(page.locator("#connectionStatus .order-analysis-indicator.running")).toBeVisible();
  await saveAlpha;
  await expect(page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-analysis-indicator.ok")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#connectionStatus .order-analysis-indicator.ok")).toBeVisible();

  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Beta");
  await completeDesign(page, "Design 2");

  const betaIndicator = page.locator("#orderList .order-row").filter({ hasText: "Design 2" }).locator(".order-analysis-indicator.warning");
  await expect(betaIndicator).toContainText("⚠");
  await expect(betaIndicator).toContainText("3");
  const betaCardIndicator = page.locator("#connectionStatus .order-analysis-indicator.warning");
  await expect(betaCardIndicator).toBeVisible();
  await expect(betaCardIndicator).toContainText("3");

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("recovers queue analysis indicators from cached analysis when a stale running badge is stored", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await completeDesign(page, "Design 1");

  await page.evaluate(() => {
    const raw = window.localStorage.getItem("thankfulforyou.designQueue");
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.orders) || !parsed.orders.length) {
      return;
    }

    parsed.orders[0].analysisBadge = {
      state: "running",
      shortLabel: "",
      fullLabel: "Analysis running",
    };
    window.localStorage.setItem("thankfulforyou.designQueue", JSON.stringify(parsed));
  });

  await page.reload();
  await expect(page.locator("#importStatus")).toBeHidden();

  const row = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await expect(row.locator(".order-analysis-indicator.ok")).toBeVisible({ timeout: 20000 });
  await expect(row.locator(".order-analysis-indicator.running")).toHaveCount(0);

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("exports completed designs without re-running analysis", async ({ page }) => {
  const analyzeCounts = new Map();
  let exportRequested = false;
  let exportAnalyzeCounts = null;

  await page.route("**/api/layout-analyze", async (route) => {
    const postData = route.request().postDataJSON();
    const text = postData?.layout?.text || "";
    analyzeCounts.set(text, (analyzeCounts.get(text) || 0) + 1);

    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.route("**/api/export-svg", async (route) => {
    exportRequested = true;
    exportAnalyzeCounts = Object.fromEntries(analyzeCounts);
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml; charset=utf-8",
      body: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await completeDesign(page, "Design 1");
  await clickQueueAction(page, "Add Design");
  await page.locator("#textInput").fill("Beta");
  await completeDesign(page, "Design 2");
  await clickQueueAction(page, "Export All Designs");

  await expect.poll(() => exportRequested, { timeout: 20000 }).toBe(true);
  expect(exportAnalyzeCounts).toEqual({
    Alpha: 1,
    Beta: 1,
  });

  await page.unrouteAll({ behavior: "ignoreErrors" });
});
