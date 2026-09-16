import { createProductionAttemptStore } from "../../api/_lib/listing-amazon-production-store.js";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import { createListingStore } from "../../api/_lib/listing-store.js";
import { createSandboxAttemptStore } from "../../api/_lib/listing-amazon-sandbox-store.js";
import { DEFAULT_LISTING_COPY_PROMPT } from "../../api/_lib/listing-copy-prompt.js";

let admin, store, member, userId;
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const png = { name: "pixel.png", type: "image/png", dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=" };
const must = (result) => { expect(result.error).toBeNull(); return result.data; };

async function createDraft() {
  return (await store.importDraft({ workspaceId, etsyShopId: "shop", etsyListingId: String(Date.now()) + randomUUID(), source: { sourceUrl: "https://www.etsy.com/listing/123", title: "Source", description: "Acrylic topper", images: [], facts: {}, warnings: [] } })).draft;
}
function rpc(draft, overrides = {}) {
  return { p_workspace_id: workspaceId, p_draft_id: draft.id, p_revision: draft.revision, p_title: draft.title, p_description: draft.description, p_bullets: draft.bullets, p_base_price_cents: draft.basePriceCents, p_copy_approved: draft.copyApproved, p_images: null, ...overrides };
}

beforeAll(async () => {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(process.env.SUPABASE_URL || "")) throw new Error("Listing DB tests require local Supabase.");
  admin = createSupabaseAdminClient();
  store = createListingStore({ supabase: admin });
  must(await admin.from("workspaces").insert([{ id: workspaceId, name: "Listing test" }, { id: otherWorkspaceId, name: "Other listing test" }]));
  const email = `listing-${randomUUID()}@example.com`, password = `T-${randomUUID()}!`;
  userId = must(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user.id;
  must(await admin.from("workspace_memberships").insert({ workspace_id: workspaceId, user_id: userId, role: "operator" }));
  member = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  must(await member.auth.signInWithPassword({ email, password }));
});

afterAll(async () => {
  if (!admin) return;
  const { data: assets } = await admin.from("listing_assets").select("storage_path").eq("workspace_id", workspaceId);
  if (assets?.length) await admin.storage.from("listing-draft-assets").remove(assets.map((a) => a.storage_path));
  await admin.from("workspaces").delete().in("id", [workspaceId, otherWorkspaceId]);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("listing draft persistence", () => {
  it("stores the copy prompt per workspace and keeps it server-only", async () => {
    expect(await store.getCopyPrompt({ workspaceId })).toBe(DEFAULT_LISTING_COPY_PROMPT);
    await expect(store.saveCopyPrompt({ workspaceId, prompt: "Use concise clinical language." })).resolves.toBe("Use concise clinical language.");
    expect(await store.getCopyPrompt({ workspaceId })).toBe("Use concise clinical language.");
    expect(await store.getCopyPrompt({ workspaceId: otherWorkspaceId })).toBe(DEFAULT_LISTING_COPY_PROMPT);
    expect((await member.from("workspace_listing_copy_prompts").select("prompt").eq("workspace_id", workspaceId)).error).not.toBeNull();
  });
  it("binds sandbox submission to the latest reviewed revision and serializes attempts",async()=>{
    const draft=await createDraft();
    const attempts=createSandboxAttemptStore({supabase:admin});
    const context={workspaceId,draftId:draft.id,revision:draft.revision,hash:"testhash"};
    await expect(attempts.claim({...context,action:"submit"})).rejects.toMatchObject({statusCode:409});
    const preview=await attempts.claim({...context,action:"validate"});
    await expect(attempts.claim({...context,action:"validate"})).rejects.toMatchObject({statusCode:409});
    await attempts.finish({workspaceId,id:preview.id,status:"checked"});
    const submitted=await attempts.claim({...context,action:"submit"});
    await attempts.finish({workspaceId,id:submitted.id,status:"unknown"});
    await expect(attempts.claim({...context,action:"submit"})).rejects.toMatchObject({statusCode:409});
    const status=await attempts.claim({...context,action:"reconcile"});
    await attempts.finish({workspaceId,id:status.id,status:"unconfirmed"});
    expect((await attempts.list({workspaceId,draftId:draft.id})).map(a=>a.status)).toEqual(expect.arrayContaining(["checked","unknown","unconfirmed"]));
  });
  it("denies cross-workspace sandbox claims and direct browser writes",async()=>{
    const draft=await createDraft();
    const attempts=createSandboxAttemptStore({supabase:admin});
    await expect(attempts.claim({workspaceId:otherWorkspaceId,draftId:draft.id,revision:1,hash:"hash",action:"validate"})).rejects.toMatchObject({statusCode:409});
    const claimed=await attempts.claim({workspaceId,draftId:draft.id,revision:1,hash:"hash",action:"validate"});
    expect((await member.from("listing_amazon_sandbox_attempts").update({status:"checked"}).eq("id",claimed.id)).error).not.toBeNull();
    await attempts.finish({workspaceId,id:claimed.id,status:"checked"});
    await store.updateDraft({workspaceId,id:draft.id,revision:1,changes:{title:"Revised"}});
    await expect(attempts.claim({workspaceId,draftId:draft.id,revision:2,hash:"hash",action:"submit"})).rejects.toMatchObject({statusCode:409});
  });
  it("preserves manual edits when the same Etsy listing is imported again", async () => {
    const draft = await createDraft();
    await store.updateDraft({ workspaceId, id: draft.id, revision: draft.revision, changes: { title: "Manually edited" } });
    const result = await store.importDraft({ workspaceId, etsyShopId: "shop", etsyListingId: draft.etsyListingId, source: { title: "Changed on Etsy", description: "Changed", images: [] } });
    expect(result.existing).toBe(true);
    expect(result.draft).toMatchObject({ id: draft.id, title: "Manually edited", revision: 2 });
  });

  it("allows exactly one concurrent update of a revision", async () => {
    const draft = await createDraft();
    const results = await Promise.all([admin.rpc("update_listing_draft_atomic", rpc(draft, { p_title: "First" })), admin.rpc("update_listing_draft_atomic", rpc(draft, { p_title: "Second" }))]);
    expect(results.map(must).sort()).toEqual([false, true]);
    expect((await store.getDraft({ workspaceId, id: draft.id })).revision).toBe(2);
  });

  it("persists Amazon production details atomically without revoking copy approval", async () => {
    const draft = await createDraft();
    const details = { packageLengthInches: 3, packageWidthInches: 2, packageHeightInches: 1, packageWeightOunces: 1.1, manufacturer: "Thankful For You", partNumber: "TFY-123", specialFeature: "Personalized", closureType: "Clip" };
    const saved = await store.updateDraft({ workspaceId, id: draft.id, revision: draft.revision, changes: { copyApproved: true, amazonProductionDetails: details } });
    expect(saved).toMatchObject({ revision: draft.revision + 1, copyApproved: true, amazonProductionDetails: details });
    expect(must(await admin.from("listing_drafts").select("amazon_production_details").eq("id", draft.id).single()).amazon_production_details).toEqual(details);
  });

  it("switches the main image in both directions and invalidates approval", async () => {
    let draft = await createDraft();
    draft = await store.uploadAsset({ workspaceId, draftId: draft.id, revision: draft.revision, file: png });
    draft = await store.uploadAsset({ workspaceId, draftId: draft.id, revision: draft.revision, file: png });
    expect(draft.images).toHaveLength(2);
    const [a, b] = draft.images;
    for (const target of [b.id, a.id]) {
      draft = await store.updateDraft({ workspaceId, id: draft.id, revision: draft.revision, changes: { images: draft.images.map((i) => ({ id: i.id, selected: true, main: i.id === target, approved: true })) } });
      expect(draft.images.filter((i) => i.main).map((i) => i.id)).toEqual([target]);
      expect(draft.images.every((i) => !i.approved)).toBe(true);
    }
    await expect(store.uploadAsset({ workspaceId, draftId: draft.id, revision: 1, file: png })).rejects.toMatchObject({ statusCode: 409 });
    expect((await store.getDraft({ workspaceId, id: draft.id })).images).toHaveLength(2);
  });

  it("scopes reads and RPC mutations to the requested workspace", async () => {
    const draft = await createDraft();
    expect(await store.getDraft({ workspaceId: otherWorkspaceId, id: draft.id })).toBeNull();
    expect(must(await admin.rpc("update_listing_draft_atomic", rpc(draft, { p_workspace_id: otherWorkspaceId, p_title: "Forbidden" })))).toBe(false);
    const foreignId = randomUUID();
    must(await admin.from("listing_drafts").insert({ id: foreignId, workspace_id: otherWorkspaceId, etsy_shop_id: "other", etsy_listing_id: "123" }));
    expect(must(await member.from("listing_drafts").select("id").eq("id", foreignId))).toEqual([]);
  });

  it("allows only one concurrent upload and removes the losing storage object", async () => {
    const draft = await createDraft();
    const results = await Promise.allSettled([1, 2].map(() => store.uploadAsset({ workspaceId, draftId: draft.id, revision: draft.revision, file: png })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected").reason).toMatchObject({ statusCode: 409 });
    const saved = await store.getDraft({ workspaceId, id: draft.id });
    expect(saved.images).toHaveLength(1);
    const objects = must(await admin.storage.from("listing-draft-assets").list(`workspaces/${workspaceId}/listing-drafts/${draft.id}`));
    expect(objects).toHaveLength(1);
  });

  it("keeps private image originals after a preparation failure", async () => {
    let draft = await createDraft();
    draft = await store.uploadAsset({ workspaceId, draftId: draft.id, revision: draft.revision, file: png });
    await expect(store.prepareAsset({ workspaceId, draftId: draft.id, revision: draft.revision, imageId: draft.images[0].id, prepare: async () => { throw new Error("Provider failed"); } })).rejects.toThrow("Provider failed");
    const saved = await store.getDraft({ workspaceId, id: draft.id });
    expect(saved.revision).toBe(draft.revision);
    expect(saved.images.map((i) => i.id)).toEqual(draft.images.map((i) => i.id));
    const asset = must(await admin.from("listing_assets").select("storage_path").eq("id", draft.images[0].id).single());
    expect((await member.storage.from("listing-draft-assets").download(asset.storage_path)).error).not.toBeNull();
  });

  it("stores a prepared result separately from its original and leaves it unapproved", async () => {
    let draft = await createDraft();
    draft = await store.uploadAsset({ workspaceId, draftId: draft.id, revision: draft.revision, file: png });
    const saved = await store.prepareAsset({ workspaceId, draftId: draft.id, revision: draft.revision, imageId: draft.images[0].id, prepare: async () => ({ bytes: Buffer.from(png.dataBase64, "base64"), mimeType: "image/png" }) });
    expect(saved.revision).toBe(draft.revision + 1);
    expect(saved.images).toHaveLength(2);
    expect(saved.images.find((i) => i.kind === "prepared")).toMatchObject({ approved: false, main: false });
    expect(saved.images.some((i) => i.id === draft.images[0].id)).toBe(true);
  });

  it("claims generation once and records a safe failure without changing the draft", async () => {
    const draft = await createDraft();
    let release, began;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { began = resolve; });
    const context = { workspaceId, draftId: draft.id, revision: draft.revision, type: "copy_generation" };
    const first = store.runOperation({ ...context, run: async () => { began(); await gate; return "done"; } });
    await started;
    try { await expect(store.runOperation({ ...context, run: () => { throw new Error("Must not run"); } })).rejects.toMatchObject({ statusCode: 409 }); }
    finally { release(); }
    expect(await first).toBe("done");
    await expect(store.runOperation({ ...context, run: () => { throw new Error("private upstream diagnostics"); } })).rejects.toThrow("private upstream diagnostics");
    const records = must(await admin.from("listing_operations").select("status,safe_error_code").eq("draft_id", draft.id));
    expect(records.map((r) => r.status).sort()).toEqual(["completed", "failed"]);
    expect(JSON.stringify(records)).not.toContain("private");
    expect((await store.getDraft({ workspaceId, id: draft.id })).revision).toBe(draft.revision);
  });

  it("claims an import before a draft exists", async () => {
    let release, began;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { began = resolve; });
    const context = { workspaceId, type: "import", sourceKey: randomUUID() };
    const first = store.runOperation({ ...context, run: async () => { began(); await gate; return { existing: false }; } });
    await started;
    try { await expect(store.runOperation({ ...context, run: () => "unexpected" })).rejects.toMatchObject({ statusCode: 409 }); }
    finally { release(); }
    await first;
  });

  it("commits all original image metadata with the imported draft", async () => {
    const listingId = randomUUID();
    const source = { title: "Photos", description: "Topper", images: [{ bytes: Buffer.from(png.dataBase64, "base64"), mimeType: "image/png", main: true, sourceRank: 0, sourceUrl: "https://i.etsystatic.com/photo.png" }] };
    const results = await Promise.all([1, 2].map(() => store.importDraft({ workspaceId, etsyShopId: "shop", etsyListingId: listingId, source })));
    expect(results.map((r) => r.existing).sort()).toEqual([false, true]);
    expect(results[0].draft.id).toBe(results[1].draft.id);
    expect(results.every((r) => r.draft.images.length === 1)).toBe(true);
  });

  it("denies direct client writes and RPC execution", async () => {
    const draft = await createDraft();
    expect((await member.from("listing_drafts").update({ title: "Bypass" }).eq("id", draft.id)).error).not.toBeNull();
    expect((await member.rpc("update_listing_draft_atomic", rpc(draft))).error).not.toBeNull();
    expect((await store.getDraft({ workspaceId, id: draft.id })).title).toBe("Source");
  });

  it("rolls back copy and revision when an image update violates constraints", async () => {
    let draft = await createDraft();
    draft = await store.uploadAsset({ workspaceId, draftId: draft.id, revision: draft.revision, file: png });
    const result = await admin.rpc("update_listing_draft_atomic", rpc(draft, { p_title: "Must roll back", p_images: [{ id: draft.images[0].id, selected: null, main: false, approved: false }] }));
    expect(result.error).not.toBeNull();
    expect(await store.getDraft({ workspaceId, id: draft.id })).toMatchObject({ title: draft.title, revision: draft.revision });
  });
});

it("production claims bind seller, revision, validation, and uncertain outcomes", async () => {
 const draft=await createDraft();const attempts=createProductionAttemptStore({supabase:admin});
 const context={workspaceId,draftId:draft.id,revision:draft.revision,hash:"production-test",sellerId:"TEST-SELLER"};
 await expect(attempts.claim({...context,action:"submit"})).rejects.toMatchObject({statusCode:409});
 await expect(attempts.claim({...context,workspaceId:otherWorkspaceId,action:"validate"})).rejects.toMatchObject({statusCode:409});
 const validation=await attempts.claim({...context,action:"validate"});
 await expect(attempts.claim({...context,action:"validate"})).rejects.toMatchObject({statusCode:409});
 await attempts.finish({workspaceId,id:validation.id,status:"checked"});
 await expect(attempts.claim({...context,sellerId:"OTHER",action:"submit"})).rejects.toMatchObject({statusCode:409});
 const submission=await attempts.claim({...context,action:"submit"});
 await attempts.finish({workspaceId,id:submission.id,status:"unknown"});
 await expect(attempts.claim({...context,action:"submit"})).rejects.toMatchObject({statusCode:409});
 expect((await member.from("listing_amazon_production_attempts").select("*")).error).not.toBeNull();
});

it("freezes reviewed draft and assets while production operation is running", async () => {
 let draft=await createDraft();
 draft=await store.uploadAsset({workspaceId,draftId:draft.id,revision:draft.revision,file:png});
 const attempts=createProductionAttemptStore({supabase:admin});
 const claim=await attempts.claim({workspaceId,draftId:draft.id,revision:draft.revision,hash:"freeze-test",sellerId:"TEST-FREEZE",action:"validate"});
 try {
  await expect(store.updateDraft({workspaceId,id:draft.id,revision:draft.revision,changes:{title:"Changed during preview"}})).rejects.toThrow(/production operation/i);
  expect((await admin.from("listing_assets").update({approved:false}).eq("id",draft.images[0].id)).error?.message).toMatch(/production operation/i);
  expect((await admin.from("listing_assets").delete().eq("id",draft.images[0].id)).error?.message).toMatch(/production operation/i);
  await expect(store.uploadAsset({workspaceId,draftId:draft.id,revision:draft.revision,file:png})).rejects.toThrow(/production operation/i);
  const saved=await store.getDraft({workspaceId,id:draft.id});
  expect(saved.revision).toBe(draft.revision);
  expect(saved.title).toBe(draft.title);
  expect(saved.images).toHaveLength(1);
 } finally { await attempts.finish({workspaceId,id:claim.id,status:"checked",issues:[],result:{}}); }
 await expect(store.updateDraft({workspaceId,id:draft.id,revision:draft.revision,changes:{title:"Allowed after completion"}})).resolves.toMatchObject({title:"Allowed after completion"});
});
