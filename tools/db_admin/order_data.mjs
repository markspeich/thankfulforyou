import { createClient } from "@supabase/supabase-js";
import { readLocalSupabaseEnv, spawnCommand } from "../supabase_env.mjs";

const PRODUCTION_PROJECT_REF = "oezjskcygvfyezvoulzw";
const PRODUCTION_SUPABASE_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const ORDER_TABLES = [
  "order_items",
  "batch_items",
  "designs",
  "design_lines",
  "design_analysis_cache",
];

function parseArgs(argv) {
  const args = {
    command: null,
    target: "local",
    dryRun: true,
    confirm: "",
  };

  for (const arg of argv) {
    if (arg === "orders:count" || arg === "orders:purge") {
      args.command = arg;
    } else if (arg.startsWith("--target=")) {
      args.target = arg.slice("--target=".length);
    } else if (arg === "--execute") {
      args.dryRun = false;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--confirm=")) {
      args.confirm = arg.slice("--confirm=".length);
    } else {
      throw new Error(`Unsupported argument: ${arg}`);
    }
  }

  if (!args.command) {
    throw new Error("Expected command orders:count or orders:purge.");
  }

  if (!["local", "production"].includes(args.target)) {
    throw new Error("--target must be local or production.");
  }

  return args;
}

function createAdminClient(env) {
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function readProductionSupabaseEnv() {
  const status = spawnCommand("npx", ["supabase", "projects", "list"], {
    encoding: "utf8",
  });
  if (status.status !== 0) {
    process.stderr.write(status.stderr || status.stdout);
    throw new Error("Supabase CLI is not authenticated or cannot list projects.");
  }

  return {
    SUPABASE_URL: PRODUCTION_SUPABASE_URL,
    SUPABASE_PROJECT_REF: PRODUCTION_PROJECT_REF,
  };
}

function ensureProductionLink() {
  const result = spawnCommand("npx", ["supabase", "link", "--project-ref", PRODUCTION_PROJECT_REF], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    throw new Error(`Unable to link Supabase CLI to production project ${PRODUCTION_PROJECT_REF}.`);
  }
}

function assertProductionTarget(env, confirm) {
  if (env.SUPABASE_URL !== PRODUCTION_SUPABASE_URL) {
    throw new Error(`Refusing production operation for unexpected URL: ${env.SUPABASE_URL || "<missing>"}`);
  }

  if (confirm !== PRODUCTION_PROJECT_REF) {
    throw new Error(`Production purge requires --confirm=${PRODUCTION_PROJECT_REF}.`);
  }
}

async function countOrderData(supabase) {
  const counts = {};
  for (const table of ORDER_TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }
    counts[table] = count ?? 0;
  }

  const { count, error } = await supabase
    .from("production_batches")
    .select("*", { count: "exact", head: true })
    .not("active_order_item_id", "is", null);
  if (error) {
    throw new Error(`production_batches active order refs: ${error.message}`);
  }
  counts.production_batches_active_order_refs = count ?? 0;

  return counts;
}

async function purgeLocalOrderData(supabase) {
  const clear = await supabase
    .from("production_batches")
    .update({ active_order_item_id: null, updated_at: new Date().toISOString() })
    .not("active_order_item_id", "is", null);
  if (clear.error) {
    throw new Error(`clear active_order_item_id: ${clear.error.message}`);
  }

  const deleted = await supabase
    .from("order_items")
    .delete()
    .not("id", "is", null);
  if (deleted.error) {
    throw new Error(`delete order_items: ${deleted.error.message}`);
  }
}

function runProductionSql(sql) {
  const result = spawnCommand("npx", [
    "supabase",
    "db",
    "query",
    "--linked",
    "--output",
    "json",
    sql,
  ], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    throw new Error("Production SQL query failed.");
  }

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const isProduction = args.target === "production";
  const env = isProduction ? readProductionSupabaseEnv() : await readLocalSupabaseEnv();

  if (isProduction && args.command === "orders:purge" && !args.dryRun) {
    assertProductionTarget(env, args.confirm);
  }

  if (isProduction) {
    ensureProductionLink();
  }

  const supabase = isProduction
    ? null
    : createAdminClient(env);

  const before = isProduction
    ? null
    : await countOrderData(supabase);

  if (args.command === "orders:count") {
    if (isProduction) {
      runProductionSql("select (select count(*) from public.order_items) as order_items, (select count(*) from public.batch_items) as batch_items, (select count(*) from public.designs) as designs, (select count(*) from public.design_lines) as design_lines, (select count(*) from public.design_analysis_cache) as design_analysis_cache, (select count(*) from public.production_batches where active_order_item_id is not null) as production_batches_active_order_refs;");
      return;
    }
    console.log(JSON.stringify({ target: args.target, counts: before }, null, 2));
    return;
  }

  if (args.dryRun) {
    if (isProduction) {
      runProductionSql("select (select count(*) from public.order_items) as order_items, (select count(*) from public.batch_items) as batch_items, (select count(*) from public.designs) as designs, (select count(*) from public.design_lines) as design_lines, (select count(*) from public.design_analysis_cache) as design_analysis_cache, (select count(*) from public.production_batches where active_order_item_id is not null) as production_batches_active_order_refs;");
      console.log(`Dry run only. Re-run with --execute --confirm=${PRODUCTION_PROJECT_REF} to purge production orders.`);
      return;
    }
    console.log(JSON.stringify({ target: args.target, dryRun: true, before }, null, 2));
    return;
  }

  if (isProduction) {
    runProductionSql("begin; update public.production_batches set active_order_item_id = null, updated_at = now() where active_order_item_id is not null; delete from public.order_items; commit;");
    runProductionSql("select (select count(*) from public.order_items) as order_items, (select count(*) from public.batch_items) as batch_items, (select count(*) from public.designs) as designs, (select count(*) from public.design_lines) as design_lines, (select count(*) from public.design_analysis_cache) as design_analysis_cache, (select count(*) from public.production_batches where active_order_item_id is not null) as production_batches_active_order_refs;");
    return;
  }

  await purgeLocalOrderData(supabase);
  const after = await countOrderData(supabase);
  console.log(JSON.stringify({ target: args.target, before, after }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
