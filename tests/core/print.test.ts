import { describe, it, expect } from "vitest";
import {
  pdfTitleFromFileName,
  buildPrintPageStyle,
} from "../../src/core/print";

// AAA パターン（Arrange-Act-Assert）。印刷補助は純関数のため DOM 不要。

describe("pdfTitleFromFileName", () => {
  it("strips a trailing .md extension", () => {
    expect(pdfTitleFromFileName("README.md")).toBe("README");
  });

  it("strips a trailing .markdown extension", () => {
    expect(pdfTitleFromFileName("notes.markdown")).toBe("notes");
  });

  it("strips the extension case-insensitively", () => {
    expect(pdfTitleFromFileName("Guide.MD")).toBe("Guide");
  });

  it("removes only the final extension", () => {
    expect(pdfTitleFromFileName("a.md.md")).toBe("a.md");
  });

  it("returns the name unchanged when it has no markdown extension", () => {
    expect(pdfTitleFromFileName("changelog")).toBe("changelog");
    expect(pdfTitleFromFileName("data.txt")).toBe("data.txt");
  });

  it("does not strip a non-trailing markdown-like segment", () => {
    expect(pdfTitleFromFileName("md")).toBe("md");
    expect(pdfTitleFromFileName(".markdown")).toBe("");
  });
});

describe("buildPrintPageStyle", () => {
  it("embeds the file name into the @page @top-center content", () => {
    expect(buildPrintPageStyle("README.md")).toBe(
      '@page { @top-center { content: "README.md"; } }',
    );
  });

  it("escapes double quotes in the file name", () => {
    expect(buildPrintPageStyle('a"b.md')).toBe(
      '@page { @top-center { content: "a\\"b.md"; } }',
    );
  });

  it("escapes backslashes in the file name", () => {
    expect(buildPrintPageStyle("a\\b.md")).toBe(
      '@page { @top-center { content: "a\\\\b.md"; } }',
    );
  });

  it("normalizes control characters to spaces", () => {
    expect(buildPrintPageStyle("a\nb\tc.md")).toBe(
      '@page { @top-center { content: "a b c.md"; } }',
    );
  });

  it("preserves multibyte (CJK) characters", () => {
    expect(buildPrintPageStyle("設計書.md")).toBe(
      '@page { @top-center { content: "設計書.md"; } }',
    );
  });
});
