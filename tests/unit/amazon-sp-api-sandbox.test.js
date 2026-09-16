import { expect, it, vi } from "vitest";
import { checkAmazonSandbox } from "../../tools/amazon_sp_api_sandbox.mjs";

const env = { AMAZON_SP_API_ENVIRONMENT: "sandbox", AMAZON_SP_API_CLIENT_ID: "client-test", AMAZON_SP_API_CLIENT_SECRET: "secret-test", AMAZON_SP_API_REFRESH_TOKEN: "refresh-test" };
it("exchanges credentials only with LWA then uses only the sandbox endpoint", async () => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-test", expires_in: 3600 })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ payload: { Orders: [] } })));
  const result = await checkAmazonSandbox({ env, fetchImpl });
  expect(fetchImpl.mock.calls[0][0]).toBe("https://api.amazon.com/auth/o2/token");
  expect(fetchImpl.mock.calls[0][1].body.get("refresh_token")).toBe("refresh-test");
  expect(fetchImpl.mock.calls[1][0]).toContain("https://sandbox.sellingpartnerapi-na.amazon.com/");
  expect(result).toEqual({ environment: "sandbox", authentication: "passed", sandboxRequest: "passed", httpStatus: 200 });
  expect(JSON.stringify(result)).not.toMatch(/secret-test|refresh-test|access-test/);
});
it("rejects production configuration before sending credentials", async () => {
  const fetchImpl = vi.fn();
  await expect(checkAmazonSandbox({ env: { ...env, AMAZON_SP_API_ENVIRONMENT: "production" }, fetchImpl })).rejects.toThrow("sandbox");
  expect(fetchImpl).not.toHaveBeenCalled();
});
it("reports missing keys by name without their values", async () => {
  await expect(checkAmazonSandbox({ env: { ...env, AMAZON_SP_API_REFRESH_TOKEN: "" } })).rejects.toThrow("AMAZON_SP_API_REFRESH_TOKEN");
});
it("sanitizes upstream failures and never follows credential-bearing redirects", async () => {
  const fetchImpl = vi.fn(async (_url, options) => {
    expect(options.redirect).toBe("error");
    throw new Error("secret-test access-test");
  });
  await expect(checkAmazonSandbox({ env, fetchImpl })).rejects.toThrow("Amazon authentication request failed");
});
it("does not treat an arbitrary successful sandbox response as a valid check", async () => {
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-test" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ unexpected: true })));
  await expect(checkAmazonSandbox({ env, fetchImpl })).rejects.toThrow("unexpected response");
});
