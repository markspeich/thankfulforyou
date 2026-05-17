import { expect, test } from "playwright/test";

test.describe.configure({ mode: "serial" });

async function completeDesign(page, queueLabel) {
  const row = page.locator("#orderList .order-row").filter({ hasText: queueLabel });

  await page.getByRole("button", { name: "Complete" }).click();
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
      return typeof value === "string"
        && (
          value.includes("Restored")
          || value.includes("Import Etsy clipboard data copied from the browser helper.")
        );
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
    await page.getByRole("button", { name: "Clear Batch" }).click();
    await expect(orderCount).toHaveText("0");
  }

  await page.getByRole("button", { name: "+ Add Design" }).click();
});

test("shows the production defaults", async ({ page }) => {
  await expect(page.locator("#backingInput")).toHaveValue("3.1");
  await expect(page.locator("#backingOutput")).toHaveText("3.100 mm");
  await expect(page.locator("#weldExportedDesignInput")).toBeChecked();
  await expect(page.locator("#preview .preview-guide-label").first()).toHaveText('2.2"');
  await expect(page.locator("#preview circle.preview-guide-box")).toHaveCount(1);

  const circleMetrics = await page.evaluate(() => {
    const guide = document.querySelector("#preview rect.preview-guide-box");
    const circle = document.querySelector("#preview circle.preview-guide-box");
    if (!(guide instanceof SVGRectElement) || !(circle instanceof SVGCircleElement)) {
      return null;
    }

    return {
      guideCenterX: Number(guide.getAttribute("x")) + Number(guide.getAttribute("width")) / 2,
      guideCenterY: Number(guide.getAttribute("y")) + Number(guide.getAttribute("height")) / 2,
      circleCenterX: Number(circle.getAttribute("cx")),
      circleCenterY: Number(circle.getAttribute("cy")),
      circleDiameter: Number(circle.getAttribute("r")) * 2,
    };
  });

  expect(circleMetrics.circleCenterX).toBeCloseTo(circleMetrics.guideCenterX, 6);
  expect(circleMetrics.circleCenterY).toBeCloseTo(circleMetrics.guideCenterY, 6);
  expect(circleMetrics.circleDiameter).toBeCloseTo(1.25 * 25.4, 6);
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

  await expect(page.locator("#importStatus")).toContainText("Restored 1 design");
  await expect(page.locator("#activeOrderName")).toHaveText("Design 1");
  await expect(page.locator("#textInput")).toHaveValue("Savannah\nRN");
  await expect(page.locator("#backingInput")).toHaveValue("4.2");
  await expect(page.locator("#weldExportedDesignInput")).not.toBeChecked();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear Batch" }).click();

  await expect(page.locator("#orderCountOutput")).toHaveText("0");
  await expect(page.locator("#importStatus")).toContainText("Batch cleared");
  await expect(page.locator(".editor-panel")).toHaveClass(/is-hidden/);

  await page.reload();

  await expect(page.locator("#orderCountOutput")).toHaveText("0");
  await expect(page.locator("#importStatus")).not.toContainText("Restored");
});

test("deletes a single design from the queue", async ({ page }) => {
  await page.getByRole("button", { name: "+ Add Design" }).click();
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

  await page.getByRole("button", { name: "Import Clipboard" }).click();

  await expect(page.locator("#orderCountOutput")).toHaveText("3");
  await expect(page.locator("#importStatus")).toContainText("Imported 2 Etsy designs from the clipboard.");

  await page.evaluate((payload) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        readText: async () => payload,
      },
    });
  }, secondPayload);

  await page.getByRole("button", { name: "Import Clipboard" }).click();

  await expect(page.locator("#orderCountOutput")).toHaveText("4");
  await expect(page.locator("#importStatus")).toContainText("Imported 1 new Etsy design and skipped 1 already in the queue.");
  await expect(page.locator("#orderList .order-row")).toContainText([
    "#4057600528",
    "#4057629148",
    "#4062879351",
  ]);
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

  await page.getByRole("button", { name: "Import Clipboard" }).click();

  await expect(page.locator("#importedColorField")).toBeVisible();
  await expect(page.locator("#importedColorValue")).toHaveText("White Glitter");
  await expect(page.locator("#importedColorValue")).toHaveClass(/highlight-light-color/);
  await expect(page.locator("#importedQuantityField")).toBeVisible();
  await expect(page.locator("#importedQuantityValue")).toHaveText("2");

  await page.locator("#orderList .order-row").filter({ hasText: "#4057629148" }).locator(".order-item").click();

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

  await page.getByRole("button", { name: "Import Clipboard" }).click();
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

  await page.getByRole("button", { name: "+ Add Design" }).click();
  await page.locator("#textInput").fill("Beta");
  await completeDesign(page, "Design 2");
  await page.getByRole("button", { name: "Copy All Designs" }).click();

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
    await page.waitForTimeout(1000);
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(buildMockAnalysisResponse()),
    });
  });

  await page.locator("#textInput").fill("Alpha");
  await page.getByRole("button", { name: "+ Add Design" }).click();
  await page.locator("#textInput").fill("Beta");

  await page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-item").click();
  await page.getByRole("button", { name: "Complete" }).click();

  const completedRow = page.locator("#orderList .order-row").filter({ hasText: "Design 1" });
  await expect(completedRow).toContainText("Complete");
  await expect(completedRow.locator(".order-analysis-indicator.running")).toBeVisible();
  await expect(page.locator("#activeOrderName")).toHaveText("Design 2");
  await expect(page.getByRole("button", { name: "Complete" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Complete" })).not.toHaveText(/Saving/);
  await expect(completedRow.locator(".order-analysis-indicator.ok")).toBeVisible({ timeout: 20000 });

  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("shows queue analysis indicators for running, connected, and multi-piece completions", async ({ page }) => {
  await page.route("**/api/layout-analyze", async (route) => {
    const postData = route.request().postDataJSON();
    const text = postData?.layout?.text || "";

    if (text === "Alpha") {
      await page.waitForTimeout(700);
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
  const saveAlpha = page.getByRole("button", { name: "Complete" }).click();
  await expect(page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-analysis-indicator.running")).toBeVisible();
  await saveAlpha;
  await expect(page.locator("#orderList .order-row").filter({ hasText: "Design 1" }).locator(".order-analysis-indicator.ok")).toBeVisible({ timeout: 20000 });

  await page.getByRole("button", { name: "+ Add Design" }).click();
  await page.locator("#textInput").fill("Beta");
  await completeDesign(page, "Design 2");

  const betaIndicator = page.locator("#orderList .order-row").filter({ hasText: "Design 2" }).locator(".order-analysis-indicator.warning");
  await expect(betaIndicator).toContainText("⚠");
  await expect(betaIndicator).toContainText("3");

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
  await page.getByRole("button", { name: "+ Add Design" }).click();
  await page.locator("#textInput").fill("Beta");
  await completeDesign(page, "Design 2");
  await page.getByRole("button", { name: "Export All Designs" }).click();

  await expect.poll(() => exportRequested, { timeout: 20000 }).toBe(true);
  expect(exportAnalyzeCounts).toEqual({
    Alpha: 1,
    Beta: 1,
  });

  await page.unrouteAll({ behavior: "ignoreErrors" });
});
