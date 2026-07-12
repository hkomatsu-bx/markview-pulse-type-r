// プレビュー（描画）/ 原文（ソース）の排他 2 値。タブごとに保持する。
// 差分はプレビューに統合した「差分強調トグル」で扱うため、
// モードではなくなった（"diff" を廃止）。

/** タブの表示モード。相互排他。 */
export type ViewMode = "preview" | "source";

/** 既定モード（タブを開いた直後）。 */
export const DEFAULT_VIEW_MODE: ViewMode = "preview";
