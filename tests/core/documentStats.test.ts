import { describe, it, expect } from "vitest";

import { computeDocumentStats } from "../../src/core/stats/documentStats";

describe("computeDocumentStats（FR-07）", () => {
  it("空文字列は 0 文字・0 行・UTF-8 を返す", () => {
    // Arrange
    const source = "";

    // Act
    const stats = computeDocumentStats(source);

    // Assert
    expect(stats).toEqual({ charCount: 0, lineCount: 0, encoding: "UTF-8" });
  });

  it("ASCII の 1 行を正しく数える", () => {
    const stats = computeDocumentStats("hello");

    expect(stats.charCount).toBe(5);
    expect(stats.lineCount).toBe(1);
  });

  it("CJK 文字をコードポイント単位で数える", () => {
    const stats = computeDocumentStats("日本語テスト");

    expect(stats.charCount).toBe(6);
    expect(stats.lineCount).toBe(1);
  });

  it("絵文字（サロゲートペア）を 1 文字として数える", () => {
    // "😀" は UTF-16 では 2 コードユニットだが 1 コードポイント。
    const stats = computeDocumentStats("a😀b");

    expect(stats.charCount).toBe(3);
  });

  it("複数行を改行数 + 1 で数える", () => {
    const stats = computeDocumentStats("a\nb\nc");

    expect(stats.lineCount).toBe(3);
  });

  it("末尾改行を末尾の空行として数える", () => {
    const stats = computeDocumentStats("a\n");

    expect(stats.lineCount).toBe(2);
  });

  it("エンコーディングは常に UTF-8", () => {
    expect(computeDocumentStats("x").encoding).toBe("UTF-8");
  });
});
