// Markdown 描画。
//
// markdown-it を GFM 寄せで構成する。
// html:false は生 HTML を無効化し XSS 面を閉じる（信頼できない .md を開く前提）。
// CJK 括弧隣接の `「**重要**」` は markdown-it の左右フランキング規則で
// 正しく強調されるため、前処理は不要。
//
// コードブロックは highlight.js で色付けする。バンドル肥大を避けるためコアのみ取り込み、
// よく使う言語だけを明示登録する（未登録言語はエスケープのみで素通し）。
// トークン色は styles.css 側で CSS 変数により明暗テーマへ追従させる。

import MarkdownIt from "markdown-it";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import sql from "highlight.js/lib/languages/sql";
import diff from "highlight.js/lib/languages/diff";

// registerLanguage は各言語定義の alias（js/ts/py/sh/html…）も同時に登録する。
const LANGUAGES: readonly (readonly [string, LanguageFn])[] = [
  ["javascript", javascript],
  ["typescript", typescript],
  ["json", json],
  ["bash", bash],
  ["python", python],
  ["rust", rust],
  ["xml", xml],
  ["css", css],
  ["markdown", markdown],
  ["yaml", yaml],
  ["sql", sql],
  ["diff", diff],
];

type LanguageFn = Parameters<typeof hljs.registerLanguage>[1];

for (const [name, fn] of LANGUAGES) {
  hljs.registerLanguage(name, fn);
}

/**
 * フェンス付きコードブロックを色付けする。
 * 登録済み言語のみ highlight.js に通し、未登録・失敗時は空文字を返して
 * markdown-it 側の既定エスケープへ委ねる（生 HTML の混入を防ぐ）。
 */
function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      const { value } = hljs.highlight(code, {
        language: lang,
        ignoreIllegals: true,
      });
      return `<pre class="hljs"><code class="hljs language-${lang}">${value}</code></pre>`;
    } catch {
      // 失敗時はフォールスルーし、既定エスケープへ委ねる。
    }
  }
  return "";
}

/** markdown-it インスタンスを生成する。設定を 1 か所に集約する。 */
function createMarkdownRenderer(): MarkdownIt {
  return new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
    highlight: highlightCode,
  });
}

const renderer = createMarkdownRenderer();

/** Markdown ソースを安全な HTML 文字列へ描画する。 */
export function renderMarkdown(source: string): string {
  return renderer.render(source);
}
