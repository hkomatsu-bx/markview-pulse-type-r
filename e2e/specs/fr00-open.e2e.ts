// ファイルを開く（ダイアログ → 描画）。
//
// 制約: ネイティブファイルピッカーは WebDriver で駆動できない。
//       本スペックは「開く → 描画」経路を CLI 起動引数（get_launch_files）で検証し、
//       「ファイルを開く」ボタンの結線・活性のみを断言する。
//       ピッカー選択自体は手動スモークチェック（aidlc 未解決#1で✅確認済）で担保する。

import { $, expect } from "@wdio/globals";

import { activateTabByName, previewHtml, sel } from "../helpers/app";

describe("FR-00 ファイルを開く（開く→描画）", () => {
  it("CLI 起動で渡したファイルが読み込まれ描画される", async () => {
    await activateTabByName("preview.md");
    expect((await previewHtml()).length).toBeGreaterThan(0);
  });

  it("「ファイルを開く」ボタンが操作可能に結線されている", async () => {
    const button = await $(sel.openFile);
    await expect(button).toBeDisplayed();
    await expect(button).toBeClickable();
    // 注: クリックするとネイティブダイアログが開き WebView を塞ぐため、選択操作は自動化しない。
  });
});
