// ブートストラップ（合成ルート）。
//
// 起動引数のファイルを開き、イベントを購読し、UI を結線する。
// 可変状態はこのモジュールの AppState 1 つに集約し、純関数（tabStore 等）で
// 不変更新する。tab id 生成は副作用のため呼び出し側（ここ）の責務。
//
// 各処理はトップレベルの小さな関数に分け、共有する可変状態は App を通して渡す
// （1 つの巨大なクロージャに閉じ込めると、変更の影響範囲が読めなくなるため）。

import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save, message } from "@tauri-apps/plugin-dialog";

import type { AppTheme, LaunchTheme, Tab, TabId } from "./types";
import {
  createTabState,
  getActiveTab,
  openTab,
  closeTab,
  setActiveTab,
  setTabViewMode,
  updateTabSource,
  type TabState,
} from "./core/tabs/tabStore";
import {
  readMarkdownFile,
  startWatch,
  stopWatch,
  getLaunchFiles,
  getLaunchTheme,
  openInEditor,
  printToPdf,
  takePendingOpenFiles,
  onFileChanged,
  onWatchError,
  onFileDrop,
  onOpenFilesPending,
} from "./core/fs/fileClient";
import { MARKDOWN_EXTENSIONS, isSamePath } from "./core/fs/markdownPath";
import {
  createThemeController,
  type ThemeSource,
  type ThemeController,
} from "./core/theme/themeController";
import {
  pdfTitleFromFileName,
  pdfFileNameFromFileName,
  buildPageMarginCss,
  PAGE_MARGIN_MM,
} from "./core/print";
import { computeDocumentStats } from "./core/stats/documentStats";
import {
  cycleContentWidth,
  contentWidthToCss,
  contentWidthLabel,
  DEFAULT_CONTENT_WIDTH,
  type ContentWidth,
} from "./core/view/contentWidth";
import {
  cycleZoom,
  zoomIn,
  zoomOut,
  resetZoom,
  zoomToScale,
  DEFAULT_ZOOM_PERCENT,
  type ZoomPercent,
} from "./core/view/zoomLevel";
import {
  createScrollPositions,
  setScrollPosition,
  getScrollPosition,
  removeScrollPosition,
  preserveScrollRatio,
  type ScrollPositions,
} from "./core/view/scrollState";
import { filterMarkdownPaths } from "./core/fs/dropPaths";
import { renderTabBar } from "./ui/tabBar";
import { renderPreview } from "./ui/preview";
import { renderMermaid, type MermaidTheme } from "./ui/mermaidRenderer";
import { loadLocalImages } from "./ui/imageLoader";
import { renderStatusBar, setStatusNotice } from "./ui/statusBar";
import {
  initToolbar,
  setViewModeButtons,
  setDiffToggle,
  setContentWidthLabel,
  setZoomLabel,
  setOpenInEditorEnabled,
  setThemeButtons,
  type ToolbarElements,
  type ViewMode,
} from "./ui/toolbar";
import {
  initOverflowMenu,
  type OverflowMenuController,
} from "./ui/overflowMenu";
import { initContextMenu, type ContextMenuElements } from "./ui/contextMenu";
import { DEFAULT_VIEW_MODE } from "./core/view/viewMode";

/** 空状態・既定のドキュメントタイトル（index.html の <title> と一致させる）。 */
const APP_TITLE = "Markview Pulse Type R";
/** 差分強調の縮退通知文言。 */
const DIFF_DEGRADED_NOTICE = "文書が大きいため差分強調を省略しました";
/** PDF 書き出し中の通知文言。 */
const SAVING_NOTICE = "PDF を書き出しています…";
/** PDF 保存完了の通知文言。 */
const SAVED_NOTICE = "PDF を保存しました";
/** 保存完了通知を状態バーに残す時間（ミリ秒）。 */
const SAVED_NOTICE_MS = 4000;

/** 必須 DOM 要素を型検証付きで取得。欠落・型不一致なら握りつぶさず即時失敗させる。 */
function requireEl<T extends HTMLElement>(id: string, ctor: new () => T): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) {
    throw new Error(`必須要素が見つからない、または型が不一致: #${id}`);
  }
  return el;
}

/** 不明値を AppTheme へ安全に正規化する（"dark" 以外は "light"）。 */
function toAppTheme(value: unknown): AppTheme {
  return value === "dark" ? "dark" : "light";
}

/** パスからファイル名のみを取り出す（Windows/Unix 両区切り対応）。 */
function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter((s) => s.length > 0);
  return parts[parts.length - 1] ?? path;
}

/** ユーザー向けにエラーを通知する（背景処理の失敗を握りつぶさない）。 */
async function reportError(title: string, error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  await message(detail, { title, kind: "error" });
}

