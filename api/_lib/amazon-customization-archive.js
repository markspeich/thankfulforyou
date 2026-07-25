import yauzl from "yauzl";

const DEFAULT_LIMITS = Object.freeze({
  compressedBytes: 5 * 1024 * 1024,
  entries: 32,
  totalUncompressedBytes: 20 * 1024 * 1024,
  jsonEntryBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
});

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const ERROR_MESSAGES = Object.freeze({
  untrusted_customization_url: "The customization download URL is not trusted.",
  invalid_customization_archive: "The customization archive is invalid.",
  customization_archive_too_large: "The customization archive is too large.",
  customization_download_failed: "The customization archive could not be retrieved.",
  customization_download_aborted: "The customization archive download was cancelled.",
  customization_download_timeout: "The customization archive download timed out.",
});

export class AmazonCustomizationArchiveError extends Error {
  constructor(code, statusCode) {
    super(ERROR_MESSAGES[code] ?? "The customization archive could not be processed.");
    this.name = "AmazonCustomizationArchiveError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function archiveError(code, statusCode) {
  return new AmazonCustomizationArchiveError(code, statusCode);
}

function isTrustedCustomizationUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:"
    && url.hostname === "zme-caps.amazon.com"
    && !url.username
    && !url.password
    && !url.port;
}

function resolveLimits(overrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isFinite(value) || value <= 0) throw archiveError("invalid_customization_archive", 422);
  }
  return limits;
}

function createRequestSignal(signal, timeoutMs) {
  const controller = new AbortController();
  let callerAborted = false;
  let timedOut = false;
  const abortForCaller = () => { callerAborted = true; controller.abort(); };
  if (signal?.aborted) abortForCaller();
  else signal?.addEventListener("abort", abortForCaller, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  return {
    signal: controller.signal,
    abortedByCaller: () => callerAborted,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortForCaller);
    },
  };
}

function abortError(request) {
  if (request.timedOut()) return archiveError("customization_download_timeout", 504);
  if (request.abortedByCaller()) return archiveError("customization_download_aborted", 499);
  return archiveError("customization_download_failed", 502);
}

function awaitWithRequestAbort(promise, request) {
  if (request.signal.aborted) return Promise.reject(abortError(request));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      request.signal.removeEventListener("abort", onAbort);
      reject(abortError(request));
    };
    request.signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { request.signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { request.signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

async function readResponseBody(response, limit, request) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) throw archiveError("customization_archive_too_large", 413);
  const chunks = [];
  let total = 0;
  const addChunk = (chunk) => {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > limit) throw archiveError("customization_archive_too_large", 413);
    chunks.push(bytes);
  };
  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      try {
        while (true) {
          if (request.signal.aborted) throw abortError(request);
          const { done, value } = await awaitWithRequestAbort(reader.read(), request);
          if (done) break;
          addChunk(value);
        }
      } finally {
        reader.releaseLock();
      }
    } else if (response.body?.[Symbol.asyncIterator]) {
      const iterator = response.body[Symbol.asyncIterator]();
      let iteratorDone = false;
      try {
        while (true) {
          if (request.signal.aborted) throw abortError(request);
          const { done, value } = await awaitWithRequestAbort(iterator.next(), request);
          if (done) {
            iteratorDone = true;
            break;
          }
          addChunk(value);
        }
      } finally {
        if (!iteratorDone) {
          try { Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* Best-effort iterator cancellation. */ }
          try { response.body.destroy?.(); } catch { /* Best-effort stream cancellation. */ }
        }
      }

    } else {
      addChunk(await awaitWithRequestAbort(response.arrayBuffer(), request));
    }
  } catch (error) {
    if (error instanceof AmazonCustomizationArchiveError) throw error;
    if (request.signal.aborted) throw abortError(request);
    throw archiveError("customization_download_failed", 502);
  }
  if (request.signal.aborted) throw abortError(request);
  return Buffer.concat(chunks, total);
}

function isUnsafeEntryName(name) {
  return !name || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..");
}

