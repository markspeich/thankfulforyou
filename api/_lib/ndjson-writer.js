function transportError(message = "Response stream closed.") {
  const error = new Error(message);
  error.code = "transport_closed";
  return error;
}

export function isResponseWritable(res) {
  return !res.destroyed && !res.writableEnded && !res.writableFinished;
}

export async function writeNdjson(res, event, { signal } = {}) {
  if (!isResponseWritable(res) || signal?.aborted) throw transportError();
  let accepted;
  try {
    accepted = res.write(`${JSON.stringify(event)}\n`);
  } catch (error) {
    throw error;
  }
  if (accepted !== false) return;
  if (typeof res.once !== "function") return;

  await new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off?.("drain", onDrain);
      res.off?.("close", onClose);
      res.off?.("error", onError);
      signal?.removeEventListener?.("abort", onAbort);
    };
    const finish = (callback, value) => { cleanup(); callback(value); };
    const onDrain = () => finish(resolve);
    const onClose = () => finish(reject, transportError());
    const onError = (error) => finish(reject, error);
    const onAbort = () => finish(reject, transportError("Request aborted."));
    res.once("drain", onDrain);
    res.once("close", onClose);
    res.once("error", onError);
    signal?.addEventListener?.("abort", onAbort, { once: true });
    if (!isResponseWritable(res) || signal?.aborted) onClose();
  });
}