/**
 * 非同期処理を起動し、失敗したら通知する。
 *
 * DOM イベントハンドラは同期関数のため、非同期処理は「起動して投げっぱなし」に
 * なる。catch を書き忘れると無音失敗になるので、その形をここへ集約する。
 */
function runReported(title: string, task: () => Promise<void>): void {
  void task().catch((error: unknown) => reportError(title, error));
}

/** 起動時に取得する DOM 要素一式。 */
interface AppElements {
  readonly preview: HTMLElement;
  readonly emptyState: HTMLElement;
  readonly tabbar: HTMLElement;
  readonly statusbar: HTMLElement;
  /** 本文スクロール領域。 */
  readonly content: HTMLElement;
  readonly welcomeOpen: HTMLButtonElement;
  readonly toolbar: ToolbarElements;
  readonly overflowButton: HTMLButtonElement;
  readonly overflowMenu: HTMLElement;
  readonly contextMenu: ContextMenuElements;
}

/**
 * アプリの可変状態。
 *
 * 表示設定（幅・ズーム・スクロール位置）は DOM/描画の関心事のため、純粋な
 * TabState とは分離して保持する。
 */
interface AppState {
  tabs: TabState;
  /** tab id の連番（生成は副作用のためここで持つ）。 */
  tabSeq: number;
  /** 差分強調。既定 ON・非永続。 */
  diffHighlight: boolean;
  contentWidth: ContentWidth;
  contentZoom: ZoomPercent;
  scrollPositions: ScrollPositions;
  /** テーマ制御。起動後に生成し、メニューの切替で setMode する（非永続）。 */
  themeController: ThemeController | null;
  /**
   * 描画の世代。render のたびに増やし、遅延解決（mermaid・画像）の反映が
   * 最新世代かを判定して古い描画を破棄する。
   */
  renderSeq: number;
  /** 直近の描画に mermaid 図が含まれていたか（テーマ切替時の再描画要否）。 */
  previewHasMermaid: boolean;
  /**
   * 直近の描画で開始した mermaid 描画の完了。遅延描画で本文高さが変わるため、
   * スクロール復元（reloadTab）が完了後に再調整するのに使う。
   */
  pendingMermaid: Promise<void>;
  /**
   * 直近の描画で開始したローカル画像埋め込みの完了。PDF 書き出しがこれを待たずに
   * 走ると、data URI 差し替え前の <img> のまま WebView2 がスナップショットし、
   * 書き出した PDF の画像が欠落し得る。
   */
  pendingImages: Promise<void>;
  /**
   * PDF 書き出し・印刷中のみ "light" を入れる。mermaid の配色は SVG へ焼き込まれ
   * CSS 変数で追従できないため、画面のテーマとは独立に指定する必要がある。
   * 上書きは発生元タブに限定する（書き出し中に別タブへ切り替えられても、その
   * タブの再描画がライト固定を誤って引き継がないようにするため）。
   */
  mermaidThemeOverride: MermaidTheme | null;
  mermaidThemeOverrideTabId: TabId | null;
  /**
   * タブごとの data URI キャッシュ（画像参照 → data URI）。
   * render はタブ切替・差分トグル・テーマ切替など多くの操作で走り、そのたびに
   * 全画像を読み直すと 1 枚最大 20MiB の読取と base64 化が繰り返される。
   * 画像が変わり得るのはファイル変更のときだけなので、そこで捨てる。
   */
  readonly imageCache: Map<TabId, Map<string, string>>;
}

/**
 * 共有コンテキスト。
 *
 * `render` は生成後に差し替える。描画（render）とタブ操作（onSelect/onClose）が
 * 相互に呼び合うため、参照を後から束ねて循環を解く。
 */
interface App {
  readonly els: AppElements;
  readonly st: AppState;
  render: () => void;
}

/** 必須要素をまとめて取得する。 */
function queryElements(): AppElements {
  return {
    preview: requireEl("preview", HTMLElement),
    emptyState: requireEl("empty-state", HTMLElement),
    tabbar: requireEl("tabbar", HTMLElement),
    statusbar: requireEl("statusbar", HTMLElement),
    content: requireEl("content", HTMLElement),
    welcomeOpen: requireEl("welcome-open", HTMLButtonElement),
    toolbar: {
      openFile: requireEl("open-file", HTMLButtonElement),
      modePreview: requireEl("mode-preview", HTMLButtonElement),
      modeSource: requireEl("mode-source", HTMLButtonElement),
      diffToggle: requireEl("diff-toggle", HTMLButtonElement),
      contentWidth: requireEl("content-width", HTMLButtonElement),
      zoom: requireEl("content-zoom", HTMLButtonElement),
      print: requireEl("print", HTMLButtonElement),
      savePdf: requireEl("save-pdf", HTMLButtonElement),
      openInEditor: requireEl("open-in-editor", HTMLButtonElement),
      themeLight: requireEl("theme-light", HTMLButtonElement),
      themeDark: requireEl("theme-dark", HTMLButtonElement),
      themeSystem: requireEl("theme-system", HTMLButtonElement),
    },
    overflowButton: requireEl("more-menu-button", HTMLButtonElement),
    overflowMenu: requireEl("more-menu", HTMLElement),
    contextMenu: {
      menu: requireEl("context-menu", HTMLElement),
      copy: requireEl("ctx-copy", HTMLButtonElement),
      width: requireEl("ctx-width", HTMLButtonElement),
      print: requireEl("ctx-print", HTMLButtonElement),
      savePdf: requireEl("ctx-save-pdf", HTMLButtonElement),
      editor: requireEl("ctx-editor", HTMLButtonElement),
    },
  };
}

