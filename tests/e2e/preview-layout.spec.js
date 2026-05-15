import { expect, test } from "playwright/test";

async function measureVisibleTextBounds(page) {
  return page.evaluate(async () => {
    const guide = document.querySelector("#preview .preview-guide-box");
    const face = document.querySelector("#preview image.face-layer");
    if (!(guide instanceof SVGRectElement) || !(face instanceof SVGImageElement)) {
      return null;
    }

    const href = face.getAttribute("href");
    const imageWidthMm = Number(face.getAttribute("width"));
    const imageHeightMm = Number(face.getAttribute("height"));
    const imageX = Number(face.getAttribute("x"));
    const imageY = Number(face.getAttribute("y"));
    const guideX = Number(guide.getAttribute("x"));
    const guideY = Number(guide.getAttribute("y"));
    const guideWidthMm = Number(guide.getAttribute("width"));
    const guideHeightMm = Number(guide.getAttribute("height"));

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

    const textLeftMm = imageX + (minX / width) * imageWidthMm;
    const textRightMm = imageX + ((maxX + 1) / width) * imageWidthMm;
    const textTopMm = imageY + (minY / height) * imageHeightMm;
    const textBottomMm = imageY + ((maxY + 1) / height) * imageHeightMm;

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
  await page.getByRole("button", { name: "+ Add Order" }).click();
});

test("shows the production defaults", async ({ page }) => {
  await expect(page.locator("#backingInput")).toHaveValue("3.1");
  await expect(page.locator("#backingOutput")).toHaveText("3.100 mm");
  await expect(page.locator("#preview .preview-guide-label").first()).toHaveText('2.2"');
});

test("keeps text inside the guide and centered for Mark RN", async ({ page }) => {
  await page.locator("#textInput").fill("Mark\nRN");
  await page.waitForTimeout(1000);

  const metrics = await measureVisibleTextBounds(page);

  expect(metrics.textWidthMm).toBeLessThanOrEqual(metrics.guideWidthMm + 0.01);
  expect(metrics.textHeightMm).toBeLessThanOrEqual(metrics.guideHeightMm + 0.01);
  expect(metrics.deltaX).toBeCloseTo(0, 2);
  expect(metrics.deltaY).toBeCloseTo(0, 2);
});

test("keeps a longer two-line layout inside the guide", async ({ page }) => {
  await page.locator("#textInput").fill("Christopher\nMSN RN");
  await page.waitForTimeout(1000);

  const metrics = await measureVisibleTextBounds(page);

  expect(metrics.textWidthMm).toBeLessThanOrEqual(metrics.guideWidthMm + 0.01);
  expect(metrics.textHeightMm).toBeLessThanOrEqual(metrics.guideHeightMm + 0.01);
});
