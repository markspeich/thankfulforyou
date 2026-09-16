import { beforeEach, describe, expect, it, vi } from "vitest";
import { createListingsHandler } from "../../api/_lib/listing-handler.js";
import { ListingProviderError } from "../../api/_lib/listing-providers.js";

function response() { return { headers: {}, status(v) { this.statusCode = v; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(v) { this.body = v; } }; }
const draft = { id: "draft-1", revision: 3, title: "Source", description: "", bullets: ["", "", "", "", ""], basePriceCents: 1999, facts: {}, warnings: [], images: [], copyApproved: false };

describe("listing preparation API", () => {
  let deps;
  beforeEach(() => { deps = { resolveAuth: vi.fn().mockResolvedValue({ workspaceId: "workspace-1" }), getCapabilities: () => ({ amazon: false, copyGeneration: false, imagePreparation: false }), store: { getCopyImages: vi.fn().mockResolvedValue([]), listDrafts: vi.fn().mockResolvedValue([draft]), getDraft: vi.fn().mockResolvedValue(draft), getCopyPrompt: vi.fn().mockResolvedValue("Default instruction"), saveCopyPrompt: vi.fn(), updateDraft: vi.fn(), importDraft: vi.fn() }, importer: { importOwnedListing: vi.fn() } }; });
  it("scopes a direct draft lookup to the authenticated workspace", async () => {
    // Break caught: a request id could read a draft outside its workspace.
    const res = response(); await createListingsHandler(deps)({ method: "GET", query: { id: "draft-1" } }, res);
    expect(deps.store.getDraft).toHaveBeenCalledWith({ workspaceId: "workspace-1", id: "draft-1" });
    expect(res.body.draft).toEqual(draft);
  });
  it("keeps Amazon submission unavailable", async () => {
    // Break caught: preparation state accidentally enables a live marketplace write.
    const res = response(); await createListingsHandler(deps)({ method: "POST", body: { action: "submitAmazon", id: "draft-1" } }, res);
    expect(res).toMatchObject({ statusCode: 409, body: { error: "Amazon submission is not available yet." } });
  });
  it("does not expose draft data before authenticating", async () => {
    deps.resolveAuth.mockRejectedValue(Object.assign(new Error("Authentication required."), { statusCode: 401, expose: true }));
    const res = response();
    await createListingsHandler(deps)({ method: "GET" }, res);
    expect(res.statusCode).toBe(401);
    expect(deps.store.listDrafts).not.toHaveBeenCalled();
  });
  it("returns the workspace copy prompt without loading listing drafts", async () => {
    // Break caught: loading the editable instruction adds an unnecessary draft query and can cross workspace boundaries.
    deps.store.getCopyPrompt = vi.fn().mockResolvedValue("Workspace instruction");
    const res = response();
    await createListingsHandler(deps)({ method: "GET", query: { setting: "copyPrompt" } }, res);
    expect(res).toMatchObject({ statusCode: 200, body: { prompt: "Workspace instruction" } });
    expect(deps.store.getCopyPrompt).toHaveBeenCalledWith({ workspaceId: "workspace-1" });
    expect(deps.store.listDrafts).not.toHaveBeenCalled();
  });
  it("saves a trimmed copy prompt only in the authenticated workspace", async () => {
    // Break caught: a client could save blank copy instructions or target another workspace.
    deps.store.saveCopyPrompt = vi.fn().mockResolvedValue("Workspace instruction");
    const res = response();
    await createListingsHandler(deps)({ method: "POST", body: { action: "saveCopyPrompt", prompt: "  Workspace instruction  " } }, res);
    expect(res).toMatchObject({ statusCode: 200, body: { prompt: "Workspace instruction" } });
    expect(deps.store.saveCopyPrompt).toHaveBeenCalledWith({ workspaceId: "workspace-1", prompt: "Workspace instruction" });
  });
  it("rejects empty and oversized copy prompts", async () => {
    for (const prompt of ["   ", "x".repeat(20_001)]) {
      const res = response();
      await createListingsHandler(deps)({ method: "POST", body: { action: "saveCopyPrompt", prompt } }, res);
      expect(res.statusCode).toBe(400);
    }
    expect(deps.store.saveCopyPrompt).not.toHaveBeenCalled();
  });
  it("keeps copy persistence inside its operation claim and retains source warnings", async () => {
    deps.getCapabilities = () => ({ copyGeneration: true });
    deps.store.getDraft.mockResolvedValue({ ...draft, warnings: ["Check size"] });
    deps.generateCopy = vi.fn(async () => ({ title: "Generated", description: "Copy", bullets: ["1", "2", "3", "4", "5"], warnings: ["Check material"] }));
    let inClaim = false;
    deps.store.runOperation = vi.fn(async ({ run }) => { inClaim = true; try { return await run(); } finally { inClaim = false; } });
    deps.store.updateDraft.mockImplementation(async (args) => { expect(inClaim).toBe(true); expect(args.internalWarnings).toEqual(["Check size", "Check material"]); return { ...draft, ...args.changes }; });
    const res = response();
    await createListingsHandler(deps)({ method: "POST", body: { action: "generateCopy", id: draft.id, revision: 3 } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.draft.title).toBe("Generated");
  });
  it("uses the saved workspace prompt for copy generation", async () => {
    deps.getCapabilities = () => ({ copyGeneration: true });
    deps.store.getCopyPrompt = vi.fn().mockResolvedValue("Workspace instruction");
    deps.store.runOperation = vi.fn(({ run }) => run());
    deps.store.updateDraft = vi.fn().mockResolvedValue(draft);
    deps.generateCopy = vi.fn().mockResolvedValue({ title: "Generated", description: "Copy", bullets: ["1", "2", "3", "4", "5"], warnings: [] });
    const res = response();
    await createListingsHandler(deps)({ method: "POST", body: { action: "generateCopy", id: draft.id, revision: draft.revision } }, res);
    expect(res.statusCode).toBe(200);
    expect(deps.store.getCopyPrompt).toHaveBeenCalledWith({ workspaceId: "workspace-1" });
    expect(deps.store.getCopyImages).toHaveBeenCalledWith({ workspaceId: "workspace-1", draftId: draft.id });
    expect(deps.generateCopy).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Workspace instruction" }));
  });
  it("rejects a stale revision before any generation call", async () => {
    deps.generateCopy = vi.fn();
    const res = response();
    await createListingsHandler(deps)({ method: "POST", body: { action: "generateCopy", id: draft.id, revision: 2 } }, res);
    expect(res.statusCode).toBe(409);
    expect(deps.generateCopy).not.toHaveBeenCalled();
  });
  it("returns the actionable billing error without overwriting the saved draft", async () => {
    deps.getCapabilities = () => ({ copyGeneration: true });
    deps.store.runOperation = vi.fn(({ run }) => run());
    deps.generateCopy = vi.fn().mockRejectedValue(new ListingProviderError({ code: "openai_quota_exhausted", statusCode: 402, message: "OpenAI API credits are exhausted. Check billing." }));
    const res = response();
    await createListingsHandler(deps)({ method: "POST", body: { action: "generateCopy", id: draft.id, revision: draft.revision } }, res);
    expect(res).toMatchObject({ statusCode: 402, body: { error: "OpenAI API credits are exhausted. Check billing." } });
    expect(deps.store.updateDraft).not.toHaveBeenCalled();
  });
  it("checks workspace ownership and revision before a sandbox request", async () => {
    deps.sandboxService = { configured: () => true, run: vi.fn(), describe: vi.fn() };
    const res = response();
    await createListingsHandler(deps)({ method: "POST", body: { action: "submitAmazonSandbox", id: draft.id, revision: 2 } }, res);
    expect(deps.store.getDraft).toHaveBeenCalledWith({ workspaceId: "workspace-1", id: draft.id });
    expect(res.statusCode).toBe(409);
    expect(deps.sandboxService.run).not.toHaveBeenCalled();
    deps.store.getDraft.mockResolvedValue(null);
    const missing = response();
    await createListingsHandler(deps)({ method: "POST", body: { action: "submitAmazonSandbox", id: draft.id, revision: 3 } }, missing);
    expect(missing.statusCode).toBe(404);
    expect(deps.sandboxService.run).not.toHaveBeenCalled();
  });
  it("returns sandbox history after testing the saved draft without enabling production", async () => {
    const history = { sku: "TFY-test", attempts: [{ status: "checked" }] };
    deps.sandboxService = { configured: () => true, run: vi.fn(), describe: vi.fn().mockResolvedValue(history) };
    const res = response();
    await createListingsHandler(deps)({ method: "POST", body: { action: "validateAmazonSandbox", id: draft.id, revision: 3 } }, res);
    expect(deps.sandboxService.run).toHaveBeenCalledWith({ workspaceId: "workspace-1", draft, action: "validate" });
    expect(res.body.draft.amazonSandbox).toEqual(history);
    const listed = response();
    await createListingsHandler(deps)({ method: "GET" }, listed);
    expect(listed.body.capabilities).toMatchObject({ amazon: false, amazonSandbox: true });
  });
});
