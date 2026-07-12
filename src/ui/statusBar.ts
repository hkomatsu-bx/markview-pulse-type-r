// ステータスバー。
//
// アクティブタブの統計（文字数/行数/エンコーディング）を表示する純粋描画関数。
// 状態は持たず、DocumentStats を受け取って container に反映する。

import type { DocumentStats } from "../core/stats/documentStats";

/** ラベル付きの統計項目を生成する。 */
function statItem(testId: string, label: string, value: string): HTMLElement {
  const item = document.createElement("span");
  item.className = "statusbar-item";
  item.dataset.testid = testId;
  const labelEl = document.createElement("span");
  labelEl.className = "statusbar-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "statusbar-value";
  valueEl.textContent = value;
  item.append(labelEl, valueEl);
  return item;
}

/** 左側のファイルパス表示を生成する。長パスは CSS で省略し、全体は title に保持する。 */
function pathItem(filePath: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "statusbar-path";
  el.dataset.testid = "status-path";
  el.textContent = filePath;
  el.title = filePath;
  return el;
}

/** 右側の統計グループ（文字数/行数/エンコーディング）を生成する。 */
function statsGroup(stats: DocumentStats): HTMLElement {
  const group = document.createElement("span");
  group.className = "statusbar-stats";
  group.dataset.testid = "status-stats";
  group.append(
    statItem(
      "status-char-count",
      "文字数",
      stats.charCount.toLocaleString("ja-JP"),
    ),
    statItem(
      "status-line-count",
      "行数",
      stats.lineCount.toLocaleString("ja-JP"),
    ),
    statItem("status-encoding", "エンコーディング", stats.encoding),
  );
  return group;
}

/**
 * ステータスバーを描画する。タブ未選択（stats が null）時は非表示。
 * 左にファイルパス、右に統計を配置する。文字列はすべて textContent で設定し、
 * HTML 注入面を作らない（パスも外部由来のためエスケープを徹底）。
 */
export function renderStatusBar(
  container: HTMLElement,
  stats: DocumentStats | null,
  filePath: string | null,
): void {
  if (!stats) {
    container.classList.add("hidden");
    container.replaceChildren();
    return;
  }
  container.classList.remove("hidden");
  // パスは left、統計は right。filePath が無い場合はパスを省略する。
  const children = filePath
    ? [pathItem(filePath), statsGroup(stats)]
    : [statsGroup(stats)];
  container.replaceChildren(...children);
}

/** 縮退通知の data-testid。 */
const NOTICE_TESTID = "status-notice";

/**
 * ステータスバーへ非モーダルの一時通知を表示する（差分強調の縮退など）。
 * renderStatusBar の後に呼ぶこと（renderStatusBar は replaceChildren で全消去するため）。
 * message が null なら既存の通知を取り除く。エラーではなく情報表示（reportError は使わない）。
 */
export function setStatusNotice(
  container: HTMLElement,
  message: string | null,
): void {
  const existing = container.querySelector(`[data-testid="${NOTICE_TESTID}"]`);
  if (existing) {
    existing.remove();
  }
  if (message === null) {
    return;
  }
  const notice = document.createElement("span");
  notice.className = "statusbar-notice";
  notice.dataset.testid = NOTICE_TESTID;
  notice.setAttribute("role", "status");
  notice.textContent = message;
  container.appendChild(notice);
}
