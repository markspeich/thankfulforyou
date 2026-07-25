const MAX_NOTES_LENGTH = 1000;
const URL_PATTERN = /^(?:https?:)?\/\//i;
const DATA_URL_PATTERN = /^data:/i;
const ASSET_VALUE_PATTERN = /(?:^|[\\/])[^\s]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const SVG_PATTERN = /<svg\b|<path\b|<g\b/i;
const EXCLUDED_LABEL_PATTERN = /(?:\b(?:url|preview|layout|placement|position|asset|image|svg|filename|filepath|file path)\b|\bid\b|identifier|uuid|guid)/i;

function normalizedString(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function firstNonBlank(...values) {
  return values.find((value) => normalizedString(value));
}

function decodedValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}


function acceptedField(name, value) {
  const decoded = decodedValue(value);
  return Boolean(name && value && !name.startsWith("^")
    && !EXCLUDED_LABEL_PATTERN.test(name)
    && !URL_PATTERN.test(value)
    && !DATA_URL_PATTERN.test(value)
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
      if (typeof node.type === "string") nodes.push(node);
      for (const nested of [node.children, node.nodes, node.areas]) visit(nested);
    }
  }
  for (const container of containers) visit(container);
  return nodes;
}

function extractLegacyFields(document) {
  const freeTextFields = [];
  const configurationFields = [];
  const root = documentRoot(document);
  for (const node of legacyNodes(root)) {
    const type = normalizedString(node.type).toLowerCase();
    if (type.includes("text")) {
      const response = field(node.label, firstNonBlank(node.text, node.value, node.displayValue));
      if (response) freeTextFields.push(response);
      continue;
    }
    if (type.includes("option")) {
      const response = field(node.label, firstNonBlank(node.optionSelection?.label, node.optionValue, node.displayValue));
      if (response) configurationFields.push(response);
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
  return `Amazon Order Item: ${normalizedString(itemId)}`;
}

function itemIdFromBlock(block) {
  const match = String(block).match(/^Amazon Order Item: (.+)$/m);
  return match ? normalizedString(match[1]) : "";
}

export function buildAmazonNoteBlock({ productTitle, orderItemId, fields = [] }) {
  const title = normalizedString(productTitle);
  const marker = itemMarker(orderItemId);
  if (!title || marker === "Amazon Order Item: ") throw new TypeError("Amazon product title and order item ID are required");
  const lines = fields
    .map((response) => field(response?.name, response?.value))
    .filter(Boolean)
    .map((response) => `${response.name}: ${response.value}`);
  return [`Amazon Customization -- ${title}`, ...lines, marker].join("\n");
}

export function appendAmazonNoteBlocks({ existingNotes = "", blocks = [], maxLength = MAX_NOTES_LENGTH }) {
  const notes = typeof existingNotes === "string" ? existingNotes : "";
  const knownItemIds = new Set();
  const markerPattern = /^Amazon Order Item: (.+)$/gm;
  for (const match of notes.matchAll(markerPattern)) knownItemIds.add(normalizedString(match[1]));

  const appendedItemIds = [];
  const acceptedBlocks = [];
  for (const block of blocks) {
    const itemId = itemIdFromBlock(block);
    if (!itemId) throw new TypeError("Amazon note blocks require an Amazon Order Item marker");
    if (knownItemIds.has(itemId)) continue;
    knownItemIds.add(itemId);
    appendedItemIds.push(itemId);
    acceptedBlocks.push(String(block));
  }
  const appended = acceptedBlocks.join("\n\n");
  const combined = !appended ? notes : notes ? `${notes}\n\n${appended}` : appended;
  if (combined.length > maxLength) throw new RangeError(`ShipStation notes exceed ${maxLength} characters`);
  return { notes: combined, appendedItemIds };
}

function sourceString(value) { return value == null ? "" : String(value).trim(); }

function orderNumber(shipment) {
  return sourceString(shipment?.amazon_order_id ?? shipment?.external_order_id ?? shipment?.order_number);
}

export function normalizeShipStationItem({ shipment = {}, item = {}, customization = {} }) {
  const { freeTextFields, configurationFields } = extractAmazonCustomizationFields(customization);
  const orderItemId = sourceString(item.external_order_item_id);
  if (!orderItemId) throw new TypeError("Amazon order item ID is required");
  const text = freeTextFields.map((response) => response.value).join("\n");
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
      personalizationResponses: [...freeTextFields, ...configurationFields],
      customizationNeeded: freeTextFields.length === 0,
    },
  };
}
