import { createClient } from "@supabase/supabase-js";
import { readLocalSupabaseEnv, spawnCommand } from "../supabase_env.mjs";

const PRODUCTION_PROJECT_REF = "oezjskcygvfyezvoulzw";
const PRODUCTION_SUPABASE_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;

export function parseArgs(argv) {
  const args = { workspaceId: "", orderNumber: "", target: "" };
  for (const arg of argv) {
    if (arg.startsWith("--workspace-id=")) args.workspaceId = arg.slice("--workspace-id=".length).trim();
    else if (arg.startsWith("--order-number=")) args.orderNumber = arg.slice("--order-number=".length).trim();
    else if (arg.startsWith("--target=")) args.target = arg.slice("--target=".length);
    else throw new Error(`Unsupported argument: ${arg}`);
  }
  if (!args.orderNumber) throw new Error("--order-number is required.");
  if (!args.workspaceId) throw new Error("--workspace-id is required.");
  if (!["local", "production"].includes(args.target)) throw new Error("--target must be local or production.");
  return args;
}

function createAdminClient(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

function readProductionSupabaseEnv() {
  const status = spawnCommand("npx", ["supabase", "projects", "list"], { encoding: "utf8" });
  if (status.status !== 0) {
    process.stderr.write(status.stderr || status.stdout);
    throw new Error("Supabase CLI is not authenticated or cannot list projects.");
  }
  return { SUPABASE_URL: PRODUCTION_SUPABASE_URL, SUPABASE_PROJECT_REF: PRODUCTION_PROJECT_REF };
}

function ensureProductionLink() {
  const result = spawnCommand("npx", ["supabase", "link", "--project-ref", PRODUCTION_PROJECT_REF], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    throw new Error(`Unable to link Supabase CLI to production project ${PRODUCTION_PROJECT_REF}.`);
  }
}

export function buildProductionQuery({ workspaceId, orderNumber }) {
  const escapedWorkspaceId = workspaceId.replace(/'/g, "''");
  const escapedOrderNumber = orderNumber.replace(/'/g, "''");
  return `select row_to_json(attempt) from (select * from public.etsy_import_attempts where workspace_id = '${escapedWorkspaceId}' and order_number = '${escapedOrderNumber}' order by attempted_at desc, id desc) attempt;`;
}

function runProductionQuery({ workspaceId, orderNumber }) {
  const sql = buildProductionQuery({ workspaceId, orderNumber });
  const result = spawnCommand("npx", ["supabase", "db", "query", "--linked", "--output", "json", sql], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    throw new Error("Production SQL query failed.");
  }
  process.stdout.write(result.stdout || "[]\n");
}

export async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.target === "production") {
    readProductionSupabaseEnv();
    ensureProductionLink();
    runProductionQuery(args);
    return;
  }
  const env = await readLocalSupabaseEnv();
  const { data, error } = await createAdminClient(env)
    .from("etsy_import_attempts")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .eq("order_number", args.orderNumber)
    .order("attempted_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw new Error(`etsy_import_attempts: ${error.message}`);
  console.log(JSON.stringify(data || [], null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
