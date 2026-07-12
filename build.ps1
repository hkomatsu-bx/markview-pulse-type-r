<#
.SYNOPSIS
  Markview Pulse Type R 一括ビルドスクリプト（PowerShell 版）。
.DESCRIPTION
  フロントエンド（Vite）と Tauri バックエンド（Rust）をまとめてビルドする。
  内部では `npm run tauri build` を呼び、`beforeBuildCommand`（tsc + vite build）が
  自動で前段に走る。配布物はインストーラを生成しない単一 exe（bundle.active=false）。

  release プロファイルの最適化は Cargo.toml の [profile.release]
  （strip / lto="fat" / codegen-units=1 / opt-level="s"）で行う。
  これらはサイズ最適化で、移植性には影響しない。
.PARAMETER Target
  ビルドプロファイル: release（既定）または debug。
.PARAMETER Clean
  ビルド前に cargo クリーン（src-tauri）と dist 削除を行う。
.PARAMETER CpuV3
  CPU マイクロアーキを x86-64-v3（AVX2 / FMA / BMI 等）に固定する opt-in 最適化。
  Haswell(2013+) / Zen+ 以降が前提で、それ未満の CPU では不正命令でクラッシュする。
  本アプリの Rust 側に重い数値ループは無く（描画は WebView2 が担う）実速度の利得は
  限定的なため、移植性優先で既定は無効。.cargo/config.toml には常設せず、
  本フラグ指定時のみ一時的に RUSTFLAGS で付与する（debug/テスト/E2E には波及しない）。
.EXAMPLE
  .\build.ps1
  release ビルド（既定・最適化済み）。
.EXAMPLE
  .\build.ps1 debug
  debug ビルド。
.EXAMPLE
  .\build.ps1 release -Clean
  クリーンしてから release ビルド。
.EXAMPLE
  .\build.ps1 release -CpuV3
  x86-64-v3 最適化付き release ビルド（移植性低下に注意）。
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('debug', 'release')]
    [string]$Target = 'release',

    [switch]$Clean,
    [switch]$CpuV3
)

$ErrorActionPreference = 'Stop'

# 日本語メッセージの文字化け防止。PowerShell 5.1 の既定出力は CP932 のため、
# UTF-8 コンソールやパイプ（Git Bash 等）へ渡すと化ける。明示的に UTF-8 に統一する。
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# どこから実行してもリポジトリルート（このスクリプトの場所）で動かす。
Set-Location -LiteralPath $PSScriptRoot

# 依存ツールの存在確認（npm は必須。Node は volta 管理を想定）。
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error 'npm が見つかりません。Node.js（volta 管理）をセットアップしてください。'
    exit 1
}

# 依存関係が未取得ならインストールする。
if (-not (Test-Path -LiteralPath 'node_modules')) {
    Write-Host '==> 依存関係をインストールします (npm install)'
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($Clean) {
    Write-Host '==> クリーンアップ (cargo clean + dist 削除)'
    Push-Location src-tauri
    try {
        cargo clean
        $cleanExit = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($cleanExit -ne 0) { exit $cleanExit }
    if (Test-Path -LiteralPath 'dist') {
        Remove-Item -LiteralPath 'dist' -Recurse -Force
    }
}

# CPU 最適化（opt-in）。既定の移植性を壊さないよう一時環境変数で限定付与する。
if ($CpuV3) {
    Write-Host '==> [警告] CPU 最適化を有効化: target-cpu=x86-64-v3'
    Write-Host '          AVX2/FMA/BMI 前提（Haswell 2013+ / Zen+）。それ未満では起動不可。'
    $existing = $env:RUSTFLAGS
    $flag = '-C target-cpu=x86-64-v3'
    $env:RUSTFLAGS = if ([string]::IsNullOrWhiteSpace($existing)) { $flag } else { "$existing $flag" }
}

Write-Host "==> Markview Pulse Type R をビルドします (profile=$Target)"
if ($Target -eq 'release') {
    npm run tauri build
} else {
    npm run tauri build -- --debug
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 成果物（単一 exe）の表示。
$outDir  = if ($Target -eq 'release') { 'src-tauri/target/release' } else { 'src-tauri/target/debug' }
$exePath = Join-Path $outDir 'mviewr.exe'

Write-Host ''
Write-Host '==> ビルド完了。成果物（単一 exe・インストーラなし）:'
if (Test-Path -LiteralPath $exePath) {
    $sizeMB = [math]::Round((Get-Item -LiteralPath $exePath).Length / 1MB, 2)
    Write-Host "    $exePath ($sizeMB MB)"
} else {
    Write-Host "    [注意] 想定パスに exe が見つかりません: $exePath"
    exit 1
}
