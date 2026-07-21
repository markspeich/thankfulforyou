import { createSupabaseAdminClient } from "./supabase-admin.js";

function createAuthError(statusCode, message) {
  return Object.assign(new Error(message), {
    statusCode,
    expose: true,
  });
}

function isSupabaseAuthNetworkError(error) {
  if (!error) {
    return false;
  }

  const name = typeof error.name === "string" ? error.name : "";
  const message = typeof error.message === "string" ? error.message : "";
  return name === "AuthRetryableFetchError" || /fetch failed|network|econn|eacces|etimedout/i.test(message);
}

export function readBearerToken(req) {
  const header = req?.headers?.authorization ?? req?.headers?.Authorization ?? "";

  if (!/^Bearer\s+/i.test(header)) {
    return null;
  }

  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

export async function resolveProductionBatchAuth(req) {
  const accessToken = readBearerToken(req);

  if (!accessToken) {
    throw createAuthError(401, "Authentication required.");
  }

  const supabase = createSupabaseAdminClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(accessToken);

  if (isSupabaseAuthNetworkError(claimsError)) {
    throw createAuthError(503, "Unable to reach Supabase auth from this dev server process.");
  }

  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (claimsError || !userId) {
    throw createAuthError(401, "Authentication required.");
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("workspace_memberships")
    .select("workspace_id")
    .eq("user_id", userId)
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
    userId,
    workspaceId,
  };
}
