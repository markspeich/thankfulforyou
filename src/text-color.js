export const DEFAULT_TEXT_COLOR = "White";
export const LIGHT_BACKING_TEXT_COLOR = "Black";

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Listing-specified text color wins. Otherwise raised text defaults to White,
// except on white backings where White text would disappear, so use Black.
export function resolveTextColorName({ textColorName, colorName } = {}) {
  const explicit = trimmed(textColorName);
  if (explicit) return explicit;
  return /\bwhite\b/i.test(trimmed(colorName)) ? LIGHT_BACKING_TEXT_COLOR : DEFAULT_TEXT_COLOR;
}
