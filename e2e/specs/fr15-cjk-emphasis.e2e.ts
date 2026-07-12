// CJK 括弧隣接の強調。
//
// 「**重要**」のように CJK 括弧へ隣接する強調記法が <strong> として描画されることを検証する
// （markdown-it の CJK 隣接調整。単体テストでも担保済みだが実機描画でも確認する）。

import { expect } from "@wdio/globals";

import { activateTabByName, previewHtml } from "../helpers/app";

describe("FR-15 CJK 括弧隣接の強調", () => {
  it("「**重要**」が <strong> として描画される", async () => {
    await activateTabByName("preview.md");
    expect(await previewHtml()).toContain("<strong>重要</strong>");
  });
});
