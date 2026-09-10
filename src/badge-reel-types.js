const BADGE_REEL_TYPES = Object.freeze([
  Object.freeze({
    id: "swivel-alligator",
    label: "Swivel Alligator",
    aliases: Object.freeze(["Swivel Alligator", "Swivel Alligator Clip"]),
  }),
  Object.freeze({
    id: "heavy-duty-belt-clip",
    label: "Heavy Duty Belt Clip",
    aliases: Object.freeze(["Belt Clip-Heavy Duty", "Heavy Duty Belt Clip"]),
  }),
  Object.freeze({ id: "mri-safe", label: "MRI Safe", aliases: Object.freeze(["MRI Safe"]) }),
  Object.freeze({ id: "belt-clip", label: "Belt Clip", aliases: Object.freeze(["Belt Clip"]) }),
  Object.freeze({
    id: "heavy-duty-carabiner",
    label: "Heavy Duty Carabiner",
    aliases: Object.freeze(["Heavy Duty Carabiner"]),
  }),
]);

function normalize(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function typeForValue(value) {
  const normalizedValue = normalize(value);
  if (!normalizedValue) return null;
  return BADGE_REEL_TYPES.find((type) => type.aliases.some((alias) => normalize(alias) === normalizedValue)) ?? null;
}

export function resolveBadgeReelTypeId(value) {
  return typeForValue(value)?.id ?? null;
}

export function badgeReelTypeLabel(id) {
  if (typeof id !== "string") return null;
  return BADGE_REEL_TYPES.find((type) => type.id === id)?.label ?? null;
}

export function findBadgeReelTypeCandidate(entries, { label, value }) {
  if (!Array.isArray(entries)) return null;

  const candidate = entries.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const normalizedLabel = normalize(entry[label]);
    return normalizedLabel === "badge reel" || normalizedLabel === "badge reel type";
  });
  if (!candidate) return null;

  const rawValue = typeof candidate[value] === "string" ? candidate[value] : "";
  return { rawValue, id: resolveBadgeReelTypeId(rawValue) };
}
