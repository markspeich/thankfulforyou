import { expect, test } from "playwright/test";

test.describe.configure({ mode: "serial" });

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
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
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

test("finishes background analysis after switching to another design", async ({ page }) => {
  const analyzeCounts = new Map();

  await page.route("**/api/layout-analyze", async (route) => {
    const postData = route.request().postDataJSON();
    const text = postData?.layout?.text || "";
    analyzeCounts.set(text, (analyzeCounts.get(text) || 0) + 1);

    if (text === "Alpha") {
      await page.waitForTimeout(700);
    }

    const response = await route.fetch();
    await route.fulfill({ response });
  });

  await page.locator("#textInput").fill("Alpha");
  await page.getByRole("button", { name: "+ Add Design" }).click();
  await page.locator("#textInput").fill("Beta");
  await expect(page.locator("#connectionStatusLabel")).not.toHaveText("Analyzing layout...", { timeout: 15000 });

  await page.waitForTimeout(900);
  await page.locator("#orderList .order-item").first().click();

  await expect(page.locator("#textInput")).toHaveValue("Alpha");
  await expect(page.locator("#connectionStatusLabel")).not.toHaveText("Analyzing layout...", { timeout: 1000 });
  await page.waitForTimeout(400);

  expect(analyzeCounts.get("Alpha")).toBe(1);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("waits for pending cached analyses before exporting all designs", async ({ page }) => {
  const analyzeCounts = new Map();
  let exportRequested = false;
  let exportAnalyzeCounts = null;

  await page.route("**/api/layout-analyze", async (route) => {
    const postData = route.request().postDataJSON();
    const text = postData?.layout?.text || "";
    analyzeCounts.set(text, (analyzeCounts.get(text) || 0) + 1);

    if (text === "Alpha") {
      await page.waitForTimeout(700);
    }

    const response = await route.fetch();
    await route.fulfill({ response });
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
  await page.getByRole("button", { name: "+ Add Design" }).click();
  await page.locator("#textInput").fill("Beta");
  await page.getByRole("button", { name: "Export All Designs" }).click();

  await page.waitForTimeout(400);
  expect(exportRequested).toBe(false);

  await expect.poll(() => exportRequested, { timeout: 20000 }).toBe(true);
  expect(exportAnalyzeCounts).toEqual({
    Alpha: 1,
    Beta: 1,
  });

  await page.unrouteAll({ behavior: "ignoreErrors" });
});
