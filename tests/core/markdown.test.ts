import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../src/core/markdown";

describe("renderMarkdown", () => {
  it("renders a heading as an h1 element", () => {
    expect(renderMarkdown("# 見出し")).toContain("<h1>見出し</h1>");
  });

  it("renders GFM tables", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |";
    const html = renderMarkdown(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
  });

  // CJK 括弧に隣接した強調が太字になること。
  it("renders bold adjacent to CJK brackets 「**重要**」 (FR-15)", () => {
    const html = renderMarkdown("「**重要**」");
    expect(html).toContain("<strong>重要</strong>");
  });

  it("renders bold adjacent to full-width parens （**注意**） (FR-15)", () => {
    const html = renderMarkdown("（**注意**）");
    expect(html).toContain("<strong>注意</strong>");
  });

  it("does not emit raw HTML (html:false, XSS guard)", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
  });

  it("highlights fenced code blocks for a registered language", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain('class="hljs');
    // `const` がキーワードとしてトークン化される。
    expect(html).toContain("hljs-keyword");
  });

  it("escapes code in an unregistered language fence (no raw HTML)", () => {
    const html = renderMarkdown(
      "```unknownlang\n<script>alert(1)</script>\n```",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
