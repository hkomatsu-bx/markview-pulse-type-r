import { describe, it, expect } from "vitest";
import {
  extractFrontMatter,
  renderFrontMatterTable,
} from "../../src/core/frontMatter";

describe("extractFrontMatter", () => {
  it("extracts leading front matter and returns the remaining body", () => {
    const src = "---\ntitle: Hello\nauthor: Alice\n---\n# 本文\n";
    const { data, body } = extractFrontMatter(src);
    expect(data).toEqual({ title: "Hello", author: "Alice" });
    expect(body).toBe("# 本文\n");
  });

  it("handles a closing delimiter at end of input without trailing newline", () => {
    const src = "---\ntitle: Hello\n---";
    const { data, body } = extractFrontMatter(src);
    expect(data).toEqual({ title: "Hello" });
    expect(body).toBe("");
  });

  it("tolerates CRLF line endings", () => {
    const src = "---\r\ntitle: Hello\r\n---\r\nbody\r\n";
    const { data, body } = extractFrontMatter(src);
    expect(data).toEqual({ title: "Hello" });
    expect(body).toBe("body\r\n");
  });

  it("returns null data and the original source when there is no front matter", () => {
    const src = "# 見出し\n\n本文です。";
    const { data, body } = extractFrontMatter(src);
    expect(data).toBeNull();
    expect(body).toBe(src);
  });

  it("ignores a '---' that is not at the very start (thematic break)", () => {
    const src = "本文\n\n---\ntitle: x\n---\n";
    const { data, body } = extractFrontMatter(src);
    expect(data).toBeNull();
    expect(body).toBe(src);
  });

  it("keeps the body intact when the YAML is invalid (no throw)", () => {
    const src = "---\ntitle: : : broken\n  bad indent\n---\n# 本文\n";
    const { data, body } = extractFrontMatter(src);
    expect(data).toBeNull();
    expect(body).toBe(src);
  });

  it("returns null data for empty front matter", () => {
    const src = "---\n\n---\nbody\n";
    const { data, body } = extractFrontMatter(src);
    expect(data).toBeNull();
    expect(body).toBe("body\n");
  });
});

describe("renderFrontMatterTable", () => {
  it("renders top-level key/value pairs as a front-matter table", () => {
    const html = renderFrontMatterTable({ title: "Hello", draft: false });
    expect(html).toContain('<table class="front-matter">');
    expect(html).toContain("<th>title</th><td>Hello</td>");
    expect(html).toContain("<th>draft</th><td>false</td>");
  });

  it("escapes HTML in keys and values (XSS guard)", () => {
    const html = renderFrontMatterTable({
      "<b>k</b>": '<img src=x onerror="alert(1)">',
    });
    expect(html).not.toContain("<b>k</b>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;b&gt;k&lt;/b&gt;");
    expect(html).toContain("&lt;img");
  });

  it("stringifies non-scalar values (arrays / objects)", () => {
    const html = renderFrontMatterTable({
      tags: ["a", "b"],
      meta: { x: 1 },
    });
    expect(html).toContain(
      "<th>tags</th><td>[&quot;a&quot;,&quot;b&quot;]</td>",
    );
    expect(html).toContain("<th>meta</th>");
    expect(html).toContain("&quot;x&quot;:1");
  });

  it("returns an empty string for non-mapping data", () => {
    expect(renderFrontMatterTable("just a string")).toBe("");
    expect(renderFrontMatterTable(["a", "b"])).toBe("");
    expect(renderFrontMatterTable(null)).toBe("");
    expect(renderFrontMatterTable(42)).toBe("");
  });

  it("returns an empty string for an empty mapping", () => {
    expect(renderFrontMatterTable({})).toBe("");
  });
});
