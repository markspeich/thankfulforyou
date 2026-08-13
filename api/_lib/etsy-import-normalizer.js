import { normalizeImportedText } from "../../src/etsy-import.js";

const PERSONALIZATION_PROPERTY_ID = "54";
const URL_PATTERN = /^https?:\/\/\S+$/i;
const FONT_LABEL_PATTERN = /\bfont\b/i;
const FONT_LINE_LABEL_PATTERN = /\bline\s*(\d+)\b/i;

function text(value) { return normalizeImportedText(value); }
function id(value) { return value == null ? "" : String(value).trim(); }
function nullableId(value) { const normalized = id(value); return normalized || null; }
function fontLineNumber(name) {
  const match = FONT_LINE_LABEL_PATTERN.exec(name);
  const number = Number(match?.[1]);
  return Number.isInteger(number) && number > 0 ? number : null;
}
function dateFromTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp * 1000));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function variationsOf(transaction) { return Array.isArray(transaction?.variations) ? transaction.variations.filter((v) => v && typeof v === "object") : []; }
function imageUrl(image) {
  if (!image || typeof image !== "object") return "";
  for (const key of ["url_75x75", "url_170x135", "url_570xN", "url_fullxfull"]) {
    if (typeof image[key] === "string" && image[key].trim()) return image[key].trim();
  }
  return "";
}

function classifyPersonalizationVariation(variation) {
  const propertyId = id(variation.property_id);
  const valueId = nullableId(variation.value_id);
  const name = text(variation.formatted_name);
  const value = text(variation.formatted_value);
  const isPersonalization = propertyId === PERSONALIZATION_PROPERTY_ID;
  const isFile = URL_PATTERN.test(value);
  const fontLabel = FONT_LABEL_PATTERN.test(name);
  const isFontSelection = isPersonalization && Boolean(value) && !isFile && Boolean(valueId) && fontLabel;
  let classification = "ignored";
  let reason = "not_personalization_property";
  if (isPersonalization && !value) {
    reason = "empty_value";
  } else if (isPersonalization && isFile) {
    classification = "file";
    reason = "file_response";
  } else if (isFontSelection) {
    classification = "font_selection";
    reason = "font_dropdown";
  } else if (isPersonalization) {
    classification = "design_text";
    reason = fontLabel && !valueId ? "font_label_without_dropdown_value" : "text_personalization";
  }
  return {
    propertyId,
    questionId: nullableId(variation.question_id),
    valueId,
    name,
    value,
    classification,
    reason,
    isFontSelection,
  };
}

export function normalizeEtsyTransaction({ receipt = {}, transaction = {}, listing = {}, image = {}, getPresetIdForListingId = () => null }) {
  const variations = variationsOf(transaction);
  const variationDiagnostics = variations.map(classifyPersonalizationVariation);
  const personalizationResponses = variationDiagnostics
    .filter((variation) => variation.propertyId === PERSONALIZATION_PROPERTY_ID)
    .map((variation) => {
      const kind = variation.classification === "file" ? "file" : "text";
      return {
        kind,
        name: variation.name,
        value: variation.value,
        isFontSelection: variation.isFontSelection,
      };
    })
    .filter((response) => response.value);
  const designResponses = personalizationResponses.filter((response) => !response.isFontSelection);
  const designLines = designResponses
    .filter((response) => response.kind === "text")
    .flatMap((response) => response.value.split(/\r?\n/).map(text).filter(Boolean));
  const fontSelections = personalizationResponses
    .filter((response) => response.isFontSelection)
    .map((response, selectionIndex) => {
      const labelLineNumber = fontLineNumber(response.name);
      const mappedLineIndex = labelLineNumber === null ? selectionIndex : labelLineNumber - 1;
      const hasDesignLine = Boolean(designLines[mappedLineIndex]);
      const lineIndex = labelLineNumber === null && !hasDesignLine ? null : mappedLineIndex;
      return {
        selectionIndex,
        name: response.value,
        lineIndex,
        outcome: lineIndex === null ? "unmatched_design_line" : hasDesignLine ? "paired" : "stored_without_design_line",
        mappingSource: labelLineNumber === null ? "ordinal" : "label_line_number",
        ...(labelLineNumber === null ? {} : { labelLineNumber }),
      };
    });
  const customerFontSelections = fontSelections
    .flatMap((selection) => selection.lineIndex === null ? [] : [{
      lineIndex: selection.lineIndex,
      name: selection.name,
    }])
    .sort((left, right) => left.lineIndex - right.lineIndex);
  const listingId = id(transaction.listing_id ?? listing.listing_id);
  const transactionId = id(transaction.transaction_id);
  const color = variations.find((variation) => text(variation.formatted_name).toLowerCase() === "color");
  const buyerName = text(receipt.name ?? receipt.buyer_name);
  const orderNumber = id(receipt.receipt_id);
  const listingTitle = text(transaction.title ?? listing.title);
  const quantity = id(transaction.quantity);
  const textValue = designLines.join("\n");
  return {
    id: `transaction:${transactionId}`,
    text: textValue,
    presetId: getPresetIdForListingId(listingId),
    etsyImportDiagnostics: {
      schemaVersion: 1,
      variations: variationDiagnostics.map(({ isFontSelection, ...variation }) => variation),
      fontSelections,
    },
    source: {
      orderNumber, transactionId, listingId, buyerName,
      colorName: text(color?.formatted_value), quantity, listingTitle,
      listingImageUrl75x75: imageUrl(image),
      personalizationResponses: designResponses.map(({ kind, name, value }) => ({ kind, name, value })),
      ...(customerFontSelections.length ? { customerFontSelections } : {}),
      expected_ship_date: transaction.expected_ship_date ?? null,
      shipByDate: dateFromTimestamp(transaction.expected_ship_date),
      variations: variations.map(({ property_id, value_id, formatted_name, formatted_value }) => ({ property_id, value_id, formatted_name, formatted_value })),
      createdTimestamp: receipt.create_timestamp ?? null,
      updatedTimestamp: receipt.update_timestamp ?? null,
      paidTimestamp: receipt.paid_timestamp ?? null,
    },
  };
}
