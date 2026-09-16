import { describe, expect, it, vi } from "vitest";
import { downloadTrustedEtsyRaster, readBase64Raster, validateRasterBytes } from "../../api/_lib/listing-assets.js";

function png(width = 20, height = 10) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}
function webp(chunkType, payload) {
  const bytes = Buffer.alloc(20 + payload.length + (payload.length % 2));
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WEBP", 8); bytes.write(chunkType, 12); bytes.writeUInt32LE(payload.length, 16); payload.copy(bytes, 20);
  return bytes;
}
function webpVp8(width = 12, height = 8) { const payload = Buffer.alloc(10); payload.set([0, 0, 0, 0x9d, 0x01, 0x2a]); payload.writeUInt16LE(width, 6); payload.writeUInt16LE(height, 8); return webp("VP8 ", payload); }
function webpVp8l(width = 12, height = 8) { const payload = Buffer.alloc(5); payload[0] = 0x2f; const w = width - 1; const h = height - 1; payload[1] = w & 0xff; payload[2] = ((w >> 8) & 0x3f) | ((h & 3) << 6); payload[3] = (h >> 2) & 0xff; payload[4] = (h >> 10) & 0x0f; return webp("VP8L", payload); }
function imageResponse(bytes, { status = 200, headers = {}, body = null } = {}) { return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), body, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }; }

describe("listing assets", () => {
  it("rejects URL credentials, nonstandard ports, and an untrusted redirect", async () => {
    const fetchImpl = vi.fn();
    for (const sourceUrl of ["https://user:pass@i.etsystatic.com/a.png", "https://i.etsystatic.com:444/a.png", "http://i.etsystatic.com/a.png"]) await expect(downloadTrustedEtsyRaster({ sourceUrl, fetchImpl })).rejects.toMatchObject({ statusCode: 400, message: "Etsy image URL is invalid." });
    expect(fetchImpl).not.toHaveBeenCalled();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const redirect = imageResponse(Buffer.alloc(0), { status: 302, headers: { location: "https://evil.example/image.png" }, body: { cancel } });
    await expect(downloadTrustedEtsyRaster({ sourceUrl: "https://i.etsystatic.com/1/a.png", fetchImpl: vi.fn().mockResolvedValue(redirect) })).rejects.toMatchObject({ statusCode: 400 });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("streams an Etsy image with a 10 MiB cap instead of buffering an oversized chunk", async () => {
    const reader = { read: vi.fn().mockResolvedValue({ done: false, value: new Uint8Array(10 * 1024 * 1024 + 1) }), cancel: vi.fn().mockResolvedValue(undefined) };
    const response = imageResponse(Buffer.alloc(0), { headers: { "content-type": "image/png" }, body: { getReader: () => reader } });
    await expect(downloadTrustedEtsyRaster({ sourceUrl: "https://i.etsystatic.com/1/a.png", fetchImpl: vi.fn().mockResolvedValue(response) })).rejects.toMatchObject({ statusCode: 400, message: "Etsy image is too large." });
    expect(reader.cancel).toHaveBeenCalledOnce();
  });

  it("uses one timeout signal for redirects and returns a safe timeout", async () => {
    const timeout = new AbortController();
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("secret", "AbortError")), { once: true })));
    const pending = downloadTrustedEtsyRaster({ sourceUrl: "https://i.etsystatic.com/1/a.png", fetchImpl, createTimeoutSignal: () => timeout.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce()); timeout.abort();
    await expect(pending).rejects.toMatchObject({ statusCode: 504, message: "Etsy image download timed out." });
  });

  it("validates common VP8 and VP8L WebP headers and rejects zero or excessive pixel dimensions", () => {
    expect(validateRasterBytes({ bytes: webpVp8(), mimeType: "image/webp" })).toMatchObject({ width: 12, height: 8, extension: "webp" });
    expect(validateRasterBytes({ bytes: webpVp8l(), mimeType: "image/webp" })).toMatchObject({ width: 12, height: 8 });
    expect(() => validateRasterBytes({ bytes: png(0, 10), mimeType: "image/png" })).toThrow("image is invalid");
    expect(() => validateRasterBytes({ bytes: png(12_000, 12_000), mimeType: "image/png" })).toThrow("image is invalid");
  });

  it("bounds and strictly decodes uploads before examining their raster bytes", () => {
    const encoded = png().toString("base64");
    expect(readBase64Raster({ name: "badge.png", type: "image/png", dataBase64: encoded })).toMatchObject({ width: 20, height: 10 });
    expect(() => readBase64Raster({ name: "badge.png", type: "image/png", dataBase64: `${encoded}\n` })).toThrow("Image upload is invalid.");
    expect(() => readBase64Raster({ name: "badge.png", type: "image/png", dataBase64: "A".repeat(4 * 1024 * 1024 + 4) })).toThrow("Image upload is invalid.");
    expect(() => readBase64Raster({ name: "badge.png", type: "image/png", dataBase64: "not-base64!" })).toThrow("Image upload is invalid.");
  });
});
