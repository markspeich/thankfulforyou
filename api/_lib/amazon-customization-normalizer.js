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


function classifyField(name, value) {
  const normalizedName = normalizedString(name);
  const normalizedValue = normalizedString(value);
  const decoded = decodedValue(normalizedValue);
  if (!normalizedName || !normalizedValue) return { response: null, rejected: "blank" };
  if (normalizedName.startsWith("^")) return { response: null, rejected: "internal" };
  if (EXCLUDED_LABEL_PATTERN.test(normalizedName)) return { response: null, rejected: "metadata_label" };
  if (URL_PATTERN.test(normalizedValue) || DATA_URL_PATTERN.test(normalizedValue) || DATA_URL_PATTERN.test(decoded)) {
    return { response: null, rejected: "url" };
  }
  if (ASSET_VALUE_PATTERN.test(decoded)) return { response: null, rejected: "asset" };
  if (SVG_PATTERN.test(decoded)) return { response: null, rejected: "markup" };
  return { response: { name: normalizedName, value: normalizedValue }, rejected: null };
}

function field(name, value) {
  return classifyField(name, value).response;
}

function documentRoot(document) {
  return document?.customizationData && typeof document.customizationData === "object"
    ? document.customizationData
    : document;
}

function v3Surfaces(document) {
  const embedded = document?.customizationData;
  const version = document?.["version3.0"] ?? document?.version3
    ?? embedded?.["version3.0"] ?? embedded?.version3;
  const surfaces = version?.customizationInfo?.surfaces;
  return Array.isArray(surfaces) ? surfaces : [];
}

function v3Areas(document) {
  return v3Surfaces(document).flatMap((surface) => Array.isArray(surface?.areas) ? surface.areas : []);
}

