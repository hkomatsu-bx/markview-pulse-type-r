// E2E フィクスチャ管理。
//
// テンプレート Markdown を OS 一時ディレクトリへ複製し、tauri-driver の
// 起動引数（CLI 起動経路 = get_launch_files）として渡す。変更系スペックは
// ここから一時ファイルを書き換えてファイル監視を発火させる。
// 本番アプリの実ファイル IO・実 watcher をそのまま検証する点が tauri-driver E2E の核心。

import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(HERE, "..", "fixtures", "templates");

/** 一時作業ディレクトリ（毎セッション開始時に再生成する）。 */
export const FIXTURE_DIR = join(tmpdir(), "markview-e2e-fixtures");

/** 起動時に開くフィクスチャ名（順序がタブ並び順になる）。 */
export const FIXTURE_NAMES = ["preview.md", "watch.md", "second.md"] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

/** フィクスチャの一時パスを返す。 */
export function fixturePath(name: FixtureName): string {
  return join(FIXTURE_DIR, name);
}

/** tauri-driver へ渡す起動引数（全フィクスチャの絶対パス）。 */
export const LAUNCH_FILES: readonly string[] = FIXTURE_NAMES.map(fixturePath);

/** テンプレートから一時ディレクトリへフィクスチャを複製する（onPrepare で呼ぶ）。 */
export function prepareFixtures(): void {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  for (const name of FIXTURE_NAMES) {
    cpSync(join(TEMPLATE_DIR, name), fixturePath(name));
  }
}

/** テンプレートの原本内容を読み出す。 */
export function readTemplate(name: FixtureName): string {
  return readFileSync(join(TEMPLATE_DIR, name), "utf8");
}

/** フィクスチャをテンプレート内容へ戻す（変更系スペックの before で使い、実行順依存を排除する）。 */
export function resetFixture(name: FixtureName): void {
  writeFileSync(fixturePath(name), readTemplate(name), "utf8");
}

/** フィクスチャへ任意内容を書き込み、ファイル監視を発火させる。 */
export function writeFixture(name: FixtureName, content: string): void {
  writeFileSync(fixturePath(name), content, "utf8");
}
