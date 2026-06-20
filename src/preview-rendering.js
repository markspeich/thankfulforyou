export function shouldUseRasterTextPreview(layout) {
  return Array.isArray(layout?.letters)
    && layout.letters.some((letter) => typeof letter?.character === "string" && [...letter.character].length > 1);
}