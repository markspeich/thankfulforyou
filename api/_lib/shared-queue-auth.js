import { createSupabaseAdminClient } from "./supabase-admin.js";

function createAuthError(statusCode, message) {
  return Object.assign(new Error(message), {
    statusCode,
    expose: true,
  });
}

export function readBearerToken(req) {
  const header = req?.headers?.authorization ?? req?.headers?.Authorization ?? "";

  if (!/^Bearer\s+/i.test(header)) {
    return null;
  }

  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

export async function resolveSharedQueueAuth(req) {
  const accessToken = readBearerToken(req);

  if (!accessToken) {
    throw createAuthError(401, "Authentication required.");
  }

  const supabase = createSupabaseAdminClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

  if (userError || !userData?.user?.id) {
    throw createAuthError(401, "Authentication required.");
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", userData.user.id)
    .order("workspace_id", { ascending: true })
    .limit(1);

  if (membershipsError) {
    throw membershipsError;
  }

  const workspaceId = memberships?.[0]?.workspace_id ?? null;

  if (!workspaceId) {
    throw createAuthError(403, "Shared workspace access denied.");
  }

  return {
    userId: userData.user.id,
    workspaceId,
  };
}
