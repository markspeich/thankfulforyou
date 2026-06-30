export function shouldUseRasterTextPreview(layout) {
  return Array.isArray(layout?.letters)
    && layout.letters.some((letter) => typeof letter?.character === "string" && [...letter.character].length > 1);
}

export function shouldUsePostStretchBackingOffset(layout) {
  return Array.isArray(layout?.letters)
    && layout.letters.some((letter) => {
      const horizontalScale = Number.isFinite(Number(letter?.horizontalScale)) ? Number(letter.horizontalScale) : 1;
      const verticalScale = Number.isFinite(Number(letter?.verticalScale)) ? Number(letter.verticalScale) : 1;
      return Math.abs(horizontalScale - 1) > 1e-6 || Math.abs(verticalScale - 1) > 1e-6;
    });
}
