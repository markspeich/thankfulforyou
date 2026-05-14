const FONT_URL = "public/fonts/Candlepin-Laser.otf";
const FONT_FAMILY = "CandlepinLaser";
const PX_PER_MM = 96 / 25.4;
const MAX_RENDER_WIDTH_MM = 50.8;
const MAX_RENDER_HEIGHT_MM = 38.1;
const PREVIEW_BOX_WIDTH_MM = 50.8;
const PREVIEW_BOX_HEIGHT_MM = 38.1;
const PREVIEW_MARGIN_MM = 6;
const PREVIEW_LABEL_RIGHT_MM = 10;
const DESIGN_BLEED_MM = 1;
const DEFAULT_PREVIEW_WIDTH_MM = PREVIEW_BOX_WIDTH_MM + PREVIEW_MARGIN_MM * 2 + PREVIEW_LABEL_RIGHT_MM;
const DEFAULT_PREVIEW_HEIGHT_MM = PREVIEW_BOX_HEIGHT_MM + PREVIEW_MARGIN_MM * 2;
const DEFAULT_ZOOM = 3;

const orderLabelInput = document.querySelector("#orderLabelInput");
const addOrderButton = document.querySelector("#addOrderButton");
const exportCompletedButton = document.querySelector("#exportCompletedButton");
const orderSearchInput = document.querySelector("#orderSearchInput");
const orderCountOutput = document.querySelector("#orderCountOutput");
const completeCountOutput = document.querySelector("#completeCountOutput");
const progressCountOutput = document.querySelector("#progressCountOutput");
const notStartedCountOutput = document.querySelector("#notStartedCountOutput");
const orderList = document.querySelector("#orderList");
const activeOrderName = document.querySelector("#activeOrderName");
const editorPanel = document.querySelector(".editor-panel");
const textInput = document.querySelector("#textInput");
const overlapInput = document.querySelector("#overlapInput");
const overlapOutput = document.querySelector("#overlapOutput");
const lineOverlapInput = document.querySelector("#lineOverlapInput");
const lineOverlapOutput = document.querySelector("#lineOverlapOutput");
const sizeInput = document.querySelector("#sizeInput");
const sizeOutput = document.querySelector("#sizeOutput");
const backingInput = document.querySelector("#backingInput");
const backingOutput = document.querySelector("#backingOutput");
const fontStatus = document.querySelector("#fontStatus");
const preview = document.querySelector("#preview");
const previewPanel = document.querySelector(".preview-panel");
const zoomOutButton = document.querySelector("#zoomOutButton");
const zoomInButton = document.querySelector("#zoomInButton");
const zoomResetButton = document.querySelector("#zoomResetButton");
const zoomOutput = document.querySelector("#zoomOutput");
const downloadButton = document.querySelector("#downloadButton");
const captureButton = document.querySelector("#captureButton");

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
const MASK_SCALE = 3;
const MASK_PADDING_PX = 12;
let lastLayout = null;
let zoom = DEFAULT_ZOOM;
let orderSequence = 1;
let activeOrderId = null;
const orders = [];

