import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildImportedDesignLineRows,
  buildImportedDesignRow,
  buildImportedOrderItemRow,
} from "../../api/_lib/orders-store.js";

import {
  acquireAmazonImportLock,
  importAmazonOrderItemsTransactional,
  releaseAmazonImportLock,
  renewAmazonImportLock,
} from "../../api/_lib/amazon-import-store.js";
import { createAmazonImportService } from "../../api/_lib/amazon-import-service.js";
import {
  appendAmazonNoteBlocks,
  normalizeShipStationItem,
} from "../../api/_lib/amazon-customization-normalizer.js";
import { createAmazonItemEnricher } from "../../api/_lib/amazon-import-enrichment.js";
import { listWorkspaceFonts } from "../../api/_lib/font-store.js";
import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import { loadPresetSnapshot } from "../../api/_lib/preset-store.js";
import { addOrderItemsToProductionBatch } from "../../api/_lib/orders-store.js";
import { loadProductionBatch } from "../../api/_lib/production-batch-store.js";
import { loadEnvFile } from "../../tools/env_file.mjs";

const PRIMARY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PRIMARY_BATCH_ID = "22222222-2222-4222-8222-222222222222";
const AMAZON_CUSTOMIZATION_FIXTURE = JSON.parse(readFileSync(
  new URL("../fixtures/amazon-customization-166136048232641.json", import.meta.url),
  "utf8",
));
let importUserId;
let nonMemberUserId;
let secondaryWorkspaceId;
let secondaryPresetId;
let secondarySizeGuideId;

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

