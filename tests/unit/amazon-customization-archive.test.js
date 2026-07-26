import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createZip } from "../fixtures/create-amazon-customization-zip.mjs";
import {
  AmazonCustomizationArchiveError,
  fetchAmazonCustomizationJson,
} from "../../api/_lib/amazon-customization-archive.js";

const trustedUrl = "https://zme-caps.amazon.com/customization?X-Amz-Signature=private-signature";
const fixtures = new URL("../fixtures/", import.meta.url);
const response = (body, { status = 200, headers } = {}) => new Response(body, { status, headers });

async function validZip() {
  return readFile(new URL("amazon-customization.zip", fixtures));
}

async function customizationJson() {
  return readFile(new URL("amazon-customization-v3.json", fixtures));
}

describe("Amazon customization fixture generator", () => {
  it("does not rewrite the fixture when imported as a helper", async () => {
    const directory = await mkdtemp(join(tmpdir(), "amazon-fixture-"));
    try {
      const generatorPath = join(directory, "create-amazon-customization-zip.mjs");
      const archivePath = join(directory, "amazon-customization.zip");
      await copyFile(new URL("../fixtures/create-amazon-customization-zip.mjs", import.meta.url), generatorPath);
      await writeFile(join(directory, "amazon-customization-v3.json"), "{}\n");
      await writeFile(archivePath, "existing fixture");

      await import(`${pathToFileURL(generatorPath).href}?test=${Date.now()}`);

      await expect(readFile(archivePath, "utf8")).resolves.toBe("existing fixture");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
describe("Amazon Custom archive reader", () => {
  it("rejects non-HTTPS and non-Amazon customization URLs before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchAmazonCustomizationJson({ url: "http://zme-caps.amazon.com/file", fetchImpl })).rejects.toMatchObject({ code: "untrusted_customization_url" });
    await expect(fetchAmazonCustomizationJson({ url: "https://evil.example/file", fetchImpl })).rejects.toMatchObject({ code: "untrusted_customization_url" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects that leave the trusted Amazon Custom host", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(null, { status: 302, headers: { location: "https://evil.example/archive.zip" } }));
    await expect(fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl })).rejects.toMatchObject({ code: "untrusted_customization_url" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects non-ZIP responses without disclosing the signed URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response("not a zip"));
    const error = await fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl }).catch((caught) => caught);
    expect(error).toBeInstanceOf(AmazonCustomizationArchiveError);
    expect(error).toMatchObject({ code: "invalid_customization_archive", statusCode: 422 });
    expect(error.message).not.toContain("private-signature");
    expect(JSON.stringify(error)).not.toContain("private-signature");
  });

  it("enforces the compressed response limit while reading", async () => {
    const archive = await validZip();
    await expect(fetchAmazonCustomizationJson({
      url: trustedUrl,
      fetchImpl: vi.fn().mockResolvedValue(response(archive)),
      limits: { compressedBytes: archive.length - 1 },
    })).rejects.toMatchObject({ code: "customization_archive_too_large", statusCode: 413 });
  });

  it("enforces the archive entry-count limit", async () => {
    await expect(fetchAmazonCustomizationJson({
      url: trustedUrl,
      fetchImpl: vi.fn().mockResolvedValue(response(await validZip())),
      limits: { entries: 3 },
    })).rejects.toMatchObject({ code: "customization_archive_too_large", statusCode: 413 });
  });

  it("enforces the total uncompressed archive limit", async () => {
    const json = await customizationJson();
    const archive = createZip([
      { name: "customization.json", contents: json },
      { name: "ignored.xml", contents: "ignored metadata" },
    ]);
    await expect(fetchAmazonCustomizationJson({
      url: trustedUrl,
      fetchImpl: vi.fn().mockResolvedValue(response(archive)),
      limits: { totalUncompressedBytes: json.length },
    })).rejects.toMatchObject({ code: "customization_archive_too_large", statusCode: 413 });
  });

  it("enforces the JSON entry size limit", async () => {
    const json = await customizationJson();
    const archive = createZip([{ name: "customization.json", contents: json }]);
    await expect(fetchAmazonCustomizationJson({
      url: trustedUrl,
      fetchImpl: vi.fn().mockResolvedValue(response(archive)),
      limits: { jsonEntryBytes: json.length - 1 },
    })).rejects.toMatchObject({ code: "customization_archive_too_large", statusCode: 413 });
  });

  it("rejects duplicate or unsafe JSON paths", async () => {
    const json = await customizationJson();
    const duplicate = createZip([{ name: "first.json", contents: json }, { name: "second.json", contents: json }]);
    await expect(fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl: vi.fn().mockResolvedValue(response(duplicate)) })).rejects.toMatchObject({ code: "invalid_customization_archive" });

    const unsafe = createZip([{ name: "../customization.json", contents: json }]);
    await expect(fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl: vi.fn().mockResolvedValue(response(unsafe)) })).rejects.toMatchObject({ code: "invalid_customization_archive" });
  });

  it("returns the single JSON entry from a valid Amazon Custom archive", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(await validZip()));
    const result = await fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl });
    expect(result).toMatchObject({
      orderId: "TEST-ORDER",
      orderItemId: "TEST-ITEM",
    });
    expect(result["version3.0"].customizationInfo.surfaces[0].areas[1].text).toBe("Jane");
    expect(fetchImpl).toHaveBeenCalledWith(trustedUrl, expect.objectContaining({ redirect: "manual" }));
    const fetchOptions = fetchImpl.mock.calls[0][1];
    expect(fetchOptions.credentials).toBe("omit");
    expect(fetchOptions.headers).toBeUndefined();
    expect(Object.keys(fetchOptions)).toEqual(["redirect", "credentials", "signal"]);
  });

  it("returns safe cancellation and timeout errors", async () => {
    const controller = new AbortController();
    const abortFetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("private-signature", "AbortError")), { once: true });
    }));
    const cancelled = fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl: abortFetch, signal: controller.signal });
    await vi.waitFor(() => expect(abortFetch).toHaveBeenCalledOnce());
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "customization_download_aborted", statusCode: 499 });

    const timeoutFetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("private-signature", "AbortError")), { once: true });
    }));
    await expect(fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl: timeoutFetch, limits: { timeoutMs: 1 } })).rejects.toMatchObject({ code: "customization_download_timeout", statusCode: 504 });
  });

  it("keeps its timeout active while a response body is pending", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: { getReader: () => ({ read: () => new Promise(() => {}), releaseLock: () => {} }) },
    });
    await expect(fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl, limits: { timeoutMs: 1 } })).rejects.toMatchObject({ code: "customization_download_timeout", statusCode: 504 });
  }, 250);
  it("keeps a stalled async iterator cancellable and returns it on timeout", async () => {
    let returned = false;
    const iterator = {
      next: () => new Promise(() => {}),
      return: () => { returned = true; return Promise.resolve({ done: true }); },
      [Symbol.asyncIterator]() { return this; },
    };
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: iterator });
    await expect(fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl, limits: { timeoutMs: 1 } })).rejects.toMatchObject({ code: "customization_download_timeout", statusCode: 504 });
    expect(returned).toBe(true);
  }, 250);

  it("follows trusted same-host redirect chains", async () => {
    const archive = await validZip();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(null, { status: 302, headers: { location: "/first-hop" } }))
      .mockResolvedValueOnce(response(null, { status: 307, headers: { location: "https://zme-caps.amazon.com/final-hop" } }))
      .mockResolvedValueOnce(response(archive));
    await expect(fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl })).resolves.toMatchObject({ orderId: "TEST-ORDER" });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      trustedUrl,
      "https://zme-caps.amazon.com/first-hop",
      "https://zme-caps.amazon.com/final-hop",
    ]);
  });

  it("allows exactly three trusted redirects and rejects a fourth", async () => {
    const archive = await validZip();
    const threeRedirects = vi.fn()
      .mockResolvedValueOnce(response(null, { status: 302, headers: { location: "/one" } }))
      .mockResolvedValueOnce(response(null, { status: 302, headers: { location: "/two" } }))
      .mockResolvedValueOnce(response(null, { status: 302, headers: { location: "/three" } }))
      .mockResolvedValueOnce(response(archive));
    await expect(fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl: threeRedirects })).resolves.toMatchObject({ orderId: "TEST-ORDER" });
    expect(threeRedirects).toHaveBeenCalledTimes(4);

    const fourthRedirect = vi.fn().mockResolvedValue(response(null, { status: 302, headers: { location: "/again" } }));
    await expect(fetchAmazonCustomizationJson({ url: trustedUrl, fetchImpl: fourthRedirect })).rejects.toMatchObject({ code: "customization_download_failed", statusCode: 502 });
    expect(fourthRedirect).toHaveBeenCalledTimes(4);
  });

});
