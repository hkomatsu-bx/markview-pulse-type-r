// ローカル画像の遅延埋め込み（描画後の副作用・IPC）。
//
// core/markdown が出力する <img> のうちローカル参照（相対・絶対パス）を、Rust コマンド
// read_image_data_uri で data URI 化して src を差し替える。WebView は相対 URL を配信元
// 基準で解決しローカル画像を表示できないため。data URI はそのまま表示でき、remote
// (http/https) は CSP（img-src 'self' data:）が遮断するため、いずれも触らない。
// remote を許可しないのは、未信頼の .md が外部へ画像を要求するだけで閲覧の事実と
// IP を送出するトラッキングビーコンになるため（遮断された画像は alt が残る）。
// 動的 IPC・DOM 変更という副作用を含むため core ではなく ui 層に置く。
//
// mermaidRenderer と同様、描画のたびに世代（isCurrent）で古い遅延解決を破棄する。
// 欠損・配下外・未対応など個別画像の失敗はダイアログを出さず、ブラウザ同様に壊れ画像
// （alt）を残してマーカークラスを付す（無音ではない＝可視の失敗。文書内の欠損画像ごとに
// モーダルを出すのは過剰なため）。

import { readImageDataUri } from "../core/fs/fileClient";
import { isLocalImageSrc } from "../core/media/imageSrc";

/** 読み込みに失敗したローカル画像へ付すマーカー。 */
export const IMAGE_ERROR_CLASS = "img-load-error";

/**
 * container 内のローカル <img> を data URI へ差し替える。
 *
 * @param mdPath 開いている .md の絶対パス（画像解決の基準）。
 * @param isCurrent 最新世代かを返す。遅延解決の完了時に false なら DOM に触れない。
 * @param cache 画像参照 → data URI のキャッシュ。呼び出し側がタブ単位で保持し、
 *   ファイル変更時に破棄する。渡すと再描画のたびの再読込・再エンコードを避けられる。
 */
export async function loadLocalImages(
  container: HTMLElement,
  mdPath: string,
  isCurrent: () => boolean,
  cache?: Map<string, string>,
): Promise<void> {
  // 分類は percent-decode 後の値で行う。markdown-it は `\\host\share\x.png` を
  // `%5C%5Chost...` へエンコードするため、生の src では UNC 判定が一度も効かない。
  const targets = Array.from(
    container.querySelectorAll<HTMLImageElement>("img"),
  )
    .map((img) => ({ img, ref: decodeSrc(img.getAttribute("src") ?? "") }))
    .filter(({ ref }) => isLocalImageSrc(ref));
  if (targets.length === 0) {
    return;
  }

  await Promise.all(
    targets.map(async ({ img, ref }) => {
      const cached = cache?.get(ref);
      if (cached !== undefined) {
        if (!isCurrent()) return;
        img.setAttribute("src", cached);
        return;
      }
      try {
        const dataUri = await readImageDataUri(mdPath, ref);
        cache?.set(ref, dataUri);
        if (!isCurrent()) return;
        img.setAttribute("src", dataUri);
      } catch {
        if (!isCurrent()) return;
        img.classList.add(IMAGE_ERROR_CLASS);
      }
    }),
  );
}

/** markdown-it が percent-encode した src を実ファイルパスへ戻す。 */
function decodeSrc(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
