import { describe, it, expect } from "vitest";
import { diff } from "../../src/core/diff/diffEngine";

// AAA パターン（Arrange-Act-Assert）。差分エンジンは純関数のため UI 不要。

describe("diff", () => {
  it("returns empty array for two empty strings", () => {
    expect(diff("", "")).toEqual([]);
  });

  it("returns a single equal op when texts are identical", () => {
    const result = diff("hello world", "hello world");
    expect(result).toEqual([{ kind: "equal", text: "hello world" }]);
  });

  it("marks an inserted word as insert", () => {
    const result = diff("hello world", "hello brave world");
    expect(result).toEqual([
      { kind: "equal", text: "hello " },
      { kind: "insert", text: "brave " },
      { kind: "equal", text: "world" },
    ]);
  });

  it("marks a deleted word as delete", () => {
    const result = diff("hello brave world", "hello world");
    expect(result).toEqual([
      { kind: "equal", text: "hello " },
      { kind: "delete", text: "brave " },
      { kind: "equal", text: "world" },
    ]);
  });

  it("represents a full replacement as delete then insert", () => {
    const result = diff("foo", "bar");
    expect(result).toEqual([
      { kind: "delete", text: "foo" },
      { kind: "insert", text: "bar" },
    ]);
  });

  it("treats insertion into empty previous as pure insert", () => {
    expect(diff("", "new text")).toEqual([
      { kind: "insert", text: "new text" },
    ]);
  });

  it("handles CJK content at word granularity", () => {
    const result = diff("これは 重要 です", "これは とても 重要 です");
    const reconstructedNext = result
      .filter((op) => op.kind !== "delete")
      .map((op) => op.text)
      .join("");
    const reconstructedPrev = result
      .filter((op) => op.kind !== "insert")
      .map((op) => op.text)
      .join("");
    expect(reconstructedNext).toBe("これは とても 重要 です");
    expect(reconstructedPrev).toBe("これは 重要 です");
  });
});
