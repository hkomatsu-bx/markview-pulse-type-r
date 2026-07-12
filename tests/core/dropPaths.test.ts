import { describe, it, expect } from "vitest";

import { filterMarkdownPaths } from "../../src/core/fs/dropPaths";

describe("filterMarkdownPaths（FR-09）", () => {
  it(".md / .markdown を抽出する", () => {
    // Arrange
    const paths = ["a.md", "b.markdown", "c.txt", "d.png"];

    // Act
    const result = filterMarkdownPaths(paths);

    // Assert
    expect(result).toEqual(["a.md", "b.markdown"]);
  });

  it("拡張子の大文字小文字を無視する", () => {
    const result = filterMarkdownPaths(["A.MD", "B.Markdown"]);

    expect(result).toEqual(["A.MD", "B.Markdown"]);
  });

  it("Markdown を含まないドロップは空配列を返す", () => {
    expect(filterMarkdownPaths(["a.txt", "b.docx"])).toEqual([]);
  });

  it("重複パスは入力順を保って除去する", () => {
    const result = filterMarkdownPaths(["a.md", "b.md", "a.md"]);

    expect(result).toEqual(["a.md", "b.md"]);
  });

  it("空配列は空配列を返す", () => {
    expect(filterMarkdownPaths([])).toEqual([]);
  });

  it("Windows フルパスでも判定できる", () => {
    const result = filterMarkdownPaths([
      "C:\\docs\\readme.md",
      "C:\\docs\\image.jpg",
    ]);

    expect(result).toEqual(["C:\\docs\\readme.md"]);
  });
});
