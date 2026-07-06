const CLIPBOARD_PAYLOAD_SOURCE = "thankfulforyou-amazon-clipboard";
const ITEM_LABEL_SEPARATOR = " - ";
const AMAZON_ORDER_ID_PATTERN = /\b\d{3}-\d{7}-\d{7}\b/;

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function getElementText(element) {
  return normalizeText(element?.textContent || element?.innerText || "");
}

function getOrderNumber() {
  const orderIdElement = document.querySelector('[data-test-id="order-id-value"]');
  const orderId = getElementText(orderIdElement);
  if (orderId) {
    return orderId;
  }

  const urlOrderId = String(window.location?.href || "").match(AMAZON_ORDER_ID_PATTERN);
  return urlOrderId?.[0] || "";
}

function getBuyerName() {
  const contactBuyer = getElementText(document.querySelector('[data-test-id="shipping-section-contact-buyer-value"]'));
  if (contactBuyer) {
    return contactBuyer;
  }

  const shippingAddress = getElementText(document.querySelector('[data-test-id="shipping-section-buyer-address"]'));
  return shippingAddress.split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
}

function extractMatch(text, pattern) {
  const match = text.match(pattern);
  return normalizeText(match?.[1] || "");
}

function getProductTitle(row) {
  const productLink = row.querySelector('a[href*="/gp/product/"]');
  return getElementText(productLink);
}

