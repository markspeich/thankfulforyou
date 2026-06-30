export const DEFAULT_WORKSPACE = "databaseOrders";
export const NOT_FOUND_WORKSPACE = "notFound";

export const WORKSPACE_ROUTE_SEGMENTS = Object.freeze({
  databaseOrders: "orders",
  orders: "production-batch",
  presets: "presets",
  fonts: "fonts",
  fixedDesigns: "fixed-designs",
  sizeGuides: "size-guides",
});

export const WORKSPACE_BY_ROUTE_SEGMENT = Object.freeze(
  Object.fromEntries(Object.entries(WORKSPACE_ROUTE_SEGMENTS).map(([workspace, segment]) => [segment, workspace])),
);

export function safeDecodeRouteSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeMissingPath(pathname) {
  const normalized = typeof pathname === "string" && pathname.startsWith("/") ? pathname : "/";
  return normalized === "/" ? null : normalized;
}

export function readAppRouteFromPathname(pathname = "/") {
  const normalizedPathname = typeof pathname === "string" && pathname ? pathname : "/";
  const segments = normalizedPathname
    .split("/")
    .filter(Boolean)
    .map(safeDecodeRouteSegment);
  const routeRoot = segments[0] || "";

  if (!routeRoot) {
    return {
      workspace: DEFAULT_WORKSPACE,
      itemId: null,
      missingPath: null,
    };
  }

  const workspace = WORKSPACE_BY_ROUTE_SEGMENT[routeRoot];
  if (!workspace) {
    return {
      workspace: NOT_FOUND_WORKSPACE,
      itemId: null,
      missingPath: normalizeMissingPath(normalizedPathname),
    };
  }

  return {
    workspace,
    itemId: typeof segments[1] === "string" && segments[1] ? segments[1] : null,
    missingPath: null,
  };
}

export function buildAppPath(workspace = DEFAULT_WORKSPACE, itemId = null) {
  const routeSegment = WORKSPACE_ROUTE_SEGMENTS[workspace] || WORKSPACE_ROUTE_SEGMENTS[DEFAULT_WORKSPACE];
  const normalizedItemId = typeof itemId === "string" && itemId.trim() ? itemId.trim() : "";
  return normalizedItemId
    ? `/${routeSegment}/${encodeURIComponent(normalizedItemId)}`
    : `/${routeSegment}`;
}