function isJsonEntry(name) {
  return name.toLowerCase().endsWith(".json");
}

function readZipEntry(zip, entry, maxBytes) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (openError, stream) => {
      if (openError || !stream) return reject(archiveError("invalid_customization_archive", 422));
      const chunks = [];
      let total = 0;
      stream.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) stream.destroy(archiveError("customization_archive_too_large", 413));
        else chunks.push(chunk);
      });
      stream.once("error", (error) => reject(error instanceof AmazonCustomizationArchiveError ? error : archiveError("invalid_customization_archive", 422)));
      stream.once("end", () => resolve(Buffer.concat(chunks, total)));
    });
  });
}

async function readJsonFromZip(buffer, limits, openZip) {
  let zip;
  try {
    zip = await openZip(buffer, { lazyEntries: true, validateEntrySizes: true });
  } catch {
    throw archiveError("invalid_customization_archive", 422);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let entryCount = 0;
    let totalUncompressed = 0;
    let jsonRead;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      try { zip.close(); } catch { /* Zip may already be closed. */ }
      if (error) reject(error);
      else resolve(value);
    };
    zip.once("error", () => finish(archiveError("invalid_customization_archive", 422)));
    zip.on("entry", (entry) => {
      if (settled) return;
      entryCount += 1;
      if (entryCount > limits.entries) return finish(archiveError("customization_archive_too_large", 413));
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || isUnsafeEntryName(entry.fileName)) {
        return finish(archiveError("invalid_customization_archive", 422));
      }
      totalUncompressed += entry.uncompressedSize;
      if (totalUncompressed > limits.totalUncompressedBytes) return finish(archiveError("customization_archive_too_large", 413));
      if (isJsonEntry(entry.fileName)) {
        if (jsonRead) return finish(archiveError("invalid_customization_archive", 422));
        if (entry.uncompressedSize > limits.jsonEntryBytes) return finish(archiveError("customization_archive_too_large", 413));
        jsonRead = readZipEntry(zip, entry, limits.jsonEntryBytes);
      }
      zip.readEntry();
    });
    zip.once("end", async () => {
      if (!jsonRead) return finish(archiveError("invalid_customization_archive", 422));
      try {
        const bytes = await jsonRead;
        const parsed = JSON.parse(bytes.toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid shape");
        finish(null, parsed);
      } catch (error) {
        finish(error instanceof AmazonCustomizationArchiveError ? error : archiveError("invalid_customization_archive", 422));
      }
    });
    zip.readEntry();
  });
}

export async function fetchAmazonCustomizationJson({ url, fetchImpl = fetch, signal, limits: suppliedLimits, openZip = yauzl.fromBufferPromise } = {}) {
  if (!isTrustedCustomizationUrl(url)) throw archiveError("untrusted_customization_url", 400);
  const limits = resolveLimits(suppliedLimits);
  const request = createRequestSignal(signal, limits.timeoutMs);
  try {
    let currentUrl = url;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      let response;
      try {
        response = await fetchImpl(currentUrl, { redirect: "manual", credentials: "omit", signal: request.signal });
      } catch {
        if (request.signal.aborted) throw abortError(request);
        throw archiveError("customization_download_failed", 502);
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount === 3) throw archiveError("customization_download_failed", 502);
        const location = response.headers?.get?.("location");
        if (!location) throw archiveError("customization_download_failed", 502);
        try { currentUrl = new URL(location, currentUrl).toString(); } catch { throw archiveError("untrusted_customization_url", 400); }
        if (!isTrustedCustomizationUrl(currentUrl)) throw archiveError("untrusted_customization_url", 400);
        continue;
      }
      if (!response.ok) throw archiveError("customization_download_failed", 502);
      const archive = await readResponseBody(response, limits.compressedBytes, request);
      if (archive.length < 4 || archive.readUInt32LE(0) !== 0x04034b50) throw archiveError("invalid_customization_archive", 422);
      return await readJsonFromZip(archive, limits, openZip);
    }
    throw archiveError("customization_download_failed", 502);
  } finally {
    request.dispose();
  }
}
