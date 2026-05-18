function normalizeLines(lines) {
  return Array.isArray(lines) ? lines : [];
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildSignaturePayload(settings = {}, options = {}) {
  const { includeLockTextHeight = true, version = null } = options;
  const payload = {
    ...(version == null ? {} : { version }),
    text: typeof settings.text === "string" ? settings.text : "",
    presetId: typeof settings.presetId === "string" ? settings.presetId : "",
    backingMm: toFiniteNumber(settings.backingMm),
    weldExportedDesign: Boolean(settings.weldExportedDesign),
    lines: normalizeLines(settings.lines).map((line = {}) => ({
      fontId: typeof line.fontId === "string" ? line.fontId : "",
      bridgeMm: toFiniteNumber(line.bridgeMm),
      lineBridgeMm: toFiniteNumber(line.lineBridgeMm),
      offsetXMm: toFiniteNumber(line.offsetXMm),
      fontSizeMm: toFiniteNumber(line.fontSizeMm),
      verticalScale: toFiniteNumber(line.verticalScale),
      ...(includeLockTextHeight ? { lockTextHeight: Boolean(line.lockTextHeight) } : {}),
    })),
  };

  return payload;
}

export function buildSettingsSignature(settings = {}) {
  return JSON.stringify(buildSignaturePayload(settings, {
    includeLockTextHeight: true,
    version: 2,
  }));
}

export function buildLegacySettingsSignature(settings = {}) {
  return JSON.stringify(buildSignaturePayload(settings, {
    includeLockTextHeight: false,
  }));
}

export function getSettingsSignatureCandidates(settings = {}) {
  const currentSignature = buildSettingsSignature(settings);
  const legacySignature = buildLegacySettingsSignature(settings);

  return currentSignature === legacySignature
    ? [currentSignature]
    : [currentSignature, legacySignature];
}
