import { describe, expect, it } from "vitest";

import { buildProductionQuery, parseArgs } from "../../tools/db_admin/etsy_import_attempts.mjs";

describe("Etsy import attempts admin CLI", () => {
  it("requires exact workspace and order identifiers plus an explicit safe target", () => {
    expect(parseArgs(["--workspace-id=workspace-1", "--order-number=1001", "--target=local"])).toEqual({ workspaceId: "workspace-1", orderNumber: "1001", target: "local" });
    expect(() => parseArgs(["--target=local"])).toThrow("--order-number");
    expect(() => parseArgs(["--order-number=1001", "--target=local"])).toThrow("--workspace-id");
    expect(() => parseArgs(["--workspace-id=workspace-1", "--order-number=1001", "--target=staging"])).toThrow("--target");
    expect(() => parseArgs(["--workspace-id=workspace-1", "--order-number=1001", "--target=local", "--execute"])).toThrow("Unsupported");
  });

  it("uses both exact identifiers in the production read-only query", () => {
    expect(buildProductionQuery({ workspaceId: "workspace-1", orderNumber: "1001" }))
      .toContain("where workspace_id = 'workspace-1' and order_number = '1001'");
  });
});
