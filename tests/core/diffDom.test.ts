import { describe, it, expect, beforeEach } from "vitest";
import { extractText, renderDiff } from "../../src/core/diff/diffDom";

// AAA パターン。jsdom 環境（vitest.config.ts で既定）でテキストノード走査を検証する。
// 案B（高忠実度）：現在の描画 DOM の書式を保ったまま差分 span を重ねる。

function el(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("extractText", () => {
  it("concatenates text nodes across nested elements in document order", () => {
    const root = el("<p>Hello <strong>brave</strong> world</p>");
    expect(extractText(root)).toBe("Hello brave world");
  });

  it("returns empty string for an empty root", () => {
    expect(extractText(el(""))).toBe("");
  });
});

describe("renderDiff", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("adds no diff markers when previous and next are identical", () => {
    renderDiff(container, "<p>hello world</p>", "<p>hello world</p>");

    expect(container.querySelectorAll(".diff-added").length).toBe(0);
    expect(container.querySelectorAll(".diff-removed").length).toBe(0);
    expect(extractText(container)).toBe("hello world");
  });

  it("wraps inserted text in span.diff-added and keeps current text intact", () => {
    renderDiff(container, "<p>hello world</p>", "<p>hello brave world</p>");

    const added = container.querySelectorAll(".diff-added");
    expect(added.length).toBe(1);
    expect(added[0]!.textContent).toBe("brave ");
    // 挿入分は現在側に存在するので、現在 DOM 全文は next と一致する。
    expect(extractText(container)).toBe("hello brave world");
  });

  it("injects deleted text as span.diff-removed without changing current words", () => {
    renderDiff(container, "<p>hello brave world</p>", "<p>hello world</p>");

    const removed = container.querySelectorAll(".diff-removed");
    expect(removed.length).toBe(1);
    expect(removed[0]!.textContent).toBe("brave ");
    // 削除分は注釈として重ねるだけ。現在語（hello/world）は保持される。
    const text = extractText(container);
    expect(text).toContain("hello");
    expect(text).toContain("world");
  });

  it("preserves inline formatting while overlaying an insertion (案B 高忠実度)", () => {
    renderDiff(
      container,
      "<p>note</p>",
      "<p>note <strong>important</strong></p>",
    );

    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    // 強調要素を残したまま、その内部に差分 span を重ねる。
    const addedInsideStrong = strong?.querySelector(".diff-added");
    expect(addedInsideStrong?.textContent).toBe("important");
  });

  it("represents a full replacement as removed + added", () => {
    renderDiff(container, "<p>foo</p>", "<p>bar</p>");

    expect(container.querySelector(".diff-removed")?.textContent).toBe("foo");
    expect(container.querySelector(".diff-added")?.textContent).toBe("bar");
  });

  it("signals degraded=false for normal-sized input", () => {
    const result = renderDiff(container, "<p>a</p>", "<p>b</p>");
    expect(result.degraded).toBe(false);
  });
});

describe("renderDiff — テーブルのセル単位差分（FR-11）", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("highlights only the changed cell (L0) and leaves unchanged cells intact", () => {
    renderDiff(
      container,
      "<table><tbody><tr><td>name</td><td>30</td></tr></tbody></table>",
      "<table><tbody><tr><td>name</td><td>31</td></tr></tbody></table>",
    );

    const cells = container.querySelectorAll("td");
    // 1 列目（name）は無加工。
    expect(cells[0]?.querySelector(".diff-added, .diff-removed")).toBeNull();
    // 2 列目（30→31）はセル内に緑/赤が入る。
    expect(cells[1]?.querySelector(".diff-added")?.textContent).toBe("31");
    expect(cells[1]?.querySelector(".diff-removed")?.textContent).toBe("30");
  });

  it("falls back to global text diff (L2) when column count changes", () => {
    renderDiff(
      container,
      "<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>",
      "<table><tbody><tr><td>a</td><td>b</td><td>c</td></tr></tbody></table>",
    );

    // 列数相違 → セル対応を諦め、表全体がテキスト差分として強調される。
    expect(container.querySelector(".diff-added")).not.toBeNull();
  });

  it("does not double-apply: table cells and surrounding text each get one set", () => {
    renderDiff(
      container,
      "<p>foo</p><table><tbody><tr><td>x</td></tr></tbody></table>",
      "<p>bar</p><table><tbody><tr><td>y</td></tr></tbody></table>",
    );

    // 段落 foo→bar とセル x→y の 2 箇所だけ（表の二重適用なし）。
    expect(container.querySelectorAll(".diff-added").length).toBe(2);
    expect(container.querySelectorAll(".diff-removed").length).toBe(2);
    const paragraph = container.querySelector("p");
    expect(paragraph?.querySelector(".diff-added")?.textContent).toBe("bar");
    const cell = container.querySelector("td");
    expect(cell?.querySelector(".diff-added")?.textContent).toBe("y");
  });

  it("inserts a phantom removed row for a deleted table row (L1)", () => {
    renderDiff(
      container,
      "<table><tbody><tr><td>a</td></tr><tr><td>b</td></tr></tbody></table>",
      "<table><tbody><tr><td>b</td></tr></tbody></table>",
    );

    const phantom = container.querySelector("tr.diff-removed-row");
    expect(phantom).not.toBeNull();
    expect(phantom?.textContent).toContain("a");
    expect(phantom?.getAttribute("aria-hidden")).toBe("true");
  });

  it("pairs content tables by index regardless of front-matter table presence", () => {
    // prev には本文表のみ、next には先頭にフロントマター表が加わるケース。
    renderDiff(
      container,
      "<table><tbody><tr><td>name</td><td>30</td></tr></tbody></table>",
      '<table class="front-matter"><tbody><tr><th>title</th><td>x</td></tr></tbody></table>' +
        "<table><tbody><tr><td>name</td><td>31</td></tr></tbody></table>",
    );

    // FM 表を対応付けから除外するので、本文表(30→31)が正しくセル差分になる。
    const contentTable = container.querySelector("table:not(.front-matter)");
    expect(contentTable?.querySelector(".diff-added")?.textContent).toBe("31");
    expect(contentTable?.querySelector(".diff-removed")?.textContent).toBe(
      "30",
    );
  });
});

describe("renderDiff — mermaid ブロックは不可分（差分 span を注入しない）", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("leaves pre.mermaid free of diff spans on an insert-only change", () => {
    // 行追加のみの差分。従来は diff-added span がブロック内に残り mermaid が壊れていた。
    renderDiff(
      container,
      '<pre class="mermaid">graph TD\nA--&gt;B</pre>',
      '<pre class="mermaid">graph TD\nA--&gt;B\nB--&gt;C</pre>',
    );

    const pre = container.querySelector("pre.mermaid");
    expect(pre).not.toBeNull();
    expect(pre?.querySelector(".diff-added, .diff-removed")).toBeNull();
    // innerHTML から読む mermaid が原文をそのまま得られる。
    expect(pre?.textContent).toBe("graph TD\nA-->B\nB-->C");
  });

  it("leaves pre.mermaid free of diff spans on a delete change", () => {
    renderDiff(
      container,
      '<pre class="mermaid">graph TD\nA--&gt;B\nB--&gt;C</pre>',
      '<pre class="mermaid">graph TD\nA--&gt;B</pre>',
    );

    const pre = container.querySelector("pre.mermaid");
    expect(pre?.querySelector(".diff-added, .diff-removed")).toBeNull();
    expect(pre?.textContent).toBe("graph TD\nA-->B");
  });
});
