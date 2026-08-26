import { describe, it, expect } from "vitest";
import {
  pdfTitleFromFileName,
  pdfFileNameFromFileName,
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

describe("pdfFileNameFromFileName", () => {
  it("replaces a markdown extension with .pdf", () => {
    expect(pdfFileNameFromFileName("README.md")).toBe("README.pdf");
    expect(pdfFileNameFromFileName("notes.markdown")).toBe("notes.pdf");
  });

  it("appends .pdf when the name has no markdown extension", () => {
    expect(pdfFileNameFromFileName("changelog")).toBe("changelog.pdf");
  });
});
