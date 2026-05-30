function formatCount(count, singular, plural) {
  const normalizedCount = Number.isFinite(Number(count)) ? Number(count) : 0;
  return `${normalizedCount} ${normalizedCount === 1 ? singular : plural}`;
}

export function buildBatchSyncStatus(kind, options = {}) {
  const count = Number.isFinite(Number(options.count)) ? Number(options.count) : 0;

  switch (kind) {
    case "empty":
      return null;
    case "restored-remote":
      return {
        tone: "ok",
        label: "Production batch loaded",
        detail: `${formatCount(count, "design was", "designs were")} loaded from Supabase.`,
      };
    case "saved-remote":
      return {
        tone: "ok",
        label: "Production batch saved",
        detail: `${formatCount(count, "design was", "designs were")} saved to Supabase.`,
      };
    default:
      return null;
  }
}
