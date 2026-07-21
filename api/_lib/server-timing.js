export function createServerTiming(res, operation) {
  const startedAt = performance.now();
  let lastMarkAt = startedAt;
  let finished = false;
  const metrics = [];
  const originalJson = typeof res.json === "function" ? res.json.bind(res) : null;

  const timing = {
    mark(name) {
      if (finished) return;
      const now = performance.now();
      metrics.push({ name, duration: now - lastMarkAt });
      lastMarkAt = now;
    },
    finish() {
      if (finished) return;
      finished = true;
      const total = performance.now() - startedAt;
      metrics.push({ name: "total", duration: total });
      if (!res.headersSent) {
        res.setHeader(
          "Server-Timing",
          metrics.map(({ name, duration }) => name + ";dur=" + duration.toFixed(1)).join(", "),
        );
      }
      if (total >= 1000) {
        console.info(JSON.stringify({
          type: "slow-api-request",
          operation,
          durationMs: Math.round(total),
          phases: Object.fromEntries(metrics.map(({ name, duration }) => [name, Math.round(duration)])),
        }));
      }
    },
  };

  if (originalJson) {
    res.json = (payload) => {
      timing.mark("handler");
      timing.finish();
      return originalJson(payload);
    };
  }

  return timing;
}
