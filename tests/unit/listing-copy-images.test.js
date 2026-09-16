import { describe, it, expect, vi } from "vitest";
import { createListingStore } from "../../api/_lib/listing-store.js";
function setup(download) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [{ storage_bucket: "listing-draft-assets", storage_path: "owned.png", mime_type: "image/png" }] }) };
  const store = createListingStore({ supabase: { from: vi.fn(() => query), storage: { from: () => ({ download }) } } });
  return { store, query };
}
describe("copy source photos", () => {
  it("loads only workspace-owned originals in source order", async () => {
    const bytes = Buffer.alloc(24);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
    bytes.writeUInt32BE(13,8); bytes.write("IHDR",12); bytes.writeUInt32BE(20,16); bytes.writeUInt32BE(10,20);
    const { store, query } = setup(vi.fn().mockResolvedValue({ data: new Blob([bytes]) }));
    expect(await store.getCopyImages({ workspaceId: "w", draftId: "d" })).toEqual([{ bytes, mimeType: "image/png" }]);
    expect(query.eq.mock.calls).toEqual([["workspace_id", "w"], ["draft_id", "d"], ["kind", "original"]]);
    expect(query.order).toHaveBeenCalledWith("source_rank", { ascending: true });
    expect(query.limit).toHaveBeenCalledWith(10);
  });
  it("reports missing photos instead of silently omitting them", async () => {
    const { store } = setup(vi.fn().mockResolvedValue({ error: new Error("private storage detail") }));
    await expect(store.getCopyImages({ workspaceId: "w", draftId: "d" })).rejects.toMatchObject({ statusCode: 502, message: "Unable to load an imported Etsy photo. Try generating copy again." });
  });
});
