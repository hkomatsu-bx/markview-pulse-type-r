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

  it("removes script tags via sanitization (XSS guard)", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
  });

  it("renders safe raw HTML tags (html:true + DOMPurify)", () => {
    const html = renderMarkdown("<div><sub>x</sub> <kbd>Ctrl</kbd></div>");
    expect(html).toContain("<div>");
    expect(html).toContain("<sub>x</sub>");
    expect(html).toContain("<kbd>Ctrl</kbd>");
  });

  it("strips event-handler attributes from raw HTML (XSS guard)", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("strips javascript: URIs from links (XSS guard)", () => {
    const html = renderMarkdown('<a href="javascript:alert(1)">click</a>');
    expect(html).not.toContain("javascript:");
  });

  it("strips target from links so they open in the same context (tabnabbing guard)", () => {
    const html = renderMarkdown(
      '<a href="https://example.com" target="_blank">x</a>',
    );
    expect(html).not.toContain("target");
  });

  it("highlights fenced code blocks for a registered language", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain('class="hljs');
    // `const` がキーワードとしてトークン化される。
    expect(html).toContain("hljs-keyword");
  });

  it("renders leading YAML front matter as a table before the body", () => {
    const html = renderMarkdown("---\ntitle: Hello\n---\n# 本文");
    expect(html).toContain('<table class="front-matter">');
    expect(html).toContain("<th>title</th>");
    // 本文もフロントマターの後に描画される。
    expect(html).toContain("<h1>本文</h1>");
    // FM テーブルが本文見出しより前に置かれる。
    expect(html.indexOf("front-matter")).toBeLessThan(html.indexOf("<h1>"));
  });

  it("leaves documents without front matter unchanged", () => {
    const html = renderMarkdown("# 見出しのみ");
    expect(html).not.toContain("front-matter");
    expect(html).toContain("<h1>見出しのみ</h1>");
  });

  it("escapes code in an unregistered language fence (no raw HTML)", () => {
    const html = renderMarkdown(
      "```unknownlang\n<script>alert(1)</script>\n```",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
