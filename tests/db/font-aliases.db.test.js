import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import { loadEnvFile } from "../../tools/env_file.mjs";
import { spawnCommand } from "../../tools/supabase_env.mjs";
import { generateSupabaseWorktreeConfig } from "../../tools/supabase_worktree_config.mjs";

const PRIMARY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

let memberUserId;
let memberClient;
let secondaryWorkspaceId;
let secondaryUserId;
let secondaryClient;
let alternateMemberUserId;
let nonOperatorUserId;
const createdAliasKeys = new Set();
const createdFontIds = new Set();
const createdOrderItemIds = new Set();
const disposableWorkspaceIds = new Set();

function quoteSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function getLocalDatabaseContainerId() {
  const config = await generateSupabaseWorktreeConfig();
  const databaseContainer = spawnCommand("docker", [
    "ps",
    "--filter", `label=com.supabase.cli.project=${config.projectId}`,
    "--filter", "name=supabase_db_",
    "--format", "{{.ID}}",
  ], { encoding: "utf8" });
  expect(databaseContainer.status, databaseContainer.stderr).toBe(0);
  const databaseContainerId = databaseContainer.stdout.trim();
  expect(databaseContainerId).toMatch(/^[a-f0-9]+$/i);
  return databaseContainerId;
}

function executeDatabaseSql(databaseContainerId, sql) {
  return spawnCommand("docker", [
    "exec",
    "-i",
    databaseContainerId,
    "psql",
    "-X",
    "-q",
    "-v", "ON_ERROR_STOP=1",
    "-U", "postgres",
    "-d", "postgres",
    "-f", "-",
  ], { encoding: "utf8", input: sql });
}

function waitForDatabaseActivity(databaseContainerId, predicate, description) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = executeDatabaseSql(databaseContainerId, String.raw`
\pset tuples_only on
\pset format unaligned
select exists (
  select 1
  from pg_catalog.pg_stat_activity
  where ${predicate}
);
`);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    if (result.stdout.trim() === "t") return;
  }
  throw new Error(`Timed out waiting for database activity: ${description}.`);
}

function waitForDatabaseSleep(databaseContainerId) {
  waitForDatabaseActivity(
    databaseContainerId,
    "wait_event = 'PgSleep' and state = 'active'",
    "test trigger sleep",
  );
}

function waitForDatabaseLock(databaseContainerId) {
  waitForDatabaseActivity(
    databaseContainerId,
    "wait_event_type = 'Lock' and state = 'active'",
    "concurrent lock waiter",
  );
}

function waitForDatabaseAdvisoryLock(databaseContainerId) {
  waitForDatabaseActivity(
    databaseContainerId,
    "wait_event = 'advisory' and state = 'active'",
    "alias advisory lock waiter",
  );
}

function activeFont(overrides = {}) {
  const suffix = randomUUID();
  const font = {
    id: `font-alias-test-${suffix}`,
    workspace_id: PRIMARY_WORKSPACE_ID,
    display_name: `Alias Test ${suffix}`,
    family_name: `AliasTest${suffix.replaceAll("-", "")}`,
    storage_path: `workspaces/${PRIMARY_WORKSPACE_ID}/fonts/${suffix}.otf`,
    file_name: `${suffix}.otf`,
    file_format: "otf",
    ...overrides,
  };
  createdFontIds.add(font.id);
  return font;
}

async function createAuthenticatedUser(admin, workspaceId, role = "operator") {
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
    role,
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
  createdOrderItemIds.add(orderItemId);
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
  const aliasName = `Marketplace ${randomUUID()}`;
  const input = {
    p_workspace_id: PRIMARY_WORKSPACE_ID,
    p_user_id: memberUserId,
    p_alias_name: aliasName,
    p_normalized_alias: aliasName.toLowerCase(),
    p_font_id: "skywalk",
    ...overrides,
  };
  createdAliasKeys.add(`${input.p_workspace_id}:${input.p_normalized_alias}`);
  return admin.rpc("map_workspace_font_alias", input);
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
  disposableWorkspaceIds.add(secondaryWorkspaceId);
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
  ({ userId: alternateMemberUserId } = await createAuthenticatedUser(
    admin,
    PRIMARY_WORKSPACE_ID,
  ));
  ({ userId: nonOperatorUserId } = await createAuthenticatedUser(
    admin,
    PRIMARY_WORKSPACE_ID,
    "viewer",
  ));
});

