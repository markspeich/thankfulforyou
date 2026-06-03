const IMPORT_MOJIBAKE_PATTERN = /[\u00c3\u00c2\u00e2]/;
const HTML_ENTITY_PATTERN = /&(#x?[0-9a-f]+|[a-z]+);/gi;
const HTML_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", "\""],
]);
const NO_IMPORTABLE_DESIGNS_MESSAGE = "Clipboard data did not contain any Etsy designs.";

function decodeHtmlEntities(value) {
  if (typeof document !== "undefined" && document.createElement) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;
    return textarea.value;
  }

  return value.replace(HTML_ENTITY_PATTERN, (entity, name) => {
    const normalizedName = name.toLowerCase();

    if (normalizedName.startsWith("#x")) {
      const codePoint = Number.parseInt(normalizedName.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    if (normalizedName.startsWith("#")) {
      const codePoint = Number.parseInt(normalizedName.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    return HTML_ENTITIES.get(normalizedName) ?? entity;
  });
}

function repairImportedMojibake(value) {
  if (!IMPORT_MOJIBAKE_PATTERN.test(value)) {
    return value;
  }

  try {
    const bytes = Uint8Array.from(Array.from(value, (character) => {
      const codePoint = character.codePointAt(0);

      if (typeof codePoint !== "number" || codePoint > 255) {
        throw new Error("Non-Latin1 character");
      }

      return codePoint;
    }));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
}

export function normalizeImportedText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return repairImportedMojibake(decodeHtmlEntities(value).trim());
}

export function normalizeImportedEntry(entry, options = {}) {
  const { getPresetIdForListingId = () => null } = options;

  if (!entry || typeof entry !== "object") {
    return null;
  }

  const personalization = normalizeImportedText(
    typeof entry.personalization === "string"
      ? entry.personalization
      : entry.text,
  );

  if (!personalization) {
    return null;
  }

  const orderNumber = entry.orderNumber == null ? "" : String(entry.orderNumber).trim();
  const listingId = entry.listingId == null ? "" : String(entry.listingId).trim();
  const buyerName = normalizeImportedText(entry.buyerName);
  const colorName = normalizeImportedText(entry.colorName);
  const quantity = entry.quantity == null ? "" : String(entry.quantity).trim();
  const listingTitle = normalizeImportedText(entry.listingTitle);
  const listingImageUrl75x75 = typeof entry.listingImageUrl75x75 === "string"
    ? entry.listingImageUrl75x75.trim()
    : "";
  const presetId = getPresetIdForListingId(listingId);

  return {
    text: personalization,
    presetId,
    source: {
      orderNumber,
      listingId,
      buyerName,
      colorName,
      quantity,
      listingTitle,
      listingImageUrl75x75,
      transactionId: entry.transactionId == null ? "" : String(entry.transactionId).trim(),
    },
  };
}

export function buildImportedBatchIdentity(source, text = "") {
  if (!source || typeof source !== "object") {
    return "";
  }

  const transactionId = source.transactionId == null ? "" : String(source.transactionId).trim();
  if (transactionId) {
    return `transaction:${transactionId}`;
  }

  const orderNumber = source.orderNumber == null ? "" : String(source.orderNumber).trim();
  const listingId = source.listingId == null ? "" : String(source.listingId).trim();
  const buyerName = typeof source.buyerName === "string" ? source.buyerName.trim() : "";
  const normalizedText = typeof text === "string" ? text.trim() : "";

  if (!orderNumber && !listingId && !buyerName && !normalizedText) {
    return "";
  }

  return `fallback:${orderNumber}|${listingId}|${buyerName}|${normalizedText}`;
}

export function parseImportedItems(payloadText, options = {}) {
  const parsed = JSON.parse(payloadText);
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
      ? parsed.items
      : [];
  const importedItems = rawItems
    .map((entry) => normalizeImportedEntry(entry, options))
    .filter(Boolean);

  if (!importedItems.length) {
    throw new Error(NO_IMPORTABLE_DESIGNS_MESSAGE);
  }

  return importedItems;
}
