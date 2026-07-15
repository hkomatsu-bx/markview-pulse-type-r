import { describe, it, expect } from "vitest";

import {
  cycleContentWidth,
  contentWidthToCss,
  contentWidthLabel,
  DEFAULT_CONTENT_WIDTH,
  type ContentWidth,
} from "../../src/core/view/contentWidth";

describe("cycleContentWidth（FR-12）", () => {
  it("narrow → normal → wide → full → narrow と循環する", () => {
    // Arrange
    let width: ContentWidth = "narrow";
    const sequence: ContentWidth[] = [];

    // Act
    for (let i = 0; i < 4; i++) {
      width = cycleContentWidth(width);
      sequence.push(width);
    }

    // Assert
    expect(sequence).toEqual(["normal", "wide", "full", "narrow"]);
  });

  it("既定は normal", () => {
    expect(DEFAULT_CONTENT_WIDTH).toBe("normal");
  });

  it("未知値は先頭（narrow）へ寄せる", () => {
    expect(cycleContentWidth("bogus" as ContentWidth)).toBe("narrow");
  });
});

describe("contentWidthToCss（FR-12）", () => {
  it("各プリセットを CSS max-width 値へ変換する", () => {
    expect(contentWidthToCss("narrow")).toBe("680px");
    expect(contentWidthToCss("normal")).toBe("860px");
    expect(contentWidthToCss("wide")).toBe("1100px");
    expect(contentWidthToCss("full")).toBe("none");
  });
});

describe("contentWidthLabel（FR-12）", () => {
  it("各プリセットの日本語ラベルを返す", () => {
    expect(contentWidthLabel("narrow")).toBe("狭");
    expect(contentWidthLabel("normal")).toBe("標準");
    expect(contentWidthLabel("wide")).toBe("広");
    expect(contentWidthLabel("full")).toBe("全幅");
  });
});
