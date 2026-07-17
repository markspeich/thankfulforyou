export function attachRequestAbort({ request, response, controller }) {
  const abort = () => { if (!controller.signal.aborted) controller.abort(); };
  const onRequestAborted = () => abort();
  const onResponseClose = () => { if (!response.writableFinished) abort(); cleanup(); };
  const onSocketClose = () => { if (!response.writableFinished) abort(); cleanup(); };
  const onFinished = () => cleanup();
  const cleanup = () => {
    request.off?.("aborted", onRequestAborted);
    response.off?.("close", onResponseClose);
    response.off?.("finish", onFinished);
    request.socket?.off?.("close", onSocketClose);
  };

  request.once("aborted", onRequestAborted);
  response.once("close", onResponseClose);
  response.once("finish", onFinished);
  request.socket?.once?.("close", onSocketClose);
  return cleanup;
}
