import crypto from "node:crypto";

export const LISTING_ASSET_BUCKET = "listing-draft-assets";
const ALLOWED = new Map([["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"]]);
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_BASE64_CHARS = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;
const MAX_DIMENSION = 12_000;
const MAX_PIXELS = 50_000_000;
const TIMEOUT_MS = 15_000;
const ETSY_IMAGE_HOSTS = new Set(["i.etsystatic.com", "img0.etsystatic.com", "img1.etsystatic.com", "img2.etsystatic.com", "img3.etsystatic.com", "img4.etsystatic.com"]);

function listingError(statusCode, message) { return Object.assign(new Error(message), { statusCode, expose: true }); }
function invalidUrl() { return listingError(400, "Etsy image URL is invalid."); }
function invalidRaster() { return listingError(400, "Etsy image is invalid."); }

function trustedEtsyImageUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !ETSY_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return null;
  return url;
}

export async function downloadTrustedEtsyRaster({ sourceUrl, fetchImpl = fetch, maxRedirects = 2, signal: callerSignal = null, createTimeoutSignal = () => AbortSignal.timeout(TIMEOUT_MS) }) {
  let url = trustedEtsyImageUrl(sourceUrl);
  if (!url) throw invalidUrl();
  const timeoutSignal = createTimeoutSignal(TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      const response = await fetchImpl(url, { redirect: "manual", signal, headers: { Accept: "image/jpeg,image/png,image/webp" } });
      if ([301, 302, 303, 307, 308].includes(response?.status)) {
        const location = response.headers?.get?.("location");
        const next = location ? trustedEtsyImageUrl(new URL(location, url).toString()) : null;
        await cancelResponse(response);
        if (!next) throw invalidUrl();
        url = next;
        continue;
      }
      if (!response?.ok) throw listingError(502, "Unable to download Etsy image.");
      const mimeType = contentType(response.headers?.get?.("content-type"));
      if (!ALLOWED.has(mimeType)) throw listingError(400, "Etsy image is not a supported raster image.");
      const claimed = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(claimed) && claimed > MAX_DOWNLOAD_BYTES) { await cancelResponse(response); throw listingError(400, "Etsy image is too large."); }
      const bytes = await readBoundedResponse(response, MAX_DOWNLOAD_BYTES, signal, () => listingError(400, "Etsy image is too large."));
      if (!bytes.length) throw invalidRaster();
      const asset = validateRasterBytes({ bytes, mimeType, maxBytes: MAX_DOWNLOAD_BYTES });
      return { ...asset, sourceUrl: url.toString() };
    }
    throw invalidUrl();
  } catch (error) {
    if (error?.statusCode) throw error;
    if (signal?.aborted || error?.name === "AbortError" || error?.name === "TimeoutError") throw listingError(504, "Etsy image download timed out.");
    throw listingError(502, "Unable to download Etsy image.");
  }
}

export function readBase64Raster(file) {
  if (!file || typeof file.name !== "string" || typeof file.type !== "string" || typeof file.dataBase64 !== "string") throw listingError(400, "Image upload must include a file.");
  const mimeType = file.type.toLowerCase().trim();
  if (!ALLOWED.has(mimeType)) throw listingError(400, "Upload a JPEG, PNG, or WebP image.");
  const encoded = file.dataBase64;
  if (!encoded || encoded.length > MAX_UPLOAD_BASE64_CHARS || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw listingError(400, "Image upload is invalid.");
  let bytes;
  try { bytes = Buffer.from(encoded, "base64"); } catch { throw listingError(400, "Image upload is invalid."); }
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES || bytes.toString("base64") !== encoded) throw listingError(400, "Image upload is invalid.");
  try { return { ...validateRasterBytes({ bytes, mimeType, maxBytes: MAX_UPLOAD_BYTES }), name: file.name.slice(0, 160) }; } catch { throw listingError(400, "Image upload is invalid."); }
}

export function validateRasterBytes({ bytes, mimeType, maxBytes = MAX_DOWNLOAD_BYTES } = {}) {
  if (!ALLOWED.has(mimeType) || !(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) throw invalidRaster();
  const data = Buffer.from(bytes);
  if (!data.length || data.length > maxBytes) throw invalidRaster();
  const dimensions = readRasterDimensions(data, mimeType);
  if (!dimensions || !Number.isInteger(dimensions.width) || !Number.isInteger(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION || dimensions.width * dimensions.height > MAX_PIXELS) throw invalidRaster();
  return { bytes: data, mimeType, extension: ALLOWED.get(mimeType), ...dimensions };
}

export function readRasterDimensions(bytes, mimeType) {
  if (mimeType === "image/png") return readPngDimensions(bytes);
  if (mimeType === "image/jpeg") return readJpegDimensions(bytes);
  if (mimeType === "image/webp") return readWebpDimensions(bytes);
  return null;
}

function readPngDimensions(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString() !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let offset = 2; offset + 4 <= bytes.length;) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || marker === undefined) return null;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 8) return null;
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(bytes) {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString() !== "RIFF" || bytes.subarray(8, 12).toString() !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  const type = bytes.subarray(12, 16).toString(); const size = bytes.readUInt32LE(16); const payload = 20;
  if (payload + size > bytes.length) return null;
  if (type === "VP8X" && size >= 10) return { width: 1 + bytes.readUIntLE(payload + 4, 3), height: 1 + bytes.readUIntLE(payload + 7, 3) };
  if (type === "VP8 " && size >= 10 && bytes.subarray(payload + 3, payload + 6).equals(Buffer.from([0x9d, 0x01, 0x2a]))) return { width: bytes.readUInt16LE(payload + 6) & 0x3fff, height: bytes.readUInt16LE(payload + 8) & 0x3fff };
  if (type === "VP8L" && size >= 5 && bytes[payload] === 0x2f) {
    const b1 = bytes[payload + 1]; const b2 = bytes[payload + 2]; const b3 = bytes[payload + 3]; const b4 = bytes[payload + 4];
    return { width: 1 + b1 + ((b2 & 0x3f) << 8), height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10) };
  }
  return null;
}

async function readBoundedResponse(response, maximum, signal, tooLarge) {
  const reader = response.body?.getReader?.();
  try {
    if (!reader) { const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.length > maximum) throw tooLarge(); return bytes; }
    const chunks = []; let length = 0;
    while (true) {
      const item = await readWithSignal(reader, signal);
      if (item.done) return Buffer.concat(chunks, length);
      const chunk = Buffer.from(item.value); length += chunk.length;
      if (length > maximum) throw tooLarge();
      chunks.push(chunk);
    }
  } catch (error) {
    await cancelReader(reader);
    throw error;
  }
}

function readWithSignal(reader, signal) {
  if (!signal) return reader.read();
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => { void cancelReader(reader); reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then((result) => { signal.removeEventListener("abort", abort); resolve(result); }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

async function cancelReader(reader) { try { await reader?.cancel?.(); } catch {} }
async function cancelResponse(response) { try { if (response?.body?.cancel) await response.body.cancel(); else await cancelReader(response?.body?.getReader?.()); } catch {} }
function contentType(value) { return typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : ""; }

export function listingAssetPath({ workspaceId, draftId, extension, id = crypto.randomUUID() }) { return `workspaces/${String(workspaceId).replace(/[^a-z0-9-]/gi, "")}/listing-drafts/${String(draftId).replace(/[^a-z0-9-]/gi, "")}/${id}.${extension}`; }
