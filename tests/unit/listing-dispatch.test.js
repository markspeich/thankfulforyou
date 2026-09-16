import { expect, it, vi } from "vitest";
const listingHandler = vi.hoisted(() => vi.fn(async (_req, res) => res.status(200).json({ drafts: [] })));
vi.mock("../../api/_lib/listing-handler.js", () => ({ default: listingHandler }));
import handler from "../../api/etsy-connection.js";

it("delegates the listing rewrite including query parameters to the authenticated listing handler", async () => {
  const req = { method: "GET", query: { resource: "listings", id: "draft-id" } };
  const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler(req, res);
  expect(listingHandler).toHaveBeenCalledWith(req, res);
  expect(res.json).toHaveBeenCalledWith({ drafts: [] });
});
