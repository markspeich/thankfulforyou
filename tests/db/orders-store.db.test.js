import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "../../api/_lib/supabase-admin.js";
import {
  addOrderGroupsToProductionBatch,
  importWorkspaceOrderItems,
  listWorkspaceOrderSummaries,
  listWorkspaceOrders,
  updateOrderGroupStatus,
} from "../../api/_lib/orders-store.js";
import { loadEnvFile } from "../../tools/env_file.mjs";
import { spawnCommand } from "../../tools/supabase_env.mjs";
import { generateSupabaseWorktreeConfig } from "../../tools/supabase_worktree_config.mjs";

const PRIMARY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const PRIMARY_BATCH_ID = "22222222-2222-4222-8222-222222222222";
const disposableWorkspaceIds = new Set();
const disposableAuthUserIds = new Set();

async function createDisposableWorkspace(name) {
  const workspaceId = randomUUID();
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("workspaces").insert({ id: workspaceId, name });
  expect(error).toBeNull();
  disposableWorkspaceIds.add(workspaceId);
  return workspaceId;
}

async function createTestBatch(
  name = "Orders Store DB Test Batch",
  workspaceId = PRIMARY_WORKSPACE_ID,
) {
  const batchId = randomUUID();
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("production_batches")
    .insert({
      id: batchId,
      workspace_id: workspaceId,
      name,
      status: "active",
    });

  expect(error).toBeNull();
  return batchId;
}

function quoteSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteNullableSqlLiteral(value) {
  return value == null ? "null" : quoteSqlLiteral(value);
}

