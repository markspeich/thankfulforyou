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
    case "local-recovery":
      return {
        tone: "warning",
        label: "Local recovery only",
        detail: typeof options.detail === "string" && options.detail.trim()
          ? options.detail.trim()
          : `Shared queue sync is unavailable. ${formatCount(count, "design is", "designs are")} being kept only in this browser for recovery.`,
      };
    case "restored-remote":
      return {
        tone: "ok",
        label: "Shared queue loaded",
        detail: `${formatCount(count, "design was", "designs were")} loaded from the shared queue.`,
      };
    case "saved-remote":
      return {
        tone: "ok",
        label: "Shared queue saved",
        detail: `${formatCount(count, "design was", "designs were")} saved to the shared queue.`,
      };
    default:
      return null;
  }
}
