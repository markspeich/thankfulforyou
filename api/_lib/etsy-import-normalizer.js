import { normalizeImportedText } from "../../src/etsy-import.js";

const PERSONALIZATION_PROPERTY_ID = "54";
const URL_PATTERN = /^https?:\/\/\S+$/i;

function text(value) { return normalizeImportedText(value); }
function id(value) { return value == null ? "" : String(value).trim(); }
function variationsOf(transaction) { return Array.isArray(transaction?.variations) ? transaction.variations.filter((v) => v && typeof v === "object") : []; }
function imageUrl(image) {
  if (!image || typeof image !== "object") return "";
  for (const key of ["url_75x75", "url_170x135", "url_570xN", "url_fullxfull"]) {
    if (typeof image[key] === "string" && image[key].trim()) return image[key].trim();
  }
  return "";
}

export function normalizeEtsyTransaction({ receipt = {}, transaction = {}, listing = {}, image = {}, getPresetIdForListingId = () => null }) {
  const variations = variationsOf(transaction);
  const personalizationResponses = variations
    .filter((variation) => id(variation.property_id) === PERSONALIZATION_PROPERTY_ID)
    .map((variation) => {
      const label = text(variation.formatted_name);
      const value = text(variation.formatted_value);
      return { kind: URL_PATTERN.test(value) ? "file" : "text", label, value };
    })
    .filter((response) => response.value);
  const designLines = personalizationResponses.filter((response) => response.kind === "text").map((response) => response.value);
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
    source: {
      orderNumber, transactionId, listingId, buyerName,
      colorName: text(color?.formatted_value), quantity, listingTitle,
      listingImageUrl75x75: imageUrl(image),
      customizationNeeded: !textValue,
      personalizationResponses,
      variations: variations.map(({ property_id, value_id, formatted_name, formatted_value }) => ({ property_id, value_id, formatted_name, formatted_value })),
      createdTimestamp: receipt.create_timestamp ?? null,
      updatedTimestamp: receipt.update_timestamp ?? null,
      paidTimestamp: receipt.paid_timestamp ?? null,
    },
  };
}
