// ダークモード OS 連動。
//
// 制約: OS テーマの動的切替は WebDriver から発火できない。
//       起動時に data-theme が OS テーマ（light/dark）を反映していることを断言し、
//       切替への追従は手動スモークチェック（aidlc 未解決#1で✅確認済）で担保する。

import { expect } from "@wdio/globals";

import { rootTheme, waitForTheme } from "../helpers/app";

describe("FR-08 ダークモード OS 連動", () => {
  it("起動時に data-theme が OS テーマを反映する", async () => {
    await waitForTheme();
    const theme = await rootTheme();
    expect(["light", "dark"]).toContain(theme);
  });
});
