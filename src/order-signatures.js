function normalizeLines(lines) {
  return Array.isArray(lines) ? lines : [];
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function buildSignaturePayload(settings = {}, options = {}) {
  const {
    includeFontBridgingPolicy = false,
    includeFontAssetFingerprint = false,
    includeLockTextHeight = true,
    includeSizeGuideFingerprint = false,
    version = null,
  } = options;
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
          backingBorder: Boolean(line.backingBorder),
        };
      }

      return {
        fontId: typeof line.fontId === "string" ? line.fontId : "",
        ...(includeFontAssetFingerprint
          ? { fontAssetFingerprint: typeof line.fontAssetFingerprint === "string" ? line.fontAssetFingerprint : "" }
          : {}),
        bridgeMm: toFiniteNumber(line.bridgeMm),
        lineBridgeMm: toFiniteNumber(line.lineBridgeMm),
        offsetXMm: toFiniteNumber(line.offsetXMm),
        fontSizeMm: toFiniteNumber(line.fontSizeMm),
        horizontalScale: toFiniteNumber(line.horizontalScale),
        verticalScale: toFiniteNumber(line.verticalScale),
        ...(includeFontBridgingPolicy ? { fontBridgingEnabled: line.fontBridgingEnabled !== false } : {}),
        ...(includeLockTextHeight ? { lockTextHeight: Boolean(line.lockTextHeight) } : {}),
      };
    }),
  };

  return payload;
}

export function buildSettingsSignature(settings = {}) {
  return JSON.stringify(buildSignaturePayload(settings, {
    includeFontBridgingPolicy: true,
    includeFontAssetFingerprint: true,
    includeLockTextHeight: true,
    includeSizeGuideFingerprint: true,
    version: 4,
  }));
}

export function buildPreFontAssetSettingsSignature(settings = {}) {
  return JSON.stringify(buildSignaturePayload(settings, {
    includeFontBridgingPolicy: true,
    includeLockTextHeight: true,
    includeSizeGuideFingerprint: true,
    version: 4,
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
  const hasFontAssetFingerprints = normalizeLines(settings.lines)
    .some((line) => line?.kind !== "fixedSvg" && Boolean(line?.fontAssetFingerprint));
  const candidates = [currentSignature];
  if (hasFontAssetFingerprints) {
    candidates.push(buildPreFontAssetSettingsSignature(settings));
  }
  const canUseLegacyBridgeSignatures = normalizeLines(settings.lines)
    .every((line) => line?.kind === "fixedSvg" || line?.fontBridgingEnabled !== false);
  if (!canUseLegacyBridgeSignatures) {
    return [...new Set(candidates)];
  }

  const preGuideFingerprintSignature = buildPreGuideFingerprintSettingsSignature(settings);
  const legacySignature = buildLegacySettingsSignature(settings);
  return [...new Set([...candidates, preGuideFingerprintSignature, legacySignature])];
}

function resolvedFontAssetPath(fingerprint) {
  const parts = typeof fingerprint === "string" ? fingerprint.split("|") : [];
  if (parts.length < 3) {
    return "";
  }
  const path = parts.slice(2).join("|").trim();
  return path && path !== "missing" ? path : "";
}

export function cachedBuildMatchesResolvedFontAssets(cachedBuild, settings = {}) {
  const expectedPaths = new Map();
  for (const line of normalizeLines(settings.lines)) {
    if (line?.kind === "fixedSvg") {
      continue;
    }
    const fontId = typeof line?.fontId === "string" ? line.fontId : "";
    const assetPath = resolvedFontAssetPath(line?.fontAssetFingerprint);
    if (!fontId || !assetPath) {
      return false;
    }
    expectedPaths.set(fontId, assetPath);
  }

  if (!expectedPaths.size) {
    return true;
  }

  const letters = Array.isArray(cachedBuild?.layout?.letters) ? cachedBuild.layout.letters : [];
  if (!letters.length) {
    return false;
  }

  const matchedFontIds = new Set();
  for (const letter of letters) {
    const expectedPath = expectedPaths.get(letter?.fontId);
    if (!expectedPath || letter?.fontPath !== expectedPath) {
      return false;
    }
    matchedFontIds.add(letter.fontId);
  }

  return [...expectedPaths.keys()].every((fontId) => matchedFontIds.has(fontId));
}
