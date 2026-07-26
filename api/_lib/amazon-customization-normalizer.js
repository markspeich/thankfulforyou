const MAX_NOTES_LENGTH = 1000;
const URL_PATTERN = /^(?:https?:)?\/\//i;
const DATA_URL_PATTERN = /^data:/i;
const ASSET_VALUE_PATTERN = /(?:^|[\\/])[^\s]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const SVG_PATTERN = /<svg\b|<path\b|<g\b/i;
const EXCLUDED_LABEL_PATTERN = /(?:\b(?:url|preview|layout|placement|position|asset|image|svg|filename|filepath|file path)\b|\bid\b|identifier|uuid|guid)/i;
const METADATA_NODE_TYPE_PATTERN = /(?:preview|render(?:ed)?|layout|asset|image|svg|thumbnail|placement)/i;
const NOTE_CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]+/g;
const ITEM_ID_CONTROL_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
const BLOCK_CONTROL_PATTERN = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/;

function normalizedString(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function noteText(value) {
  return normalizedString(value).replace(NOTE_CONTROL_PATTERN, " ").replace(/ {2,}/g, " ").trim();
}

function normalizedItemId(value) {
  const itemId = normalizedString(value);
  if (!itemId || ITEM_ID_CONTROL_PATTERN.test(itemId)) {
    throw new TypeError("Amazon order item ID is required and cannot contain control characters");
  }
  return itemId;
}

function firstNonBlank(...values) {
  return values.find((value) => normalizedString(value));
}

function decodedValue(value) {
  let decoded = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}


function acceptedField(name, value) {
  const decoded = decodedValue(value);
  return Boolean(name && value && !name.startsWith("^")
    && !EXCLUDED_LABEL_PATTERN.test(name)
    && !URL_PATTERN.test(value)
    && !DATA_URL_PATTERN.test(value)
    && !DATA_URL_PATTERN.test(decoded)
    && !ASSET_VALUE_PATTERN.test(decoded)
    && !SVG_PATTERN.test(decoded));
}

function field(name, value) {
  const normalizedName = normalizedString(name);
  const normalizedValue = normalizedString(value);
  return acceptedField(normalizedName, normalizedValue) ? { name: normalizedName, value: normalizedValue } : null;
}

function documentRoot(document) {
  return document?.customizationData && typeof document.customizationData === "object"
    ? document.customizationData
    : document;
}

function v3Areas(document) {
  const embedded = document?.customizationData;
  const version = document?.["version3.0"] ?? document?.version3
    ?? embedded?.["version3.0"] ?? embedded?.version3;
  const surfaces = version?.customizationInfo?.surfaces;
  return Array.isArray(surfaces) ? surfaces.flatMap((surface) => Array.isArray(surface?.areas) ? surface.areas : []) : [];
}

function extractV3Fields(document) {
  const freeTextFields = [];
  const configurationFields = [];
  for (const area of v3Areas(document)) {
    const type = normalizedString(area?.customizationType).toLowerCase();
    if (type.includes("text")) {
      const response = field(area?.label, firstNonBlank(area?.text, area?.displayValue));
      if (response) freeTextFields.push(response);
      continue;
    }
    if (type.includes("option") || area?.optionValue != null) {
      const response = field(area?.label, firstNonBlank(area?.optionValue, area?.displayValue));
      if (response) configurationFields.push(response);
    }
  }
  return { freeTextFields, configurationFields };
}

function legacyNodes(document) {
  const root = documentRoot(document);
  const containers = [
    root?.nodes,
    root?.customizationNodes,
    root?.customizations,
    root?.customizationInfo?.nodes,
    root?.customizationInfo?.customizations,
  ];
  const nodes = [];
  const seen = new Set();
  function visit(children) {
    for (const node of Array.isArray(children) ? children : []) {
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      if (METADATA_NODE_TYPE_PATTERN.test(normalizedString(node.type))) continue;
      if (typeof node.type === "string") nodes.push(node);
      for (const nested of [node.children, node.nodes, node.areas]) visit(nested);
    }
  }
  for (const container of containers) visit(container);
  return nodes;
}

function appendUniqueLegacyField(fields, seenFields, kind, response) {
  if (!response) return;
  const key = `${kind}\u0000${response.name}\u0000${response.value}`;
  if (seenFields.has(key)) return;
  seenFields.add(key);
  fields.push(response);
}
function extractLegacyFields(document) {
  const freeTextFields = [];
  const configurationFields = [];
  const seenFields = new Set();
  const root = documentRoot(document);
  for (const node of legacyNodes(root)) {
    const type = normalizedString(node.type).toLowerCase();
    if (type.includes("text")) {
      const response = field(node.label, firstNonBlank(node.text, node.value, node.displayValue));
      appendUniqueLegacyField(freeTextFields, seenFields, "text", response);
      continue;
    }
    if (type.includes("option")) {
      const response = field(node.label, firstNonBlank(node.optionSelection?.label, node.optionValue, node.displayValue));
      appendUniqueLegacyField(configurationFields, seenFields, "option", response);
    }
  }
  return { freeTextFields, configurationFields };
}

export function extractAmazonCustomizationFields(document) {
  const observed = extractV3Fields(document);
  return observed.freeTextFields.length || observed.configurationFields.length || v3Areas(document).length
    ? observed
    : extractLegacyFields(document);
}

function itemMarker(itemId) {
  return `Amazon Order Item: ${normalizedItemId(itemId)}`;
}

function existingItemIds(notes) {
  const ids = new Set();
  const lines = String(notes).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (index + 1 < lines.length && lines[index + 1] !== "") continue;
    const match = lines[index].match(/^Amazon Order Item: (.+)$/);
    if (!match) continue;
    try {
      ids.add(normalizedItemId(match[1]));
    } catch {
      continue;
    }
  }
  return ids;
}

