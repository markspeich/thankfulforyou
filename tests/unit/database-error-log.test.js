import { describe, expect, it, vi } from "vitest";

import {
  databaseErrorCause,
  databaseErrorLogArgs,
  databaseErrorLogFields,
} from "../../api/_lib/database-error-log.js";
import { createAmazonImportDiagnostics } from "../../api/_lib/amazon-import-diagnostics.js";
import { AmazonImportStoreError } from "../../api/_lib/amazon-import-store.js";

function postgrestError(overrides = {}) {
  return {
    code: "22023",
    message: "p_items[0].orderItem is invalid",
    details: "Key (id)=(private-row-value) already exists.",
    hint: null,
    ...overrides,
  };
}

describe("database error log summary", () => {
  it("finds the Supabase error behind a wrapped store error and omits row details", () => {
    // Break caught: production logs showed only AmazonImportStoreError, hiding the RPC rejection reason.
    const error = new AmazonImportStoreError("Unable to import Amazon order items.", {
      cause: postgrestError(),
    });

    expect(databaseErrorCause(error)).toEqual({
      code: "22023",
      message: "p_items[0].orderItem is invalid",
    });
    expect(JSON.stringify(databaseErrorCause(error))).not.toContain("private-row-value");
  });

  it("reads a raw rethrown PostgREST error, its hint, and PGRST codes", () => {
    expect(databaseErrorCause(postgrestError({ code: "PGRST202", message: "Could not find the function", hint: "Perhaps you meant x" })))
      .toEqual({ code: "PGRST202", message: "Could not find the function", hint: "Perhaps you meant x" });
  });

  it("ignores non-database errors, Node system errors, and cause cycles", () => {
    const cyclic = new Error("outer");
    cyclic.cause = cyclic;
    expect(databaseErrorCause(new TypeError("bad input"))).toBeNull();
    expect(databaseErrorCause(Object.assign(new Error("write EPIPE"), { code: "EPIPE", syscall: "write" }))).toBeNull();
    expect(databaseErrorCause(cyclic)).toBeNull();
    expect(databaseErrorCause(null)).toBeNull();
    expect(databaseErrorLogFields(new Error("plain"))).toEqual({});
    expect(databaseErrorLogArgs(new Error("plain"))).toEqual([]);
  });

  it("flattens control characters and bounds message length", () => {
    const summary = databaseErrorCause(postgrestError({ message: `line one\nline two ${"x".repeat(400)}` }));
    expect(summary.message).toMatch(/^line one line two x+$/);
    expect(summary.message.length).toBe(300);
  });

  it("adds the database cause to Amazon shipment failure diagnostics", () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const diagnostics = createAmazonImportDiagnostics({ logger, runId: "run-1", workspaceId: "workspace-1" });

    diagnostics.error("shipment.failed", {
      shipmentId: "se-1",
      orderNumber: "113-5091013-7708222",
      stage: "persistence",
      error: new AmazonImportStoreError("Unable to import Amazon order items.", { cause: postgrestError() }),
    });

    const [, envelope] = logger.error.mock.calls[0];
    expect(envelope.details).toMatchObject({
      errorName: "AmazonImportStoreError",
      databaseError: { code: "22023", message: "p_items[0].orderItem is invalid" },
    });
    expect(JSON.stringify(envelope)).not.toContain("private-row-value");
  });
});
