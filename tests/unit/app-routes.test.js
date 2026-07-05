import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE,
  NOT_FOUND_WORKSPACE,
  buildAppPath,
  readAppRouteFromPathname,
} from "../../src/app-routes.js";

describe("app route helpers", () => {
  it("marks unknown top-level browser paths as not found", () => {
    expect(readAppRouteFromPathname("/missing-page")).toEqual({
      workspace: NOT_FOUND_WORKSPACE,
      itemId: null,
      missingPath: "/missing-page",
    });
  });

  it("keeps the root path on the default orders workspace", () => {
    expect(readAppRouteFromPathname("/")).toEqual({
      workspace: DEFAULT_WORKSPACE,
      itemId: null,
      missingPath: null,
    });
  });

  it("builds a bookmarkable path for fixed designs", () => {
    expect(buildAppPath("fixedDesigns")).toBe("/fixed-designs");
  });
}
);
