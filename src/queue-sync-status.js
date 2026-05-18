function formatCount(count, singular, plural) {
  const normalizedCount = Number.isFinite(Number(count)) ? Number(count) : 0;
  return `${normalizedCount} ${normalizedCount === 1 ? singular : plural}`;
}

export function buildQueueSyncStatus(kind, options = {}) {
  const count = Number.isFinite(Number(options.count)) ? Number(options.count) : 0;

  switch (kind) {
    case "local-only":
      return {
        tone: "warning",
        label: "Saved in this browser",
        detail: `${formatCount(count, "design is", "designs are")} stored locally. Click Save to sync this batch to Neon.`,
      };
    case "restored-local":
      return {
        tone: "warning",
        label: "Restored from browser",
        detail: `${formatCount(count, "design was", "designs were")} restored from local browser storage.`,
      };
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
    case "empty":
    default:
      return {
        tone: "pending",
        label: "No saved batch",
        detail: "Drafts stay in this browser until you save a queue to Neon.",
      };
  }
}
