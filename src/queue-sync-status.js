function formatCount(count, singular, plural) {
  const normalizedCount = Number.isFinite(Number(count)) ? Number(count) : 0;
  return `${normalizedCount} ${normalizedCount === 1 ? singular : plural}`;
}

export function buildQueueSyncStatus(kind, options = {}) {
  const count = Number.isFinite(Number(options.count)) ? Number(options.count) : 0;

  switch (kind) {
    case "local-only":
    case "restored-local":
    case "empty":
      return null;
    case "restored-remote":
      return {
        tone: "ok",
        label: "Restored from Neon",
        detail: `${formatCount(count, "design was", "designs were")} loaded from the remote saved batch.`,
      };
    case "saved-remote":
      return {
        tone: "ok",
        label: "Saved to Neon",
        detail: `${formatCount(count, "design is", "designs are")} synced to the remote saved batch.`,
      };
    default:
      return null;
  }
}
