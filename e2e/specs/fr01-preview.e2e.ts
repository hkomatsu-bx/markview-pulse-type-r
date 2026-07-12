// リアルタイムプレビュー。
//
// 開いた Markdown が markdown-it により HTML として描画されることを検証する。

import { expect } from "@wdio/globals";

import { activateTabByName, previewHtml } from "../helpers/app";

describe("FR-01 リアルタイムプレビュー", () => {
  it("Markdown が HTML 要素として描画される", async () => {
    await activateTabByName("preview.md");
    const html = await previewHtml();
    expect(html).toContain("<h1>");
    expect(html).toContain("</p>");
    expect(html).toContain("<strong>リアルタイムプレビュー</strong>");
  });
});
