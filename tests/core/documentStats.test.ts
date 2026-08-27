import { describe, it, expect } from "vitest";

import { computeDocumentStats } from "../../src/core/stats/documentStats";
import { splitSourceLines } from "../../src/core/view/sourceLines";

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

  it("末尾改行は行終端子として扱い、行を増やさない", () => {
    // 原文ビューの行番号（splitSourceLines）と同じ定義。ここが食い違うと
    // 「行数 2」なのに行番号は 1 までしか出ない、という矛盾が同じ画面に出る。
    const stats = computeDocumentStats("a\n");

    expect(stats.lineCount).toBe(1);
    expect(splitSourceLines("a\n")).toHaveLength(1);
  });

  it("行数は常に原文ビューの最終行番号と一致する", () => {
    for (const source of ["a", "a\n", "a\nb", "a\nb\n", "a\n\nb\n", "\n"]) {
      expect(computeDocumentStats(source).lineCount).toBe(
        splitSourceLines(source).length,
      );
    }
  });

  it("エンコーディングは常に UTF-8", () => {
    expect(computeDocumentStats("x").encoding).toBe("UTF-8");
  });
});
