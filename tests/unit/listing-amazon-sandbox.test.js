import { expect, it, vi } from "vitest";
import { buildSandboxPayload, stableListingSku, createListingAmazonSandboxService } from "../../api/_lib/listing-amazon-sandbox.js";
const draft = { id: "11111111-1111-4111-8111-111111111111", revision: 3, title: "Acrylic topper", description: "Personalized topper", bullets: ["a", "b", "c", "d", "e"], copyApproved: true, basePriceCents: 1999, images: [{ id: "image1", selected: true, main: true, approved: true, url: "https://storage.example/image.jpg?token=private" }] };
it("builds product-only copy/image attributes and stable SKU without offers or ASINs", () => {
  const result = buildSandboxPayload(draft);
  expect(stableListingSku(draft.id)).toBe("TFY-11111111111141118111111111111111");
  expect(result.payload.requirements).toBe("LISTING_PRODUCT_ONLY");
  expect(result.payload.attributes.bullet_point).toHaveLength(5);
  expect(result.payload.attributes.main_product_image_locator[0].media_location).toContain("image.jpg");
  expect(JSON.stringify(result.payload)).not.toMatch(/purchasable_offer|fulfillment_availability|1999|B0H5TJYK3D/);
  expect(result.issues).toEqual([]);
});
it("blocks unapproved copy and incomplete bullet/gallery reviews", () => {
  expect(buildSandboxPayload({ ...draft, bullets: ["a"], copyApproved: false, images: [{ ...draft.images[0], approved: false }] }).issues.length).toBeGreaterThan(2);
});
it("hashes content consistently despite refreshed signed delivery URLs", () => {
  expect(buildSandboxPayload(draft).hash).toBe(buildSandboxPayload({ ...draft, images: [{ ...draft.images[0], url: "https://storage.example/image.jpg?token=changed" }] }).hash);
});
it("records uncertain submission without retrying and never claims a listing exists", async () => {
  const attempts = { claim: vi.fn(async () => ({ id: "attempt" })), finish: vi.fn(), list: vi.fn(async () => []) };
  const client = { submit: vi.fn(async () => { throw Object.assign(new Error("Safe failure"), { uncertain: true, expose: true }); }) };
  const service = createListingAmazonSandboxService({ attempts, client, configured: () => true });
  await service.run({ workspaceId: "w", draft, action: "submit" });
  expect(client.submit).toHaveBeenCalledTimes(1);
  expect(attempts.finish).toHaveBeenCalledWith(expect.objectContaining({ status: "unknown" }));
});
it("does not reconcile a canned response for a different SKU", async () => {
  const attempts = { claim: vi.fn(async () => ({ id: "attempt" })), finish: vi.fn(), list: vi.fn(async () => []) };
  const service = createListingAmazonSandboxService({ attempts, client: { get: async () => ({ sku: "CANNED-SKU", status: "BUYABLE", issues: [] }) }, configured: () => true });
  await service.run({ workspaceId: "w", draft, action: "reconcile" });
  expect(attempts.finish).toHaveBeenCalledWith(expect.objectContaining({ status: "unconfirmed" }));
});