/** 初期状態を作る。 */
function createAppState(): AppState {
  return {
    tabs: createTabState(),
    tabSeq: 0,
    diffHighlight: true,
    contentWidth: DEFAULT_CONTENT_WIDTH,
    contentZoom: DEFAULT_ZOOM_PERCENT,
    scrollPositions: createScrollPositions(),
    themeController: null,
    renderSeq: 0,
    previewHasMermaid: false,
    pendingMermaid: Promise.resolve(),
    pendingImages: Promise.resolve(),
    mermaidThemeOverride: null,
    mermaidThemeOverrideTabId: null,
    imageCache: new Map<TabId, Map<string, string>>(),
  };
}

/**
 * 用紙余白の `@page` ルールを注入する。
 *
 * `@page` は CSS 変数を受け付けないため、余白値を styles.css に直書きすると
 * PDF 書き出し側（Rust へ渡す値）と二重管理になり、単位換算を挟むぶん乖離しやすい。
 * 値の源を core/print.ts の 1 つに保つため、ここで組み立てて流し込む。
 */
function applyPageMargins(): void {
  const style = document.createElement("style");
  style.id = "page-margin-style";
  style.textContent = buildPageMarginCss();
  document.head.appendChild(style);
}

// ---- 表示設定の反映 ----

/** 本文最大幅をプレビューとツールバーラベルへ反映する。 */
function applyContentWidth({ els, st }: App): void {
  els.preview.style.setProperty(
    "--content-max-width",
    contentWidthToCss(st.contentWidth),
  );
  setContentWidthLabel(els.toolbar, st.contentWidth);
}

/** 本文ズーム倍率を本文領域（CSS 変数）とツールバーラベルへ反映する。 */
function applyContentZoom({ els, st }: App): void {
  // 本文（プレビュー/原文）の共通祖先 #content に倍率を載せ、本文側 CSS が乗算する。
  els.content.style.setProperty(
    "--content-zoom",
    String(zoomToScale(st.contentZoom)),
  );
  setZoomLabel(els.toolbar, st.contentZoom);
}

/** ズーム倍率を更新して反映する（変化が無ければ何もしない）。 */
function setContentZoom(app: App, next: ZoomPercent): void {
  if (next === app.st.contentZoom) {
    return;
  }
  app.st.contentZoom = next;
  applyContentZoom(app);
}

/** mermaid 図に使う配色（発生元タブが今もアクティブな間だけ上書きを優先する）。 */
function currentMermaidTheme({ st }: App): MermaidTheme {
  if (
    st.mermaidThemeOverride !== null &&
    st.tabs.activeTabId === st.mermaidThemeOverrideTabId
  ) {
    return st.mermaidThemeOverride;
  }
  return toAppTheme(document.documentElement.getAttribute("data-theme"));
}

/** 指定タブの画像キャッシュを取得する（無ければ作る）。 */
function imageCacheFor({ st }: App, id: TabId): Map<string, string> {
  let cache = st.imageCache.get(id);
  if (!cache) {
    cache = new Map<string, string>();
    st.imageCache.set(id, cache);
  }
  return cache;
}

// ---- 描画 ----

/** 空状態（タブ無し）を描画する。 */
function renderEmptyState({ els, st }: App): void {
  // 空状態ではアプリ名へ戻す。
  document.title = APP_TITLE;
  els.preview.replaceChildren();
  st.previewHasMermaid = false;
  els.preview.classList.add("hidden");
  els.emptyState.classList.remove("hidden");
  renderStatusBar(els.statusbar, null, null);
  // タブが無いときは「エディタで開く」を無効化。
  setOpenInEditorEnabled(els.toolbar, false);
}

/**
 * 本文描画のあとに走る遅延処理（mermaid 図・ローカル画像）を開始する。
 * 完了は st.pendingMermaid / st.pendingImages で追跡し、PDF 書き出しや
 * スクロール復元がそれを待てるようにする。
 */