afterAll(async () => {
  const admin = createSupabaseAdminClient();
  const primaryAliasNames = [...createdAliasKeys]
    .map((key) => key.split(":").slice(1).join(":"));
  if (primaryAliasNames.length > 0) {
    const { error } = await admin
      .from("font_aliases")
      .delete()
      .eq("workspace_id", PRIMARY_WORKSPACE_ID)
      .in("normalized_alias", primaryAliasNames);
    expect(error).toBeNull();
  }
  if (createdOrderItemIds.size > 0) {
    const { error } = await admin.from("order_items").delete().in("id", [...createdOrderItemIds]);
    expect(error).toBeNull();
  }
  if (disposableWorkspaceIds.size > 0) {
    const { error } = await admin.from("workspaces").delete().in("id", [...disposableWorkspaceIds]);
    expect(error).toBeNull();
  }
  if (createdFontIds.size > 0) {
    const { error } = await admin.from("fonts").delete().in("id", [...createdFontIds]);
    expect(error).toBeNull();
  }
  const userDeletions = await Promise.all([
    memberUserId ? admin.auth.admin.deleteUser(memberUserId) : Promise.resolve(),
    secondaryUserId ? admin.auth.admin.deleteUser(secondaryUserId) : Promise.resolve(),
    alternateMemberUserId ? admin.auth.admin.deleteUser(alternateMemberUserId) : Promise.resolve(),
    nonOperatorUserId ? admin.auth.admin.deleteUser(nonOperatorUserId) : Promise.resolve(),
  ]);
  for (const result of userDeletions.filter(Boolean)) {
    expect(result.error).toBeNull();
  }
});

