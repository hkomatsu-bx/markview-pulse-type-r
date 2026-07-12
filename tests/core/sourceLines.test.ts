import { describe, it, expect } from "vitest";
import { splitSourceLines } from "../../src/core/view/sourceLines";

// 原文の論理行分割。末尾改行は行を増やさず、文中の空行は保持する。

describe("splitSourceLines", () => {
  it("splits on newline", () => {
    expect(splitSourceLines("a\nb")).toEqual(["a", "b"]);
  });

  it("does not count a trailing newline as an extra line", () => {
    expect(splitSourceLines("a\nb\n")).toEqual(["a", "b"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(splitSourceLines("")).toEqual([]);
  });

  it("preserves blank lines inside the text", () => {
    expect(splitSourceLines("a\n\nb")).toEqual(["a", "", "b"]);
  });

  it("preserves a genuine trailing blank line before the terminator", () => {
    // 「a」「空行」の 2 行＋末尾改行。末尾改行ぶんだけ落とす。
    expect(splitSourceLines("a\n\n")).toEqual(["a", ""]);
  });

  it("normalizes CRLF to LF before splitting", () => {
    expect(splitSourceLines("a\r\nb\r\n")).toEqual(["a", "b"]);
  });

  it("treats a single line without newline as one line", () => {
    expect(splitSourceLines("solo")).toEqual(["solo"]);
  });

  it("treats a lone newline as a single empty line", () => {
    expect(splitSourceLines("\n")).toEqual([""]);
  });
});
