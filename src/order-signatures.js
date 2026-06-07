function normalizeLines(lines) {
  return Array.isArray(lines) ? lines : [];
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildSignaturePayload(settings = {}, options = {}) {
  const { includeLockTextHeight = true, includeSizeGuideFingerprint = false, version = null } = options;
  const payload = {
    ...(version == null ? {} : { version }),
    text: typeof settings.text === "string" ? settings.text : "",
    presetId: typeof settings.presetId === "string" ? settings.presetId : "",
    boundingSizePresetId: typeof settings.boundingSizePresetId === "string" ? settings.boundingSizePresetId : "",
    ...(includeSizeGuideFingerprint
      ? { boundingSizePresetFingerprint: typeof settings.boundingSizePresetFingerprint === "string" ? settings.boundingSizePresetFingerprint : "" }
      : {}),
    backingMm: toFiniteNumber(settings.backingMm),
    weldExportedDesign: Boolean(settings.weldExportedDesign),
    lines: normalizeLines(settings.lines).map((line = {}) => {
      if (line.kind === "fixedSvg") {
        return {
          kind: "fixedSvg",
          fixedDesignId: typeof line.fixedDesignId === "string" ? line.fixedDesignId : "",
          fixedDesignVersion: toFiniteNumber(line.fixedDesignVersion),
          svgSizeMm: toFiniteNumber(line.svgSizeMm),
          offsetXMm: toFiniteNumber(line.offsetXMm),
          offsetYMm: toFiniteNumber(line.offsetYMm),
        };
      }

      return {
        fontId: typeof line.fontId === "string" ? line.fontId : "",
        bridgeMm: toFiniteNumber(line.bridgeMm),
        lineBridgeMm: toFiniteNumber(line.lineBridgeMm),
        offsetXMm: toFiniteNumber(line.offsetXMm),
        fontSizeMm: toFiniteNumber(line.fontSizeMm),
        horizontalScale: toFiniteNumber(line.horizontalScale),
        verticalScale: toFiniteNumber(line.verticalScale),
        ...(includeLockTextHeight ? { lockTextHeight: Boolean(line.lockTextHeight) } : {}),
      };
    }),
  };

  return payload;
}

export function buildSettingsSignature(settings = {}) {
  return JSON.stringify(buildSignaturePayload(settings, {
    includeLockTextHeight: true,
    includeSizeGuideFingerprint: true,
    version: 3,
  }));
}

export function buildPreGuideFingerprintSettingsSignature(settings = {}) {
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
  const preGuideFingerprintSignature = buildPreGuideFingerprintSettingsSignature(settings);
  const legacySignature = buildLegacySettingsSignature(settings);

  return [...new Set([currentSignature, preGuideFingerprintSignature, legacySignature])];
}