const statusLabels = {
  "not-started": "Not started",
  "in-progress": "In progress",
  captured: "Saved",
  exported: "Exported",
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateZoom(nextZoom, anchor = null) {
  const previousZoom = zoom;
  zoom = clamp(nextZoom, 0.4, 6);
  zoomOutput.textContent = `${Math.round(zoom * 100)}%`;

  if (lastLayout) {
    preview.style.setProperty("--preview-width", `${lastLayout.previewWidthMm * PX_PER_MM * zoom}px`);
    preview.style.setProperty("--preview-height", `${lastLayout.previewHeightMm * PX_PER_MM * zoom}px`);
  } else {
    preview.style.setProperty("--preview-width", `${DEFAULT_PREVIEW_WIDTH_MM * PX_PER_MM * zoom}px`);
    preview.style.setProperty("--preview-height", `${DEFAULT_PREVIEW_HEIGHT_MM * PX_PER_MM * zoom}px`);
  }

  if (anchor && previousZoom !== zoom) {
    const ratio = zoom / previousZoom;
    previewPanel.scrollLeft = (previewPanel.scrollLeft + anchor.x) * ratio - anchor.x;
    previewPanel.scrollTop = (previewPanel.scrollTop + anchor.y) * ratio - anchor.y;
  }
}

function renderPreviewGuideOnly() {
  const previewBoxX = (DEFAULT_PREVIEW_WIDTH_MM - PREVIEW_LABEL_RIGHT_MM - PREVIEW_BOX_WIDTH_MM) / 2;
  const previewBoxY = (DEFAULT_PREVIEW_HEIGHT_MM - PREVIEW_BOX_HEIGHT_MM) / 2;

  preview.replaceChildren();
  preview.setAttribute("viewBox", `0 0 ${DEFAULT_PREVIEW_WIDTH_MM} ${DEFAULT_PREVIEW_HEIGHT_MM}`);
  updateZoom(zoom);
  appendPreviewGuide(previewBoxX, previewBoxY);
}

function appendPreviewGuide(previewBoxX, previewBoxY) {
  const topLabel = makeSvgElement("text", {
    class: "preview-guide-label",
    x: previewBoxX + PREVIEW_BOX_WIDTH_MM / 2,
    y: previewBoxY - 2.6,
    "text-anchor": "middle",
  });
  topLabel.textContent = '2"';

  const sideLabel = makeSvgElement("text", {
    class: "preview-guide-label",
    x: previewBoxX + PREVIEW_BOX_WIDTH_MM + 4.5,
    y: previewBoxY + PREVIEW_BOX_HEIGHT_MM / 2,
    "text-anchor": "middle",
    transform: `rotate(90 ${previewBoxX + PREVIEW_BOX_WIDTH_MM + 4.5} ${previewBoxY + PREVIEW_BOX_HEIGHT_MM / 2})`,
  });
  sideLabel.textContent = '1.5"';

  preview.append(
    makeSvgElement("rect", {
      class: "preview-guide-box",
      x: previewBoxX,
      y: previewBoxY,
      width: PREVIEW_BOX_WIDTH_MM,
      height: PREVIEW_BOX_HEIGHT_MM,
      rx: 1.6,
    }),
    topLabel,
    sideLabel,
  );
}

function getCurrentSettings() {
  return {
    text: textInput.value,
    bridgeMm: Number(overlapInput.value),
    lineBridgeMm: Number(lineOverlapInput.value),
    fontSizeMm: Number(sizeInput.value),
    backingMm: Number(backingInput.value),
  };
}

function applySettings(settings) {
  textInput.value = settings.text;
  overlapInput.value = settings.bridgeMm;
  lineOverlapInput.value = settings.lineBridgeMm;
  sizeInput.value = settings.fontSizeMm;
  backingInput.value = settings.backingMm;
}

function getActiveOrder() {
  return orders.find((order) => order.id === activeOrderId) || null;
}

function summarizeOrderText(text) {
  const summary = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" / ");
  return summary || "No text entered";
}

function saveActiveOrderDraft() {
  const order = getActiveOrder();
  if (!order) {
    return;
  }

  order.label = orderLabelInput.value.trim() || order.label;
  order.text = textInput.value;
  order.settings = getCurrentSettings();
  if (order.status !== "captured" && order.status !== "exported") {
    order.status = "in-progress";
  }
}

function updateActiveOrderFromControls() {
  const order = getActiveOrder();
  if (!order) {
    return;
  }

  order.label = orderLabelInput.value.trim() || order.label;
  order.text = textInput.value;
  order.settings = getCurrentSettings();
  order.capturedLayout = null;
  order.status = "in-progress";
  renderOrderList();
}

