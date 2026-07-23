// ローカル画像の遅延埋め込み（描画後の副作用・IPC）。
//
// core/markdown が出力する <img> のうちローカル参照（相対・絶対パス）を、Rust コマンド
// read_image_data_uri で data URI 化して src を差し替える。WebView は相対 URL を配信元
// 基準で解決しローカル画像を表示できないため。remote(http/https)/data はブラウザが解決
// できるので触らない。動的 IPC・DOM 変更という副作用を含むため core ではなく ui 層に置く。
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
 */
export async function loadLocalImages(
  container: HTMLElement,
  mdPath: string,
  isCurrent: () => boolean,
): Promise<void> {
  const targets = Array.from(
    container.querySelectorAll<HTMLImageElement>("img"),
  ).filter((img) => isLocalImageSrc(img.getAttribute("src") ?? ""));
  if (targets.length === 0) {
    return;
  }

  await Promise.all(
    targets.map(async (img) => {
      const raw = img.getAttribute("src") ?? "";
      // markdown-it は URL を percent-encode するため、実ファイルパスへ戻す。
      let ref: string;
      try {
        ref = decodeURIComponent(raw);
      } catch {
        ref = raw;
      }
      try {
        const dataUri = await readImageDataUri(mdPath, ref);
        if (!isCurrent()) return;
        img.setAttribute("src", dataUri);
      } catch {
        if (!isCurrent()) return;
        img.classList.add(IMAGE_ERROR_CLASS);
      }
    }),
  );
}