function startDeferredRendering(app: App, active: Tab, seq: number): void {
  const { els, st } = app;
  const isCurrent = (): boolean => seq === st.renderSeq;
  const isPreview = active.viewMode === "preview";
  // mermaid 図があれば遅延ロードして描画する（無ければ mermaid を import しない）。
  // renderPreview 直後の同期時点で判定する（この時点では未処理の pre.mermaid が残る）。
  st.previewHasMermaid =
    isPreview && els.preview.querySelector("pre.mermaid") !== null;
  st.pendingMermaid = st.previewHasMermaid
    ? renderMermaid(
        els.preview,
        isCurrent,
        (error) => void reportError("mermaid 図の描画に失敗しました", error),
        currentMermaidTheme(app),
      )
    : Promise.resolve();
  // ローカル画像（相対・絶対パス）を Rust 経由で data URI 化して埋め込む。
  // プレビュー時のみ。遅延解決のため世代（seq）で古い描画への上書きを防ぐ。
  st.pendingImages = isPreview
    ? loadLocalImages(
        els.preview,
        active.path,
        isCurrent,
        imageCacheFor(app, active.id),
      )
    : Promise.resolve();
}

/** アクティブタブの本文を描画し、遅延処理（mermaid・画像）を開始する。 */
function renderActiveTab(app: App, active: Tab, seq: number): void {
  const { els, st } = app;
  // document.title を MD ファイル名（語幹）へ同期し、PDF の Title プロパティから
  // アプリ名を排除する。
  // 注: プリンタ印刷（Ctrl+P）の保存ダイアログの既定ファイル名は WebView2 の
  // ネイティブ印刷経路が決めるため Web 層からは制御できない。
  document.title = pdfTitleFromFileName(active.fileName);
  els.emptyState.classList.add("hidden");
  els.preview.classList.remove("hidden");
  setViewModeButtons(els.toolbar, active.viewMode);
  setOpenInEditorEnabled(els.toolbar, true);
  // 差分強調トグルは原文モードでは無効化（プレビュー時のみ作用）。
  setDiffToggle(els.toolbar, {
    active: st.diffHighlight,
    enabled: active.viewMode === "preview",
  });
  const result = renderPreview(els.preview, active, st.diffHighlight);
  startDeferredRendering(app, active, seq);
  renderStatusBar(
    els.statusbar,
    computeDocumentStats(active.source),
    active.path,
  );
  // 差分強調を縮退（省略）した場合のみ非モーダル通知を出す（無音失敗禁止）。
  setStatusNotice(
    els.statusbar,
    result.diffDegraded ? DIFF_DEGRADED_NOTICE : null,
  );
}

/** 現在の状態を UI 全体へ反映する。 */
function renderApp(app: App): void {
  const { els, st } = app;
  // 世代を進める。これ以前に開始した遅延描画は破棄対象になる。
  const seq = ++st.renderSeq;
  renderTabBar(els.tabbar, st.tabs, {
    onSelect: (id) => {
      selectTab(app, id);
    },
    onClose: (id) => void closeTabAt(app, id),
  });
  applyContentWidth(app);
  applyContentZoom(app);
  const active = getActiveTab(st.tabs);
  if (!active) {
    renderEmptyState(app);
    return;
  }
  renderActiveTab(app, active, seq);
}

// ---- スクロール位置 ----

/** 現在アクティブタブのスクロール位置を記録する。 */
function saveActiveScroll({ els, st }: App): void {
  if (st.tabs.activeTabId !== null) {
    st.scrollPositions = setScrollPosition(
      st.scrollPositions,
      st.tabs.activeTabId,
      els.content.scrollTop,
    );
  }
}

/** 指定タブがアクティブな間だけ、その保存位置へスクロールを復元する。 */
function restoreScrollFor({ els, st }: App, id: TabId): void {
  const top = getScrollPosition(st.scrollPositions, id);
  requestAnimationFrame(() => {
    // 1 フレームの間に切り替わっていたら、切替先の位置を壊さない。
    if (st.tabs.activeTabId === id) {
      els.content.scrollTop = top;
    }
  });
}

// ---- タブ操作 ----

function selectTab(app: App, id: TabId): void {
  if (id === app.st.tabs.activeTabId) {
    return;
  }
  // 切替前に現在位置を保存し、切替後に対象タブの位置を復元する。
  saveActiveScroll(app);
  app.st.tabs = setActiveTab(app.st.tabs, id);
  app.render();
  restoreScrollFor(app, id);
}

