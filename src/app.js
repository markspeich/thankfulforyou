const FONT_URL = "public/fonts/Candlepin-Laser.otf";
const FONT_FAMILY = "CandlepinLaser";
const PX_PER_MM = 96 / 25.4;

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
const guideInput = document.querySelector("#guideInput");
const fontStatus = document.querySelector("#fontStatus");
const preview = document.querySelector("#preview");
const previewPanel = document.querySelector(".preview-panel");
const zoomOutButton = document.querySelector("#zoomOutButton");
const zoomInButton = document.querySelector("#zoomInButton");
const zoomResetButton = document.querySelector("#zoomResetButton");
const zoomOutput = document.querySelector("#zoomOutput");
const downloadButton = document.querySelector("#downloadButton");
const captureButton = document.querySelector("#captureButton");
const nextOrderButton = document.querySelector("#nextOrderButton");

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
const MASK_SCALE = 3;
const MASK_PADDING_PX = 12;
let lastLayout = null;
let zoom = 1;
let orderSequence = 1;
let activeOrderId = null;
const orders = [];

const statusLabels = {
  "not-started": "Not started",
  "in-progress": "In progress",
  captured: "Captured",
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
    preview.style.setProperty("--preview-width", `${lastLayout.widthMm * PX_PER_MM * zoom}px`);
    preview.style.setProperty("--preview-height", `${lastLayout.heightMm * PX_PER_MM * zoom}px`);
  }

  if (anchor && previousZoom !== zoom) {
    const ratio = zoom / previousZoom;
    previewPanel.scrollLeft = (previewPanel.scrollLeft + anchor.x) * ratio - anchor.x;
    previewPanel.scrollTop = (previewPanel.scrollTop + anchor.y) * ratio - anchor.y;
  }
}

function getCurrentSettings() {
  return {
    text: textInput.value,
    bridgeMm: Number(overlapInput.value),
    lineBridgeMm: Number(lineOverlapInput.value),
    fontSizeMm: Number(sizeInput.value),
    backingMm: Number(backingInput.value),
    showGuides: guideInput.checked,
  };
}