function getListingId(row, rowText) {
  const productLink = row.querySelector('a[href*="/gp/product/"]');
  const href = productLink?.getAttribute?.("href") || "";
  const productMatch = href.match(/\/gp\/product\/([^/?#]+)/i);
  if (productMatch?.[1]) {
    return normalizeText(productMatch[1]);
  }

  return extractMatch(rowText, /ASIN\s*:?\s*([A-Z0-9]+?)(?=\s*SKU\b|\s|$)/i);
}

function extractOrderItemIdFromText(rowText) {
  const numericId = rowText.match(/Order Item ID\s*:?\s*(\d{15})/i);
  if (numericId?.[1]) {
    return numericId[1];
  }

  return extractMatch(rowText, /Order Item ID\s*:?\s*([A-Z0-9-]+?)(?=\s|\bItem\b|$)/i);
}

function getTransactionId(row, rowText) {
  const customizationLink = row.querySelector('a[href*="orderItemId="]');
  const href = customizationLink?.getAttribute?.("href") || "";
  const match = href.match(/[?&]orderItemId=([^&#]+)/i);
  if (match?.[1]) {
    return normalizeText(match[1]);
  }

  return extractOrderItemIdFromText(rowText);
}
function getQuantity(row, rowText) {
  const cells = Array.from(row.children || []);
  const numericCell = cells.find((cell) => /^\d+$/.test(getElementText(cell)));
  if (numericCell) {
    return getElementText(numericCell);
  }

  const quantityAfterOrderItem = extractMatch(rowText, /Order Item ID\s*:?\s*[A-Z0-9-]+\s*\n\s*(\d+)/i);
  if (quantityAfterOrderItem) {
    return quantityAfterOrderItem;
  }

  return extractMatch(rowText, /\b(\d+)\s*x\s*\$/i) || "1";
}

function getListingImageUrl(row) {
  const image = row.querySelector("img");
  return normalizeText(image?.getAttribute?.("src") || "");
}

function getOrderItemRowScore(row, rowText) {
  let score = 0;
  if (row.querySelector('a[href*="orderItemId="]')) score += 4;
  if (row.querySelectorAll(".customization-modification").length) score += 3;
  if (/Customizations\s*:/i.test(rowText)) score += 2;
  score -= Math.min(rowText.length / 10000, 1);
  return score;
}

function getOrderItemRows() {
  const rowsByOrderItemId = new Map();

  Array.from(document.querySelectorAll("table.a-keyvalue tbody tr")).forEach((row) => {
    const rowText = getElementText(row);
    if (!/Order Item ID\s*:/i.test(rowText)) {
      return;
    }

    const orderItemId = getTransactionId(row, rowText);
    if (!orderItemId) {
      return;
    }

    const candidate = { row, score: getOrderItemRowScore(row, rowText) };
    const existing = rowsByOrderItemId.get(orderItemId);
    if (!existing || candidate.score > existing.score) {
      rowsByOrderItemId.set(orderItemId, candidate);
    }
  });

  return Array.from(rowsByOrderItemId.values()).map((entry) => entry.row);
}

const CUSTOMIZATION_FIELD_LABELS = [
  "Surface 1",
  "Badge Reel Type",
  "Text Line 10",
  "Text Line 9",
  "Text Line 8",
  "Text Line 7",
  "Text Line 6",
  "Text Line 5",
  "Text Line 4",
  "Text Line 3",
  "Text Line 2",
  "Text Line 1",
  "Title Color",
  "Title Font",
  "Name Color",
  "Name Font",
  "Color",
  "Text",
  "Title",
  "Name",
];
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCanonicalCustomizationLabel(value) {
  const normalizedValue = normalizeText(value).replace(/:$/, "").toLowerCase();
  return CUSTOMIZATION_FIELD_LABELS.find((label) => label.toLowerCase() === normalizedValue) || "";
}

function setCustomizationField(fields, key, value) {
  const normalizedValue = normalizeText(value);
  if (!key || !normalizedValue) {
    return;
  }

  if (key === "Color" && fields.has(key)) {
    return;
  }

  fields.set(key, normalizedValue);
}
function parseColonCustomizationFields(fields, blockText) {
  const text = normalizeText(blockText).replace(/\n+/g, " ");
  const labelPattern = CUSTOMIZATION_FIELD_LABELS.map(escapeRegExp).join("|");
  const matches = Array.from(text.matchAll(new RegExp(`(?:^|\\s)(${labelPattern})\\s*:`, "gi")));

  matches.forEach((match, index) => {
    const key = getCanonicalCustomizationLabel(match[1]);
    const valueStart = match.index + match[0].length;
    const valueEnd = matches[index + 1]?.index ?? text.length;
    setCustomizationField(fields, key, text.slice(valueStart, valueEnd));
  });
}

function parseLineCustomizationFields(fields, blockText) {
  const lines = normalizeText(blockText).split(/\n+/).map((line) => line.trim()).filter(Boolean);

  lines.forEach((line, index) => {
    if (/^Customizations:?$/i.test(line)) {
      return;
    }

    const colonMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (colonMatch) {
      setCustomizationField(fields, getCanonicalCustomizationLabel(colonMatch[1]), colonMatch[2]);
      return;
    }

    const key = getCanonicalCustomizationLabel(line);
    if (!key) {
      return;
    }

    const nextLine = lines[index + 1] || "";
    if (!getCanonicalCustomizationLabel(nextLine) && !/^Customizations:?$/i.test(nextLine)) {
      setCustomizationField(fields, key, nextLine);
    }
  });
}

function parseCustomizationFields(blockText) {
  const fields = new Map();
  parseColonCustomizationFields(fields, blockText);
  parseLineCustomizationFields(fields, blockText);
  return fields;
}
function parseRowCustomizationFields(row, rowText = "") {
  const fields = new Map();
  row.querySelectorAll(".customization-modification").forEach((entry) => {
    const key = getCanonicalCustomizationLabel(getElementText(entry.querySelector(".a-color-tertiary")));
    const value = getElementText(entry.querySelector(".customization-modification-value"));
    setCustomizationField(fields, key, value);
  });
  if (!fields.size && rowText) return parseCustomizationFields(rowText);
  return fields;
}
function splitCustomizationBlocks(clipboardText) {
  const lines = normalizeText(clipboardText).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const blocks = [];
  let current = [];

  lines.forEach((line) => {
    if (/^Customizations:?$/i.test(line) && current.length) {
      blocks.push(current.join("\n"));
      current = [];
    }

    if (!/^Customizations:?$/i.test(line)) {
      current.push(line);
    }
  });

  if (current.length) {
    blocks.push(current.join("\n"));
  }

  return blocks.length ? blocks : [""];
}

function buildPersonalization(fields) {
  const textLineValues = Array.from({ length: 10 }, (_, index) => fields.get(`Text Line ${index + 1}`) || "")
    .filter(Boolean);

  if (textLineValues.length) {
    return textLineValues.join("\n");
  }

  return ["Name", "Title"]
    .map((key) => fields.get(key) || "")
    .filter(Boolean)
    .join("\n");
}
function hasDesignCustomizationFields(fields) {
  return Boolean(fields.get("Color") || buildPersonalization(fields));
}

function getCustomizationFields(row, rowText, customizationBlock) {
  if (customizationBlock) {
    const clipboardFields = parseCustomizationFields(customizationBlock);
    if (hasDesignCustomizationFields(clipboardFields)) {
      return clipboardFields;
    }
  }

  return parseRowCustomizationFields(row, rowText);
}

function buildOrderItemLabel(orderNumber, buyerName, itemNumber) {
  let label = `#${orderNumber}`;

  if (buyerName) {
    label += `${ITEM_LABEL_SEPARATOR}${buyerName}`;
  }

  if (itemNumber > 1) {
    label += `${ITEM_LABEL_SEPARATOR}Item ${itemNumber}`;
  }

  return label;
}

async function analyzeAmazonOrderForClipboard() {
  const orderNumber = getOrderNumber();
  const buyerName = getBuyerName();
  const rows = getOrderItemRows();
  const customizationText = await navigator.clipboard.readText();
  const customizationBlocks = splitCustomizationBlocks(customizationText);

  return rows.map((row, index) => {
    const rowText = getElementText(row);
    const customizationBlock = customizationBlocks[index] || customizationBlocks[0] || "";
    const fields = getCustomizationFields(row, rowText, customizationBlock);

    return {
      orderNumber,
      listingId: getListingId(row, rowText),
      transactionId: getTransactionId(row, rowText),
      buyerName,
      colorName: fields.get("Color") || "",
      quantity: getQuantity(row, rowText),
      listingTitle: getProductTitle(row),
      listingImageUrl75x75: getListingImageUrl(row),
      label: buildOrderItemLabel(orderNumber, buyerName, index + 1),
      personalization: buildPersonalization(fields),
    };
  });
}

async function copyBadgeBatchPayload() {
  const items = await analyzeAmazonOrderForClipboard();

  if (!items.length) {
    console.warn("No Amazon order items found on this page.");
    return;
  }

  const payload = JSON.stringify({
    source: CLIPBOARD_PAYLOAD_SOURCE,
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
  }, null, 2);

  await navigator.clipboard.writeText(payload);
  console.info(`Copied ${items.length} Amazon design items to the clipboard.`);
}

function ensureCopyButton() {
  if (document.querySelector("[data-badge-clipboard-copy]")) {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.badgeClipboardCopy = "true";
  button.textContent = "Copy Orders";
  button.style.position = "fixed";
  button.style.right = "16px";
  button.style.bottom = "92px";
  button.style.zIndex = "99999";
  button.style.padding = "10px 14px";
  button.style.border = "1px solid #0b7a75";
  button.style.borderRadius = "8px";
  button.style.background = "#ffffff";
  button.style.color = "#0b7a75";
  button.style.fontWeight = "700";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 12px 26px rgba(0, 0, 0, 0.12)";
  button.addEventListener("click", async () => {
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Copying...";

    try {
      await copyBadgeBatchPayload();
      button.textContent = "Copied";
      setTimeout(() => {
        button.disabled = false;
        button.textContent = originalLabel;
      }, 1200);
    } catch (error) {
      console.error("Failed to copy Amazon badge batch payload.", error);
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });

  document.body.append(button);
}

ensureCopyButton();