function v3Candidates(document) {
  return v3Areas(document).map((area) => {
    const type = normalizedString(area?.customizationType).toLowerCase();
    if (type.includes("text")) {
      return {
        kind: "text",
        fontName: normalizedString(area?.fontFamily),
        ...classifyField(area?.label, firstNonBlank(area?.text, area?.displayValue)),
      };
    }
    if (type.includes("option") || area?.optionValue != null) {
      return { kind: "configuration", ...classifyField(area?.label, firstNonBlank(area?.optionValue, area?.displayValue)) };
    }
    return { kind: "unsupported", response: null, rejected: "unsupported" };
  });
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

function legacyCandidates(document) {
  const root = documentRoot(document);
  return legacyNodes(root).map((node) => {
    const type = normalizedString(node.type).toLowerCase();
    if (type.includes("text")) {
      return { kind: "text", ...classifyField(node.label, firstNonBlank(node.text, node.value, node.displayValue)) };
    }
    if (type.includes("option")) {
      return { kind: "configuration", ...classifyField(node.label, firstNonBlank(node.optionSelection?.label, node.optionValue, node.displayValue)) };
    }
    return { kind: "unsupported", response: null, rejected: "unsupported" };
  });
}

function deduplicateAcceptedCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.response) return true;
    const key = `${candidate.kind}\u0000${candidate.response.name}\u0000${candidate.response.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasV3SurfaceContainer(document) {
  const embedded = document?.customizationData;
  const version = document?.["version3.0"] ?? document?.version3
    ?? embedded?.["version3.0"] ?? embedded?.version3;
  return Array.isArray(version?.customizationInfo?.surfaces);
}

function classifiedCustomization(document) {
  const surfaces = v3Surfaces(document);
  const areas = v3Areas(document);
  if (areas.length) {
    return {
      format: "v3",
      surfaceCount: surfaces.length,
      areaCount: areas.length,
      candidates: v3Candidates(document),
    };
  }

  const legacy = deduplicateAcceptedCandidates(legacyCandidates(document));
  if (legacy.length) {
    return { format: "legacy", surfaceCount: 0, areaCount: 0, candidates: legacy };
  }
  if (hasV3SurfaceContainer(document)) {
    return { format: "v3", surfaceCount: surfaces.length, areaCount: 0, candidates: [] };
  }
  return {
    format: isEmptyCustomizationDocument(document) ? "empty" : "unknown",
    surfaceCount: 0,
    areaCount: 0,
    candidates: [],
  };
}

function fieldsFromCandidates(candidates) {
  const freeTextFields = [];
  const configurationFields = [];
  for (const candidate of candidates) {
    if (candidate.kind === "text" && candidate.response) freeTextFields.push(candidate.response);
    if (candidate.kind === "configuration" && candidate.response) configurationFields.push(candidate.response);
  }
  return { freeTextFields, configurationFields };
}

export function extractAmazonCustomizationFields(document) {
  return fieldsFromCandidates(classifiedCustomization(document).candidates);
}

function summaryLabel(name) {
  return normalizedString(name)
    .replace(NOTE_CONTROL_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function emptySummary(format) {
  return {
    format,
    surfaceCount: 0,
    areaCount: 0,
    candidateNodeCount: 0,
    acceptedTextCount: 0,
    acceptedConfigurationCount: 0,
    acceptedLabels: [],
    rejectedCounts: {},
  };
}

function isEmptyCustomizationDocument(document) {
  const seen = new Set();
  let current = document;
  for (let depth = 0; depth < 256; depth += 1) {
    if (current == null) return true;
    if (typeof current !== "object" || Array.isArray(current) || seen.has(current)) return false;
    seen.add(current);
    const keys = Object.keys(current);
    if (keys.length === 0) return true;
    if (keys.length !== 1 || keys[0] !== "customizationData") return false;
    current = current.customizationData;
  }
  return false;
}

export function summarizeAmazonCustomization(document) {
  const classified = classifiedCustomization(document);
  const summary = emptySummary(classified.format);
  summary.surfaceCount = classified.surfaceCount;
  summary.areaCount = classified.areaCount;
  const candidates = classified.candidates;
  summary.candidateNodeCount = candidates.length;
  for (const candidate of candidates) {
    if (candidate.kind === "text" && candidate.response) summary.acceptedTextCount += 1;
    if (candidate.kind === "configuration" && candidate.response) summary.acceptedConfigurationCount += 1;
    if (candidate.response) {
      const label = summaryLabel(candidate.response.name);
      if (label && summary.acceptedLabels.length < 40) summary.acceptedLabels.push(label);
    } else if (candidate.rejected) {
      summary.rejectedCounts[candidate.rejected] = (summary.rejectedCounts[candidate.rejected] ?? 0) + 1;
    }
  }
  return summary;
}

function fontFieldBase(name) {
  const match = normalizedString(name).match(/^(.*?)(?:\s+font)$/i);
  return match ? match[1].trim().toLowerCase() : null;
}

function customerFontData(freeTextFields, configurationFields, candidates = []) {
  const textFields = freeTextFields.filter((response) => fontFieldBase(response.name) == null);
  const textCandidates = candidates.filter(
    (candidate) => candidate.kind === "text"
      && candidate.response
      && fontFieldBase(candidate.response.name) == null,
  );
  const fontFields = [...freeTextFields, ...configurationFields]
    .map((response) => ({ response, base: fontFieldBase(response.name) }))
    .filter(({ base }) => base != null);
  const customerFontSelections = textFields.flatMap((response, lineIndex) => {
    const base = response.name.trim().toLowerCase();
    const selection = textCandidates[lineIndex]?.fontName
      || fontFields.find((candidate) => candidate.base === base)?.response.value;
    return selection ? [{ lineIndex, name: selection }] : [];
  });
  return { textFields, customerFontSelections };
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
  return sourceString(
    shipment?.amazon_order_id
      ?? shipment?.shipment_number
      ?? shipment?.external_shipment_id
      ?? shipment?.external_order_id
      ?? shipment?.order_number,
  );
}

export function normalizeShipStationItem({ shipment = {}, item = {}, customization = {} }) {
  const classified = classifiedCustomization(customization);
  const { freeTextFields, configurationFields } = fieldsFromCandidates(classified.candidates);
  const { textFields, customerFontSelections } = customerFontData(
    freeTextFields,
    configurationFields,
    classified.candidates,
  );
  const color = configurationFields.find(
    (response) => response.name.toLowerCase() === "color",
  );
  const orderItemId = normalizedItemId(item.external_order_item_id);
  const text = textFields.map((response) => response.value).join("\n");
  const price = structuredUnitPrice(item.unit_price);
  return {
    id: `amazon-order-item:${orderItemId}`,
    text,
    source: {
      marketplace: "amazon",
      orderNumber: orderNumber(shipment),
      buyerName: sourceString(shipment?.ship_to?.name),
      transactionId: orderItemId,
      amazonOrderItemId: orderItemId,
      shipStationShipmentId: sourceString(shipment.shipment_id),
      listingId: sourceString(item.asin) || sourceString(item.sku),
      sku: sourceString(item.sku),
      listingTitle: sourceString(item.name),
      listingImageUrl75x75: sourceString(item.image_url),
      quantity: sourceString(item.quantity || 1),
      colorName: sourceString(color?.value),
      shipByDate: sourceString(shipment.ship_by_date),
      ...(price ? { price } : {}),
      personalizationResponses: [...freeTextFields, ...configurationFields],
      ...(customerFontSelections.length ? { customerFontSelections } : {}),
      customizationNeeded: textFields.length === 0,
    },
  };
}