async function closeTabAt(app: App, id: TabId): Promise<void> {
  const { st } = app;
  st.scrollPositions = removeScrollPosition(st.scrollPositions, id);
  st.imageCache.delete(id);
  st.tabs = closeTab(st.tabs, id);
  app.render();
  // 閉じたのがアクティブタブなら隣が新しくアクティブになる。タブクリックでの
  // 切替（selectTab）と同じく、その保存位置を復元する。
  if (st.tabs.activeTabId !== null) {
    restoreScrollFor(app, st.tabs.activeTabId);
  }
  try {
    await stopWatch(id);
  } catch (error) {
    await reportError("監視の停止に失敗しました", error);
  }
}

function selectViewMode(app: App, mode: ViewMode): void {
  const active = getActiveTab(app.st.tabs);
  if (!active) {
    return;
  }
  app.st.tabs = setTabViewMode(app.st.tabs, active.id, mode);
  app.render();
}

/** 差分強調の ON/OFF を切り替える。原文モードでは無効。 */
function toggleDiff(app: App): void {
  const active = getActiveTab(app.st.tabs);
  if (active?.viewMode !== "preview") {
    return;
  }
  app.st.diffHighlight = !app.st.diffHighlight;
  app.render();
}

/** 本文最大幅を順送りする。 */
function cycleWidth(app: App): void {
  app.st.contentWidth = cycleContentWidth(app.st.contentWidth);
  applyContentWidth(app);
}

/** テーマモードを切り替える（ライト/ダーク/システム）。初期化前は無視する。 */
function selectTheme(app: App, mode: LaunchTheme): void {
  const controller = app.st.themeController;
  if (!controller) {
    return;
  }
  runReported("テーマの切り替えに失敗しました", async () => {
    await controller.setMode(mode);
    setThemeButtons(app.els.toolbar, mode);
  });
}

/**
 * パスを開く。既存タブがあれば複製せずアクティブ化する。
 * @param activate 開いた直後に描画するか（複数を続けて開くときは最後だけ true）。
 */
async function openPath(
  app: App,
  path: string,
  activate = true,
): Promise<void> {
  const { st } = app;
  const file = await readMarkdownFile(path);
  // 同一ファイル判定は正規化キーで行う。Windows は大文字小文字を区別せず
  // 区切り文字も混在するため、生の文字列比較だと同じファイルが二重に開く。
  const existing = st.tabs.tabs.find((t) => isSamePath(t.path, file.path));
  if (existing) {
    st.tabs = setActiveTab(st.tabs, existing.id);
    if (activate) app.render();
    return;
  }
  const id: TabId = `tab-${String(++st.tabSeq)}`;
  const tab: Tab = {
    id,
    path: file.path,
    fileName: basename(file.path),
    source: file.content,
    previousSource: file.content,
    viewMode: DEFAULT_VIEW_MODE,
  };
  st.tabs = openTab(st.tabs, tab);
  if (activate) app.render();
  await startWatch(id, file.path);
}

/**
 * 複数のパスをまとめて開く。
 * 読み込みは並列に行い、描画は最後に 1 回だけ走らせる（1 件ずつ描画すると
 * 途中のタブの markdown 描画と画像 IPC が即座に捨てられる）。
 */
async function openPaths(app: App, paths: readonly string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  const results = await Promise.allSettled(
    paths.map((path) => openPath(app, path, false)),
  );
  app.render();
  const failed = results.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") {
    await reportError("ファイルを開けませんでした", failed.reason);
  }
}

/** ダイアログでファイルを選んで開く。 */
async function openFileDialog(app: App): Promise<void> {
  try {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Markdown", extensions: [...MARKDOWN_EXTENSIONS] }],
    });
    if (typeof selected === "string") {
      await openPaths(app, [selected]);
    }
  } catch (error) {
    await reportError("ファイル選択に失敗しました", error);
  }
}

/** 監視通知を受けて該当タブを再読込し、アクティブなら再描画する。 */
async function reloadTab(app: App, tabId: TabId): Promise<void> {
  const { els, st } = app;
  const tab = st.tabs.tabs.find((t) => t.id === tabId);
  if (!tab) {
    return;
  }
  try {
    const file = await readMarkdownFile(tab.path);
    // 内容が変わっていなければ何もしない。属性のみの変更などで監視イベントが
    // 届くことがあり、そのたびに updateTabSource すると previousSource が
    // 現在値で塗り潰され、表示中の差分強調が理由もなく消えてしまう。
    if (file.content === tab.source) {
      return;
    }
    // 本文が変わった＝参照先の画像も差し替わり得るため、キャッシュを捨てる。
    st.imageCache.delete(tabId);
    st.tabs = updateTabSource(st.tabs, tabId, file.content);
    if (st.tabs.activeTabId !== tabId) {
      return;
    }
    // 再描画で本文高さが変わるため、スクロール位置を比率で近似復元する。
    const prevTop = els.content.scrollTop;
    const prevHeight = els.content.scrollHeight;
    app.render();
    const restoreScroll = (): void => {
      // 遅延実行の間にタブが切り替わっていたら触らない。切替先の閲覧位置を
      // 書き換えてしまい、かつその値を元タブの保存位置として記録してしまうため。
      if (st.tabs.activeTabId !== tabId) {
        return;
      }
      const nextTop = preserveScrollRatio(
        prevTop,
        prevHeight,
        els.content.scrollHeight,
      );
      els.content.scrollTop = nextTop;
      st.scrollPositions = setScrollPosition(
        st.scrollPositions,
        tabId,
        nextTop,
      );
    };
    requestAnimationFrame(restoreScroll);
    // mermaid は遅延描画で完了後に高さが変わるため、完了後にもう一度復元する。
    void st.pendingMermaid.then(() => requestAnimationFrame(restoreScroll));
  } catch (error) {
    await reportError("変更の再読込に失敗しました", error);
  }
}

