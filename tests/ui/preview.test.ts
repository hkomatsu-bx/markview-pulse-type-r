import { describe, it, expect, beforeEach } from "vitest";
import { renderPreview } from "../../src/ui/preview";
import type { Tab } from "../../src/types";

// プレビューは Tab を描画する。原文モードは textContent、プレビューモードは markdown 描画。
// 差分強調が ON かつ previousSource≠source のとき、語差分を span で重ねる（diffDom 経由）。

function makeTab(overrides: Partial<Tab>): Tab {
  return {
    id: "t1",
    path: "C:/docs/a.md",
    fileName: "a.md",
    source: "",
    previousSource: "",
    viewMode: "preview",
    isWatching: false,
    ...overrides,
  };
}

describe("renderPreview", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("article");
  });

  it("renders markdown to HTML in preview mode", () => {
    renderPreview(
      container,
      makeTab({ source: "# 見出し\n\n**重要**な本文" }),
      true,
    );

    expect(container.querySelector("h1")?.textContent).toBe("見出し");
    expect(container.querySelector("strong")?.textContent).toBe("重要");
  });

  it("does not add diff markers when previousSource equals source", () => {
    renderPreview(
      container,
      makeTab({ source: "same", previousSource: "same" }),
      true,
    );

    expect(
      container.querySelectorAll(".diff-added, .diff-removed").length,
    ).toBe(0);
  });

  it("overlays diff markers when diffHighlight is ON and content changed", () => {
    renderPreview(
      container,
      makeTab({
        previousSource: "hello world",
        source: "hello brave world",
      }),
      true,
    );

    expect(container.querySelector(".diff-added")?.textContent).toBe("brave ");
  });

  it("does not overlay diff markers when diffHighlight is OFF", () => {
    renderPreview(
      container,
      makeTab({
        previousSource: "hello world",
        source: "hello brave world",
      }),
      false,
    );

    expect(
      container.querySelectorAll(".diff-added, .diff-removed").length,
    ).toBe(0);
    // 素の markdown は描画される。
    expect(container.textContent).toContain("hello brave world");
  });

  it("ignores diffHighlight in source mode (raw text, no markdown parse)", () => {
    const result = renderPreview(
      container,
      makeTab({
        source: "# 見出し\n\n**重要**",
        previousSource: "x",
        viewMode: "source",
      }),
      true,
    );

    const pre = container.querySelector("pre.source-view");
    expect(pre).not.toBeNull();
    // markdown は解釈されない（原文のまま）。
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
    expect(result.diffDegraded).toBe(false);
  });

  it("renders one .src-line per logical line in source mode (FR-18)", () => {
    renderPreview(
      container,
      makeTab({ source: "# 見出し\n\n**重要**", viewMode: "source" }),
      false,
    );

    const lines = container.querySelectorAll("pre.source-view .src-line");
    expect(lines.length).toBe(3);
    expect(lines[0]?.textContent).toBe("# 見出し");
    expect(lines[1]?.textContent).toBe("");
    expect(lines[2]?.textContent).toBe("**重要**");
  });

  it("does not put line numbers into the copyable text (FR-18)", () => {
    // 行番号は ::before 生成内容で描画され textContent には現れない。
    renderPreview(
      container,
      makeTab({ source: "alpha\nbeta", viewMode: "source" }),
      false,
    );

    const pre = container.querySelector("pre.source-view");
    // 各行の textContent は原文のみ（番号 "1"/"2" を含まない）。
    expect(pre?.textContent).not.toMatch(/\d/);
    expect(pre?.textContent).toContain("alpha");
    expect(pre?.textContent).toContain("beta");
  });

  it("renders an empty <pre> for empty source (FR-18)", () => {
    renderPreview(
      container,
      makeTab({ source: "", viewMode: "source" }),
      false,
    );

    const pre = container.querySelector("pre.source-view");
    expect(pre).not.toBeNull();
    expect(pre?.querySelectorAll(".src-line").length).toBe(0);
  });
});