function renderOrderList() {
  const searchTerm = orderSearchInput.value.trim().toLowerCase();
  const visibleOrders = orders.filter((order) => {
    if (!searchTerm) {
      return true;
    }

    return `${order.label} ${order.text}`.toLowerCase().includes(searchTerm);
  });
  const completeCount = orders.filter((order) => order.status === "captured" || order.status === "exported").length;
  const progressCount = orders.filter((order) => order.status === "in-progress").length;
  const notStartedCount = orders.filter((order) => order.status === "not-started").length;
  const exportableCount = orders.filter((order) => order.text.trim()).length;

  orderCountOutput.textContent = String(orders.length);
  completeCountOutput.textContent = String(completeCount);
  progressCountOutput.textContent = String(progressCount);
  notStartedCountOutput.textContent = String(notStartedCount);
  exportCompletedButton.disabled = exportableCount === 0;
  orderList.replaceChildren();

  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "order-empty";
    empty.textContent = "Add one Etsy order at a time. Multi-line text stays inside that order.";
    orderList.append(empty);
  }

  if (orders.length && !visibleOrders.length) {
    const empty = document.createElement("p");
    empty.className = "order-empty";
    empty.textContent = "No orders match the current search.";
    orderList.append(empty);
  }

  visibleOrders.forEach((order) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `order-item${order.id === activeOrderId ? " active" : ""}`;
    item.setAttribute("role", "listitem");

    const header = document.createElement("span");
    header.className = "order-item-header";

    const title = document.createElement("span");
    title.textContent = order.label;

    const status = document.createElement("span");
    status.className = `order-status ${order.status}`;
    status.textContent = statusLabels[order.status];

    const previewText = document.createElement("span");
    previewText.className = "order-item-text";
    previewText.textContent = summarizeOrderText(order.text);

    header.append(title, status);
    item.append(header, previewText);
    item.addEventListener("click", () => selectOrder(order.id));
    orderList.append(item);
  });

  const activeOrder = getActiveOrder();
  editorPanel.classList.toggle("is-hidden", !activeOrder);
  activeOrderName.textContent = activeOrder
    ? activeOrder.label
    : "No order selected";
  captureButton.disabled = !activeOrder || !activeOrder.text.trim();
  downloadButton.disabled = !activeOrder || !activeOrder.text.trim();
}

function selectOrder(orderId) {
  saveActiveOrderDraft();

  const order = orders.find((candidate) => candidate.id === orderId);
  if (!order) {
    return;
  }

  activeOrderId = order.id;
  if (order.status === "not-started") {
    order.status = "in-progress";
  }

  orderLabelInput.value = order.label;
  orderLabelInput.placeholder = order.label;
  applySettings(order.settings);
  renderOrderList();
  requestAnimationFrame(() => {
    render();
  });
}

function addOrder() {
  const label = `Order ${orderSequence}`;
  const order = {
    id: crypto.randomUUID(),
    label,
    text: "",
    status: "in-progress",
    settings: {
      ...getCurrentSettings(),
      text: "",
    },
    capturedLayout: null,
  };

  orders.push(order);
  orderSequence += 1;
  orderLabelInput.placeholder = `Order ${orderSequence}`;
  selectOrder(order.id);
  fontStatus.classList.remove("warning");
  fontStatus.textContent = `${label} added. Enter the label and text in the editor.`;
}

function captureActiveOrder() {
  const order = getActiveOrder();
  if (!order) {
    return;
  }

  if (!textInput.value.trim()) {
    fontStatus.classList.add("warning");
    fontStatus.textContent = "Enter order text before saving this layout.";
    return;
  }

  order.label = orderLabelInput.value.trim() || order.label;
  order.text = textInput.value;
  order.settings = getCurrentSettings();
  order.capturedLayout = structuredClone(lastLayout);
  order.status = "captured";
  renderOrderList();

  const currentLabel = order.label;
  const activeIndex = orders.findIndex((candidate) => candidate.id === order.id);
  const orderedCandidates = [
    ...orders.slice(activeIndex + 1),
    ...orders.slice(0, activeIndex),
  ];
  const nextUncaptured = orderedCandidates.find((candidate) => candidate.status !== "captured" && candidate.status !== "exported");
  if (nextUncaptured) {
    selectOrder(nextUncaptured.id);
    fontStatus.classList.remove("warning");
    fontStatus.textContent = `${currentLabel} saved. Moved to ${nextUncaptured.label}.`;
    return;
  }

  fontStatus.classList.remove("warning");
  fontStatus.textContent = `${currentLabel} saved. All orders in the queue are saved.`;
}

async function checkFont() {
  try {
    const response = await fetch(FONT_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Font file not found");
    }

    await document.fonts.load(`120px "${FONT_FAMILY}"`);
    fontStatus.classList.remove("warning");
    fontStatus.textContent = "Using Candlepin-Laser.otf from public/fonts.";
  } catch {
    fontStatus.classList.add("warning");
    fontStatus.textContent = "Candlepin-Laser.otf is not available in public/fonts yet, so this preview is using a fallback script font.";
  }
}

