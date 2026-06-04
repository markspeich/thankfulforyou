import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

export const TEST_OPERATOR_EMAIL = "test.operator@example.com";
export const TEST_OPERATOR_PASSWORD = "TestOperator123!";
export const PRIMARY_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
export const PRIMARY_BATCH_ID = "22222222-2222-4222-8222-222222222222";

async function findUserByEmail(supabase, email) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      throw error;
    }

    const users = data?.users || [];
    const user = users.find((candidate) => (
      String(candidate?.email || "").toLowerCase() === email.toLowerCase()
    ));
    if (user || users.length < 1000) {
      return user || null;
    }
  }
}

async function upsertOrThrow(supabase, table, payload, options) {
  const { error } = await supabase
    .from(table)
    .upsert(payload, options);
  if (error) {
    throw error;
  }
}

export async function initializeAppData(supabase, options = {}) {
  const now = options.now || new Date().toISOString();
  const existingUser = await findUserByEmail(supabase, TEST_OPERATOR_EMAIL);
  const userPayload = {
    email: TEST_OPERATOR_EMAIL,
    password: TEST_OPERATOR_PASSWORD,
    email_confirm: true,
    user_metadata: { name: "Test Operator" },
  };

  const { data: userData, error: userError } = existingUser
    ? await supabase.auth.admin.updateUserById(existingUser.id, userPayload)
    : await supabase.auth.admin.createUser(userPayload);
  if (userError) {
    throw userError;
  }

  const user = userData?.user;
  if (!user?.id) {
    throw new Error("Unable to resolve initialized test operator.");
  }

  await upsertOrThrow(
    supabase,
    "workspaces",
    { id: PRIMARY_WORKSPACE_ID, name: "Primary Workspace" },
    { onConflict: "id" },
  );
  await upsertOrThrow(
    supabase,
    "workspace_memberships",
    { workspace_id: PRIMARY_WORKSPACE_ID, user_id: user.id, role: "operator" },
    { onConflict: "workspace_id,user_id" },
  );
  await upsertOrThrow(
    supabase,
    "production_batches",
    {
      id: PRIMARY_BATCH_ID,
      workspace_id: PRIMARY_WORKSPACE_ID,
      name: "Primary Batch",
      status: "active",
      active_order_item_id: null,
      updated_at: now,
      updated_by: user.id,
    },
    { onConflict: "id" },
  );

  return {
    operator: {
      id: user.id,
      email: user.email || TEST_OPERATOR_EMAIL,
    },
    workspace: {
      id: PRIMARY_WORKSPACE_ID,
      name: "Primary Workspace",
    },
    batch: {
      id: PRIMARY_BATCH_ID,
      name: "Primary Batch",
      updatedAt: now,
    },
  };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function main() {
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const result = await initializeAppData(supabase);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
