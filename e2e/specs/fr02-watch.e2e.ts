// ファイル変更の自動検知 → 更新。
//
// 外部プロセス（ここでは Node fs）がファイルを書き換えると、本番の実 watcher
// （notify / ポーリング fallback）が検知し file-changed を発火、プレビューが自動更新される。
// 実ファイル監視を本番経路で検証する点が tauri-driver E2E の最大価値（Playwright では不可）。

import { expect } from "@wdio/globals";

import {
  activateTabByName,
  previewHtml,
  waitForPreviewContains,
} from "../helpers/app";
import { resetFixture, writeFixture } from "../helpers/fixtures";

describe("FR-02 ファイル変更の自動検知→更新", () => {
  // 実行順に依存しないよう毎回テンプレート内容へ戻す。
  before(() => {
    resetFixture("watch.md");
  });

  it("外部からのファイル変更がプレビューへ自動反映される", async () => {
    await activateTabByName("watch.md");
    await waitForPreviewContains("WATCH_BASELINE");

    writeFixture("watch.md", "# WATCH_UPDATED\n\n外部変更が自動反映された。\n");

    // waitUntil がタイムアウトで throw するため、到達＝検知成功。到達後に内容も確認する。
    await waitForPreviewContains("WATCH_UPDATED");
    expect(await previewHtml()).toContain("WATCH_UPDATED");
  });
});