function measureCharacter(character, fontSizeMm) {
  const fontSizePx = fontSizeMm * PX_PER_MM;
  ctx.font = `${fontSizePx}px "${FONT_FAMILY}", "Segoe Script", cursive`;
  const metrics = ctx.measureText(character);
  const left = (metrics.actualBoundingBoxLeft || 0) / PX_PER_MM;
  const right = (metrics.actualBoundingBoxRight || metrics.width) / PX_PER_MM;

  return {
    advance: metrics.width / PX_PER_MM,
    left,
    right,
    inkWidth: left + right,
  };
}

function createGlyphMask(character, fontSizeMm) {
  const fontSizePx = fontSizeMm * PX_PER_MM * MASK_SCALE;
  const maskCanvas = document.createElement("canvas");
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });

  maskContext.font = `${fontSizePx}px "${FONT_FAMILY}", "Segoe Script", cursive`;
  const metrics = maskContext.measureText(character);
  const left = Math.ceil(metrics.actualBoundingBoxLeft || 0);
  const right = Math.ceil(metrics.actualBoundingBoxRight || metrics.width);
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent || fontSizePx * 0.8);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent || fontSizePx * 0.25);
  const width = Math.max(1, left + right + MASK_PADDING_PX * 2);
  const height = Math.max(1, ascent + descent + MASK_PADDING_PX * 2);
  const baseline = MASK_PADDING_PX + ascent;

  maskCanvas.width = width;
  maskCanvas.height = height;
  maskContext.font = `${fontSizePx}px "${FONT_FAMILY}", "Segoe Script", cursive`;
  maskContext.fillStyle = "#000";
  maskContext.textBaseline = "alphabetic";
  maskContext.fillText(character, MASK_PADDING_PX + left, baseline);

  const imageData = maskContext.getImageData(0, 0, width, height);

  return {
    character,
    data: imageData.data,
    width,
    height,
    baseline,
    leftMm: left / MASK_SCALE / PX_PER_MM,
    rightMm: right / MASK_SCALE / PX_PER_MM,
    ascentMm: ascent / MASK_SCALE / PX_PER_MM,
    descentMm: descent / MASK_SCALE / PX_PER_MM,
  };
}

function maskHasInk(mask, x, y) {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) {
    return false;
  }

  return mask.data[(y * mask.width + x) * 4 + 3] > 32;
}

function getOverlapWidthPx(leftMask, rightMask, dxPx) {
  const baselineDelta = leftMask.baseline - rightMask.baseline;
  let minX = Infinity;
  let maxX = -Infinity;

  for (let rightY = 0; rightY < rightMask.height; rightY += 1) {
    const leftY = rightY + baselineDelta;
    if (leftY < 0 || leftY >= leftMask.height) {
      continue;
    }

    for (let rightX = 0; rightX < rightMask.width; rightX += 1) {
      if (!maskHasInk(rightMask, rightX, rightY)) {
        continue;
      }

      const leftX = rightX + dxPx;
      if (maskHasInk(leftMask, leftX, leftY)) {
        minX = Math.min(minX, leftX);
        maxX = Math.max(maxX, leftX);
      }
    }
  }

  return Number.isFinite(minX) ? maxX - minX + 1 : 0;
}

function findPairOffsetMm(leftMask, rightMask, bridgeMm) {
  const targetPx = Math.max(1, Math.round(bridgeMm * PX_PER_MM * MASK_SCALE));
  const start = leftMask.width + rightMask.width;
  const end = -rightMask.width;

  for (let dx = start; dx >= end; dx -= 1) {
    if (getOverlapWidthPx(leftMask, rightMask, dx) >= targetPx) {
      const rightOriginRelativeToLeft = dx / MASK_SCALE / PX_PER_MM;
      return rightOriginRelativeToLeft;
    }
  }

  return (leftMask.rightMm + rightMask.leftMm) - bridgeMm;
}

