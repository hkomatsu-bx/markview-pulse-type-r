// mermaid ブロックの DOM 表現。
//
// markdown.ts が出力するクラス名を diffDom・main・mermaidRenderer がセレクタで
// 拾う。型検査の効かない文字列で結ばれた契約のため、片側だけ変えても壊れたことに
// 気づけない（図が描かれず差分 span が混入するだけで、例外は出ない）。
// 定数を共有して必ず同時に変わるようにする。

/** mermaid フェンスの描画先要素に付くクラス名。 */
export const MERMAID_BLOCK_CLASS = "mermaid";

/** 未描画の mermaid ブロックを選ぶセレクタ。 */
export const MERMAID_BLOCK_SELECTOR = `pre.${MERMAID_BLOCK_CLASS}`;
