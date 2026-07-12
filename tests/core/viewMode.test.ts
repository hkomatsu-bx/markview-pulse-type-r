import { describe, it, expect } from "vitest";

import { DEFAULT_VIEW_MODE } from "../../src/core/view/viewMode";

describe("viewMode（FR-17）", () => {
  it("既定モードは preview", () => {
    expect(DEFAULT_VIEW_MODE).toBe("preview");
  });
});
