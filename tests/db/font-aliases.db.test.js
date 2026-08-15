import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import { loadEnvFile } from "../../tools/env_file.mjs";

const PRIMARY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

let memberUserId;
let memberClient;
let secondaryWorkspaceId;
let secondaryUserId;
let secondaryClient;

function activeFont(overrides = {}) {
  const suffix = randomUUID();
  return {
    id: `font-alias-test-${suffix}`,
    workspace_id: PRIMARY_WORKSPACE_ID,
    display_name: `Alias Test ${suffix}`,
    family_name: `AliasTest${suffix.replaceAll("-", "")}`,
    storage_path: `workspaces/${PRIMARY_WORKSPACE_ID}/fonts/${suffix}.otf`,
    file_name: `${suffix}.otf`,
    file_format: "otf",
    ...overrides,
  };
}

async function createAuthenticatedUser(admin, workspaceId) {
  const email = `font-alias-${randomUUID()}@example.com`;
  const password = `T-${randomUUID()}!`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(createError).toBeNull();

  const { error: membershipError } = await admin.from("workspace_memberships").insert({
    workspace_id: workspaceId,
    user_id: created.user.id,
    role: "operator",
  });
  expect(membershipError).toBeNull();

  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  expect(signInError).toBeNull();

  return { client, userId: created.user.id };
}

async function createDesignFixture(admin, { fontIds, revision = 1 } = {}) {
  const orderItemId = `font-alias-order-${randomUUID()}`;
  const designId = randomUUID();
  const selectedFonts = fontIds || ["candlepin", "somekind"];
  const { error: orderError } = await admin.from("order_items").insert({
    id: orderItemId,
    workspace_id: PRIMARY_WORKSPACE_ID,
    order_number: `FONT-${randomUUID()}`,
    revision,
  });
  expect(orderError).toBeNull();
  const { error: designError } = await admin.from("designs").insert({
    id: designId,
    workspace_id: PRIMARY_WORKSPACE_ID,
    order_item_id: orderItemId,
    design_text: "Ada\nRN",
    revision,
  });
  expect(designError).toBeNull();
  const { error: linesError } = await admin.from("design_lines").insert([
    {
      design_id: designId,
      line_index: 0,
      text: "Ada",
      font_id: selectedFonts[0],
      letter_bridge_mm: 0.7,
      line_bridge_mm: 0.4,
      offset_x_mm: 1.25,
      text_height_mm: 19,
      horizontal_scale: 0.95,
      vertical_scale: 1.05,
      lock_text_height: true,
    },
    {
      design_id: designId,
      line_index: 1,
      text: "RN",
      font_id: selectedFonts[1],
      letter_bridge_mm: 0.5,
      line_bridge_mm: 0.5,
      offset_x_mm: 0,
      text_height_mm: 16,
      horizontal_scale: 1,
      vertical_scale: 1,
      lock_text_height: false,
    },
  ]);
  expect(linesError).toBeNull();
  return { designId, orderItemId, revision };
}

async function mapAlias(admin, overrides = {}) {
  return admin.rpc("map_workspace_font_alias", {
    p_workspace_id: PRIMARY_WORKSPACE_ID,
    p_alias_name: `Marketplace ${randomUUID()}`,
    p_normalized_alias: `marketplace ${randomUUID()}`,
    p_font_id: "skywalk",
    ...overrides,
  });
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
  secondaryWorkspaceId = randomUUID();
  const { error: workspaceError } = await admin.from("workspaces").insert({
    id: secondaryWorkspaceId,
    name: "Font Alias Secondary Workspace",
  });
  expect(workspaceError).toBeNull();

  ({ client: memberClient, userId: memberUserId } = await createAuthenticatedUser(
    admin,
    PRIMARY_WORKSPACE_ID,
  ));
  ({ client: secondaryClient, userId: secondaryUserId } = await createAuthenticatedUser(
    admin,
    secondaryWorkspaceId,
  ));
});

afterAll(async () => {
  const admin = createSupabaseAdminClient();
  await Promise.all([
    memberUserId ? admin.auth.admin.deleteUser(memberUserId) : Promise.resolve(),
    secondaryUserId ? admin.auth.admin.deleteUser(secondaryUserId) : Promise.resolve(),
  ]);
});