function payloadFor(normalizedItem, workspaceId = PRIMARY_WORKSPACE_ID, userId = importUserId) {
  const context = { workspaceId, userId };
  return {
    orderItem: buildImportedOrderItemRow(normalizedItem, context),
    design: buildImportedDesignRow(normalizedItem, context),
    lines: buildImportedDesignLineRows(normalizedItem),
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

beforeAll(async () => {
  const admin = createSupabaseAdminClient();
  const { data: importUser, error: importUserError } = await admin.auth.admin.createUser({
    email: `amazon-import-member-${randomUUID()}@example.com`,
    password: `T-${randomUUID()}!`,
    email_confirm: true,
  });
  expect(importUserError).toBeNull();
  importUserId = importUser.user.id;

  const { data: nonMember, error: nonMemberError } = await admin.auth.admin.createUser({
    email: `amazon-import-nonmember-${randomUUID()}@example.com`,
    password: `T-${randomUUID()}!`,
    email_confirm: true,
  });
  expect(nonMemberError).toBeNull();
  nonMemberUserId = nonMember.user.id;

  secondaryWorkspaceId = randomUUID();
  secondaryPresetId = `amazon-secondary-preset-${randomUUID()}`;
  secondarySizeGuideId = `amazon-secondary-size-${randomUUID()}`;
  const { error: workspaceError } = await admin.from("workspaces").insert({
    id: secondaryWorkspaceId,
    name: "Amazon Import Secondary Workspace",
  });
  expect(workspaceError).toBeNull();
  const { error: membershipError } = await admin.from("workspace_memberships").insert({
    workspace_id: PRIMARY_WORKSPACE_ID,
    user_id: importUserId,
    role: "operator",
  });
  expect(membershipError).toBeNull();
  const { error: presetError } = await admin.from("presets").insert({
    id: secondaryPresetId,
    workspace_id: secondaryWorkspaceId,
    name: "Secondary Amazon Preset",
  });
  expect(presetError).toBeNull();
  const { error: sizeGuideError } = await admin.from("size_guides").insert({
    id: secondarySizeGuideId,
    workspace_id: secondaryWorkspaceId,
    name: "Secondary Amazon Size",
    max_width_in: 2,
    max_height_in: 2,
    min_width_in: 1,
    min_height_in: 1,
  });
  expect(sizeGuideError).toBeNull();
});

afterAll(async () => {
  const admin = createSupabaseAdminClient();
  await Promise.all([
    importUserId ? admin.auth.admin.deleteUser(importUserId) : Promise.resolve(),
    nonMemberUserId ? admin.auth.admin.deleteUser(nonMemberUserId) : Promise.resolve(),
  ]);
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
      userId: importUserId,
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
      userId: importUserId,
      items: [item(id, "Original")],
    });

    const result = await importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: importUserId,
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

  it("stores the raw Amazon customization document and refreshes it on re-import", async () => {
    // Break caught: the atomic RPC drops the diagnostic document on insert or existing-item imports.
    const id = `amazon-order-item:${randomUUID()}`;
    const original = item(id, "Original");
    original.amazonCustomizationJson = {
      orderItemId: "amazon-item-raw",
      "version3.0": { customizationInfo: { surfaces: [{ areas: [
        { customizationType: "TextPrinting", label: "Name", text: "Alicia", fontFamily: "Skywalk" },
      ] }] } },
    };
    await importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: importUserId,
      items: [original],
    });

    const replacement = item(id, "Replacement");
    replacement.amazonCustomizationJson = {
      orderItemId: "amazon-item-raw",
      "version3.0": { customizationInfo: { surfaces: [{ areas: [
        { customizationType: "TextPrinting", label: "Name", text: "Alicia", fontFamily: "Somekind" },
      ] }] } },
    };
    await importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: importUserId,
      items: [replacement],
    });

    const admin = createSupabaseAdminClient();
    const [{ data: orderItem, error: orderError }, { data: design, error: designError }] = await Promise.all([
      admin
        .from("order_items")
        .select("amazon_customization_json")
        .eq("id", id)
        .maybeSingle(),
      admin
        .from("designs")
        .select("design_text")
        .eq("order_item_id", id)
        .maybeSingle(),
    ]);
    expect(orderError).toBeNull();
    expect(designError).toBeNull();
    expect(orderItem.amazon_customization_json).toEqual(replacement.amazonCustomizationJson);
    expect(design.design_text).toBe("Original");
  });

  it("imports the supplied Amazon customization through the real service into the production batch", async () => {
    // Break caught: the real preset envelope, font resolver, transactional store, and batch loader disagree.
    const previousApiKey = process.env.SHIPSTATION_API_KEY;
    const previousStoreId = process.env.SHIPSTATION_AMAZON_STORE_ID;
    process.env.SHIPSTATION_API_KEY = "local-test-only";
    process.env.SHIPSTATION_AMAZON_STORE_ID = "local-test-only";
    const orderItemId = `amazon-order-item:${AMAZON_CUSTOMIZATION_FIXTURE.orderItemId}`;
    const cleanupAdmin = createSupabaseAdminClient();
    await cleanupAdmin
      .from("order_items")
      .delete()
      .eq("id", orderItemId)
      .eq("workspace_id", PRIMARY_WORKSPACE_ID);

    const shipment = {
      shipment_id: "fixture-shipment-166136048232641",
      shipment_number: AMAZON_CUSTOMIZATION_FIXTURE.orderId,
      ship_by_date: "2026-08-05",
      ship_to: { name: "Alicia" },
      items: [{
        external_order_item_id: AMAZON_CUSTOMIZATION_FIXTURE.orderItemId,
        name: AMAZON_CUSTOMIZATION_FIXTURE.title,
        asin: AMAZON_CUSTOMIZATION_FIXTURE.asin,
        sku: AMAZON_CUSTOMIZATION_FIXTURE.vendorCode,
        quantity: AMAZON_CUSTOMIZATION_FIXTURE.quantity,
        options: [{ name: "CustomizedURL", value: "https://local.test/customization.zip" }],
      }],
      tags: [],
      notes_to_buyer: "",
    };
    const client = {
      async *iteratePendingShipments() { yield shipment; },
      async updateNotesToBuyer() {},
      async addShipmentTag() {},
    };

    try {
      const [presetRecord, fonts] = await Promise.all([
        loadPresetSnapshot(PRIMARY_WORKSPACE_ID),
        listWorkspaceFonts({ workspaceId: PRIMARY_WORKSPACE_ID }),
      ]);
      const enrichItem = createAmazonItemEnricher({
        presetSnapshot: presetRecord.snapshot,
        fontOptions: fonts.map((font) => ({
          id: font.id,
          displayName: font.displayName ?? font.display_name,
          label: font.label,
        })),
      });
      const service = createAmazonImportService({
        store: {
          acquireAmazonImportLock,
          renewAmazonImportLock,
          releaseAmazonImportLock,
          importAmazonOrderItemsTransactional,
        },
        createShipStationClient: () => client,
        fetchCustomizationJson: async () => AMAZON_CUSTOMIZATION_FIXTURE,
        normalizeItem: normalizeShipStationItem,
        appendNoteBlocks: appendAmazonNoteBlocks,
        enrichItem,
      });
      const prepared = await service.prepare({
        workspaceId: PRIMARY_WORKSPACE_ID,
        userId: importUserId,
        onProgress() {},
      });
      let result;
      try {
        result = await prepared.run();
      } finally {
        await prepared.release();
      }

      expect(result).toMatchObject({ importedItems: 1, failed: 0 });
      await expect(addOrderItemsToProductionBatch({
        workspaceId: PRIMARY_WORKSPACE_ID,
        userId: importUserId,
        batchId: PRIMARY_BATCH_ID,
        orderItemIds: [orderItemId],
      })).resolves.toEqual({ addedOrderItemIds: [orderItemId] });

      const admin = createSupabaseAdminClient();
      const { data: stored, error: storedError } = await admin
        .from("order_items")
        .select("amazon_customization_json, source_json")
        .eq("id", orderItemId)
        .single();
      expect(storedError).toBeNull();
      expect(stored.amazon_customization_json).toEqual(AMAZON_CUSTOMIZATION_FIXTURE);
      expect(stored.source_json).not.toHaveProperty("amazonCustomizationJson");
      expect(stored.source_json).not.toHaveProperty("amazon_customization_json");

      const batch = await loadProductionBatch({
        batchId: PRIMARY_BATCH_ID,
        workspaceId: PRIMARY_WORKSPACE_ID,
      });
      expect(batch.orderItems).toContainEqual(expect.objectContaining({
        id: orderItemId,
        text: "Alicia\nRN",
        source: expect.objectContaining({
          customerFontSelections: [
            { lineIndex: 0, name: "Skywalk" },
            { lineIndex: 1, name: "Somekind" },
          ],
        }),
        settings: expect.objectContaining({
          lines: [
            expect.objectContaining({ fontId: "skywalk" }),
            expect.objectContaining({ fontId: "somekind" }),
          ],
        }),
      }));
      expect(JSON.stringify(batch)).not.toContain("amazon_customization_json");
    } finally {
      await cleanupAdmin
        .from("order_items")
        .delete()
        .eq("id", orderItemId)
        .eq("workspace_id", PRIMARY_WORKSPACE_ID);
      if (previousApiKey == null) delete process.env.SHIPSTATION_API_KEY;
      else process.env.SHIPSTATION_API_KEY = previousApiKey;
      if (previousStoreId == null) delete process.env.SHIPSTATION_AMAZON_STORE_ID;
      else process.env.SHIPSTATION_AMAZON_STORE_ID = previousStoreId;
    }
  });

  it("fills a missing Amazon listing identity on re-import without changing the saved design", async () => {
    // Break caught: existing Amazon rows remain permanently unable to assign presets.
    const id = `amazon-order-item:${randomUUID()}`;
    const original = item(id, "Original");
    original.source.listingId = "";
    await importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: importUserId,
      items: [original],
    });

    const replacement = item(id, "Replacement");
    replacement.source.listingId = "NURSE-SOMEKIND";
    await importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: importUserId,
      items: [replacement],
    });

    const supabase = createSupabaseAdminClient();
    const [{ data: orderItem, error: orderError }, { data: design, error: designError }] = await Promise.all([
      supabase
        .from("order_items")
        .select("listing_id, source_json")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("designs")
        .select("design_text")
        .eq("order_item_id", id)
        .maybeSingle(),
    ]);
    expect(orderError).toBeNull();
    expect(designError).toBeNull();
    expect(orderItem).toMatchObject({
      listing_id: "NURSE-SOMEKIND",
      source_json: { listingId: "NURSE-SOMEKIND" },
    });
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
      userId: importUserId,
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

  it("rejects duplicate item IDs in the RPC before any rows are written", async () => {
    const id = `amazon-order-item:${randomUUID()}`;
    const duplicatePayload = payloadFor(item(id));
    const admin = createSupabaseAdminClient();

    const { error } = await admin.rpc("import_amazon_order_items", {
      p_workspace_id: PRIMARY_WORKSPACE_ID,
      p_user_id: importUserId,
      p_items: [duplicatePayload, duplicatePayload],
    });
    expect(error?.message).toContain("unique order item IDs");

    const { data: orders, error: queryError } = await admin
      .from("order_items")
      .select("id")
      .eq("id", id);
    expect(queryError).toBeNull();
    expect(orders).toEqual([]);
  });

  it("rejects an authenticated user without workspace membership", async () => {
    const id = `amazon-order-item:${randomUUID()}`;
    await expect(importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: nonMemberUserId,
      items: [item(id)],
    })).rejects.toThrow("Unable to import Amazon order items.");

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("order_items")
      .select("id")
      .eq("id", id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("rejects a durable ID that already belongs to another workspace and rolls back", async () => {
    const conflictId = `amazon-order-item:${randomUUID()}`;
    const validId = `amazon-order-item:${randomUUID()}`;
    const admin = createSupabaseAdminClient();
    const { error: existingError } = await admin.from("order_items").insert({
      id: conflictId,
      workspace_id: secondaryWorkspaceId,
      status: "open",
      source_json: { source: "secondary-workspace" },
    });
    expect(existingError).toBeNull();

    await expect(importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: importUserId,
      items: [item(validId), item(conflictId)],
    })).rejects.toThrow("Unable to import Amazon order items.");

    const { data: validRows, error: validError } = await admin
      .from("order_items")
      .select("id")
      .eq("id", validId);
    expect(validError).toBeNull();
    expect(validRows).toEqual([]);
    const { data: existing, error: conflictError } = await admin
      .from("order_items")
      .select("workspace_id, source_json")
      .eq("id", conflictId)
      .maybeSingle();
    expect(conflictError).toBeNull();
    expect(existing).toEqual({
      workspace_id: secondaryWorkspaceId,
      source_json: { source: "secondary-workspace" },
    });
  });

  it("rejects preset and size guide references from another workspace and rolls back", async () => {
    const presetValidId = `amazon-order-item:${randomUUID()}`;
    const crossPresetId = `amazon-order-item:${randomUUID()}`;
    const crossPresetItem = item(crossPresetId);
    crossPresetItem.presetId = secondaryPresetId;

    await expect(importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: importUserId,
      items: [item(presetValidId), crossPresetItem],
    })).rejects.toThrow("Unable to import Amazon order items.");

    const sizeValidId = `amazon-order-item:${randomUUID()}`;
    const crossSizeId = `amazon-order-item:${randomUUID()}`;
    const crossSizeItem = item(crossSizeId);
    crossSizeItem.settings.boundingSizePresetId = secondarySizeGuideId;
    await expect(importAmazonOrderItemsTransactional({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: importUserId,
      items: [item(sizeValidId), crossSizeItem],
    })).rejects.toThrow("Unable to import Amazon order items.");

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("order_items")
      .select("id")
      .in("id", [presetValidId, crossPresetId, sizeValidId, crossSizeId]);
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