// ---- 印刷 / PDF ----

/**
 * mermaid 図をライト配色へ描き替えてから `run` を実行し、終了後に元へ戻す。
 * 本文の配色は @media print（styles.css）が印刷時にライトへ戻すため対象外で、
 * CSS 変数に追従しない mermaid だけがこの明示的な再描画を要する。
 * 図が無いときは再描画そのものを省く。
 */
async function withLightMermaid(
  app: App,
  run: () => Promise<void>,
): Promise<void> {
  const { els, st } = app;
  if (!st.previewHasMermaid || currentMermaidTheme(app) === "light") {
    // mermaid が無い/既にライトでも、直前の描画が開始したローカル画像の埋め込みが
    // 未完のまま run（printToPdf 等）を呼ぶと欠損画像になり得るため待つ。
    await st.pendingImages;
    await run();
    return;
  }
  const tabId = st.tabs.activeTabId;
  st.mermaidThemeOverride = "light";
  st.mermaidThemeOverrideTabId = tabId;
  // 再描画は本文 DOM を作り直すため、閲覧位置を戻せるよう控えておく。
  const scrollTop = els.content.scrollTop;
  try {
    app.render();
    await st.pendingMermaid;
    await st.pendingImages;
    await run();
  } finally {
    st.mermaidThemeOverride = null;
    st.mermaidThemeOverrideTabId = null;
    app.render();
    await st.pendingMermaid;
    // 書き出し中に別タブへ切り替えられていたら、そのタブの閲覧位置を壊さない。
    if (st.tabs.activeTabId === tabId) {
      els.content.scrollTop = scrollTop;
    }
  }
}

/**
 * プリンタへの印刷。現在の表示内容を「見たまま」印刷する。
 * 印刷用レイアウトは @media print（styles.css）が担い、ツールバー/タブを除外する。
 * mermaid 図はダーク配色を SVG へ焼き込むため、本文の配色が @media print で
 * ライトへ戻っても図だけ暗く残る。withLightMermaid で図もライトへ切り替えてから
 * 印刷し、印刷ダイアログが閉じたら元へ戻す。
 *
 * 注: この経路（WebView2 のネイティブ印刷 → XPS ドライバ）で PDF 化すると
 * グリフがアウトライン化され、テキストを選択・検索できない PDF になる。
 * PDF が目的の場合は saveAsPdf（WebView2 PrintToPdf）を使う。
 */
function printNow(app: App): void {
  if (!getActiveTab(app.st.tabs)) {
    return;
  }
  runReported("印刷に失敗しました", () =>
    withLightMermaid(app, () => {
      window.print();
      return Promise.resolve();
    }),
  );
}

/**
 * PDF として保存。保存先を選ばせ、WebView2 の PrintToPdf で書き出す。
 * ヘッダーへは MD ファイル名の語幹を渡す（フッターのページ番号は WebView2 側が付与）。
 * 画面がダークでも PDF は常にライト配色で出す（紙・PDF は白地が前提）。
 * キャンセル時は何もしない。書き出し中は状態バーへ通知を出す。
 *
 * 保存先ダイアログを表示している間にアクティブタブが切り替えられた場合は中止する
 * （切替後、WebView2 が実際にスナップショットするのは新しいタブの内容になり、
 * 利用者が選んだはずの文書と異なる PDF が書き出されてしまうため）。
 */