describe("workspace font alias database foundation", () => {
  it("enforces normalized alias uniqueness within each workspace", async () => {
    const admin = createSupabaseAdminClient();
    const primaryFont = activeFont();
    const secondaryFont = activeFont({ workspace_id: secondaryWorkspaceId });
    expect((await admin.from("fonts").insert([primaryFont, secondaryFont])).error).toBeNull();

    const normalizedAlias = `shared-${randomUUID()}`;
    const first = await admin.from("font_aliases").insert({
      workspace_id: PRIMARY_WORKSPACE_ID,
      font_id: primaryFont.id,
      alias_name: "Shared Name",
      normalized_alias: normalizedAlias,
    });
    expect(first.error).toBeNull();
    const duplicate = await admin.from("font_aliases").insert({
      workspace_id: PRIMARY_WORKSPACE_ID,
      font_id: primaryFont.id,
      alias_name: "Shared Name Again",
      normalized_alias: normalizedAlias,
    });
    expect(duplicate.error?.code).toBe("23505");
    const otherWorkspace = await admin.from("font_aliases").insert({
      workspace_id: secondaryWorkspaceId,
      font_id: secondaryFont.id,
      alias_name: "Shared Name",
      normalized_alias: normalizedAlias,
    });
    expect(otherWorkspace.error).toBeNull();
  });

  it("isolates alias reads and writes with workspace membership RLS", async () => {
    const admin = createSupabaseAdminClient();
    const primaryFont = activeFont();
    const secondaryFont = activeFont({ workspace_id: secondaryWorkspaceId });
    expect((await admin.from("fonts").insert([primaryFont, secondaryFont])).error).toBeNull();
    expect((await admin.from("font_aliases").insert([
      {
        workspace_id: PRIMARY_WORKSPACE_ID,
        font_id: primaryFont.id,
        alias_name: "Primary Only",
        normalized_alias: `primary-${randomUUID()}`,
      },
      {
        workspace_id: secondaryWorkspaceId,
        font_id: secondaryFont.id,
        alias_name: "Secondary Only",
        normalized_alias: `secondary-${randomUUID()}`,
      },
    ])).error).toBeNull();

    const { data: primaryRows, error: primaryReadError } = await memberClient
      .from("font_aliases")
      .select("workspace_id");
    expect(primaryReadError).toBeNull();
    expect(primaryRows.length).toBeGreaterThan(0);
    expect(new Set(primaryRows.map((row) => row.workspace_id))).toEqual(new Set([PRIMARY_WORKSPACE_ID]));

    const forbiddenWrite = await memberClient.from("font_aliases").insert({
      workspace_id: secondaryWorkspaceId,
      font_id: secondaryFont.id,
      alias_name: "Cross Workspace",
      normalized_alias: `cross-${randomUUID()}`,
    });
    expect(forbiddenWrite.error?.code).toBe("42501");

    const { data: secondaryRows, error: secondaryReadError } = await secondaryClient
      .from("font_aliases")
      .select("workspace_id");
    expect(secondaryReadError).toBeNull();
    expect(secondaryRows.length).toBeGreaterThan(0);
    expect(new Set(secondaryRows.map((row) => row.workspace_id))).toEqual(new Set([secondaryWorkspaceId]));
  });

  it("seeds Super Boy only when an active same-workspace Super Boys font exists at migration time", async () => {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("font_aliases")
      .select("workspace_id, alias_name, normalized_alias, fonts!inner(display_name, archived_at, deleted_at)")
      .eq("normalized_alias", "super boy");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it.each([
    ["cross-workspace", () => activeFont({ workspace_id: secondaryWorkspaceId })],
    ["archived", () => activeFont({ archived_at: new Date().toISOString() })],
    ["deleted", () => activeFont({ deleted_at: new Date().toISOString() })],
  ])("rejects a %s target without saving the alias", async (_label, buildFont) => {
    const admin = createSupabaseAdminClient();
    const font = buildFont();
    expect((await admin.from("fonts").insert(font)).error).toBeNull();
    const aliasName = `Rejected ${randomUUID()}`;
    const normalizedAlias = aliasName.toLowerCase();
    const { error } = await mapAlias(admin, {
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
      p_font_id: font.id,
    });
    expect(error?.code).toBe("22023");
    expect((await admin.from("font_aliases").select("id").eq("normalized_alias", normalizedAlias)).data)
      .toEqual([]);
  });

  it("saves an alias without synthesizing a future design line", async () => {
    const admin = createSupabaseAdminClient();
    const aliasName = `Future ${randomUUID()}`;
    const normalizedAlias = aliasName.toLowerCase();
    const { data, error } = await mapAlias(admin, {
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      alias_name: aliasName,
      normalized_alias: normalizedAlias,
      previous_font_id: null,
      font_id: "skywalk",
      font_display_name: "Skywalk Laser",
      line: null,
      order_revision: null,
      design_revision: null,
    });
    expect((await admin.from("design_lines").select("id").eq("line_index", 7)).data).toEqual([]);
  });

  it("updates only the selected line and increments both authoritative revisions", async () => {
    const admin = createSupabaseAdminClient();
    const fixture = await createDesignFixture(admin);
    const aliasName = `Selected ${randomUUID()}`;
    const { data, error } = await mapAlias(admin, {
      p_alias_name: aliasName,
      p_normalized_alias: aliasName.toLowerCase(),
      p_order_item_id: fixture.orderItemId,
      p_design_id: fixture.designId,
      p_line_index: 0,
      p_expected_order_revision: fixture.revision,
      p_expected_design_revision: fixture.revision,
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      font_id: "skywalk",
      font_display_name: "Skywalk Laser",
      order_revision: 2,
      design_revision: 2,
      line: {
        design_id: fixture.designId,
        line_index: 0,
        text: "Ada",
        font_id: "skywalk",
        letter_bridge_mm: 0.7,
        line_bridge_mm: 0.4,
        offset_x_mm: 1.25,
        text_height_mm: 19,
        horizontal_scale: 0.95,
        vertical_scale: 1.05,
        lock_text_height: true,
      },
    });
    const { data: lines } = await admin
      .from("design_lines")
      .select("line_index, font_id")
      .eq("design_id", fixture.designId)
      .order("line_index");
    expect(lines).toEqual([
      { line_index: 0, font_id: "skywalk" },
      { line_index: 1, font_id: "somekind" },
    ]);
  });

  it("returns previous and current authoritative font metadata when reassigning an alias", async () => {
    const admin = createSupabaseAdminClient();
    const aliasName = `Reassign ${randomUUID()}`;
    const normalizedAlias = aliasName.toLowerCase();
    expect((await mapAlias(admin, {
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
      p_font_id: "candlepin",
    })).error).toBeNull();

    const { data, error } = await mapAlias(admin, {
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
      p_font_id: "somekind",
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({
      previous_font_id: "candlepin",
      previous_font_display_name: "Candlepin Laser",
      font_id: "somekind",
      font_display_name: "Somekind",
    });
    const { data: rows } = await admin
      .from("font_aliases")
      .select("font_id")
      .eq("workspace_id", PRIMARY_WORKSPACE_ID)
      .eq("normalized_alias", normalizedAlias);
    expect(rows).toEqual([{ font_id: "somekind" }]);
  });

  it.each([
    ["order", { p_expected_order_revision: 0, p_expected_design_revision: 1 }],
    ["design", { p_expected_order_revision: 1, p_expected_design_revision: 0 }],
  ])("rolls back alias and line changes for a stale %s revision", async (_label, revisions) => {
    const admin = createSupabaseAdminClient();
    const fixture = await createDesignFixture(admin);
    const aliasName = `Stale ${randomUUID()}`;
    const normalizedAlias = aliasName.toLowerCase();
    expect((await mapAlias(admin, {
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
      p_font_id: "candlepin",
    })).error).toBeNull();

    const { error } = await mapAlias(admin, {
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
      p_font_id: "skywalk",
      p_order_item_id: fixture.orderItemId,
      p_design_id: fixture.designId,
      p_line_index: 0,
      ...revisions,
    });
    expect(error?.code).toBe("40001");
    const [{ data: aliases }, { data: lines }, { data: orders }, { data: designs }] = await Promise.all([
      admin.from("font_aliases").select("font_id").eq("normalized_alias", normalizedAlias),
      admin.from("design_lines").select("font_id").eq("design_id", fixture.designId).eq("line_index", 0),
      admin.from("order_items").select("revision").eq("id", fixture.orderItemId),
      admin.from("designs").select("revision").eq("id", fixture.designId),
    ]);
    expect(aliases).toEqual([{ font_id: "candlepin" }]);
    expect(lines).toEqual([{ font_id: "candlepin" }]);
    expect(orders).toEqual([{ revision: 1 }]);
    expect(designs).toEqual([{ revision: 1 }]);
  });

  it("serializes concurrent mapping attempts and returns the one authoritative winner", async () => {
    const fixture = await createDesignFixture(createSupabaseAdminClient());
    const aliasName = `Concurrent ${randomUUID()}`;
    const normalizedAlias = aliasName.toLowerCase();
    const inputs = ["skywalk", "somekind"].map((fontId) => ({
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
      p_font_id: fontId,
      p_order_item_id: fixture.orderItemId,
      p_design_id: fixture.designId,
      p_line_index: 0,
      p_expected_order_revision: 1,
      p_expected_design_revision: 1,
    }));
    const results = await Promise.all(inputs.map((input) => (
      createSupabaseAdminClient().rpc("map_workspace_font_alias", {
        p_workspace_id: PRIMARY_WORKSPACE_ID,
        ...input,
      })
    )));
    const successes = results.filter((result) => !result.error);
    const conflicts = results.filter((result) => result.error?.code === "40001");
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);

    const winner = successes[0].data;
    const admin = createSupabaseAdminClient();
    const [{ data: aliases }, { data: lines }, { data: orders }, { data: designs }] = await Promise.all([
      admin.from("font_aliases").select("font_id").eq("normalized_alias", normalizedAlias),
      admin.from("design_lines").select("font_id").eq("design_id", fixture.designId).eq("line_index", 0),
      admin.from("order_items").select("revision").eq("id", fixture.orderItemId),
      admin.from("designs").select("revision").eq("id", fixture.designId),
    ]);
    expect(aliases).toEqual([{ font_id: winner.font_id }]);
    expect(lines).toEqual([{ font_id: winner.font_id }]);
    expect(orders).toEqual([{ revision: 2 }]);
    expect(designs).toEqual([{ revision: 2 }]);
  });
});
