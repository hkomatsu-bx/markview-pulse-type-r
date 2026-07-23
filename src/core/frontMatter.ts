// フロントマター（YAML）処理。
//
// Markdown 冒頭の `---` で囲まれた YAML ブロックを抽出し、GitHub 風のテーブル HTML へ
// 変換する純粋ロジック。DOM/IO 非依存で単体テスト可能。
// 出力 HTML は最終的に markdown.ts 側で DOMPurify も通過するが、値の HTML エスケープは
// ここでも必ず行う（二重防御。信頼できない .md を開く前提）。

import { load } from "js-yaml";

/** フロントマター抽出結果。data はパース値（マッピング以外や失敗時は null 相当）。 */
export interface FrontMatterResult {
  /** パース済みフロントマター。無し・不正 YAML の場合は null。 */
  readonly data: unknown;
  /** フロントマターを取り除いた本文。無し・不正時は source をそのまま返す。 */
  readonly body: string;
}

// 先頭行の `---\n ... \n---` のみを対象にする。途中の `---`（テーマブレーク）は対象外。
// 閉じ `---` の後は改行または文字列末尾を許容する。
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** YAML の全行コメント（行頭が # の行）を取り除く。実体があるかの判定に使う。 */
function stripYamlComments(yaml: string): string {
  return yaml.replace(/^[ \t]*#.*$/gm, "");
}

/**
 * 先頭のフロントマターを抽出する。
 * 無い場合・YAML パース失敗時は throw せず data:null・body:source を返し、本文を保持する。
 */
export function extractFrontMatter(source: string): FrontMatterResult {
  const match = FRONT_MATTER_RE.exec(source);
  if (!match) {
    return { data: null, body: source };
  }

  const yamlText = match[1] ?? "";
  const body = source.slice(match[0].length);

  // 空・空白・コメントのみのフロントマターは有効な空メタとして扱い、ブロックを取り除く
  // （js-yaml v5 は空文書で throw するため load を通さない）。
  if (stripYamlComments(yamlText).trim() === "") {
    return { data: null, body };
  }

  try {
    const data = load(yamlText);
    // front matter はマッピング（key/value）のみ対象にする。スカラーや配列は front matter と
    // みなさず本文に残す（取り除くと表にもならず内容が消えるため）。
    if (!isRecord(data)) {
      return { data: null, body: source };
    }
    return { data, body };
  } catch {
    // 壊れた YAML で本文が消えないよう、原文をそのまま返す。
    return { data: null, body: source };
  }
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** HTML 特殊文字をエスケープする。 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/** フロントマター値を表示用文字列へ変換する（非スカラーは JSON 文字列化）。 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  // 配列・オブジェクトなど非スカラーは JSON 文字列化して表示する。
  // 循環参照（YAML アンカー等）で JSON.stringify が失敗する場合はプレースホルダを返す。
  try {
    return JSON.stringify(value);
  } catch {
    return "[表示できない値]";
  }
}

/** 値がプレーンなマッピング（key/value を持つオブジェクト）か判定する。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * フロントマターを GitHub 風テーブル HTML へ変換する。
 * トップレベルの key/value のみを行にする。マッピングでない・空の場合は空文字を返す。
 * key/value はいずれも HTML エスケープする。
 */
export function renderFrontMatterTable(data: unknown): string {
  if (!isRecord(data)) {
    return "";
  }

  const rows = Object.entries(data);
  if (rows.length === 0) {
    return "";
  }

  const body = rows
    .map(([key, value]) => {
      const k = escapeHtml(key);
      const v = escapeHtml(formatValue(value));
      return `<tr><th>${k}</th><td>${v}</td></tr>`;
    })
    .join("");

  return `<table class="front-matter"><tbody>${body}</tbody></table>`;
}
