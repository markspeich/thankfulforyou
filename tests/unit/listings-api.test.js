import { describe, expect, it, vi } from "vitest";

import { fetchListingCopyPrompt, saveListingCopyPrompt, fetchListings, saveListingDraft } from "../../src/listings-api.js";

describe("listings api", () => {
  it("sends the bearer token while loading drafts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ drafts: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchListings({ accessToken: "token-1" })).resolves.toEqual({ drafts: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/listings", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer token-1" }),
    }));
  });

  it("saves an explicit change set with its revision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ draft: { id: "draft-1" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await saveListingDraft({ id: "draft-1", revision: 3, changes: { title: "Updated" }, accessToken: "token-1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/listings", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ id: "draft-1", revision: 3, changes: { title: "Updated" } }),
    }));
  });
});

it("loads and saves the authenticated workspace prompt", async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ prompt: "Five concise bullets" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(fetchListingCopyPrompt({ accessToken: "token-1" })).resolves.toEqual({ prompt: "Five concise bullets" });
  expect(fetchMock).toHaveBeenCalledWith("/api/listings?setting=copyPrompt", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token-1" }) }));
  await saveListingCopyPrompt({ prompt: "Five concise bullets", accessToken: "token-1" });
  expect(fetchMock).toHaveBeenLastCalledWith("/api/listings", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "saveCopyPrompt", prompt: "Five concise bullets" }) }));
  vi.unstubAllGlobals();
});