function applySettings(settings) {
  textInput.value = settings.text;
  overlapInput.value = settings.bridgeMm;
  lineOverlapInput.value = settings.lineBridgeMm;
  sizeInput.value = settings.fontSizeMm;
  backingInput.value = settings.backingMm;
  guideInput.checked = settings.showGuides;
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

  orderCountOutput.textContent = String(orders.length);
  completeCountOutput.textContent = String(completeCount);
  progressCountOutput.textContent = String(progressCount);
  notStartedCountOutput.textContent = String(notStartedCount);
  exportCompletedButton.disabled = completeCount === 0;
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
  nextOrderButton.disabled = orders.length < 2;
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
  render();
  renderOrderList();
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

function selectNextUncapturedOrder() {
  if (!orders.length) {
    return;
  }

  const activeIndex = Math.max(0, orders.findIndex((order) => order.id === activeOrderId));
  const orderedCandidates = [
    ...orders.slice(activeIndex + 1),
    ...orders.slice(0, activeIndex),
  ];
  const nextUncaptured = orderedCandidates.find((order) => order.status !== "captured" && order.status !== "exported");

  if (nextUncaptured) {
    selectOrder(nextUncaptured.id);
    return;
  }

  const nextOrder = orders[(activeIndex + 1) % orders.length];
  selectOrder(nextOrder.id);
}

function captureActiveOrder() {
  const order = getActiveOrder();
  if (!order) {
    return;
  }

  if (!textInput.value.trim()) {
    fontStatus.classList.add("warning");
    fontStatus.textContent = "Enter order text before capturing this layout.";
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
    fontStatus.textContent = `${currentLabel} captured. Moved to ${nextUncaptured.label}.`;
    return;
  }

  fontStatus.classList.remove("warning");
  fontStatus.textContent = `${currentLabel} captured. All orders in the queue are captured.`;
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

  return {
    data: imageData.data,
    width,
    height,
    baseline,
    inkLeft,
    inkRight,
    leftMm: visualLeftMm,
    rightMm: visualRightMm,
    widthMm: visualRightMm - visualLeftMm,
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
  const hasActiveOrder = Boolean(getActiveOrder());
  const text = textInput.value.trim();
  const bridgeMm = Number(overlapInput.value);
  const lineBridgeMm = Number(lineOverlapInput.value);
  const fontSizeMm = Number(sizeInput.value);
  const backingMm = Number(backingInput.value);
  const showGuides = guideInput.checked;

  overlapOutput.textContent = `${bridgeMm.toFixed(1)} mm`;
  lineOverlapOutput.textContent = `${lineBridgeMm.toFixed(1)} mm`;
  sizeOutput.textContent = `${fontSizeMm.toFixed(0)} mm`;
  backingOutput.textContent = `${backingMm.toFixed(3)} mm`;

  if (hasActiveOrder && !text) {
    lastLayout = null;
    preview.replaceChildren();
    preview.removeAttribute("viewBox");
    return;
  }

  const layoutText = text || "Emily";
  const lines = layoutTextLines(layoutText, fontSizeMm, bridgeMm, lineBridgeMm);
  const textWidthMm = Math.max(...lines.map((line) => line.mask.widthMm), fontSizeMm);
  const textHeightMm = Math.max(...lines.map((line) => line.y + line.mask.height / (PX_PER_MM * MASK_SCALE)), fontSizeMm);
  const widthMm = Math.max(textWidthMm + backingMm * 2 + 18, 90);
  const heightMm = Math.max(textHeightMm + backingMm * 2 + 16, 58);
  const topOffset = backingMm + 5;
  const absoluteLetters = lines.flatMap((line) => {
    const lineX = (widthMm - line.mask.widthMm) / 2 - line.mask.leftMm;
    const baselineY = topOffset + line.y + line.mask.baselineMm;

    return line.letters.map((letter) => ({
      ...letter,
      x: lineX + letter.x,
      y: baselineY,
      lineIndex: line.index,
      absoluteLeftEdge: lineX + letter.leftEdge,
    }));
  });

  lastLayout = {
    text: layoutText,
    bridgeMm,
    lineBridgeMm,
    widthMm,
    heightMm,
    fontSizeMm,
    backingMm,
    letters: absoluteLetters.map((letter) => ({
      character: letter.character,
      x: letter.x,
      y: letter.y,
    })),
  };

  preview.replaceChildren();
  preview.setAttribute("viewBox", `0 0 ${widthMm} ${heightMm}`);
  updateZoom(zoom);

  const guideGroup = makeSvgElement("g");
  const backingImage = makeSvgElement("image", {
    href: createBackingImage(absoluteLetters, widthMm, heightMm, fontSizeMm, backingMm),
    x: 0,
    y: 0,
    width: widthMm,
    height: heightMm,
  });
  const faceImage = makeSvgElement("image", {
    class: "face-layer",
    href: createFaceImage(absoluteLetters, widthMm, heightMm, fontSizeMm),
    x: 0,
    y: 0,
    width: widthMm,
    height: heightMm,
  });

  absoluteLetters.forEach((letter, index) => {
    if (showGuides && index > 0 && bridgeMm > 0) {
      const previousLetter = absoluteLetters[index - 1];
      if (previousLetter.lineIndex !== letter.lineIndex) {
        return;
      }

      const guide = makeSvgElement("rect", {
        class: "bridge-guide",
        x: letter.absoluteLeftEdge,
        y: letter.y - fontSizeMm * 0.62,
        width: bridgeMm,
        height: fontSizeMm * 0.48,
        rx: 0.5,
      });
      guideGroup.append(guide);
    }
  });

  preview.append(backingImage, guideGroup, faceImage);
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
    const response = await fetch("/api/export-svg", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(lastLayout),
    });

    if (!response.ok) {
      throw new Error("Vector SVG export failed");
    }

    const svgSource = await response.text();
    const blob = new Blob([svgSource], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "candlepin-layout-poc.svg";
    link.click();
    URL.revokeObjectURL(url);
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

[textInput, overlapInput, lineOverlapInput, sizeInput, backingInput, guideInput].forEach((control) => {
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
exportCompletedButton.addEventListener("click", () => {
  const completeCount = orders.filter((order) => order.status === "captured" || order.status === "exported").length;
  if (!completeCount) {
    return;
  }

  fontStatus.classList.add("warning");
  fontStatus.textContent = "Batch export is not wired yet. Export completed orders one at a time for now.";
});
orderSearchInput.addEventListener("input", renderOrderList);
captureButton.addEventListener("click", captureActiveOrder);
nextOrderButton.addEventListener("click", () => {
  saveActiveOrderDraft();
  selectNextUncapturedOrder();
});
downloadButton.addEventListener("click", downloadSvg);
zoomOutButton.addEventListener("click", () => updateZoom(zoom / 1.2));
zoomInButton.addEventListener("click", () => updateZoom(zoom * 1.2));
zoomResetButton.addEventListener("click", () => updateZoom(1));
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
render();
renderOrderList();