function saveAsPdf(app: App): void {
  const { els, st } = app;
  const active = getActiveTab(st.tabs);
  if (!active) {
    return;
  }
  const tabId = active.id;
  const headerTitle = pdfTitleFromFileName(active.fileName);
  runReported("PDF の保存に失敗しました", async () => {
    try {
      const destination = await save({
        defaultPath: pdfFileNameFromFileName(active.fileName),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (destination === null) {
        return;
      }
      if (getActiveTab(st.tabs)?.id !== tabId) {
        throw new Error(
          "保存先を選んでいる間に別のタブへ切り替わったため中止しました",
        );
      }
      // 通知は withLightMermaid のコールバック内で出す。ダーク×mermaid 時は
      // withLightMermaid 自身が再描画を挟むため、先に出すとその再描画
      // （renderStatusBar の全消去）で即座に消えてしまう。
      await withLightMermaid(app, () => {
        setStatusNotice(els.statusbar, SAVING_NOTICE);
        return printToPdf(destination, headerTitle, PAGE_MARGIN_MM);
      });
      setStatusNotice(els.statusbar, SAVED_NOTICE);
      window.setTimeout(() => {
        // この間に別の通知（次の書き出し・差分縮退等）へ変わっていれば消さない。
        if (
          els.statusbar.querySelector(".statusbar-notice")?.textContent ===
          SAVED_NOTICE
        ) {
          setStatusNotice(els.statusbar, null);
        }
      }, SAVED_NOTICE_MS);
    } catch (error) {
      setStatusNotice(els.statusbar, null);
      throw error;
    }
  });
}

/** アクティブファイルを OS 既定アプリ（エディタ等）で開く。 */
function openActiveInEditor(app: App): void {
  const active = getActiveTab(app.st.tabs);
  if (!active) {
    return;
  }
  runReported("エディタで開けませんでした", () => openInEditor(active.path));
}

// ---- 結線 ----

/** ツールバーとウェルカム画面を結線する。 */
function wireToolbar(app: App, overflow: OverflowMenuController): void {
  initToolbar(app.els.toolbar, {
    onOpenFile: () => {
      overflow.close();
      void openFileDialog(app);
    },
    onSelectMode: (mode) => {
      selectViewMode(app, mode);
    },
    onToggleDiff: () => {
      toggleDiff(app);
    },
    // 本文幅はメニュー内で連続切替できるよう、クリックしても閉じない。
    onCycleWidth: () => {
      cycleWidth(app);
    },
    onCycleZoom: () => {
      setContentZoom(app, cycleZoom(app.st.contentZoom));
    },
    onPrint: () => {
      overflow.close();
      printNow(app);
    },
    onSavePdf: () => {
      overflow.close();
      saveAsPdf(app);
    },
    onOpenInEditor: () => {
      overflow.close();
      openActiveInEditor(app);
    },
    // テーマ切替はメニューを開いたまま（選択状態を見比べられるように）。
    onSelectTheme: (mode) => {
      selectTheme(app, mode);
    },
  });

  // ウェルカム画面の「ファイルを開く」。ツールバーと同じ導線。
  app.els.welcomeOpen.addEventListener("click", () => void openFileDialog(app));
}

/**
 * 右クリックのカスタムコンテキストメニューを結線する。
 * WebView 既定メニューは抑止し、本メニューを表示する。動作は既存ハンドラを再利用。
 */
function wireContextMenu(app: App): void {
  initContextMenu(app.els.contextMenu, {
    resolve: () => {
      const selection = window.getSelection();
      const text =
        selection && !selection.isCollapsed ? selection.toString() : "";
      return {
        selectionText: text.length > 0 ? text : null,
        hasActiveTab: Boolean(getActiveTab(app.st.tabs)),
        widthLabel: contentWidthLabel(app.st.contentWidth),
      };
    },
    onCopy: (text) => {
      runReported("コピーに失敗しました", () =>
        navigator.clipboard.writeText(text),
      );
    },
    onWidth: () => {
      cycleWidth(app);
    },
    onPrint: () => {
      printNow(app);
    },
    onSavePdf: () => {
      saveAsPdf(app);
    },
    onEditor: () => {
      openActiveInEditor(app);
    },
  });
}

/**
 * キーボード・ホイールのショートカットを結線する。
 * Ctrl+P は空状態での既定印刷を抑止するため横取りしてガード経由で呼ぶ。
 * Ctrl + +/-/0 と Ctrl+ホイールで本文ズーム。素のキー・ホイールは横取りしない。
 */
function wireShortcuts(app: App): void {
  window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "p") {
      event.preventDefault();
      printNow(app);
      return;
    }
    // "+" は shift 無しだと "=" として届くため両方を受ける
    // （テンキーの +/- も Chromium では "+"/"-" として届く）。
    if (key === "+" || key === "=") {
      event.preventDefault();
      setContentZoom(app, zoomIn(app.st.contentZoom));
    } else if (key === "-") {
      event.preventDefault();
      setContentZoom(app, zoomOut(app.st.contentZoom));
    } else if (key === "0") {
      event.preventDefault();
      setContentZoom(app, resetZoom());
    }
  });

  // passive:false でないと preventDefault が効かないため明示する。
  app.els.content.addEventListener(
    "wheel",
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      setContentZoom(
        app,
        event.deltaY < 0
          ? zoomIn(app.st.contentZoom)
          : zoomOut(app.st.contentZoom),
      );
    },
    { passive: false },
  );
}

