# 設計記録: ローカル画像の data URI 埋め込み

- ステータス: 採用（v1.1.1）
- 日付: 2026-07-23
- 関連: `src-tauri/src/commands/image.rs` / `src/ui/imageLoader.ts` / `src/core/media/imageSrc.ts` / `src/core/fs/fileClient.ts`

## 背景・課題

Markdown が相対パスでローカル画像を参照する（例 `![](images/diagram.png)`）と、プレビューに表示されない。原因は 2 つ。

1. **相対 URL の解決先**: WebView は `<img src="images/diagram.png">` をアプリ配信元（`tauri://` / `http://tauri.localhost`）基準で解決するため、`.md` の置き場所ではなく存在しない URL を引く。
2. **ローカルファイルは不許可**: CSP は `img-src 'self' data: https:` で `file:` / `asset:` を許可せず、`tauri.conf.json` に asset protocol 設定もない。

`https:` 画像と `data:` 埋め込みは現状でも表示可能。問題はローカル画像（相対・絶対）に限る。

## 決定

**方式B: Rust で画像を読み、base64 の `data:` URI として埋め込む。**

- Rust コマンド `read_image_data_uri(mdPath, src)` が、開いている `.md` の親ディレクトリを基準に画像を解決し、`data:{mime};base64,...` を返す。
- フロント（`imageLoader.ts`）は描画後にローカル `<img>`（`isLocalImageSrc` で判定）を抽出し、コマンド結果で `src` を差し替える。
- CSP の `img-src data:` は許可済みのため、**CSP・capabilities の変更は不要**。

### トラバーサル既定 ＝ `.md` 配下限定（本記録の主眼）

未信頼の `.md` を開く前提のため、**画像の読み取りは `.md` ファイルの置きディレクトリ配下（サブツリー）に限定する**ことを既定とする。

- 基準ディレクトリ（`.md` の親）と対象を **`canonicalize`（実体解決）** した上で、対象が基準配下に収まる場合のみ読み取る。
- `../` による配下外への脱出、無関係な絶対パス（例 `C:\Users\...\秘密`）は **`AppError::Forbidden`** として拒否する。
- `canonicalize` はシンボリックリンクを解決するため、リンク経由の配下外脱出も実パス比較で検出できる。

この既定を採る理由:

- **最小権限**: アプリに「任意の場所のファイルを画像として読む」広い能力を与えない。読み取りは利用者が開いた文書の近傍に限定される。
- **実運用との整合**: 実資料は `images/` などサブディレクトリ配置が一般的で、この既定で不足しない。
- **緩和は後日可能**: `../` や共有ディレクトリ参照を許す要件が出た場合は、明示的な設定として段階的に緩める（既定を緩めない）。

### 追加のガード

- **UNC / プロトコル相対の拒否（強制認証対策）**: `src` が UNC・プロトコル相対（先頭が 2 つのパス区切り。`\\host` / `//host` / 混在）の場合、**`canonicalize` に到達する前に** `AppError::Forbidden` で拒否する。Windows では UNC パスの `canonicalize` が SMB 接続＋自動 NTLM 認証を誘発し、未信頼 `.md` から資格情報（NetNTLMv2 ハッシュ）を盗まれ得る（クリック不要の強制認証）。サブツリー判定は実体解決の後段のため手遅れになる。フロントの `isLocalImageSrc` でも UNC を非ローカル扱いにするが、権威的判定は Rust 側。
- **拡張子ホワイトリスト**: `png/jpg/jpeg/gif/webp/svg/bmp/ico/avif` のみ。未対応は `AppError::InvalidImage`。
- **サイズ上限**: 20 MiB。超過は `AppError::InvalidImage`（過大なメモリ消費・base64 肥大の防止）。
- **失敗時 UX**: 個別画像の失敗（欠損・配下外・未対応）はダイアログを出さず、ブラウザ同様に壊れ画像（alt）を残し、`img-load-error` クラスを付す（可視の失敗であり無音ではない。文書内の欠損画像ごとのモーダルは過剰なため）。

## 検討した代替案

**方式A: Tauri asset protocol（`convertFileSrc`）**。`tauri.conf.json` に `assetProtocol.enable` ＋ `scope`、CSP に `asset:` 追加、DOMPurify に asset スキーム許可が必要。任意の場所の `.md` を開く本アプリでは asset scope を広く取る必要があり、標準で広い FS 露出を WebView へ与える点が本方式より不利と判断し不採用。

## 既知の限界

- `file:` スキーム URI（例 `file:///C:/img.png`）は本対応の範囲外（`isLocalImageSrc` は非ローカル扱いで素通し＝従来どおり表示されない）。要件が出れば別途対応する。
- `.md` の外（`../` 先や無関係な絶対パス）にある画像は既定で表示されない（上記トラバーサル方針による意図的挙動）。
- 画像は描画のたびに再読込・再エンコードする（メモ化は将来の最適化課題）。

## 関連テスト

- Rust: `src-tauri/src/commands/image.rs` の `#[cfg(test)]`（配下/脱出/欠損/未対応/サイズ超過/MIME/配下判定）。
- フロント: `tests/core/imageSrc.test.ts`（`isLocalImageSrc`）、`tests/ui/imageLoader.test.ts`（差し替え・デコード・失敗マーカー・世代破棄）。
