import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), begin: vi.fn() }));
vi.mock("../../api/_lib/production-batch-auth.js", () => ({ resolveProductionBatchAuth: mocks.auth }));
vi.mock("../../api/_lib/etsy-connection-store.js", () => ({ getEtsyConnection: mocks.get }));
vi.mock("../../api/_lib/etsy-oauth.js", () => ({ OAUTH_STATE_MAX_AGE_SECONDS: 900, beginEtsyAuthorization: mocks.begin }));
import handler from "../../api/etsy-connection.js";
function response() { return { headers: {}, status(v) { this.statusCode = v; return this; }, setHeader(k, v) { this.headers[k] = v; }, json(v) { this.body = v; } }; }
beforeEach(() => { mocks.auth.mockReset().mockResolvedValue({ workspaceId: "w", userId: "u" }); mocks.get.mockReset(); mocks.begin.mockReset(); });
describe("Etsy connection API", () => {
  it("returns status without credentials", async () => { mocks.get.mockResolvedValue({ status: "connected", etsyShopName: "Badge Shop", accessToken: "no" }); const res = response(); await handler({ method: "GET" }, res); expect(res.body).toEqual({ status: "connected", shopName: "Badge Shop", reconnectRequired: false }); });
  it("starts authorization with scoped cookie", async () => { mocks.begin.mockReturnValue({ authorizeUrl: "https://etsy.test", sealedContext: "sealed" }); const res = response(); await handler({ method: "POST", body: { action: "beginAuthorization" } }, res); expect(res.body).toEqual({ authorizeUrl: "https://etsy.test" }); expect(res.headers["Set-Cookie"]).toContain("HttpOnly"); expect(res.headers["Set-Cookie"]).toContain("Path=/api/etsy-callback"); expect(res.headers["Set-Cookie"]).toContain("Max-Age=900"); });
  it("rejects unsupported action and method", async () => { let res = response(); await handler({ method: "POST", body: { action: "writeOrders" } }, res); expect(res.statusCode).toBe(400); res = response(); await handler({ method: "DELETE" }, res); expect(res.statusCode).toBe(405); });
});
