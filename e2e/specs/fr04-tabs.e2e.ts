// タブ UI（追加/切替/クローズ）。
//
// 制約: ネイティブダイアログからの新規追加は WebDriver で駆動不可。
//       複数ファイル CLI 起動で多タブ描画を用意し、切替・クローズを自動検証する。
//       ダイアログ経由の追加は手動スモークチェックで担保する。

import { $, $$, browser, expect } from "@wdio/globals";

import {
  activateTabByName,
  sel,
  tabCount,
  waitForMinTabs,
} from "../helpers/app";

describe("FR-04 タブ UI（切替/クローズ）", () => {
  it("複数ファイル起動で複数タブが描画される", async () => {
    await waitForMinTabs(2);
    expect(await tabCount()).toBeGreaterThanOrEqual(2);
  });

  it("タブをクリックすると切り替わる", async () => {
    await activateTabByName("preview.md");
    const activeName = await $(`${sel.activeTab} ${sel.tabName}`);
    expect(await activeName.getText()).toBe("preview.md");
  });

  it("× ボタンでタブを閉じられる", async () => {
    const before = await tabCount();
    await activateTabByName("second.md");
    await $(`${sel.activeTab} ${sel.tabClose}`).click();

    await browser.waitUntil(async () => (await tabCount()) === before - 1, {
      timeoutMsg: "タブが閉じられませんでした",
    });
    expect((await $$(sel.tab)).length).toBe(before - 1);
  });
});