describe("workspace font alias database foundation", () => {
  it("enforces normalized alias uniqueness within each workspace", async () => {
    const admin = createSupabaseAdminClient();
    const primaryFont = activeFont();
    const secondaryFont = activeFont({ workspace_id: secondaryWorkspaceId });
    expect((await admin.from("fonts").insert([primaryFont, secondaryFont])).error).toBeNull();

    const aliasName = `Shared ${randomUUID()}`;
    const normalizedAlias = aliasName.toLowerCase();
    createdAliasKeys.add(`${PRIMARY_WORKSPACE_ID}:${normalizedAlias}`);
    const first = await admin.from("font_aliases").insert({
      workspace_id: PRIMARY_WORKSPACE_ID,
      font_id: primaryFont.id,
      alias_name: aliasName,
      normalized_alias: normalizedAlias,
    });
    expect(first.error).toBeNull();
    const duplicate = await admin.from("font_aliases").insert({
      workspace_id: PRIMARY_WORKSPACE_ID,
      font_id: primaryFont.id,
      alias_name: aliasName.toUpperCase(),
      normalized_alias: normalizedAlias,
    });
    expect(duplicate.error?.code).toBe("23505");
    const otherWorkspace = await admin.from("font_aliases").insert({
      workspace_id: secondaryWorkspaceId,
      font_id: secondaryFont.id,
      alias_name: aliasName,
      normalized_alias: normalizedAlias,
    });
    expect(otherWorkspace.error).toBeNull();
  });

  it("isolates alias reads and writes with workspace membership RLS", async () => {
    const admin = createSupabaseAdminClient();
    const primaryFont = activeFont();
    const secondaryFont = activeFont({ workspace_id: secondaryWorkspaceId });
    expect((await admin.from("fonts").insert([primaryFont, secondaryFont])).error).toBeNull();
    const primaryAliasName = `Primary ${randomUUID()}`;
    const secondaryAliasName = `Secondary ${randomUUID()}`;
    createdAliasKeys.add(`${PRIMARY_WORKSPACE_ID}:${primaryAliasName.toLowerCase()}`);
    expect((await admin.from("font_aliases").insert([
      {
        workspace_id: PRIMARY_WORKSPACE_ID,
        font_id: primaryFont.id,
        alias_name: primaryAliasName,
        normalized_alias: primaryAliasName.toLowerCase(),
      },
      {
        workspace_id: secondaryWorkspaceId,
        font_id: secondaryFont.id,
        alias_name: secondaryAliasName,
        normalized_alias: secondaryAliasName.toLowerCase(),
      },
    ])).error).toBeNull();

    const { data: primaryRows, error: primaryReadError } = await memberClient
      .from("font_aliases")
      .select("workspace_id");
    expect(primaryReadError).toBeNull();
    expect(primaryRows.length).toBeGreaterThan(0);
    expect(new Set(primaryRows.map((row) => row.workspace_id))).toEqual(new Set([PRIMARY_WORKSPACE_ID]));

    const forbiddenWrite = await memberClient.from("font_aliases").insert({
      workspace_id: PRIMARY_WORKSPACE_ID,
      font_id: primaryFont.id,
      alias_name: "Direct Member Write",
      normalized_alias: "direct member write",
    });
    expect(forbiddenWrite.error?.code).toBe("42501");

    const { data: secondaryRows, error: secondaryReadError } = await secondaryClient
      .from("font_aliases")
      .select("workspace_id");
    expect(secondaryReadError).toBeNull();
    expect(secondaryRows.length).toBeGreaterThan(0);
    expect(new Set(secondaryRows.map((row) => row.workspace_id))).toEqual(new Set([secondaryWorkspaceId]));
  });

  it("normalizes aliases with the same locale-independent Unicode contract as JavaScript", async () => {
    const admin = createSupabaseAdminClient();
    const cases = [
      ["  S\u{FF35}\u{FF50}\u{FF45}\u{FF52}\u2003Boy  ", "super boy"],
      ["  \u0130STANBUL  ", "i\u0307stanbul"],
    ];
    for (const [aliasName, normalizedAlias] of cases) {
      const { data, error } = await mapAlias(admin, {
        p_alias_name: aliasName,
        p_normalized_alias: normalizedAlias,
      });
      expect(error).toBeNull();
      expect(data.normalized_alias).toBe(normalizedAlias);
    }
  });

  it("rejects aliases that normalize empty or disagree with the canonical key", async () => {
    const admin = createSupabaseAdminClient();
    const emptyResult = await mapAlias(admin, {
      p_alias_name: " \u00a0\u2003\ufeff ",
      p_normalized_alias: "",
    });
    expect(emptyResult.error?.code).toBe("22023");

    const mismatchName = `Mismatch ${randomUUID()}`;
    const mismatchResult = await mapAlias(admin, {
      p_alias_name: mismatchName,
      p_normalized_alias: "wrong key",
    });
    expect(mismatchResult.error?.code).toBe("22023");
    const { data: rows, error } = await admin
      .from("font_aliases")
      .select("id")
      .in("normalized_alias", ["", "wrong key"]);
    expect(error).toBeNull();
    expect(rows).toEqual([]);
  });

  it("seeds Super Boy only for an active same-workspace Super Boys font", async () => {
    const admin = createSupabaseAdminClient();
    const activeWorkspaceId = randomUUID();
    const archivedWorkspaceId = randomUUID();
    disposableWorkspaceIds.add(activeWorkspaceId);
    disposableWorkspaceIds.add(archivedWorkspaceId);
    expect((await admin.from("workspaces").insert([
      { id: activeWorkspaceId, name: `Active Super Boys ${randomUUID()}` },
      { id: archivedWorkspaceId, name: `Archived Super Boys ${randomUUID()}` },
    ])).error).toBeNull();
    const activeSuperBoys = activeFont({
      workspace_id: activeWorkspaceId,
      display_name: "Super Boys",
    });
    const archivedSuperBoys = activeFont({
      workspace_id: archivedWorkspaceId,
      display_name: "Super Boys",
      archived_at: new Date().toISOString(),
    });
    expect((await admin.from("fonts").insert([activeSuperBoys, archivedSuperBoys])).error).toBeNull();

    const { data: insertedCount, error: seedError } = await admin
      .rpc("seed_workspace_super_boy_font_aliases");
    expect(seedError).toBeNull();
    expect(insertedCount).toBe(1);
    const { data, error } = await admin
      .from("font_aliases")
      .select("workspace_id, font_id, alias_name, normalized_alias")
      .in("workspace_id", [activeWorkspaceId, archivedWorkspaceId])
      .eq("normalized_alias", "super boy")
      .order("workspace_id");
    expect(error).toBeNull();
    expect(data).toEqual([{
      workspace_id: activeWorkspaceId,
      font_id: activeSuperBoys.id,
      alias_name: "Super Boy",
      normalized_alias: "super boy",
    }]);
    expect((await admin.rpc("seed_workspace_super_boy_font_aliases")).data).toBe(0);
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

  it("holds the target font against archive updates until alias mapping commits", async () => {
    // Break caught: FOR KEY SHARE allows an archive update to commit while mapping still uses the font as active.
    const admin = createSupabaseAdminClient();
    const font = activeFont();
    expect((await admin.from("fonts").insert(font)).error).toBeNull();
    const aliasName = `Locked Target ${randomUUID()}`;
    const normalizedAlias = aliasName.toLowerCase();
    const databaseContainerId = await getLocalDatabaseContainerId();
    const suffix = randomUUID().replaceAll("-", "");
    const triggerName = `zz_test_hold_font_alias_${suffix}`;
    const functionName = `test_hold_font_alias_${suffix}`;
    const setupResult = executeDatabaseSql(databaseContainerId, `
create function public.${functionName}()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $hold$
begin
  perform pg_catalog.pg_sleep(3);
  return null;
end;
$hold$;

create trigger ${triggerName}
after insert on public.font_aliases
for each row
when (new.normalized_alias = ${quoteSqlLiteral(normalizedAlias)})
execute function public.${functionName}();
`);
    expect(setupResult.status, setupResult.stderr || setupResult.stdout).toBe(0);

    let mappingPromise;
    let archivePromise;
    try {
      mappingPromise = mapAlias(admin, {
        p_alias_name: aliasName,
        p_normalized_alias: normalizedAlias,
        p_font_id: font.id,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      waitForDatabaseSleep(databaseContainerId);

      const archivedAt = new Date().toISOString();
      archivePromise = createSupabaseAdminClient()
        .from("fonts")
        .update({ archived_at: archivedAt, deleted_at: archivedAt })
        .eq("id", font.id)
        .then((result) => result);
      await new Promise((resolve) => setTimeout(resolve, 100));
      waitForDatabaseLock(databaseContainerId);

      const [mapping, archive] = await Promise.all([mappingPromise, archivePromise]);
      expect(mapping.error).toBeNull();
      expect(archive.error).toBeNull();
      expect(mapping.data.font_id).toBe(font.id);
    } finally {
      await Promise.allSettled([mappingPromise, archivePromise].filter(Boolean));
      const cleanupResult = executeDatabaseSql(databaseContainerId, `
drop trigger if exists ${triggerName} on public.font_aliases;
drop function if exists public.${functionName}();
`);
      expect(cleanupResult.status, cleanupResult.stderr || cleanupResult.stdout).toBe(0);
    }
  }, 30_000);

  it("saves an alias without synthesizing a future design line", async () => {
    const admin = createSupabaseAdminClient();
    const fixture = await createDesignFixture(admin);
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
    expect((await admin
      .from("design_lines")
      .select("id")
      .eq("design_id", fixture.designId)
      .eq("line_index", 7)).data).toEqual([]);
  });

  it("requires a workspace member operator and attributes every affected row to that operator", async () => {
    const admin = createSupabaseAdminClient();
    const aliasName = `Attributed ${randomUUID()}`;
    const normalizedAlias = aliasName.toLowerCase();
    const unauthorized = await mapAlias(admin, {
      p_user_id: secondaryUserId,
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
    });
    expect(unauthorized.error?.code).toBe("42501");

    const nonOperator = await mapAlias(admin, {
      p_user_id: nonOperatorUserId,
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
    });
    expect(nonOperator.error?.code).toBe("42501");

    const fixture = await createDesignFixture(admin);
    const created = await mapAlias(admin, {
      p_user_id: memberUserId,
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
      p_font_id: "candlepin",
    });
    expect(created.error).toBeNull();
    expect(created.data).toMatchObject({
      created_by: memberUserId,
      updated_by: memberUserId,
    });

    const reassigned = await mapAlias(admin, {
      p_user_id: alternateMemberUserId,
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
      p_font_id: "skywalk",
      p_expected_alias_revision: 1,
      p_order_item_id: fixture.orderItemId,
      p_design_id: fixture.designId,
      p_line_index: 0,
      p_expected_order_revision: 1,
      p_expected_design_revision: 1,
    });
    expect(reassigned.error).toBeNull();
    expect(reassigned.data).toMatchObject({
      created_by: memberUserId,
      updated_by: alternateMemberUserId,
    });
    const [{ data: order }, { data: design }] = await Promise.all([
      admin.from("order_items").select("updated_by").eq("id", fixture.orderItemId).single(),
      admin.from("designs").select("updated_by").eq("id", fixture.designId).single(),
    ]);
    expect(order.updated_by).toBe(alternateMemberUserId);
    expect(design.updated_by).toBe(alternateMemberUserId);
  });

  it("rejects a selected design line that is not a text item", async () => {
    const admin = createSupabaseAdminClient();
    const fixture = await createDesignFixture(admin);
    expect((await admin
      .from("design_lines")
      .update({ item_kind: "fixed_svg" })
      .eq("design_id", fixture.designId)
      .eq("line_index", 0)).error).toBeNull();

    const aliasName = `Fixed ${randomUUID()}`;
    const normalizedAlias = aliasName.toLowerCase();
    const result = await mapAlias(admin, {
      p_alias_name: aliasName,
      p_normalized_alias: normalizedAlias,
      p_order_item_id: fixture.orderItemId,
      p_design_id: fixture.designId,
      p_line_index: 0,
      p_expected_order_revision: fixture.revision,
      p_expected_design_revision: fixture.revision,
    });

    expect(result.error?.code).toBe("22023");
    expect((await admin
      .from("font_aliases")
      .select("id")
      .eq("workspace_id", PRIMARY_WORKSPACE_ID)
      .eq("normalized_alias", normalizedAlias)).data).toEqual([]);
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

  it("atomically invalidates export-ready geometry when the selected line font changes", async () => {
    // Break caught: a mapped font changes while stale completed geometry remains exportable.
    const admin = createSupabaseAdminClient();
    const fixture = await createDesignFixture(admin);
    const cachedBuild = {
      signature: "completed-candlepin",
      layout: { lines: [{ fontId: "candlepin" }] },
      analysis: { connectedComponentCount: 1 },
    };
    expect((await admin.from("designs").update({
      production_status: "export_ready",
      cached_build_json: cachedBuild,
      previous_completed_build_json: { ...cachedBuild, signature: "previous-candlepin" },
      saved_settings_signature: "completed-candlepin",
      completed_settings_signature: "completed-candlepin",
      analysis_badge_json: { state: "ok", shortLabel: "1" },
      pending_analysis_signature: "completed-candlepin",
    }).eq("id", fixture.designId)).error).toBeNull();
    expect((await admin.from("design_analysis_cache").insert({
      design_id: fixture.designId,
      settings_signature: "completed-candlepin",
      layout_json: cachedBuild.layout,
      analysis_json: cachedBuild.analysis,
    })).error).toBeNull();

    const aliasName = `Invalidate ${randomUUID()}`;
    const { data, error } = await mapAlias(admin, {
      p_alias_name: aliasName,
      p_normalized_alias: aliasName.toLowerCase(),
      p_font_id: "skywalk",
      p_order_item_id: fixture.orderItemId,
      p_design_id: fixture.designId,
      p_line_index: 0,
      p_expected_order_revision: fixture.revision,
      p_expected_design_revision: fixture.revision,
    });

    expect(error).toBeNull();
    expect(data).toMatchObject({
      design_state_invalidated: true,
      production_status: "in_progress",
      order_revision: 2,
      design_revision: 2,
    });
    const [{ data: designs }, { data: cacheRows }, { data: lines }] = await Promise.all([
      admin.from("designs")
        .select("production_status, cached_build_json, previous_completed_build_json, saved_settings_signature, completed_settings_signature, analysis_badge_json, pending_analysis_signature")
        .eq("id", fixture.designId),
      admin.from("design_analysis_cache").select("design_id").eq("design_id", fixture.designId),
      admin.from("design_lines").select("font_id").eq("design_id", fixture.designId).eq("line_index", 0),
    ]);
    expect(designs).toEqual([{
      production_status: "in_progress",
      cached_build_json: null,
      previous_completed_build_json: null,
      saved_settings_signature: null,
      completed_settings_signature: null,
      analysis_badge_json: null,
      pending_analysis_signature: null,
    }]);
    expect(cacheRows).toEqual([]);
    expect(lines).toEqual([{ font_id: "skywalk" }]);
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
      p_expected_alias_revision: 1,
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

  it("rejects a concurrent alias-only replacement when both operators expected no mapping", async () => {
    // Break caught: a waiter silently replaces an alias created after its editor opened.
    const admin = createSupabaseAdminClient();
    const aliasName = `Alias Lock ${randomUUID()}`;
    const normalizedAlias = aliasName.toLowerCase();
    const databaseContainerId = await getLocalDatabaseContainerId();
    const suffix = randomUUID().replaceAll("-", "");
    const triggerName = `zz_test_hold_alias_advisory_${suffix}`;
    const functionName = `test_hold_alias_advisory_${suffix}`;
    const setupResult = executeDatabaseSql(databaseContainerId, `
create function public.${functionName}()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $hold$
begin
  perform pg_catalog.pg_sleep(3);
  return null;
end;
$hold$;

create trigger ${triggerName}
after insert on public.font_aliases
for each row
when (new.normalized_alias = ${quoteSqlLiteral(normalizedAlias)})
execute function public.${functionName}();
`);
    expect(setupResult.status, setupResult.stderr || setupResult.stdout).toBe(0);

    let firstPromise;
    let secondPromise;
    try {
      firstPromise = mapAlias(admin, {
        p_user_id: memberUserId,
        p_alias_name: aliasName,
        p_normalized_alias: normalizedAlias,
        p_font_id: "candlepin",
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      waitForDatabaseSleep(databaseContainerId);

      secondPromise = mapAlias(createSupabaseAdminClient(), {
        p_user_id: alternateMemberUserId,
        p_alias_name: aliasName,
        p_normalized_alias: normalizedAlias,
        p_font_id: "somekind",
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      waitForDatabaseAdvisoryLock(databaseContainerId);

      const [first, second] = await Promise.all([firstPromise, secondPromise]);
      expect(first.error).toBeNull();
      expect(second.error?.code).toBe("40001");
      expect(first.data).toMatchObject({
        previous_font_id: null,
        font_id: "candlepin",
        alias_revision: 1,
        created_by: memberUserId,
        updated_by: memberUserId,
      });
      const { data: saved, error: savedError } = await admin
        .from("font_aliases")
        .select("font_id, revision, created_by, updated_by")
        .eq("workspace_id", PRIMARY_WORKSPACE_ID)
        .eq("normalized_alias", normalizedAlias)
        .single();
      expect(savedError).toBeNull();
      expect(saved).toEqual({
        font_id: "candlepin",
        revision: 1,
        created_by: memberUserId,
        updated_by: memberUserId,
      });
    } finally {
      await Promise.allSettled([firstPromise, secondPromise].filter(Boolean));
      const cleanupResult = executeDatabaseSql(databaseContainerId, `
drop trigger if exists ${triggerName} on public.font_aliases;
drop function if exists public.${functionName}();
`);
      expect(cleanupResult.status, cleanupResult.stderr || cleanupResult.stdout).toBe(0);
    }
  }, 30_000);

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
      p_expected_alias_revision: 1,
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
        p_user_id: memberUserId,
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