function validatedNoteBlock(itemId, block) {
  if (typeof block !== "string") {
    throw new TypeError("Amazon note block text is required");
  }
  const normalizedBlock = block.replace(/\r\n/g, "\n");
  if (BLOCK_CONTROL_PATTERN.test(normalizedBlock) || normalizedBlock.includes("\r")) {
    throw new TypeError("Amazon note blocks cannot contain control characters");
  }
  const lines = normalizedBlock.split("\n");
  const expectedMarker = itemMarker(itemId);
  const structuralMarkers = lines.filter((line) => line.startsWith("Amazon Order Item:"));
  if (structuralMarkers.length !== 1 || structuralMarkers[0] !== expectedMarker || lines.at(-1) !== expectedMarker) {
    throw new TypeError("Amazon note block marker does not match its item ID");
  }
  return normalizedBlock;
}

export function buildAmazonNoteBlock({ productTitle, orderItemId, fields = [] }) {
  const title = noteText(productTitle);
  const marker = itemMarker(orderItemId);
  if (!title) throw new TypeError("Amazon product title is required");
  const lines = fields
    .map((response) => field(response?.name, response?.value))
    .filter(Boolean)
    .map((response) => ({ name: noteText(response.name), value: noteText(response.value) }))
    .filter((response) => response.name && response.value)
    .map((response) => {
      const line = `${response.name}: ${response.value}`;
      return line.startsWith("Amazon Order Item:") ? `Customization ${line}` : line;
    });
  return [`Amazon Customization -- ${title}`, ...lines, marker].join("\n");
}

export function appendAmazonNoteBlocks({ existingNotes = "", blocks = [], maxLength = MAX_NOTES_LENGTH }) {
  const notes = typeof existingNotes === "string" ? existingNotes : "";
  const knownItemIds = existingItemIds(notes);

  const appendedItemIds = [];
  const acceptedBlocks = [];
  for (const entry of blocks) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("Amazon note blocks require structured item entries");
    }
    const itemId = normalizedItemId(entry.itemId);
    if (knownItemIds.has(itemId)) continue;
    const block = validatedNoteBlock(itemId, entry.block);
    knownItemIds.add(itemId);
    appendedItemIds.push(itemId);
    acceptedBlocks.push(block);
  }
  const appended = acceptedBlocks.join("\n\n");
  const combined = !appended ? notes : notes ? `${notes}\n\n${appended}` : appended;
  if (combined.length > maxLength) throw new RangeError(`ShipStation notes exceed ${maxLength} characters`);
  return { notes: combined, appendedItemIds };
}

function sourceString(value) { return value == null ? "" : String(value).trim(); }

function structuredUnitPrice(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const amount = typeof value.amount === "number"
    ? (Number.isFinite(value.amount) ? String(value.amount) : "")
    : (typeof value.amount === "string" ? value.amount.trim() : "");
  const currency = typeof value.currency === "string" ? value.currency.trim() : "";
  if (!amount && !currency) return null;
  return {
    ...(amount ? { amount } : {}),
    ...(currency ? { currency } : {}),
  };
}

function orderNumber(shipment) {
  return sourceString(shipment?.amazon_order_id ?? shipment?.external_order_id ?? shipment?.order_number);
}

export function normalizeShipStationItem({ shipment = {}, item = {}, customization = {} }) {
  const { freeTextFields, configurationFields } = extractAmazonCustomizationFields(customization);
  const orderItemId = normalizedItemId(item.external_order_item_id);
  const text = freeTextFields.map((response) => response.value).join("\n");
  const price = structuredUnitPrice(item.unit_price);
  return {
    id: `amazon-order-item:${orderItemId}`,
    text,
    source: {
      marketplace: "amazon",
      orderNumber: orderNumber(shipment),
      transactionId: orderItemId,
      amazonOrderItemId: orderItemId,
      shipStationShipmentId: sourceString(shipment.shipment_id),
      listingId: sourceString(item.asin),
      sku: sourceString(item.sku),
      listingTitle: sourceString(item.name),
      listingImageUrl75x75: sourceString(item.image_url),
      quantity: sourceString(item.quantity || 1),
      shipByDate: sourceString(shipment.ship_by_date),
      ...(price ? { price } : {}),
      personalizationResponses: [...freeTextFields, ...configurationFields],
      customizationNeeded: freeTextFields.length === 0,
    },
  };
}