function createLineMask(letters, fontSizeMm) {
  const scale = PX_PER_MM * MASK_SCALE;
  const minLeft = Math.min(...letters.map((letter) => letter.leftEdge), 0);
  const maxRight = Math.max(...letters.map((letter) => letter.rightEdge), fontSizeMm);
  const width = Math.ceil((maxRight - minLeft) * scale) + MASK_PADDING_PX * 2;
  const height = Math.ceil(fontSizeMm * 1.35 * scale) + MASK_PADDING_PX * 2;
  const baseline = MASK_PADDING_PX + Math.ceil(fontSizeMm * scale);
  const maskCanvas = document.createElement("canvas");
  const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });

  maskCanvas.width = width;
  maskCanvas.height = height;
  maskContext.font = `${fontSizeMm * scale}px "${FONT_FAMILY}", "Segoe Script", cursive`;
  maskContext.fillStyle = "#000";
  maskContext.textBaseline = "alphabetic";

  letters.forEach((letter) => {
    maskContext.fillText(letter.character, MASK_PADDING_PX + (letter.x - minLeft) * scale, baseline);
  });

  const imageData = maskContext.getImageData(0, 0, width, height);
  let inkLeft = width;
  let inkRight = 0;
  let hasInk = false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (imageData.data[(y * width + x) * 4 + 3] > 32) {
        inkLeft = Math.min(inkLeft, x);
        inkRight = Math.max(inkRight, x);
        hasInk = true;
      }
    }
  }

  const visualLeftMm = hasInk ? minLeft + (inkLeft - MASK_PADDING_PX) / scale : minLeft;
  const visualRightMm = hasInk ? minLeft + (inkRight - MASK_PADDING_PX) / scale : maxRight;
  let inkTop = height;
  let inkBottom = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (imageData.data[(y * width + x) * 4 + 3] > 32) {
        inkTop = Math.min(inkTop, y);
        inkBottom = Math.max(inkBottom, y);
      }
    }
  }

  const visualTopMm = hasInk ? (inkTop - MASK_PADDING_PX) / scale : 0;
  const visualBottomMm = hasInk ? (inkBottom - MASK_PADDING_PX) / scale : fontSizeMm;

  return {
    data: imageData.data,
    width,
    height,
    baseline,
    inkLeft,
    inkRight,
    leftMm: visualLeftMm,
    rightMm: visualRightMm,
    topMm: visualTopMm,
    bottomMm: visualBottomMm,
    widthMm: visualRightMm - visualLeftMm,
    heightMm: visualBottomMm - visualTopMm,
    baselineMm: baseline / scale,
  };
}

function getLineOverlapHeightPx(upperMask, lowerMask, dxPx, dyPx) {
  let minY = Infinity;
  let maxY = -Infinity;

  for (let lowerY = 0; lowerY < lowerMask.height; lowerY += 1) {
    const upperY = lowerY + dyPx;
    if (upperY < 0 || upperY >= upperMask.height) {
      continue;
    }

    for (let lowerX = 0; lowerX < lowerMask.width; lowerX += 1) {
      if (!maskHasInk(lowerMask, lowerX, lowerY)) {
        continue;
      }

      const upperX = lowerX + dxPx;
      if (maskHasInk(upperMask, upperX, upperY)) {
        minY = Math.min(minY, upperY);
        maxY = Math.max(maxY, upperY);
      }
    }
  }

  return Number.isFinite(minY) ? maxY - minY + 1 : 0;
}

function findLineOffsetMm(upperMask, lowerMask, bridgeMm) {
  const scale = PX_PER_MM * MASK_SCALE;
  const targetPx = Math.max(1, Math.round(bridgeMm * scale));
  const upperCenter = (upperMask.inkLeft + upperMask.inkRight) / 2;
  const lowerCenter = (lowerMask.inkLeft + lowerMask.inkRight) / 2;
  const dxPx = Math.round(upperCenter - lowerCenter);

  for (let dy = upperMask.height; dy >= -lowerMask.height; dy -= 1) {
    if (getLineOverlapHeightPx(upperMask, lowerMask, dxPx, dy) >= targetPx) {
      return dy / scale;
    }
  }

  return (upperMask.height - MASK_PADDING_PX * 2) / scale - bridgeMm;
}

function layoutCharacters(text, fontSizeMm, bridgeMm) {
  const characters = [...text].filter((character) => character !== "\n");
  if (!characters.length) {
    return [];
  }

  const masks = characters.map((character) => createGlyphMask(character, fontSizeMm));
  const positions = [];

  return characters.map((character, index) => {
    const metrics = measureCharacter(character, fontSizeMm);
    const mask = masks[index];
    const maskOrigin = index === 0
      ? 0
      : positions[index - 1].maskOrigin + findPairOffsetMm(masks[index - 1], mask, bridgeMm);
    positions.push({ maskOrigin });

    const x = maskOrigin + mask.leftMm;
    const leftEdge = x - metrics.left;
    const rightEdge = x + metrics.right;

    const item = {
      character,
      index,
      x,
      leftEdge,
      rightEdge,
      width: metrics.inkWidth,
      advance: metrics.advance,
    };

    return item;
  });
}

