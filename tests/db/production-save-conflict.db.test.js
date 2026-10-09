import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import { saveProductionBatch } from "../../api/_lib/production-batch-store.js";

const REQUEST_TIMEOUT_MS = 3000;
let supabase;
let workspaceId;
let row;

async function rpc(orderItems, colorUpdates = []) {
  const started = performance.now();
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/save_production_order_items`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_order_items: orderItems, p_color_updates: colorUpdates }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.text();
  const elapsedMs = performance.now() - started;
  console.log(`save_production_order_items HTTP ${response.status} in ${Math.round(elapsedMs)}ms`);
  return { status: response.status, body: body ? JSON.parse(body) : null, elapsedMs };
}

beforeEach(async () => {
  // These fixtures must never be created in production, even if remote tests are enabled elsewhere.
  const url = new URL(process.env.SUPABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Save-conflict regression requires isolated local Supabase.");
  }
  supabase = createSupabaseAdminClient();
  workspaceId = randomUUID();
  const { error } = await supabase.from("workspaces").insert({ id: workspaceId, name: "Save conflict regression" });
  expect(error).toBeNull();
  row = {
    id: `conflict-${randomUUID()}`, workspace_id: workspaceId, status: "open",
    quantity: 1, revision: 2, updated_at: new Date().toISOString(),
    imported_color: "Hot Pink", source_json: { colorName: "Hot Pink" },
  };
  expect((await rpc([row])).status).toBe(204);
});

afterEach(async () => {
  if (workspaceId && supabase) {
    const { error } = await supabase.from("workspaces").delete().eq("id", workspaceId);
    expect(error).toBeNull();
  }
  workspaceId = null;
});

describe("production save conflict through local PostgREST", () => {
  it("returns bounded PT409/409 and rolls back every row in a stale explicit color request", async () => {
    const newRow = { ...row, id: `a-new-${randomUUID()}`, revision: 1 };
    const conflict = await rpc([newRow, row], [{ orderItemId: row.id, action: "set", colorName: "Wrong" }]);
    expect(conflict).toMatchObject({ status: 409, body: { code: "PT409", message: "Order item revision conflict." } });
    expect(conflict.elapsedMs).toBeLessThan(REQUEST_TIMEOUT_MS);
    const { data, error } = await supabase.from("order_items").select("id, revision, imported_color, source_json").eq("workspace_id", workspaceId);
    expect(error).toBeNull();
    expect(data).toEqual([{ id: row.id, revision: 2, imported_color: "Hot Pink", source_json: { colorName: "Hot Pink" } }]);
  });

  it("maps an actual RPC conflict to REVISION_CONFLICT before writing batch or design records", async () => {
    const batchId = randomUUID();
    await expect(saveProductionBatch({
      userId: null,
      snapshot: {
        batch: { id: batchId, workspaceId, name: "Conflict batch", status: "active" },
        activeOrderItemId: row.id,
        orderItems: [{ id: row.id, revision: 1, text: "Draft", source: { colorName: "Wrong" }, settings: { text: "Draft", lines: [] } }],
      },
      colorUpdates: [{ orderItemId: row.id, action: "clear" }],
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    for (const table of ["production_batches", "designs"]) {
      const { data, error } = await supabase.from(table).select("id").eq("workspace_id", workspaceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    const { data, error } = await supabase.from("order_items").select("revision, imported_color, source_json").eq("id", row.id).single();
    expect(error).toBeNull();
    expect(data).toEqual({ revision: 2, imported_color: "Hot Pink", source_json: { colorName: "Hot Pink" } });
  });

  it("keeps fresh saves and explicit color intent working after a rejected stale save", async () => {
    expect((await rpc([row])).status).toBe(409);
    expect((await rpc([{ ...row, revision: 3, imported_color: "Stale Blue" }])).status).toBe(204);
    expect((await rpc([{ ...row, revision: 4 }], [{ orderItemId: row.id, action: "set", colorName: " Purple " }])).status).toBe(204);
    expect((await rpc([{ ...row, revision: 5 }], [{ orderItemId: row.id, action: "clear" }])).status).toBe(204);
    expect((await rpc([{ ...row, revision: 6 }])).status).toBe(204);
    const { data, error } = await supabase.from("order_items").select("revision, imported_color, source_json").eq("id", row.id).single();
    expect(error).toBeNull();
    expect(data).toEqual({ revision: 6, imported_color: null, source_json: { colorName: "" } });
  });
});
