import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { writeNdjson } from "../../api/_lib/ndjson-writer.js";

function response(write = vi.fn(() => true)) {
  const res = new EventEmitter();
  res.write = write;
  res.writableFinished = false;
  res.writableEnded = false;
  res.destroyed = false;
  return res;
}

describe("NDJSON writer", () => {
  it("writes one newline-delimited frame", async () => {
    const res = response();
    await writeNdjson(res, { type: "progress", processed: 1 });
    expect(res.write).toHaveBeenCalledWith('{"type":"progress","processed":1}\n');
  });

  it("waits for drain after backpressure", async () => {
    const res = response(vi.fn(() => false));
    let settled = false;
    const pending = writeNdjson(res, { type: "progress" }).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    res.emit("drain");
    await pending;
    expect(settled).toBe(true);
  });

  it("rejects when write throws", async () => {
    const failure = new Error("write failed");
    const res = response(vi.fn(() => { throw failure; }));
    await expect(writeNdjson(res, { type: "progress" })).rejects.toBe(failure);
  });

  it("rejects backpressure waits on close and removes listeners", async () => {
    const res = response(vi.fn(() => false));
    const pending = writeNdjson(res, { type: "progress" });
    res.emit("close");
    await expect(pending).rejects.toMatchObject({ code: "transport_closed" });
    expect(res.listenerCount("drain")).toBe(0);
    expect(res.listenerCount("error")).toBe(0);
  });
});
