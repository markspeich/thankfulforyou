import { describe, expect, it } from "vitest";

import {
  listWorkspaceFontAliases,
  mapWorkspaceFontAlias,
} from "../../api/_lib/font-alias-store.js";

function createAliasSupabase({ aliases = [], rpcResult = { data: null, error: null } } = {}) {
  return {
    from(table) {
      expect(table).toBe("font_aliases");
      return {
        select() { return this; },
        eq() { return this; },
        order: async () => ({ data: aliases, error: null }),
      };
    },
    async rpc(name, args) {
      this.rpcCall = { name, args };
      return rpcResult;
    },
  };
}

describe("workspace font alias store", () => {
  it("returns only browser-safe alias and target-font metadata", async () => {
    // Break caught: the aliases query returns raw source diagnostics or audit-user data to browsers.
    const supabase = createAliasSupabase({
      aliases: [{
        id: "alias-1", workspace_id: "workspace-1", alias_name: " Lemonade ", normalized_alias: "lemonade",
        font_id: "font-1", created_by: "operator-1", updated_by: "operator-2", etsy_import_diagnostics: { token: "private" },
        created_at: "2026-08-15T12:00:00.000Z", updated_at: "2026-08-15T13:00:00.000Z",
        fonts: { id: "font-1", display_name: "Crushed Lemonade", archived_at: null, deleted_at: null, storage_path: "private/path" },
      }],
    });

    await expect(listWorkspaceFontAliases({ workspaceId: "workspace-1", supabase })).resolves.toEqual([{
      id: "alias-1", aliasName: " Lemonade ", normalizedAlias: "lemonade", fontId: "font-1",
      font: { id: "font-1", displayName: "Crushed Lemonade", archivedAt: null, deletedAt: null },
      createdAt: "2026-08-15T12:00:00.000Z", updatedAt: "2026-08-15T13:00:00.000Z",
    }]);
  });

  it("sends the server-canonical alias and authenticated operator to the mapping RPC", async () => {
    // Break caught: a client-controlled normalized key or missing operator reaches the transactional RPC.
    const supabase = createAliasSupabase({
      rpcResult: { data: {
        alias_id: "alias-1", alias_name: "  S\u{FF35}\u{FF50}\u{FF45}\u{FF52}   Boy ", normalized_alias: "super boy", font_id: "font-1",
        font_display_name: "Super Boys", font_archived_at: null, font_deleted_at: null,
      }, error: null },
    });

    const result = await mapWorkspaceFontAlias({
      workspaceId: "workspace-1", userId: "operator-1", aliasName: "  S\u{FF35}\u{FF50}\u{FF45}\u{FF52}   Boy ",
      normalizedAlias: "attacker-controlled", fontId: "font-1", supabase,
    });

    expect(supabase.rpcCall).toEqual({
      name: "map_workspace_font_alias",
      args: expect.objectContaining({
        p_workspace_id: "workspace-1", p_user_id: "operator-1", p_alias_name: "  S\u{FF35}\u{FF50}\u{FF45}\u{FF52}   Boy ",
        p_normalized_alias: "super boy", p_font_id: "font-1",
      }),
    });
    expect(result.alias).toMatchObject({
      id: "alias-1", aliasName: "  S\u{FF35}\u{FF50}\u{FF45}\u{FF52}   Boy ", normalizedAlias: "super boy", fontId: "font-1",
      font: { displayName: "Super Boys", archivedAt: null, deletedAt: null },
    });
  });

  it("maps revision conflicts to a stable exposed error", async () => {
    // Break caught: stale writes become a generic server failure instead of a recoverable conflict.
    const supabase = createAliasSupabase({
      rpcResult: { data: null, error: { code: "40001", message: "Design revision conflict." } },
    });

    await expect(mapWorkspaceFontAlias({
      workspaceId: "workspace-1", userId: "operator-1", aliasName: "Lemonade", fontId: "font-1", supabase,
    })).rejects.toMatchObject({
      code: "FONT_ALIAS_CONFLICT", statusCode: 409, expose: true,
      message: "This mapping changed while you were editing it. Refresh and try again.",
    });
  });
});