async function explainInlinedOrdersSummaryFunction({
  workspaceId,
  cursorSortKey,
  cursorGroupId,
  limit = 5,
}) {
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

  const sql = String.raw`
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
select replace(
  replace(
    pg_get_functiondef(
      'public.list_workspace_order_summaries(uuid,uuid,text,text,text,integer,text,text)'::regprocedure
    ),
    'CREATE OR REPLACE FUNCTION public.list_workspace_order_summaries',
    'CREATE OR REPLACE FUNCTION pg_temp.list_workspace_order_summaries'
  ),
  E'\n SET search_path TO ''''\n',
  E'\n'
)
\gexec
analyze public.order_items;
analyze public.designs;
explain (analyze, buffers, format json)
select *
from pg_temp.list_workspace_order_summaries(
  p_workspace_id => ${quoteSqlLiteral(workspaceId)}::uuid,
  p_status_filter => 'all',
  p_batch_filter => 'all',
  p_search_term => '',
  p_requested_limit => ${limit},
  p_cursor_sort_key => ${quoteNullableSqlLiteral(cursorSortKey)},
  p_cursor_group_id => ${quoteNullableSqlLiteral(cursorGroupId)}
);
`;
  const explainResult = spawnCommand("docker", [
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
  expect(
    explainResult.status,
    explainResult.stderr || explainResult.stdout,
  ).toBe(0);

  return JSON.parse(explainResult.stdout.trim());
}

function flattenPlanNodes(node) {
  return [node, ...(node.Plans || []).flatMap(flattenPlanNodes)];
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

function waitForDatabaseSleep(databaseContainerId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = executeDatabaseSql(databaseContainerId, String.raw`
\pset tuples_only on
\pset format unaligned
select exists (
  select 1
  from pg_catalog.pg_stat_activity
  where wait_event = 'PgSleep'
    and state = 'active'
);
`);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    if (result.stdout.trim() === "t") return;
  }
  throw new Error("Timed out waiting for the projection race transaction to sleep.");
}

async function assertLegacyArchivedOrderExcluded(row) {
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

  const assertionResult = spawnCommand("docker", [
    "exec",
    databaseContainerId,
    "psql",
    "-v", "ON_ERROR_STOP=1",
    "-U", "postgres",
    "-d", "postgres",
    "-c",
    `begin;
alter table public.order_items drop constraint order_items_status_check;
insert into public.order_items (
  id, workspace_id, status, order_number, buyer_name, listing_id, transaction_id, quantity, source_json
) values (
  ${quoteSqlLiteral(row.id)},
  ${quoteSqlLiteral(row.workspaceId)}::uuid,
  'archived',
  ${quoteSqlLiteral(row.orderNumber)},
  ${quoteSqlLiteral(row.buyerName)},
  'legacy',
  ${quoteSqlLiteral(row.transactionId)},
  1,
  '{}'::jsonb
);
do $test$
begin
  if exists (
    select 1
    from public.list_workspace_order_summaries(
      p_workspace_id => ${quoteSqlLiteral(row.workspaceId)}::uuid,
      p_status_filter => 'open',
      p_search_term => ${quoteSqlLiteral(row.buyerName)}
    )
    where group_id = ${quoteSqlLiteral(`order:${row.orderNumber}`)}
  ) then
    raise exception 'legacy archived order was returned by the open filter';
  end if;
end
$test$;
rollback;
`,
  ], { encoding: "utf8" });
  expect(
    assertionResult.status,
    assertionResult.stderr || assertionResult.stdout,
  ).toBe(0);
}

beforeAll(() => {
  loadEnvFile();

  const supabaseUrl = process.env.SUPABASE_URL || "";
  const allowRemote = process.env.TFY_ALLOW_REMOTE_DB_TESTS === "1";
  if (!allowRemote && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(supabaseUrl)) {
    throw new Error(
      `Refusing to run DB tests against non-local SUPABASE_URL: ${supabaseUrl || "<missing>"}.`,
    );
  }
});

afterEach(async () => {
  const supabase = createSupabaseAdminClient();
  const cleanupErrors = [];
  for (const userId of disposableAuthUserIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) cleanupErrors.push(error.message);
  }
  disposableAuthUserIds.clear();

  for (const workspaceId of disposableWorkspaceIds) {
    const { error } = await supabase.from("workspaces").delete().eq("id", workspaceId);
    if (error) cleanupErrors.push(error.message);
  }
  disposableWorkspaceIds.clear();
  expect(cleanupErrors).toEqual([]);
});

describe("orders store database integration", () => {
  it("transactionally maintains compact workspace order-group summaries", async () => {
    // Break caught: source mutations leave the compact group projection stale or leak another workspace.
    const suffix = randomUUID().slice(0, 8);
    const workspaceId = await createDisposableWorkspace(`Projection ${suffix}`);
    const otherWorkspaceId = await createDisposableWorkspace(`Projection Other ${suffix}`);
    const orderNumber = `PROJECTION-${suffix}`;
    const groupId = `order:${orderNumber}`;
    const firstItemId = `projection-${suffix}-first`;
    const secondItemId = `projection-${suffix}-second`;
    const supabase = createSupabaseAdminClient();
    const firstBatchId = await createTestBatch(`Projection Batch A ${suffix}`, workspaceId);
    const secondBatchId = await createTestBatch(`Projection Batch B ${suffix}`, workspaceId);

    const { error: insertError } = await supabase.from("order_items").insert([
      {
        id: firstItemId,
        workspace_id: workspaceId,
        status: "open",
        order_number: orderNumber,
        buyer_name: `Projection Buyer ${suffix}`,
        transaction_id: `projection-${suffix}-first`,
        quantity: 1,
        source_json: { rawCustomization: { diagnostic: "must-not-leak" } },
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: secondItemId,
        workspace_id: workspaceId,
        status: "open",
        order_number: orderNumber,
        buyer_name: `Projection Buyer ${suffix}`,
        transaction_id: `projection-${suffix}-second`,
        quantity: 1,
        source_json: {},
        created_at: "2026-02-01T00:00:00.000Z",
      },
      {
        id: `projection-${suffix}-other`,
        workspace_id: otherWorkspaceId,
        status: "complete",
        order_number: orderNumber,
        buyer_name: `Other Projection Buyer ${suffix}`,
        transaction_id: `projection-${suffix}-other`,
        quantity: 1,
        source_json: {},
        created_at: "2027-01-01T00:00:00.000Z",
      },
    ]);
    expect(insertError).toBeNull();

    const readSummary = async () => supabase
      .from("order_group_summaries")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("group_id", groupId)
      .maybeSingle();

    const { data: initialSummary, error: initialError } = await readSummary();
    expect(initialError).toBeNull();
    expect(initialSummary).toMatchObject({
      workspace_id: workspaceId,
      group_id: groupId,
      order_number: orderNumber,
      buyer_name: `Projection Buyer ${suffix}`,
      group_status: "open",
    });
    expect(initialSummary).not.toHaveProperty("is_in_active_batch");
    expect(JSON.stringify(initialSummary)).not.toContain("must-not-leak");
    expect(initialSummary).not.toHaveProperty("source_json");
    expect(initialSummary).not.toHaveProperty("design_lines");
    expect(initialSummary).not.toHaveProperty("cached_build_json");
    const initialSortKey = initialSummary.sort_key;

    const readVisibility = async (batchId) => supabase
      .from("order_group_batch_visibility")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("batch_id", batchId)
      .eq("group_id", groupId)
      .maybeSingle();

    expect((await readVisibility(firstBatchId)).data).toMatchObject({
      workspace_id: workspaceId,
      batch_id: firstBatchId,
      group_id: groupId,
      group_status: "open",
      is_in_batch: false,
      sort_key: initialSortKey,
    });
    expect((await readVisibility(secondBatchId)).data).toMatchObject({
      workspace_id: workspaceId,
      batch_id: secondBatchId,
      group_id: groupId,
      group_status: "open",
      is_in_batch: false,
      sort_key: initialSortKey,
    });

    const { data: isolatedSummary, error: isolatedError } = await supabase
      .from("order_group_summaries")
      .select("workspace_id, group_status, buyer_name")
      .eq("workspace_id", otherWorkspaceId)
      .eq("group_id", groupId)
      .single();
    expect(isolatedError).toBeNull();
    expect(isolatedSummary).toEqual({
      workspace_id: otherWorkspaceId,
      group_status: "complete",
      buyer_name: `Other Projection Buyer ${suffix}`,
    });

    const { error: firstCompleteError } = await supabase
      .from("order_items")
      .update({ status: "complete" })
      .eq("workspace_id", workspaceId)
      .eq("id", firstItemId);
    expect(firstCompleteError).toBeNull();
    expect((await readSummary()).data?.group_status).toBe("open");

    const { error: secondCompleteError } = await supabase
      .from("order_items")
      .update({ status: "complete" })
      .eq("workspace_id", workspaceId)
      .eq("id", secondItemId);
    expect(secondCompleteError).toBeNull();
    expect((await readSummary()).data?.group_status).toBe("complete");
    expect((await readVisibility(firstBatchId)).data?.group_status).toBe("complete");
    expect((await readVisibility(secondBatchId)).data?.group_status).toBe("complete");

    const { data: firstMembership, error: firstMembershipError } = await supabase
      .from("batch_items")
      .insert({
        workspace_id: workspaceId,
        batch_id: firstBatchId,
        order_item_id: firstItemId,
        batch_position: 0,
        status: "active",
      })
      .select("id")
      .single();
    expect(firstMembershipError).toBeNull();
    expect((await readVisibility(firstBatchId)).data?.is_in_batch).toBe(true);
    expect((await readVisibility(secondBatchId)).data?.is_in_batch).toBe(false);

    const { data: secondMembership, error: secondMembershipError } = await supabase
      .from("batch_items")
      .insert({
        workspace_id: workspaceId,
        batch_id: secondBatchId,
        order_item_id: secondItemId,
        batch_position: 0,
        status: "active",
      })
      .select("id")
      .single();
    expect(secondMembershipError).toBeNull();
    expect((await readVisibility(firstBatchId)).data?.is_in_batch).toBe(true);
    expect((await readVisibility(secondBatchId)).data?.is_in_batch).toBe(true);

    const { error: archivedError } = await supabase
      .from("batch_items")
      .update({ status: "archived" })
      .eq("id", firstMembership.id);
    expect(archivedError).toBeNull();
    expect((await readVisibility(firstBatchId)).data?.is_in_batch).toBe(false);
    expect((await readVisibility(secondBatchId)).data?.is_in_batch).toBe(true);

    const { error: reactivatedError } = await supabase
      .from("batch_items")
      .update({ status: "active" })
      .eq("id", firstMembership.id);
    expect(reactivatedError).toBeNull();
    expect((await readVisibility(firstBatchId)).data?.is_in_batch).toBe(true);
    expect((await readVisibility(secondBatchId)).data?.is_in_batch).toBe(true);

    const { error: membershipDeleteError } = await supabase
      .from("batch_items")
      .delete()
      .eq("id", firstMembership.id);
    expect(membershipDeleteError).toBeNull();
    expect((await readVisibility(firstBatchId)).data?.is_in_batch).toBe(false);
    expect((await readVisibility(secondBatchId)).data?.is_in_batch).toBe(true);

    const { error: secondMembershipDeleteError } = await supabase
      .from("batch_items")
      .delete()
      .eq("id", secondMembership.id);
    expect(secondMembershipDeleteError).toBeNull();
    expect((await readVisibility(firstBatchId)).data?.is_in_batch).toBe(false);
    expect((await readVisibility(secondBatchId)).data?.is_in_batch).toBe(false);

    const { error: reorderError } = await supabase
      .from("order_items")
      .update({ created_at: "2028-01-01T00:00:00.000Z" })
      .eq("workspace_id", workspaceId)
      .eq("id", firstItemId);
    expect(reorderError).toBeNull();
    const reorderedSortKey = (await readSummary()).data?.sort_key;
    expect(reorderedSortKey).not.toBe(initialSortKey);
    expect((await readVisibility(firstBatchId)).data?.sort_key).toBe(reorderedSortKey);
    expect((await readVisibility(secondBatchId)).data?.sort_key).toBe(reorderedSortKey);

    const { error: firstDeleteError } = await supabase
      .from("order_items")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", firstItemId);
    expect(firstDeleteError).toBeNull();
    expect((await readSummary()).data).not.toBeNull();

    const { error: finalDeleteError } = await supabase
      .from("order_items")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", secondItemId);
    expect(finalDeleteError).toBeNull();
    expect((await readSummary()).data).toBeNull();
    expect((await readVisibility(firstBatchId)).data).toBeNull();
    expect((await readVisibility(secondBatchId)).data).toBeNull();
  }, 30_000);

  it("serializes concurrent member refreshes before publishing group aggregates", async () => {
    // Break caught: a blocked upsert publishes an aggregate computed before a concurrent member commits.
    const suffix = randomUUID().slice(0, 8);
    const workspaceId = await createDisposableWorkspace(`Projection Race ${suffix}`);
    const batchId = await createTestBatch(`Projection Race Batch ${suffix}`, workspaceId);
    const orderNumber = `PROJECTION-RACE-${suffix}`;
    const groupId = `order:${orderNumber}`;
    const firstItemId = `projection-race-${suffix}-first`;
    const secondItemId = `projection-race-${suffix}-second`;
    const supabase = createSupabaseAdminClient();
    const { error: insertError } = await supabase.from("order_items").insert([
      {
        id: firstItemId,
        workspace_id: workspaceId,
        status: "open",
        order_number: orderNumber,
        buyer_name: `Projection Race ${suffix}`,
        transaction_id: `projection-race-${suffix}-first`,
        quantity: 1,
        source_json: {},
      },
      {
        id: secondItemId,
        workspace_id: workspaceId,
        status: "open",
        order_number: orderNumber,
        buyer_name: `Projection Race ${suffix}`,
        transaction_id: `projection-race-${suffix}-second`,
        quantity: 1,
        source_json: {},
      },
    ]);
    expect(insertError).toBeNull();

    const databaseContainerId = await getLocalDatabaseContainerId();
    const holdTriggerName = "zz_test_hold_order_group_projection_refresh";
    const holdFunctionName = "test_hold_order_group_projection_refresh";
    const setupResult = executeDatabaseSql(databaseContainerId, `
create or replace function public.${holdFunctionName}()
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

create trigger ${holdTriggerName}
after update of status on public.order_items
for each row
when (new.id = ${quoteSqlLiteral(firstItemId)})
execute function public.${holdFunctionName}();
`);
    expect(setupResult.status, setupResult.stderr || setupResult.stdout).toBe(0);

    try {
      const firstUpdatePromise = createSupabaseAdminClient()
        .from("order_items")
        .update({ status: "complete" })
        .eq("workspace_id", workspaceId)
        .eq("id", firstItemId)
        .then((result) => result);

      await new Promise((resolve) => setTimeout(resolve, 200));
      waitForDatabaseSleep(databaseContainerId);

      const secondUpdatePromise = createSupabaseAdminClient()
        .from("order_items")
        .update({ status: "complete" })
        .eq("workspace_id", workspaceId)
        .eq("id", secondItemId)
        .then((result) => result);

      const [firstUpdate, secondUpdate] = await Promise.all([
        firstUpdatePromise,
        secondUpdatePromise,
      ]);
      expect(firstUpdate.error).toBeNull();
      expect(secondUpdate.error).toBeNull();

      const [{ data: sourceItems, error: sourceError }, { data: summary, error: summaryError }, { data: visibility, error: visibilityError }] = await Promise.all([
        supabase
          .from("order_items")
          .select("id, status")
          .eq("workspace_id", workspaceId)
          .eq("order_number", orderNumber)
          .order("id"),
        supabase
          .from("order_group_summaries")
          .select("group_status")
          .eq("workspace_id", workspaceId)
          .eq("group_id", groupId)
          .single(),
        supabase
          .from("order_group_batch_visibility")
          .select("group_status")
          .eq("workspace_id", workspaceId)
          .eq("batch_id", batchId)
          .eq("group_id", groupId)
          .single(),
      ]);
      expect(sourceError).toBeNull();
      expect(sourceItems.map((item) => item.status)).toEqual(["complete", "complete"]);
      expect(summaryError).toBeNull();
      expect(summary?.group_status).toBe("complete");
      expect(visibilityError).toBeNull();
      expect(visibility?.group_status).toBe("complete");
    } finally {
      const cleanupResult = executeDatabaseSql(databaseContainerId, `
drop trigger if exists ${holdTriggerName} on public.order_items;
drop function if exists public.${holdFunctionName}();
`);
      expect(cleanupResult.status, cleanupResult.stderr || cleanupResult.stdout).toBe(0);
    }
  }, 30_000);

  it("reconciles visibility after concurrent first group and batch creation", async () => {
    // Break caught: concurrent creators each miss the other's uncommitted row and publish no pair.
    const suffix = randomUUID().slice(0, 8);
    const workspaceId = await createDisposableWorkspace(`Projection Creation Race ${suffix}`);
    const orderNumber = `PROJECTION-CREATION-${suffix}`;
    const groupId = `order:${orderNumber}`;
    const orderItemId = `projection-creation-${suffix}`;
    const batchId = randomUUID();
    const databaseContainerId = await getLocalDatabaseContainerId();
    const holdTriggerName = "zz_test_hold_order_group_projection_creation";
    const holdFunctionName = "test_hold_order_group_projection_creation";
    const setupResult = executeDatabaseSql(databaseContainerId, `
create or replace function public.${holdFunctionName}()
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

create trigger ${holdTriggerName}
after insert on public.order_items
for each row
when (new.id = ${quoteSqlLiteral(orderItemId)})
execute function public.${holdFunctionName}();
`);
    expect(setupResult.status, setupResult.stderr || setupResult.stdout).toBe(0);

    try {
      const orderInsertPromise = createSupabaseAdminClient()
        .from("order_items")
        .insert({
          id: orderItemId,
          workspace_id: workspaceId,
          status: "open",
          order_number: orderNumber,
          buyer_name: `Projection Creation ${suffix}`,
          transaction_id: `projection-creation-${suffix}`,
          quantity: 1,
          source_json: {},
        })
        .then((result) => result);

      await new Promise((resolve) => setTimeout(resolve, 200));
      waitForDatabaseSleep(databaseContainerId);

      const batchInsertPromise = createSupabaseAdminClient()
        .from("production_batches")
        .insert({
          id: batchId,
          workspace_id: workspaceId,
          name: `Projection Creation Batch ${suffix}`,
          status: "active",
        })
        .then((result) => result);

      const [orderInsert, batchInsert] = await Promise.all([
        orderInsertPromise,
        batchInsertPromise,
      ]);
      expect(orderInsert.error).toBeNull();
      expect(batchInsert.error).toBeNull();

      const { data: visibility, error: visibilityError } = await createSupabaseAdminClient()
        .from("order_group_batch_visibility")
        .select("workspace_id, batch_id, group_id, is_in_batch")
        .eq("workspace_id", workspaceId)
        .eq("batch_id", batchId)
        .eq("group_id", groupId)
        .maybeSingle();
      expect(visibilityError).toBeNull();
      expect(visibility).toEqual({
        workspace_id: workspaceId,
        batch_id: batchId,
        group_id: groupId,
        is_in_batch: false,
      });
    } finally {
      const cleanupResult = executeDatabaseSql(databaseContainerId, `
drop trigger if exists ${holdTriggerName} on public.order_items;
drop function if exists public.${holdFunctionName}();
`);
      expect(cleanupResult.status, cleanupResult.stderr || cleanupResult.stdout).toBe(0);
    }
  }, 30_000);

  it("keeps empty-search discovery and group hydration index-bounded after a deep cursor", async () => {
    // Break caught: empty Orders pages scan every historical item before applying the cursor and limit.
    const suffix = randomUUID().slice(0, 8);
    const testWorkspaceId = await createDisposableWorkspace(`Bounded Empty Search ${suffix}`);
    const supabase = createSupabaseAdminClient();
    const groupCount = 2400;
    const rows = Array.from({ length: groupCount }, (_, offset) => {
      const sequence = offset + 1;
      return {
        id: `bounded-${suffix}-${sequence}`,
        workspace_id: testWorkspaceId,
        status: sequence === 599 ? "complete" : sequence === 597 ? "skipped" : "open",
        order_number: String(9_000_000_000 + sequence),
        buyer_name: `Bounded Buyer ${sequence}`,
        listing_id: `bounded-listing-${sequence}`,
        transaction_id: `bounded-transaction-${sequence}`,
        quantity: 1,
        source_json: {},
        created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, sequence)).toISOString(),
      };
    });
    const completeGroupNumber = String(9_000_000_000 + 599);
    rows.push({
      ...rows[598],
      id: `bounded-${suffix}-599-sibling`,
      transaction_id: `bounded-transaction-599-sibling`,
      created_at: new Date(Date.UTC(2024, 11, 1)).toISOString(),
    });

    for (let offset = 0; offset < rows.length; offset += 250) {
      const { error } = await supabase.from("order_items").insert(rows.slice(offset, offset + 250));
      expect(error).toBeNull();
    }
    const designs = rows.map((row) => ({
      workspace_id: testWorkspaceId,
      order_item_id: row.id,
      design_text: `Bounded design ${row.id}`,
    }));
    for (let offset = 0; offset < designs.length; offset += 250) {
      const { error } = await supabase.from("designs").insert(designs.slice(offset, offset + 250));
      expect(error).toBeNull();
    }
    const filterBatchId = await createTestBatch(`Bounded Filter ${suffix}`, testWorkspaceId);
    const { error: membershipError } = await supabase.from("batch_items").insert({
      workspace_id: testWorkspaceId,
      batch_id: filterBatchId,
      order_item_id: `bounded-${suffix}-599`,
      batch_position: 0,
      status: "active",
    });
    expect(membershipError).toBeNull();

    const cursorSequence = 600;
    const cursorOrderNumber = String(9_000_000_000 + cursorSequence);
    const cursorSortKey = "20250101001000000000"
      + ":3:"
      + cursorOrderNumber.padStart(64, "0");
    const cursorGroupId = `order:${cursorOrderNumber}`;
    const page = await listWorkspaceOrderSummaries({
      workspaceId: testWorkspaceId,
      statusFilter: "all",
      searchTerm: "",
      limit: 5,
      cursor: {
        version: 1,
        sortKey: cursorSortKey,
        groupId: cursorGroupId,
      },
    });

    expect(page.orders.map((order) => order.id)).toEqual([
      `order:${completeGroupNumber}`,
      "order:9000000598",
      "order:9000000597",
      "order:9000000596",
      "order:9000000595",
    ]);
    expect(page.orders[0].items).toHaveLength(2);
    expect(page.hasMore).toBe(true);

    const firstPage = await listWorkspaceOrderSummaries({
      workspaceId: testWorkspaceId,
      statusFilter: "all",
      searchTerm: "",
      limit: 5,
    });
    expect(firstPage.orders.map((order) => order.id)).toEqual([
      "order:9000002400",
      "order:9000002399",
      "order:9000002398",
      "order:9000002397",
      "order:9000002396",
    ]);

    const [completePage, skippedPage, inBatchPage, notInBatchPage] = await Promise.all([
      listWorkspaceOrderSummaries({
        workspaceId: testWorkspaceId,
        statusFilter: "complete",
        searchTerm: "",
        limit: 1,
        cursor: { version: 1, sortKey: cursorSortKey, groupId: cursorGroupId },
      }),
      listWorkspaceOrderSummaries({
        workspaceId: testWorkspaceId,
        statusFilter: "skipped",
        searchTerm: "",
        limit: 1,
        cursor: { version: 1, sortKey: cursorSortKey, groupId: cursorGroupId },
      }),
      listWorkspaceOrderSummaries({
        workspaceId: testWorkspaceId,
        activeBatchId: filterBatchId,
        statusFilter: "all",
        batchFilter: "inBatch",
        searchTerm: "",
        limit: 1,
        cursor: { version: 1, sortKey: cursorSortKey, groupId: cursorGroupId },
      }),
      listWorkspaceOrderSummaries({
        workspaceId: testWorkspaceId,
        activeBatchId: filterBatchId,
        statusFilter: "all",
        batchFilter: "notInBatch",
        searchTerm: "",
        limit: 1,
        cursor: { version: 1, sortKey: cursorSortKey, groupId: cursorGroupId },
      }),
    ]);
    expect(completePage.orders[0]).toMatchObject({
      id: `order:${completeGroupNumber}`,
      status: "complete",
    });
    expect(completePage.orders[0].items).toHaveLength(2);
    expect(skippedPage.orders[0]).toMatchObject({ id: "order:9000000597", status: "skipped" });
    expect(inBatchPage.orders[0].id).toBe(`order:${completeGroupNumber}`);
    expect(inBatchPage.orders[0].isInActiveBatch).toBe(true);
    expect(inBatchPage.orders[0].items).toHaveLength(2);
    expect(notInBatchPage.orders[0].id).toBe("order:9000000598");

    const firstPagePlan = await explainInlinedOrdersSummaryFunction({
      workspaceId: testWorkspaceId,
      cursorSortKey: null,
      cursorGroupId: null,
      limit: 5,
    });
    const deepCursorPlan = await explainInlinedOrdersSummaryFunction({
      workspaceId: testWorkspaceId,
      cursorSortKey,
      cursorGroupId,
      limit: 5,
    });
    for (const explained of [firstPagePlan, deepCursorPlan]) {
      const planNodes = flattenPlanNodes(explained[0].Plan);
      const orderItemScans = planNodes.filter((node) => node["Relation Name"] === "order_items");
      const orderItemIndexNames = new Set(orderItemScans.map((node) => node["Index Name"]).filter(Boolean));

      expect(orderItemIndexNames).toContain("order_items_workspace_newest_group_idx");
      expect(orderItemIndexNames).toContain("order_items_workspace_group_members_idx");
      expect(
        orderItemScans.some(
          (node) => node["Node Type"] === "Seq Scan" && node["Actual Loops"] > 0,
        ),
        JSON.stringify(orderItemScans, null, 2),
      ).toBe(false);
      const newestScan = orderItemScans.find(
        (node) => node["Index Name"] === "order_items_workspace_newest_group_idx",
      );
      expect(newestScan).toBeDefined();
      expect(
        (newestScan["Actual Rows"] + (newestScan["Rows Removed by Filter"] || 0))
        * newestScan["Actual Loops"],
        JSON.stringify(newestScan, null, 2),
      ).toBe(6);
    }
  }, 60_000);

  it("searches and paginates more than one thousand complete order groups without splitting a group", async () => {
    // Break caught: compact Orders search reads only a browser-sized subset or paginates item rows.
    const suffix = randomUUID().slice(0, 8);
    const testWorkspaceId = await createDisposableWorkspace(`Scale Search ${suffix}`);
    const boundaryOrderNumber = `99${String(Date.now()).slice(-8)}`;
    const traversalToken = `Traverse${suffix}`;
    const supabase = createSupabaseAdminClient();
    const bulkRows = Array.from({ length: 1005 }, (_, index) => ({
      id: `scale-${suffix}-${index}`,
      workspace_id: testWorkspaceId,
      status: ["open", "complete", "skipped"][index % 3],
      order_number: index === 0
        ? `MANUAL-${suffix}`
        : index === 1
          ? null
          : `8${String(index).padStart(9, "0")}`,
      buyer_name: `${traversalToken} Buyer ${index}`,
      listing_id: `scale-listing-${index}`,
      transaction_id: `scale-transaction-${index}`,
      imported_color: index % 2 ? "Pink" : "Teal",
      quantity: 1,
      source_json: {},
      created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
    }));
    const specialRows = [
      {
        id: `scale-${suffix}-boundary-a`, workspace_id: testWorkspaceId, status: "open",
        order_number: boundaryOrderNumber, buyer_name: "Boundary Buyer", listing_id: "boundary-a",
        transaction_id: `boundary-a-${suffix}`, imported_color: "White", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-boundary-b`, workspace_id: testWorkspaceId, status: "open",
        order_number: boundaryOrderNumber, buyer_name: "Boundary Buyer", listing_id: "boundary-b",
        transaction_id: `boundary-b-${suffix}`, imported_color: "Black", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-boundary-next`, workspace_id: testWorkspaceId, status: "open",
        order_number: `98${String(Date.now()).slice(-8)}`, buyer_name: "Boundary Buyer", listing_id: "boundary-next",
        transaction_id: `boundary-next-${suffix}`, imported_color: "Gray", quantity: 1, source_json: {},
        created_at: "2025-12-01T00:00:00.000Z",
      },
      {
        id: `scale-${suffix}-old-complete`, workspace_id: testWorkspaceId, status: "complete",
        order_number: "4118855809", buyer_name: "Historical Buyer", listing_id: "historical-listing",
        transaction_id: `historical-${suffix}`, imported_color: "Navy", quantity: 1, source_json: {},
        created_at: "2020-01-01T00:00:00.000Z",
      },
      {
        id: `scale-${suffix}-buyer`, workspace_id: testWorkspaceId, status: "open",
        order_number: `BUYER-${suffix}`, buyer_name: "Only NeedleBuyer Match", listing_id: "plain-listing",
        transaction_id: `plain-buyer-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-listing-id`, workspace_id: testWorkspaceId, status: "open",
        order_number: `LISTING-ID-${suffix}`, buyer_name: "Plain", listing_id: "Only-NeedleListingId-Match",
        transaction_id: `plain-listing-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-listing-title`, workspace_id: testWorkspaceId, status: "open",
        order_number: `LISTING-TITLE-${suffix}`, buyer_name: "Plain", listing_id: "plain",
        transaction_id: `plain-title-${suffix}`, imported_color: "Plain", quantity: 1,
        source_json: { marketplace: "amazon", listingTitle: "Only NeedleListingTitle Match", rawCustomization: { diagnostic: "must-not-leak" } },
      },
      {
        id: `scale-${suffix}-transaction`, workspace_id: testWorkspaceId, status: "open",
        order_number: `TRANSACTION-${suffix}`, buyer_name: "Plain", listing_id: "plain",
        transaction_id: "Only-NeedleTransaction-Match", imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-color`, workspace_id: testWorkspaceId, status: "open",
        order_number: `COLOR-${suffix}`, buyer_name: "Plain", listing_id: "plain",
        transaction_id: `plain-color-${suffix}`, imported_color: "Only NeedleColor Match", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-design`, workspace_id: testWorkspaceId, status: "open",
        order_number: `DESIGN-${suffix}`, buyer_name: "Plain", listing_id: "plain",
        transaction_id: `plain-design-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-line`, workspace_id: testWorkspaceId, status: "open",
        order_number: `LINE-${suffix}`, buyer_name: "Plain", listing_id: "plain",
        transaction_id: `plain-line-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-order-numeric`, workspace_id: testWorkspaceId, status: "open",
        order_number: `77${String(Date.now()).slice(-8)}`, buyer_name: `Ordering-${suffix}`,
        listing_id: "plain", transaction_id: `ordering-numeric-${suffix}`, imported_color: "Plain",
        quantity: 1, source_json: {}, created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: `scale-${suffix}-order-nonnumeric`, workspace_id: testWorkspaceId, status: "open",
        order_number: `CUSTOM-${suffix}`, buyer_name: `Ordering-${suffix}`,
        listing_id: "plain", transaction_id: `ordering-nonnumeric-${suffix}`, imported_color: "Plain",
        quantity: 1, source_json: {}, created_at: "2026-02-01T00:00:00.000Z",
      },
      {
        id: `scale-${suffix}-order-null`, workspace_id: testWorkspaceId, status: "open",
        order_number: null, buyer_name: `Ordering-${suffix}`,
        listing_id: "plain", transaction_id: `ordering-null-${suffix}`, imported_color: "Plain",
        quantity: 1, source_json: {}, created_at: "2026-03-01T00:00:00.000Z",
      },
      {
        id: `scale-${suffix}-mixed-complete`, workspace_id: testWorkspaceId, status: "complete",
        order_number: `MIXED-${suffix}`, buyer_name: "Mixed Group", listing_id: "plain",
        transaction_id: `mixed-complete-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-mixed-open`, workspace_id: testWorkspaceId, status: "open",
        order_number: `MIXED-${suffix}`, buyer_name: "Mixed Group", listing_id: "plain",
        transaction_id: `mixed-open-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-skipped-a`, workspace_id: testWorkspaceId, status: "skipped",
        order_number: `SKIPPED-${suffix}`, buyer_name: "Skipped Group", listing_id: "plain",
        transaction_id: `skipped-a-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
      {
        id: `scale-${suffix}-skipped-b`, workspace_id: testWorkspaceId, status: "skipped",
        order_number: `SKIPPED-${suffix}`, buyer_name: "Skipped Group", listing_id: "plain",
        transaction_id: `skipped-b-${suffix}`, imported_color: "Plain", quantity: 1, source_json: {},
      },
    ].map((row, index) => ({
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      ...row,
    }));

    for (let index = 0; index < bulkRows.length; index += 250) {
      const { error } = await supabase.from("order_items").insert(bulkRows.slice(index, index + 250));
      expect(error).toBeNull();
    }
    const { error: specialError } = await supabase.from("order_items").insert(specialRows);
    expect(specialError).toBeNull();
    const isolatedWorkspaceId = await createDisposableWorkspace(`Isolated ${suffix}`);
    const { error: isolatedOrderError } = await supabase.from("order_items").insert({
      id: `scale-${suffix}-other-workspace`,
      workspace_id: isolatedWorkspaceId,
      status: "open",
      order_number: `OTHER-${suffix}`,
      buyer_name: `Ordering-${suffix}`,
      quantity: 1,
      source_json: {},
    });
    expect(isolatedOrderError).toBeNull();
    const filterBatchId = await createTestBatch(`Scale Filter ${suffix}`, testWorkspaceId);
    const { error: membershipError } = await supabase.from("batch_items").insert({
      workspace_id: testWorkspaceId,
      batch_id: filterBatchId,
      order_item_id: `scale-${suffix}-boundary-a`,
      batch_position: 0,
      status: "active",
    });
    expect(membershipError).toBeNull();

    const designId = randomUUID();
    const lineDesignId = randomUUID();
    const { error: designsError } = await supabase.from("designs").insert([
      { id: designId, workspace_id: testWorkspaceId, order_item_id: `scale-${suffix}-design`, design_text: "Only NeedleDesign Match" },
      { id: lineDesignId, workspace_id: testWorkspaceId, order_item_id: `scale-${suffix}-line`, design_text: "Plain design" },
    ]);
    expect(designsError).toBeNull();
    const { error: lineError } = await supabase.from("design_lines").insert({
      workspace_id: testWorkspaceId,
      design_id: lineDesignId,
      line_index: 0,
      text: "Only NeedleLine Match",
      font_id: "skywalk",
    });
    expect(lineError).toBeNull();

    const page = await listWorkspaceOrderSummaries({
      workspaceId: testWorkspaceId,
      statusFilter: "open",
      limit: 50,
    });
    expect(page.orders).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(new Set(page.orders.map((order) => order.id)).size).toBe(50);
    expect(JSON.stringify(page)).not.toContain("must-not-leak");

    const boundaryPage = await listWorkspaceOrderSummaries({
      workspaceId: testWorkspaceId,
      statusFilter: "open",
      searchTerm: "Boundary Buyer",
      limit: 1,
    });
    expect(boundaryPage.orders).toHaveLength(1);
    expect(boundaryPage.orders[0]).toMatchObject({ id: `order:${boundaryOrderNumber}` });
    expect(boundaryPage.orders[0].items).toHaveLength(2);
    const afterBoundary = await listWorkspaceOrderSummaries({
      workspaceId: testWorkspaceId,
      statusFilter: "open",
      searchTerm: "Boundary Buyer",
      limit: 1,
      cursor: { version: 1, ...boundaryPage.nextCursorValues },
    });
    expect(afterBoundary.orders.map((order) => order.id)).not.toContain(`order:${boundaryOrderNumber}`);

    const inBatch = await listWorkspaceOrderSummaries({
      workspaceId: testWorkspaceId,
      activeBatchId: filterBatchId,
      statusFilter: "open",
      batchFilter: "inBatch",
      searchTerm: boundaryOrderNumber,
      limit: 50,
    });
    expect(inBatch.orders).toHaveLength(1);
    expect(inBatch.orders[0]).toMatchObject({
      id: `order:${boundaryOrderNumber}`,
      isInActiveBatch: true,
    });
    expect(inBatch.orders[0].items).toHaveLength(2);
    const notInBatch = await listWorkspaceOrderSummaries({
      workspaceId: testWorkspaceId,
      activeBatchId: filterBatchId,
      statusFilter: "open",
      batchFilter: "notInBatch",
      searchTerm: boundaryOrderNumber,
      limit: 50,
    });
    expect(notInBatch.orders).toEqual([]);

    const orderedKinds = await listWorkspaceOrderSummaries({
      workspaceId: testWorkspaceId,
      statusFilter: "open",
      searchTerm: `Ordering-${suffix}`,
      limit: 50,
    });
    expect(orderedKinds.orders.map((order) => order.id)).toEqual([
      `item:scale-${suffix}-order-null`,
      `order:CUSTOM-${suffix}`,
      expect.stringMatching(/^order:77\d{8}$/),
    ]);
    expect(orderedKinds.orders.map((order) => order.id)).not.toContain(`order:OTHER-${suffix}`);

    const otherWorkspace = await listWorkspaceOrderSummaries({
      workspaceId: isolatedWorkspaceId,
      statusFilter: "open",
      searchTerm: `Ordering-${suffix}`,
      limit: 50,
    });
    expect(otherWorkspace.orders.map((order) => order.id)).toEqual([`order:OTHER-${suffix}`]);

    const mixedOpen = await listWorkspaceOrderSummaries({
      workspaceId: testWorkspaceId,
      statusFilter: "open",
      searchTerm: `MIXED-${suffix}`,
      limit: 50,
    });
    expect(mixedOpen.orders).toHaveLength(1);
    expect(mixedOpen.orders[0]).toMatchObject({ id: `order:MIXED-${suffix}`, status: "open" });
    expect(mixedOpen.orders[0].items.map((item) => item.status).sort()).toEqual(["complete", "open"]);
    const mixedComplete = await listWorkspaceOrderSummaries({
      workspaceId: testWorkspaceId,
      statusFilter: "complete",
      searchTerm: `MIXED-${suffix}`,
      limit: 50,
    });
    expect(mixedComplete.orders).toEqual([]);

    const skipped = await listWorkspaceOrderSummaries({
      workspaceId: testWorkspaceId,
      statusFilter: "skipped",
      searchTerm: `SKIPPED-${suffix}`,
      limit: 50,
    });
    expect(skipped.orders).toHaveLength(1);
    expect(skipped.orders[0]).toMatchObject({ id: `order:SKIPPED-${suffix}`, status: "skipped" });
    expect(skipped.orders[0].items).toHaveLength(2);

    const traversedIds = [];
    let traversalCursor = null;
    do {
      const traversalPage = await listWorkspaceOrderSummaries({
        workspaceId: testWorkspaceId,
        statusFilter: "all",
        searchTerm: traversalToken,
        limit: 50,
        cursor: traversalCursor,
      });
      traversedIds.push(...traversalPage.orders.map((order) => order.id));
      traversalCursor = traversalPage.nextCursorValues
        ? { version: 1, ...traversalPage.nextCursorValues }
        : null;
      if (!traversalPage.hasMore) break;
      expect(traversalCursor).not.toBeNull();
      expect(traversedIds.length).toBeLessThanOrEqual(1005);
    } while (traversalCursor);
    expect(traversedIds).toHaveLength(1005);
    expect(new Set(traversedIds).size).toBe(1005);

    const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: anonRpcError } = await anon.rpc("list_workspace_order_summaries", {
      p_workspace_id: testWorkspaceId,
      p_status_filter: "open",
      p_requested_limit: 1,
    });
    expect(anonRpcError).not.toBeNull();
    const restrictedEmail = `orders-rpc-${suffix}@example.com`;
    const restrictedPassword = "OrdersRpc123!";
    const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
      email: restrictedEmail,
      password: restrictedPassword,
      email_confirm: true,
    });
    expect(createUserError).toBeNull();
    disposableAuthUserIds.add(createdUser.user.id);
    const authenticated = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await authenticated.auth.signInWithPassword({
      email: restrictedEmail,
      password: restrictedPassword,
    });
    expect(signInError).toBeNull();
    const { error: authenticatedRpcError } = await authenticated.rpc("list_workspace_order_summaries", {
      p_workspace_id: testWorkspaceId,
      p_status_filter: "open",
      p_requested_limit: 1,
    });
    expect(authenticatedRpcError).not.toBeNull();
    for (const [term, expectedId] of [
      ["needlebuyer", `order:BUYER-${suffix}`],
      ["needlelistingid", `order:LISTING-ID-${suffix}`],
      ["needlelistingtitle", `order:LISTING-TITLE-${suffix}`],
      ["needletransaction", `order:TRANSACTION-${suffix}`],
      ["needlecolor", `order:COLOR-${suffix}`],
      ["needledesign", `order:DESIGN-${suffix}`],
      ["needleline", `order:LINE-${suffix}`],
    ]) {
      const search = await listWorkspaceOrderSummaries({
        workspaceId: testWorkspaceId,
        statusFilter: "all",
        searchTerm: term.toUpperCase(),
        limit: 50,
      });
      expect(search.orders.map((order) => order.id)).toContain(expectedId);
      expect(JSON.stringify(search)).not.toContain("must-not-leak");
    }

    for (const statusFilter of ["all", "complete"]) {
      const historical = await listWorkspaceOrderSummaries({
        workspaceId: testWorkspaceId,
        statusFilter,
        searchTerm: "4118855809",
        limit: 50,
      });
      expect(historical.orders).toHaveLength(1);
      expect(historical.orders[0]).toMatchObject({
        id: "order:4118855809",
        status: "complete",
      });
    }
  }, 60_000);

  it("treats LIKE metacharacters and both listing title keys as literal search data", async () => {
    // Break caught: raw LIKE patterns broaden user searches or source_json.title is skipped.
    const suffix = randomUUID().slice(0, 8);
    const testWorkspaceId = await createDisposableWorkspace(`Literal Search ${suffix}`);
    const supabase = createSupabaseAdminClient();
    const rows = [
      {
        id: `literal-${suffix}-percent`, workspace_id: testWorkspaceId, status: "open",
        order_number: `PERCENT-${suffix}`, buyer_name: `Literal 100% Match ${suffix}`,
        listing_id: "plain", transaction_id: `percent-${suffix}`, quantity: 1, source_json: {},
      },
      {
        id: `literal-${suffix}-percent-decoy`, workspace_id: testWorkspaceId, status: "open",
        order_number: `PERCENT-DECOY-${suffix}`, buyer_name: `Literal 1000 Match ${suffix}`,
        listing_id: "plain", transaction_id: `percent-decoy-${suffix}`, quantity: 1, source_json: {},
      },
      {
        id: `literal-${suffix}-underscore`, workspace_id: testWorkspaceId, status: "open",
        order_number: `UNDERSCORE-${suffix}`, buyer_name: `Literal under_score ${suffix}`,
        listing_id: "plain", transaction_id: `underscore-${suffix}`, quantity: 1, source_json: {},
      },
      {
        id: `literal-${suffix}-underscore-decoy`, workspace_id: testWorkspaceId, status: "open",
        order_number: `UNDERSCORE-DECOY-${suffix}`, buyer_name: `Literal underXscore ${suffix}`,
        listing_id: "plain", transaction_id: `underscore-decoy-${suffix}`, quantity: 1, source_json: {},
      },
      {
        id: `literal-${suffix}-backslash`, workspace_id: testWorkspaceId, status: "open",
        order_number: `BACKSLASH-${suffix}`, buyer_name: `Literal slash\\value ${suffix}`,
        listing_id: "plain", transaction_id: `backslash-${suffix}`, quantity: 1, source_json: {},
      },
      {
        id: `literal-${suffix}-backslash-decoy`, workspace_id: testWorkspaceId, status: "open",
        order_number: `BACKSLASH-DECOY-${suffix}`, buyer_name: `Literal slashvalue ${suffix}`,
        listing_id: "plain", transaction_id: `backslash-decoy-${suffix}`, quantity: 1, source_json: {},
      },
      {
        id: `literal-${suffix}-source-title`, workspace_id: testWorkspaceId, status: "open",
        order_number: `SOURCE-TITLE-${suffix}`, buyer_name: "Plain",
        listing_id: "plain", transaction_id: `source-title-${suffix}`, quantity: 1,
        source_json: { title: `Legacy listing title ${suffix}` },
      },
    ];
    const { error } = await supabase.from("order_items").insert(rows);
    expect(error).toBeNull();

    for (const [searchTerm, expectedOrderId] of [
      [`100% Match ${suffix}`, `order:PERCENT-${suffix}`],
      [`under_score ${suffix}`, `order:UNDERSCORE-${suffix}`],
      [`slash\\value ${suffix}`, `order:BACKSLASH-${suffix}`],
      [`listing title ${suffix}`, `order:SOURCE-TITLE-${suffix}`],
    ]) {
      const page = await listWorkspaceOrderSummaries({
        workspaceId: testWorkspaceId,
        statusFilter: "open",
        searchTerm,
      });
      expect(page.orders.map((order) => order.id)).toEqual([expectedOrderId]);
    }
  }, 30_000);

  it("imports order items to Orders without adding them to the production batch", async () => {
    const suffix = Date.now().toString(36);
    const orderNumber = `ORDERS-${suffix}`;
    const transactionId = `txn-orders-${suffix}`;

    const result = await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "orders",
      batchId: PRIMARY_BATCH_ID,
      items: [{
        text: "Ada\nRN",
        presetId: "preset-c3e8a1d7f520",
        source: {
          orderNumber,
          transactionId,
          buyerName: "Ada Lovelace",
          listingId: `listing-${suffix}`,
          colorName: "Teal",
          quantity: "2",
        },
        settings: {
          boundingSizePresetId: "size-2-2x1-5",
          backingMm: 4.2,
          lines: [
            { fontId: "skywalk", fontSizeMm: 18 },
            { fontId: "somekind", bridgeMm: 0.7 },
          ],
        },
      }],
    });

    expect(result).toMatchObject({
      importedCount: 1,
      addedToBatchCount: 0,
      addedOrderItemIds: [],
    });
    const importedOrder = result.orders.find((order) => order.orderNumber === orderNumber);

    expect(importedOrder).toMatchObject({
      id: `order:${orderNumber}`,
      orderNumber,
      buyerName: "Ada Lovelace",
      isInActiveBatch: false,
    });
    expect(importedOrder.items[0]).toMatchObject({
      id: `transaction:${transactionId}`,
      importedColor: "Teal",
      quantity: 2,
      isInActiveBatch: false,
      design: {
        text: "Ada\nRN",
        presetId: "preset-c3e8a1d7f520",
        backingBorderMm: 4.2,
        lines: [
          { lineIndex: 0, text: "Ada", fontId: "skywalk", textHeightMm: 18 },
          { lineIndex: 1, text: "RN", fontId: "somekind", letterBridgeMm: 0.7 },
        ],
      },
    });

    const supabase = createSupabaseAdminClient();
    const { data: batchItems, error } = await supabase
      .from("batch_items")
      .select("order_item_id")
      .eq("batch_id", PRIMARY_BATCH_ID)
      .eq("order_item_id", `transaction:${transactionId}`);

    expect(error).toBeNull();
    expect(batchItems).toEqual([]);
  });

  it("imports order items to the active production batch and groups checked orders", async () => {
    const suffix = Date.now().toString(36);
    const orderNumber = `BATCH-${suffix}`;
    const existingTransactionId = `txn-existing-${suffix}`;
    const newTransactionId = `txn-new-${suffix}`;
    const batchId = await createTestBatch("Grouped Orders DB Test Batch");

    const firstImport = await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "productionBatch",
      batchId,
      items: [{
        text: "Grace",
        source: {
          orderNumber,
          transactionId: existingTransactionId,
          buyerName: "Grace Hopper",
        },
      }],
    });

    expect(firstImport).toMatchObject({
      importedCount: 1,
      addedToBatchCount: 1,
      addedOrderItemIds: [`transaction:${existingTransactionId}`],
    });

    const secondImport = await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "orders",
      items: [{
        text: "Badge buddy",
        source: {
          orderNumber,
          transactionId: newTransactionId,
          buyerName: "Grace Hopper",
        },
      }],
    });

    expect(secondImport).toMatchObject({
      importedCount: 1,
      addedToBatchCount: 0,
    });

    const groupedAdd = await addOrderGroupsToProductionBatch({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      batchId,
      orderIds: [`order:${orderNumber}`],
    });

    expect(groupedAdd).toEqual({
      addedOrderItemIds: [`transaction:${newTransactionId}`],
    });

    const listed = await listWorkspaceOrders({
      workspaceId: PRIMARY_WORKSPACE_ID,
      activeBatchId: batchId,
    });
    const groupedOrder = listed.orders.find((order) => order.orderNumber === orderNumber);

    expect(groupedOrder).toMatchObject({
      id: `order:${orderNumber}`,
      isInActiveBatch: true,
    });
    expect(groupedOrder.items).toHaveLength(2);
    expect(groupedOrder.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: `transaction:${existingTransactionId}`, isInActiveBatch: true }),
      expect.objectContaining({ id: `transaction:${newTransactionId}`, isInActiveBatch: true }),
    ]));
  });

  it("hides complete orders by default and preserves saved designs on duplicate imports", async () => {
    const suffix = Date.now().toString(36);
    const completeId = `transaction:txn-complete-${suffix}`;
    const savedId = `transaction:txn-saved-${suffix}`;
    const cachedBuild = {
      signature: `saved-${suffix}`,
      layout: { text: "Saved", lines: [{ text: "Saved" }] },
      analysis: { connectedComponentCount: 1 },
    };
    const supabase = createSupabaseAdminClient();

    const importResult = await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "orders",
      items: [
        {
          text: "Complete",
          source: {
            orderNumber: `COMPLETE-${suffix}`,
            transactionId: `txn-complete-${suffix}`,
            buyerName: "Complete Buyer",
          },
        },
        {
          text: "Saved",
          presetId: "preset-c3e8a1d7f520",
          source: {
            orderNumber: `SAVED-${suffix}`,
            transactionId: `txn-saved-${suffix}`,
            buyerName: "Saved Buyer",
          },
          settings: { lines: [{ fontId: "skywalk" }] },
        },
      ],
    });

    expect(importResult.importedCount).toBe(2);

    const { error: completeError } = await supabase
      .from("order_items")
      .update({ status: "complete" })
      .eq("id", completeId);

    expect(completeError).toBeNull();

    const { error: savedError } = await supabase
      .from("designs")
      .update({
        production_status: "export_ready",
        cached_build_json: cachedBuild,
        saved_settings_signature: cachedBuild.signature,
        completed_settings_signature: cachedBuild.signature,
        analysis_badge_json: { state: "ok", shortLabel: "Ready", fullLabel: "Ready" },
      })
      .eq("order_item_id", savedId);

    expect(savedError).toBeNull();

    await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "orders",
      items: [{
        text: "Draft overwrite",
        presetId: "preset-b7d2e9f4c318",
        source: {
          orderNumber: `SAVED-${suffix}`,
          transactionId: `txn-saved-${suffix}`,
          buyerName: "Saved Buyer",
        },
        settings: { lines: [{ fontId: "somekind" }] },
      }],
    });

    const listed = await listWorkspaceOrders({
      workspaceId: PRIMARY_WORKSPACE_ID,
      activeBatchId: PRIMARY_BATCH_ID,
    });

    expect(listed.orders.some((order) => order.orderNumber === `COMPLETE-${suffix}`)).toBe(false);
    const savedOrder = listed.orders.find((order) => order.orderNumber === `SAVED-${suffix}`);
    expect(savedOrder?.items[0].design).toMatchObject({
      text: "Saved",
      presetId: "preset-c3e8a1d7f520",
      productionStatus: "export_ready",
      cachedBuild,
      savedSettingsSignature: cachedBuild.signature,
      completedSettingsSignature: cachedBuild.signature,
      lines: [{ lineIndex: 0, text: "Saved", fontId: "skywalk" }],
    });
  });

  it("skips an order and clears active production batch selection", async () => {
    const suffix = Date.now().toString(36);
    const orderNumber = `SKIP-${suffix}`;
    const transactionId = `txn-skip-${suffix}`;
    const orderItemId = `transaction:${transactionId}`;
    const batchId = await createTestBatch("Skip Orders DB Test Batch");

    await importWorkspaceOrderItems({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      target: "productionBatch",
      batchId,
      items: [{
        text: "Skip Me",
        source: {
          orderNumber,
          transactionId,
          buyerName: "Skip Buyer",
        },
      }],
    });

    const supabase = createSupabaseAdminClient();
    const { error: activeSelectionError } = await supabase
      .from("production_batches")
      .update({ active_order_item_id: orderItemId })
      .eq("id", batchId);

    expect(activeSelectionError).toBeNull();

    const result = await updateOrderGroupStatus({
      workspaceId: PRIMARY_WORKSPACE_ID,
      userId: null,
      orderId: `order:${orderNumber}`,
      status: "skipped",
    });

    expect(result).toEqual({
      orderItemIds: [orderItemId],
      status: "skipped",
    });

    const { data: batch, error: batchError } = await supabase
      .from("production_batches")
      .select("active_order_item_id")
      .eq("id", batchId)
      .maybeSingle();
    const { data: batchItems, error: batchItemsError } = await supabase
      .from("batch_items")
      .select("order_item_id")
      .eq("batch_id", batchId)
      .eq("order_item_id", orderItemId);

    expect(batchError).toBeNull();
    expect(batch?.active_order_item_id).toBeNull();
    expect(batchItemsError).toBeNull();
    expect(batchItems).toEqual([]);
  });

  it("excludes legacy archived order items from the open filter", async () => {
    // Break caught: a historical archived item is returned as open after the lifecycle change.
    const suffix = randomUUID().slice(0, 8);
    const archivedId = `legacy-${suffix}-archived`;
    await assertLegacyArchivedOrderExcluded({
      id: archivedId,
      workspaceId: PRIMARY_WORKSPACE_ID,
      orderNumber: `ARCHIVED-${suffix}`,
      buyerName: `Legacy archived ${suffix}`,
      transactionId: `archived-${suffix}`,
    });
  }, 30_000);
});