function layoutTextLines(text, fontSizeMm, letterBridgeMm, lineBridgeMm) {
  const rawLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lineTexts = rawLines.length ? rawLines : ["Emily"];
  const lines = lineTexts.map((lineText, index) => {
    const letters = layoutCharacters(lineText, fontSizeMm, letterBridgeMm);
    return {
      index,
      text: lineText,
      letters,
      mask: createLineMask(letters, fontSizeMm),
      y: 0,
    };
  });

  lines.forEach((line, index) => {
    if (index === 0) {
      line.y = 0;
      return;
    }

    const previous = lines[index - 1];
    line.y = previous.y + findLineOffsetMm(previous.mask, line.mask, lineBridgeMm);
  });

  return lines;
}

function makeSvgElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

function fillBackingHoles(imageData, width, height) {
  const data = imageData.data;
  const visited = new Uint8Array(width * height);
  const queue = [];

  function isTransparent(index) {
    return data[index * 4 + 3] <= 32;
  }

  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return;
    }

    const index = y * width + x;
    if (visited[index] || !isTransparent(index)) {
      return;
    }

    visited[index] = 1;
    queue.push(index);
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }

  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (queue.length) {
    const index = queue.pop();
    const x = index % width;
    const y = Math.floor(index / width);

    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  for (let index = 0; index < width * height; index += 1) {
    if (!visited[index]) {
      const offset = index * 4;
      data[offset] = 68;
      data[offset + 1] = 111;
      data[offset + 2] = 139;
      data[offset + 3] = 255;
    }
  }
}

function createBackingImage(letters, widthMm, heightMm, fontSizeMm, backingMm) {
  const scale = PX_PER_MM * 3;
  const backingCanvas = document.createElement("canvas");
  const backingContext = backingCanvas.getContext("2d", { willReadFrequently: true });
  const widthPx = Math.ceil(widthMm * scale);
  const heightPx = Math.ceil(heightMm * scale);

  backingCanvas.width = widthPx;
  backingCanvas.height = heightPx;
  backingContext.font = `${fontSizeMm * scale}px "${FONT_FAMILY}", "Segoe Script", cursive`;
  backingContext.textBaseline = "alphabetic";
  backingContext.lineJoin = "round";
  backingContext.lineCap = "round";
  backingContext.strokeStyle = "#446f8b";
  backingContext.fillStyle = "#446f8b";
  backingContext.lineWidth = backingMm * 2 * scale;

  letters.forEach((letter) => {
    backingContext.strokeText(letter.character, letter.x * scale, letter.y * scale);
    backingContext.fillText(letter.character, letter.x * scale, letter.y * scale);
  });

  const imageData = backingContext.getImageData(0, 0, widthPx, heightPx);
  fillBackingHoles(imageData, widthPx, heightPx);
  backingContext.putImageData(imageData, 0, 0);

  return backingCanvas.toDataURL("image/png");
}

function createFaceImage(letters, widthMm, heightMm, fontSizeMm) {
  const scale = PX_PER_MM * 3;
  const faceCanvas = document.createElement("canvas");
  const faceContext = faceCanvas.getContext("2d");
  const widthPx = Math.ceil(widthMm * scale);
  const heightPx = Math.ceil(heightMm * scale);

  faceCanvas.width = widthPx;
  faceCanvas.height = heightPx;
  faceContext.font = `${fontSizeMm * scale}px "${FONT_FAMILY}", "Segoe Script", cursive`;
  faceContext.textBaseline = "alphabetic";
  faceContext.lineJoin = "round";
  faceContext.lineCap = "round";
  faceContext.fillStyle = "#f8fbfc";

  letters.forEach((letter) => {
    faceContext.fillText(letter.character, letter.x * scale, letter.y * scale);
  });

  return faceCanvas.toDataURL("image/png");
}

