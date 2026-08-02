import { refreshAccessToken } from "./auth-session.js";

let refreshPromise = null;

export function isAuthenticationError(error) {
  return Boolean(error && (
    error.status === 401
    || error.statusCode === 401
    || (typeof error.message === "string" && /(authentication required|jwt has expired|unauthorized)/i.test(error.message))
  ));
}

async function refreshAccessTokenOnce() {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function runAuthenticatedRequest(request, {
  accessToken = null,
  onAccessToken = () => {},
  disableRefresh = false,
} = {}) {
  try {
    return await request(accessToken);
  } catch (error) {
    if (!isAuthenticationError(error) || disableRefresh) throw error;
    let refreshedToken = null;
    try {
      refreshedToken = await refreshAccessTokenOnce();
    } catch {
      throw Object.assign(new Error("Authentication required."), { status: 401 });
    }
    if (!refreshedToken) {
      throw Object.assign(new Error("Authentication required."), { status: 401 });
    }
    onAccessToken(refreshedToken);
    return request(refreshedToken);
  }
}
