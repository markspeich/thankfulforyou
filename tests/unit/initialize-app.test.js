import { describe, expect, it, vi } from "vitest";

import {
  initializeAppData,
  PRIMARY_BATCH_ID,
  PRIMARY_WORKSPACE_ID,
  TEST_OPERATOR_EMAIL,
} from "../../tools/initialize_app.mjs";

function createSupabaseMock(existingUser = null) {
  const calls = [];
  const user = existingUser || {
    id: "user-1",
    email: TEST_OPERATOR_EMAIL,
  };

  return {
    calls,
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({
          data: { users: existingUser ? [existingUser] : [] },
          error: null,
        }),
        createUser: vi.fn().mockResolvedValue({
          data: { user },
          error: null,
        }),
        updateUserById: vi.fn().mockResolvedValue({
          data: { user },
          error: null,
        }),
      },
    },
    from(table) {
      return {
        upsert(payload, options) {
          calls.push({ table, payload, options });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

describe("initialize app tool", () => {
  it("creates the test operator and primary workspace context", async () => {
    const supabase = createSupabaseMock();
    const result = await initializeAppData(supabase, {
      now: "2026-06-04T19:30:38.519Z",
    });

    expect(supabase.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: TEST_OPERATOR_EMAIL,
      password: "TestOperator123!",
      email_confirm: true,
    }));
    expect(supabase.calls).toEqual([
      {
        table: "workspaces",
        payload: { id: PRIMARY_WORKSPACE_ID, name: "Primary Workspace" },
        options: { onConflict: "id" },
      },
      {
        table: "workspace_memberships",
        payload: { workspace_id: PRIMARY_WORKSPACE_ID, user_id: "user-1", role: "operator" },
        options: { onConflict: "workspace_id,user_id" },
      },
      {
        table: "production_batches",
        payload: {
          id: PRIMARY_BATCH_ID,
          workspace_id: PRIMARY_WORKSPACE_ID,
          name: "Primary Batch",
          status: "active",
          active_order_item_id: null,
          updated_at: "2026-06-04T19:30:38.519Z",
          updated_by: "user-1",
        },
        options: { onConflict: "id" },
      },
    ]);
    expect(result).toMatchObject({
      operator: { id: "user-1", email: TEST_OPERATOR_EMAIL },
      workspace: { id: PRIMARY_WORKSPACE_ID, name: "Primary Workspace" },
      batch: { id: PRIMARY_BATCH_ID, name: "Primary Batch" },
    });
  });

  it("updates the test operator when it already exists", async () => {
    const existingUser = { id: "user-existing", email: TEST_OPERATOR_EMAIL };
    const supabase = createSupabaseMock(existingUser);

    await initializeAppData(supabase, {
      now: "2026-06-04T19:30:38.519Z",
    });

    expect(supabase.auth.admin.createUser).not.toHaveBeenCalled();
    expect(supabase.auth.admin.updateUserById).toHaveBeenCalledWith(
      "user-existing",
      expect.objectContaining({
        email: TEST_OPERATOR_EMAIL,
        password: "TestOperator123!",
        email_confirm: true,
      }),
    );
  });
});
