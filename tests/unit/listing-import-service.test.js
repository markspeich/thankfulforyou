import { describe, expect, it, vi } from "vitest";
import { createListingImportService, recommendMainImage } from "../../api/_lib/listing-import-service.js";

function setup(overrides = {}) {
  const deps = {
    getConnection: vi.fn(async () => ({ status: "connected", etsyShopId: "7", accessToken: "old", refreshToken: "refresh", accessTokenExpiresAt: "2020-01-01" })),
    refreshAccess: vi.fn(async () => ({ accessToken: "new" })), markReconnect: vi.fn(),
    createClient: vi.fn(() => ({ getListing: vi.fn(async () => ({ listing_id: 123, shop_id: 7, title: "Acrylic topper", description: "Badge", materials: ["acrylic"], item_length: 3, item_dimensions_unit: "in" })), getListingImages: vi.fn(async () => [{ url_fullxfull: "https://i.etsystatic.com/product.jpg", alt_text: "Badge topper" }]) })),
    downloadImage: vi.fn(async () => ({ bytes: Buffer.from("image"), mimeType: "image/jpeg", extension: "jpg", width: 2000, height: 2000 })),
    ...overrides,
  };
  return { deps, service: createListingImportService(deps) };
}
describe("owned Etsy listing preparation import", () => {
  it("refreshes tokens, downloads originals and retains source facts without approving them", async () => {
    const { service, deps } = setup();
    const result = await service.importOwnedListing({ workspaceId: "w", source: "https://www.etsy.com/listing/123/example" });
    expect(deps.refreshAccess).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w", refreshToken: "refresh" }));
    expect(await deps.createClient.mock.calls[0][0].getAccessToken()).toBe("new");
    expect(result.source.facts).toMatchObject({ materials: ["acrylic"], item_length: 3 });
    expect(result.source.images[0]).toMatchObject({ main: true, alt: "Badge topper" });
    expect(result.source.warnings.join(" ")).toContain("Confirm product dimensions");
  });
  it.each([undefined, 8])("rejects missing/foreign shop before downloading assets (%s)", async (shop_id) => {
    const getImages = vi.fn();
    const { service, deps } = setup({ createClient: () => ({ getListing: async () => ({ listing_id: 123, shop_id, title: "Other" }), getListingImages: getImages }) });
    await expect(service.importOwnedListing({ workspaceId: "w", source: "123" })).rejects.toMatchObject({ statusCode: 403 });
    expect(getImages).not.toHaveBeenCalled();
    expect(deps.downloadImage).not.toHaveBeenCalled();
  });
  it("retains source copy with actionable warning if a photo cannot download", async () => {
    const { service } = setup({ downloadImage: async () => { throw new Error("secret upstream"); } });
    const result = await service.importOwnedListing({ workspaceId: "w", source: "123" });
    expect(result.source.title).toBe("Acrylic topper");
    expect(result.source.images).toEqual([]);
    expect(result.source.warnings.join(" ")).toContain("image 1 could not be downloaded");
    expect(JSON.stringify(result)).not.toContain("secret upstream");
  });
  it("marks authorization failures as reconnect required", async () => {
    const { service, deps } = setup({ refreshAccess: async () => { throw Object.assign(new Error("secret"), { category: "reauthorize" }); } });
    await expect(service.importOwnedListing({ workspaceId: "w", source: "123" })).rejects.toMatchObject({ statusCode: 409, message: "Reconnect Etsy before importing a listing." });
    expect(deps.markReconnect).toHaveBeenCalledWith({ workspaceId: "w" });
  });
  it("recommends a product photo ahead of an Etsy-first color chart", () => {
    const images = recommendMainImage([{ sourceRank: 0, alt: "Colors chart", width: 2000, height: 2000 }, { sourceRank: 1, alt: "Badge reel topper", width: 1800, height: 1800 }]);
    expect(images.map((i) => i.main)).toEqual([false, true]);
  });
});