/**
 * data-theme の変更（メニュー手動切替・OS 追従の両方）で mermaid 図の配色を追従させる。
 * mermaid の色は生成時に SVG へ焼き込まれ CSS 変数では追従しないため、再描画が要る。
 * mermaid 在時のみ再描画し、非 mermaid 文書のスクロール位置は維持する。
 */
function wireThemeObserver(app: App): void {
  const observer = new MutationObserver(() => {
    if (app.st.previewHasMermaid) {
      app.render();
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

/**
 * テーマ制御を初期化する。
 *
 * テーマは表示上の設定にすぎない。ここでの失敗が以降の購読やファイルオープンまで
 * 巻き込むと、テーマ 1 件の不調でアプリの主機能が丸ごと死ぬため、失敗しても
 * OS 追従（system）へ縮退させて続行する。
 */
async function initTheme(app: App): Promise<void> {
  // Tauri のウィンドウテーマを ThemeSource として注入。
  // 起動引数で dark/light が指定された場合は固定適用し OS 追従しない。
  const win = getCurrentWindow();
  const themeSource: ThemeSource = {
    current: async () => toAppTheme(await win.theme()),
    onChange: (handler) =>
      win.onThemeChanged(({ payload }) => {
        handler(toAppTheme(payload));
      }),
  };
  try {
    const launchTheme = await getLaunchTheme();
    app.st.themeController = await createThemeController(
      document.documentElement,
      themeSource,
      launchTheme,
    );
    setThemeButtons(app.els.toolbar, launchTheme);
  } catch (error) {
    await reportError("テーマの初期化に失敗しました", error);
  }
}

/** イベント購読を確立し、起動引数のファイルを開く。 */
async function initSubscriptions(app: App): Promise<void> {
  const { els } = app;
  /** IPC 契約の破壊を利用者へ通知する（イベントを黙って捨てない）。 */
  const reportInvalidPayload = (error: unknown): void => {
    void reportError("アプリ内部の通信で不整合が発生しました", error);
  };

  // 2 回目以降の起動（「送る」/関連付け等）で転送されたファイルを開く。
  // イベントは合図のみで、実体は Rust 側の控えから回収する。
  const drainPendingOpenFiles = (): void => {
    runReported("転送されたファイルを開けませんでした", async () => {
      await openPaths(app, filterMarkdownPaths(await takePendingOpenFiles()));
    });
  };
  await onOpenFilesPending(drainPendingOpenFiles);
  // 購読を確立する前に届いていた転送を回収する（取りこぼし防止）。
  drainPendingOpenFiles();

  await onFileChanged(
    ({ tabId }) => void reloadTab(app, tabId),
    reportInvalidPayload,
  );
  await onWatchError(
    ({ message: msg }) =>
      void reportError("ファイル監視でエラーが発生しました", msg),
    reportInvalidPayload,
  );
  // ドラッグ&ドロップでファイルを開く。enter/over でハイライト、drop で開く。
  await onFileDrop((event) => {
    if (event.kind === "drop") {
      els.content.classList.remove("is-drop-target");
      void openPaths(app, filterMarkdownPaths([...event.paths]));
    } else if (event.kind === "leave") {
      els.content.classList.remove("is-drop-target");
    } else {
      els.content.classList.add("is-drop-target");
    }
  }, reportInvalidPayload);

  await openPaths(app, await getLaunchFiles());
}

function bootstrap(): void {
  applyPageMargins();
  // バージョン番号をウェルカム画面に表示。値はビルド時に Vite の define で
  // 注入される（vite.config.ts）。
  requireEl("app-version", HTMLSpanElement).textContent = `v${__APP_VERSION__}`;

  const app: App = {
    els: queryElements(),
    st: createAppState(),
    render: () => undefined,
  };
  app.render = () => {
    renderApp(app);
  };

  // 副次コマンドを束ねる「…」メニュー。終端操作では閉じ、調整系（本文幅）は開いたまま。
  const overflow = initOverflowMenu({
    button: app.els.overflowButton,
    menu: app.els.overflowMenu,
  });
  wireToolbar(app, overflow);
  wireContextMenu(app);
  wireShortcuts(app);
  wireThemeObserver(app);

  // 初期化。失敗は通知して握りつぶさず、いずれにせよ初期描画は行う。
  void (async () => {
    try {
      await initTheme(app);
      await initSubscriptions(app);
    } catch (error) {
      await reportError("初期化に失敗しました", error);
    } finally {
      app.render();
    }
  })();
}

window.addEventListener("DOMContentLoaded", bootstrap);
