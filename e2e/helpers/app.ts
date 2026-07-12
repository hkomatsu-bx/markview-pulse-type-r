// E2E 共通セレクタとアプリ操作ヘルパー。
//
// セレクタは index.html / 各 UI レンダラの DOM 契約に対応する。
// プレビュー内容・テーマの読み出しは API ドリフトを避けるため browser.execute で直接取得する。

import { browser, $$ } from "@wdio/globals";

/** DOM 契約に対応するセレクタ（index.html / tabBar.ts / toolbar.ts）。 */
export const sel = {
  openFile: "#open-file",
  modePreview: "#mode-preview",
  modeDiff: "#mode-diff",
  tabbar: "#tabbar",
  tab: ".tab",
  tabName: ".tab-name",
  tabClose: ".tab-close",
  activeTab: ".tab.is-active",
  preview: "#preview",
  emptyState: "#empty-state",
} as const;

/** プレビュー領域の innerHTML を取得する。 */
export async function previewHtml(): Promise<string> {
  return browser.execute(
    () => document.querySelector("#preview")?.innerHTML ?? "",
  );
}

/** ルート要素の data-theme を取得する。 */
export async function rootTheme(): Promise<string | null> {
  return browser.execute(() =>
    document.documentElement.getAttribute("data-theme"),
  );
}

/** プレビューに指定テキストが現れるまで待機する（非同期描画・再読込に対応）。 */
export async function waitForPreviewContains(
  text: string,
  timeout = 15000,
): Promise<void> {
  await browser.waitUntil(async () => (await previewHtml()).includes(text), {
    timeout,
    timeoutMsg: `preview に "${text}" が現れませんでした`,
  });
}

/** 表示中のタブ数を返す。 */
export async function tabCount(): Promise<number> {
  return (await $$(sel.tab)).length;
}

/** 指定名のタブが描画されるまで待つ（起動時の非同期オープン＝get_launch_files→render に対応）。 */
async function waitForTabByName(name: string, timeout = 15000): Promise<void> {
  await browser.waitUntil(
    async () => {
      const labels = await $$(sel.tabName);
      for (const label of labels) {
        if ((await label.getText()) === name) {
          return true;
        }
      }
      return false;
    },
    { timeout, timeoutMsg: `タブが見つかりません: ${name}` },
  );
}

/** 指定ファイル名のタブをクリックしてアクティブにする（出現を待ってからクリック）。 */
export async function activateTabByName(name: string): Promise<void> {
  await waitForTabByName(name);
  const labels = await $$(sel.tabName);
  for (const label of labels) {
    if ((await label.getText()) === name) {
      await label.click();
      return;
    }
  }
  throw new Error(`タブが見つかりません: ${name}`);
}

/** タブ数が min 以上になるまで待つ（起動時の複数ファイル非同期オープンに対応）。 */
export async function waitForMinTabs(
  min: number,
  timeout = 15000,
): Promise<void> {
  await browser.waitUntil(async () => (await tabCount()) >= min, {
    timeout,
    timeoutMsg: `タブ数が ${min} 以上になりませんでした`,
  });
}

/** data-theme が有効値（light/dark）に設定されるまで待つ（テーマ追従の非同期適用に対応）。 */
export async function waitForTheme(timeout = 15000): Promise<void> {
  await browser.waitUntil(
    async () => {
      const t = await rootTheme();
      return t === "light" || t === "dark";
    },
    { timeout, timeoutMsg: "data-theme が設定されませんでした" },
  );
}