function render() {
  const text = textInput.value.trim();
  const bridgeMm = Number(overlapInput.value);
  const lineBridgeMm = Number(lineOverlapInput.value);
  const fontSizeMm = Number(sizeInput.value);
  const backingMm = Number(backingInput.value);

  overlapOutput.textContent = `${bridgeMm.toFixed(1)} mm`;
  lineOverlapOutput.textContent = `${lineBridgeMm.toFixed(1)} mm`;
  sizeOutput.textContent = `${fontSizeMm.toFixed(0)} mm`;
  backingOutput.textContent = `${backingMm.toFixed(3)} mm`;

  if (!text) {
    lastLayout = null;
    renderPreviewGuideOnly();
    return;
  }

  const layout = buildOrderLayout({
    text,
    bridgeMm,
    lineBridgeMm,
    fontSizeMm,
    backingMm,
  });
  const previewWidthMm = Math.max(layout.widthMm, PREVIEW_BOX_WIDTH_MM) + PREVIEW_MARGIN_MM * 2;
  const previewHeightMm = Math.max(layout.heightMm, PREVIEW_BOX_HEIGHT_MM) + PREVIEW_MARGIN_MM * 2;
  const previewBoxX = (previewWidthMm - PREVIEW_LABEL_RIGHT_MM - PREVIEW_BOX_WIDTH_MM) / 2;
  const previewBoxY = (previewHeightMm - PREVIEW_BOX_HEIGHT_MM) / 2;
  const designX = previewBoxX + (PREVIEW_BOX_WIDTH_MM - layout.widthMm) / 2;
  const designY = previewBoxY + (PREVIEW_BOX_HEIGHT_MM - layout.heightMm) / 2;

  lastLayout = {
    ...layout,
    previewWidthMm,
    previewHeightMm,
  };

  preview.replaceChildren();
  preview.setAttribute("viewBox", `0 0 ${previewWidthMm} ${previewHeightMm}`);
  updateZoom(zoom);

  const backingImage = makeSvgElement("image", {
    href: createBackingImage(layout.letters, layout.widthMm, layout.heightMm, layout.fontSizeMm, layout.backingMm),
    x: designX,
    y: designY,
    width: layout.widthMm,
    height: layout.heightMm,
  });
  const faceImage = makeSvgElement("image", {
    class: "face-layer",
    href: createFaceImage(layout.letters, layout.widthMm, layout.heightMm, layout.fontSizeMm),
    x: designX,
    y: designY,
    width: layout.widthMm,
    height: layout.heightMm,
  });

  appendPreviewGuide(previewBoxX, previewBoxY);
  preview.append(backingImage, faceImage);
}

async function downloadSvg() {
  if (!lastLayout) {
    fontStatus.classList.add("warning");
    fontStatus.textContent = "Enter order text before exporting this order.";
    return;
  }

  downloadButton.disabled = true;
  downloadButton.textContent = "Exporting...";
  downloadButton.setAttribute("aria-busy", "true");
  fontStatus.classList.remove("warning");
  fontStatus.textContent = "Generating welded vector SVG...";

  try {
    await requestSvgExport({
      layout: lastLayout,
      filename: "candlepin-layout-poc.svg",
    });
    fontStatus.classList.remove("warning");
    fontStatus.textContent = "Vector SVG exported.";
    const order = getActiveOrder();
    if (order) {
      order.status = "exported";
      order.capturedLayout = structuredClone(lastLayout);
      order.settings = getCurrentSettings();
      renderOrderList();
    }
  } catch {
    fontStatus.classList.add("warning");
    fontStatus.textContent = "Vector SVG export failed. Check the terminal for details.";
  } finally {
    downloadButton.disabled = false;
    downloadButton.textContent = "Export This Order";
    downloadButton.removeAttribute("aria-busy");
    renderOrderList();
  }
}

