// インライン差分表示（書式保持・案B）。
//
// ファイル変更で previousSource(旧) / source(新) が確定した後、差分モードへ切り替えると
// 追加/削除箇所が span.diff-added / span.diff-removed として強調表示される。

import { $, browser, expect } from "@wdio/globals";

import {
  activateTabByName,
  previewHtml,
  sel,
  waitForPreviewContains,
} from "../helpers/app";
import { resetFixture, writeFixture } from "../helpers/fixtures";

describe("FR-03 インライン差分表示", () => {
  before(() => {
    resetFixture("watch.md");
  });

  it("変更後に差分モードで追加/削除が強調表示される", async () => {
    await activateTabByName("watch.md");
    await waitForPreviewContains("WATCH_BASELINE");

    // 見出しは維持し段落を追記して差分（insert）を作る。
    writeFixture("watch.md", "# WATCH_BASELINE\n\n差分用に追記された段落。\n");
    await waitForPreviewContains("差分用に追記された段落");

    await $(sel.modeDiff).click();

    await browser.waitUntil(
      async () => /diff-(added|removed)/.test(await previewHtml()),
      { timeoutMsg: "差分注釈(.diff-added/.diff-removed)が現れませんでした" },
    );
    expect(await previewHtml()).toMatch(/diff-(added|removed)/);
  });
});
