import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  acquireAmazonImportLock,
  importAmazonOrderItemsTransactional,
  releaseAmazonImportLock,
  renewAmazonImportLock,
} from "../../api/_lib/amazon-import-store.js";
import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import { loadEnvFile } from "../../tools/env_file.mjs";

const PRIMARY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function item(id, text = "Ada\nRN") {
  return {
    id,
    text,
    source: {
      orderNumber: `ORDER-${id}`,
      buyerName: "Ada Lovelace",
      listingId: `LISTING-${id}`,
      transactionId: `TX-${id}`,
      colorName: "Teal",
      quantity: 2,
    },
    settings: {
      backingMm: 4.2,
      lines: [
        { fontId: "skywalk", fontSizeMm: 18 },
        { fontId: "somekind", bridgeMm: 0.7 },
      ],
    },
  };
}

beforeAll(() => {
  loadEnvFile();
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const allowRemote = process.env.TFY_ALLOW_REMOTE_DB_TESTS === "1";
  if (!allowRemote && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(supabaseUrl)) {
    throw new Error(`Refusing to run DB tests against non-local SUPABASE_URL: ${supabaseUrl || "<missing>"}.`);
  }
});

describe("Amazon import database integration", () => {
  it("serializes acquisition, preserves ownership, and allows expiry reclamation", async () => {
    const now = new Date("2026-07-25T15:00:00.000Z");
    const results = await Promise.all([
      acquireAmazonImportLock({ workspaceId: PRIMARY_WORKSPACE_ID, lockToken: "race-a", now }),
      acquireAmazonImportLock({ workspaceId: PRIMARY_WORKSPACE_ID, lockToken: "race-b", now }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);

    const owner = results[0] ? "race-a" : "race-b";
    const stale = results[0] ? "race-b" : "race-a";
    await expect(renewAmazonImportLock({
      workspaceId: PRIMARY_WORKSPACE_ID,
      lockToken: stale,
      now: new Date("2026-07-25T15:05:00.000Z"),
    })).resolves.toBe(false);
    await expect(releaseAmazonImportLock({
      workspaceId: PRIMARY_WORKSPACE_ID,
      lockToken: stale,
    })).resolves.toBe(false);
    await expect(renewAmazonImportLock({
      workspaceId: PRIMARY_WORKSPACE_ID,
      lockToken: owner,
      now: new Date("2026-07-25T15:05:00.000Z"),
    })).resolves.toBe(true);

    await expect(acquireAmazonImportLock({
      workspaceId: PRIMARY_WORKSPACE_ID,
      lockToken: "reclaimed",
      now: new Date("2026-07-25T15:16:00.000Z"),
    })).resolves.toBe(true);
    await expect(releaseAmazonImportLock({
      workspaceId: PRIMARY_WORKSPACE_ID,
      lockToken: owner,
    })).resolves.toBe(false);
    await expect(releaseAmazonImportLock({
      workspaceId: PRIMARY_WORKSPACE_ID,
      lockToken: "reclaimed",
    })).resolves.toBe(true);
  });

  it("atomically inserts supplied orders, designs, and ordered lines", async () => {
    const firstId = `amazon-order-item:${randomUUID()}`;
    const secondId = `amazon-order-item:${randomUUID()}`;
    const result = await importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      items: [item(firstId), item(secondId, "Grace\nLPN")],
    });
    expect(result).toEqual({
      importedOrderItemIds: [firstId, secondId],
      existingOrderItemIds: [],
    });

    const supabase = createSupabaseAdminClient();
    const { data: orders, error: ordersError } = await supabase
      .from("order_items")
      .select("id, order_number, quantity")
      .in("id", [firstId, secondId])
      .order("id");
    expect(ordersError).toBeNull();
    expect(orders).toHaveLength(2);

    const { data: designs, error: designsError } = await supabase
      .from("designs")
      .select("id, order_item_id, design_text")
      .in("order_item_id", [firstId, secondId])
      .order("order_item_id");
    expect(designsError).toBeNull();
    expect(designs).toHaveLength(2);

    const firstDesign = designs.find((design) => design.order_item_id === firstId);
    const { data: lines, error: linesError } = await supabase
      .from("design_lines")
      .select("line_index, text, font_id")
      .eq("design_id", firstDesign.id)
      .order("line_index");
    expect(linesError).toBeNull();
    expect(lines).toEqual([
      { line_index: 0, text: "Ada", font_id: "skywalk" },
      { line_index: 1, text: "RN", font_id: "somekind" },
    ]);
  });

  it("reports durable IDs as existing without changing their stored rows", async () => {
    const id = `amazon-order-item:${randomUUID()}`;
    await importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      items: [item(id, "Original")],
    });

    const result = await importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      items: [item(id, "Replacement")],
    });
    expect(result).toEqual({
      importedOrderItemIds: [],
      existingOrderItemIds: [id],
    });

    const supabase = createSupabaseAdminClient();
    const { data: design, error } = await supabase
      .from("designs")
      .select("design_text")
      .eq("order_item_id", id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(design.design_text).toBe("Original");
  });

  it("rolls back every row when one line payload violates the schema", async () => {
    const validId = `amazon-order-item:${randomUUID()}`;
    const invalidId = `amazon-order-item:${randomUUID()}`;
    const valid = item(validId);
    const invalid = item(invalidId);
    invalid.settings.lines[0].fontSizeMm = 0;

    await expect(importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      items: [valid, invalid],
    })).rejects.toThrow("Unable to import Amazon order items");

    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("order_items")
      .select("id")
      .in("id", [validId, invalidId]);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("blocks anon and authenticated browser clients from state and RPC access", async () => {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: anonTableError } = await anon
      .from("amazon_import_state")
      .select("workspace_id");
    expect(anonTableError).not.toBeNull();
    const { error: anonRpcError } = await anon.rpc("import_amazon_order_items", {
      p_workspace_id: PRIMARY_WORKSPACE_ID,
      p_user_id: null,
      p_items: [],
    });
    expect(anonRpcError).not.toBeNull();

    const admin = createSupabaseAdminClient();
    const email = `amazon-db-test-${randomUUID()}@example.com`;
    const password = `T-${randomUUID()}!`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(createError).toBeNull();

    const authenticated = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await authenticated.auth.signInWithPassword({ email, password });
    expect(signInError).toBeNull();
    const { error: authenticatedTableError } = await authenticated
      .from("amazon_import_state")
      .select("workspace_id");
    expect(authenticatedTableError).not.toBeNull();
    const { error: authenticatedRpcError } = await authenticated.rpc("import_amazon_order_items", {
      p_workspace_id: PRIMARY_WORKSPACE_ID,
      p_user_id: created.user.id,
      p_items: [],
    });
    expect(authenticatedRpcError).not.toBeNull();

    await admin.auth.admin.deleteUser(created.user.id);
  });
});
