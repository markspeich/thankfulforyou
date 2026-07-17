import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { attachRequestAbort } from "../../tools/dev_server_abort.mjs";

function fixture() {
  const request = new EventEmitter();
  request.socket = new EventEmitter();
  const response = new EventEmitter();
  response.writableFinished = false;
  const controller = new AbortController();
  attachRequestAbort({ request, response, controller });
  return { request, response, controller };
}

describe("dev server request abort bridge", () => {
  it("aborts a streamed API request when the response closes early", () => {
    const { response, controller } = fixture();
    response.emit("close");
    expect(controller.signal.aborted).toBe(true);
  });

  it("aborts when the client socket closes before the response finishes", () => {
    const { request, controller } = fixture();
    request.socket.emit("close");
    expect(controller.signal.aborted).toBe(true);
  });

  it("does not abort an ordinarily completed response and cleans listeners", () => {
    const { request, response, controller } = fixture();
    response.writableFinished = true;
    response.emit("finish");
    response.emit("close");
    request.socket.emit("close");
    expect(controller.signal.aborted).toBe(false);
    expect(response.listenerCount("close")).toBe(0);
    expect(request.listenerCount("aborted")).toBe(0);
    expect(request.socket.listenerCount("close")).toBe(0);
  });
});