async function requestSvgExport({ layout = null, layouts = null, filename }) {
  const payload = layouts
    ? { layouts }
    : layout;
  const response = await fetch("/api/export-svg", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Vector SVG export failed");
  }

  const svgSource = await response.text();
  const blob = new Blob([svgSource], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportAllOrders() {
  saveActiveOrderDraft();
  renderOrderList();

  const exportableOrders = orders.filter((order) => order.text.trim());
  if (!exportableOrders.length) {
    fontStatus.classList.add("warning");
    fontStatus.textContent = "Add text to at least one order before exporting all orders.";
    return;
  }

  exportCompletedButton.disabled = true;
  exportCompletedButton.textContent = "Exporting...";
  exportCompletedButton.setAttribute("aria-busy", "true");
  fontStatus.classList.remove("warning");
  fontStatus.textContent = `Generating batch SVG for ${exportableOrders.length} order${exportableOrders.length === 1 ? "" : "s"}...`;

  try {
    const builtLayouts = exportableOrders.map((order) => ({
      order,
      layout: buildOrderLayout(order.settings),
    }));

    await requestSvgExport({
      layouts: builtLayouts.map(({ layout }) => layout),
      filename: "candlepin-layout-batch.svg",
    });

    builtLayouts.forEach(({ order, layout }) => {
      order.status = "exported";
      order.capturedLayout = structuredClone(layout);
    });
    fontStatus.classList.remove("warning");
    fontStatus.textContent = `Batch SVG exported for ${exportableOrders.length} order${exportableOrders.length === 1 ? "" : "s"}.`;
  } catch {
    fontStatus.classList.add("warning");
    fontStatus.textContent = "Batch SVG export failed. Check the terminal for details.";
  } finally {
    exportCompletedButton.disabled = false;
    exportCompletedButton.textContent = "Export All Orders";
    exportCompletedButton.removeAttribute("aria-busy");
    renderOrderList();
  }
}

function buildOrderLayout(settings) {
  const text = settings.text.trim();
  const bridgeMm = Number(settings.bridgeMm);
  const lineBridgeMm = Number(settings.lineBridgeMm);
  const fontSizeMm = Number(settings.fontSizeMm);
  const backingMm = Number(settings.backingMm);
  const lines = layoutTextLines(text, fontSizeMm, bridgeMm, lineBridgeMm);
  const textWidthMm = Math.max(...lines.map((line) => line.mask.widthMm), fontSizeMm);
  const minTopMm = Math.min(...lines.map((line) => line.y + line.mask.topMm));
  const maxBottomMm = Math.max(...lines.map((line) => line.y + line.mask.bottomMm));
  const rawTextHeightMm = maxBottomMm - minTopMm;
  const scaleFactor = Math.min(
    MAX_RENDER_WIDTH_MM / textWidthMm,
    MAX_RENDER_HEIGHT_MM / rawTextHeightMm,
  );
  const scaledBackingMm = backingMm * scaleFactor;
  const rawWidthMm = textWidthMm + backingMm * 2 + DESIGN_BLEED_MM * 2;
  const rawHeightMm = rawTextHeightMm + backingMm * 2 + DESIGN_BLEED_MM * 2;
  const widthMm = rawWidthMm * scaleFactor;
  const heightMm = rawHeightMm * scaleFactor;
  const absoluteLetters = lines.flatMap((line) => {
    const rawLineX = DESIGN_BLEED_MM + backingMm + (textWidthMm - line.mask.widthMm) / 2 - line.mask.leftMm;
    const rawBaselineY = DESIGN_BLEED_MM + backingMm + (line.y - minTopMm) + line.mask.baselineMm;

    return line.letters.map((letter) => ({
      character: letter.character,
      x: (rawLineX + letter.x) * scaleFactor,
      y: rawBaselineY * scaleFactor,
    }));
  });

  return {
    text,
    bridgeMm,
    lineBridgeMm,
    widthMm,
    heightMm,
    fontSizeMm: fontSizeMm * scaleFactor,
    backingMm: scaledBackingMm,
    letters: absoluteLetters,
  };
}

[textInput, overlapInput, lineOverlapInput, sizeInput, backingInput].forEach((control) => {
  control.addEventListener("input", () => {
    render();
    updateActiveOrderFromControls();
  });
});

orderLabelInput.addEventListener("input", () => {
  const order = getActiveOrder();
  if (!order) {
    return;
  }

  order.label = orderLabelInput.value.trim() || `Order ${orders.indexOf(order) + 1}`;
  order.status = "in-progress";
  renderOrderList();
});
addOrderButton.addEventListener("click", addOrder);
exportCompletedButton.addEventListener("click", exportAllOrders);
orderSearchInput.addEventListener("input", renderOrderList);
captureButton.addEventListener("click", captureActiveOrder);
downloadButton.addEventListener("click", downloadSvg);
zoomOutButton.addEventListener("click", () => updateZoom(zoom / 1.2));
zoomInButton.addEventListener("click", () => updateZoom(zoom * 1.2));
zoomResetButton.addEventListener("click", () => updateZoom(DEFAULT_ZOOM));
previewPanel.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = previewPanel.getBoundingClientRect();
  const anchor = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  const direction = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  updateZoom(zoom * direction, anchor);
}, { passive: false });

await checkFont();
renderPreviewGuideOnly();
render();
renderOrderList();
