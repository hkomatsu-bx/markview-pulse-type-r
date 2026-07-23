// ブートストラップ（合成ルート）。
//
// 起動引数のファイルを開き、イベントを購読し、UI を結線する。
// 状態（TabState）はここでのみ保持し、純関数（tabStore）で不変更新する。
// tab id 生成は副作用のため呼び出し側（ここ）の責務。

import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, message } from "@tauri-apps/plugin-dialog";

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
  onFileChanged,
  onWatchError,
  onFileDrop,
  onOpenFiles,
} from "./core/fs/fileClient";
import {
  createThemeController,
  type ThemeSource,
  type ThemeController,
} from "./core/theme/themeController";
import { pdfTitleFromFileName, buildPrintPageStyle } from "./core/print";
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
import { renderMermaid } from "./ui/mermaidRenderer";
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
import { initOverflowMenu } from "./ui/overflowMenu";
import { initContextMenu } from "./ui/contextMenu";
import { DEFAULT_VIEW_MODE } from "./core/view/viewMode";

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

/** 空状態・既定のドキュメントタイトル（index.html の <title> と一致させる）。 */
const APP_TITLE = "Markview Pulse Type R";

/** 印刷ヘッダー用の動的 `@page` ルールを専用 <style> に反映する（無ければ生成）。 */
function setPrintPageStyle(css: string): void {
  const id = "print-page-style";
  let styleEl = document.getElementById(id);
  if (!(styleEl instanceof HTMLStyleElement)) {
    styleEl = document.createElement("style");
    styleEl.id = id;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}

/** ユーザー向けにエラーを通知する（背景処理の失敗を握りつぶさない）。 */
async function reportError(title: string, error: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message : String(error);
  await message(detail, { title, kind: "error" });
}

function bootstrap(): void {
  const previewEl = requireEl("preview", HTMLElement);
  const emptyStateEl = requireEl("empty-state", HTMLElement);
  const tabbarEl = requireEl("tabbar", HTMLElement);
  const statusbarEl = requireEl("statusbar", HTMLElement);
  const contentEl = requireEl("content", HTMLElement); // 本文スクロール領域
  const welcomeOpenEl = requireEl("welcome-open", HTMLButtonElement);

  // バージョン番号（<major>.<minor>.<revision>.<commit>）をウェルカム画面に表示。
  // 値はビルド時に Vite の define で注入される（vite.config.ts）。
  requireEl("app-version", HTMLSpanElement).textContent = `v${__APP_VERSION__}`;
  const toolbarEls: ToolbarElements = {
    openFile: requireEl("open-file", HTMLButtonElement),
    modePreview: requireEl("mode-preview", HTMLButtonElement),
    modeSource: requireEl("mode-source", HTMLButtonElement),
    diffToggle: requireEl("diff-toggle", HTMLButtonElement),
    contentWidth: requireEl("content-width", HTMLButtonElement),
    zoom: requireEl("content-zoom", HTMLButtonElement),
    print: requireEl("print", HTMLButtonElement),
    openInEditor: requireEl("open-in-editor", HTMLButtonElement),
    themeLight: requireEl("theme-light", HTMLButtonElement),
    themeDark: requireEl("theme-dark", HTMLButtonElement),
    themeSystem: requireEl("theme-system", HTMLButtonElement),
  };

  let state: TabState = createTabState();
  let tabSeq = 0;
  const nextTabId = (): TabId => `tab-${String(++tabSeq)}`;

  // 差分強調: アプリ全体で保持。既定 ON。永続化しない。
  let diffHighlight = true;

  /** 差分強調の縮退通知文言。 */
  const DIFF_DEGRADED_NOTICE = "文書が大きいため差分強調を省略しました";

  // 表示設定（幅はアプリ全体・スクロール位置はタブ単位）。
  // いずれも DOM/描画の関心事のため、純粋な TabState とは分離して保持する。
  let contentWidth: ContentWidth = DEFAULT_CONTENT_WIDTH;
  let scrollPositions: ScrollPositions = createScrollPositions();

  // 本文ズーム（アプリ全体で保持・非永続）。本文のみを拡大する。
  let contentZoom: ZoomPercent = DEFAULT_ZOOM_PERCENT;

  // テーマ制御。起動後に生成し、メニューの切替で setMode する（非永続）。
  let themeController: ThemeController | null = null;

  // mermaid 描画の世代管理。render() のたびに増やし、遅延 import 完了後の
  // 反映が最新世代かを判定して古い描画を破棄する。
  let renderSeq = 0;
  // 直近の描画に mermaid 図が含まれていたか。テーマ切替時の再描画要否の判定に使う。
  let previewHasMermaid = false;
  // 直近の描画で開始した mermaid 描画の完了 Promise。遅延描画で本文高さが変わるため、
  // スクロール復元（reloadTab）が完了後に再調整するのに使う。
  let pendingMermaid: Promise<void> = Promise.resolve();

  /** 本文最大幅をプレビューとツールバーラベルへ反映する。 */
  function applyContentWidth(): void {
    previewEl.style.setProperty(
      "--content-max-width",
      contentWidthToCss(contentWidth),
    );
    setContentWidthLabel(toolbarEls, contentWidth);
  }

  /** 本文ズーム倍率を本文領域（CSS 変数）とツールバーラベルへ反映する。 */
  function applyContentZoom(): void {
    // 本文（プレビュー/原文）の共通祖先 #content に倍率を載せ、本文側 CSS が乗算する。
    contentEl.style.setProperty(
      "--content-zoom",
      String(zoomToScale(contentZoom)),
    );
    setZoomLabel(toolbarEls, contentZoom);
  }

  /** ズーム倍率を更新して反映する（変化が無ければ何もしない）。 */
  function setContentZoom(next: ZoomPercent): void {
    if (next === contentZoom) {
      return;
    }
    contentZoom = next;
    applyContentZoom();
  }

  /** 現在の状態を UI 全体へ反映する。 */
  function render(): void {
    // 世代を進める。これ以前に開始した mermaid の遅延描画は破棄対象になる。
    const seq = ++renderSeq;
    renderTabBar(tabbarEl, state, {
      onSelect,
      onClose: (id) => void onClose(id),
    });
    applyContentWidth();
    applyContentZoom();
    const active = getActiveTab(state);
    if (!active) {
      // 空状態ではアプリ名へ戻す（印刷ヘッダーは onPrint で抑止されるため未設定で可）。
      document.title = APP_TITLE;
      previewEl.replaceChildren();
      previewHasMermaid = false;
      previewEl.classList.add("hidden");
      emptyStateEl.classList.remove("hidden");
      renderStatusBar(statusbarEl, null, null);
      // タブが無いときは「エディタで開く」を無効化。
      setOpenInEditorEnabled(toolbarEls, false);
      return;
    }
    // document.title を MD ファイル名（語幹）へ同期し、PDF の Title プロパティから
    // アプリ名を排除する。印刷ヘッダー（@page）も同時に同期。
    // 注: 保存ダイアログの既定ファイル名は WebView2 のネイティブ印刷経路が
    // 決めるため Web 層からは制御できず、プリセットは断念している。
    document.title = pdfTitleFromFileName(active.fileName);
    setPrintPageStyle(buildPrintPageStyle(active.fileName));
    emptyStateEl.classList.add("hidden");
    previewEl.classList.remove("hidden");
    setViewModeButtons(toolbarEls, active.viewMode);
    setOpenInEditorEnabled(toolbarEls, true);
    // 差分強調トグルは原文モードでは無効化（プレビュー時のみ作用）。
    setDiffToggle(toolbarEls, {
      active: diffHighlight,
      enabled: active.viewMode === "preview",
    });
    const result = renderPreview(previewEl, active, diffHighlight);
    // mermaid 図があれば遅延ロードして描画する（無ければ mermaid を import しない）。
    // renderPreview 直後の同期時点で判定する（この時点では未処理の pre.mermaid が残る）。
    previewHasMermaid =
      active.viewMode === "preview" &&
      previewEl.querySelector("pre.mermaid") !== null;
    if (previewHasMermaid) {
      pendingMermaid = renderMermaid(
        previewEl,
        () => seq === renderSeq,
        (error) => void reportError("mermaid 図の描画に失敗しました", error),
      );
    } else {
      pendingMermaid = Promise.resolve();
    }
    // ローカル画像（相対・絶対パス）を Rust 経由で data URI 化して埋め込む。
    // プレビュー時のみ。遅延解決のため世代（seq）で古い描画への上書きを防ぐ。
    if (active.viewMode === "preview") {
      void loadLocalImages(previewEl, active.path, () => seq === renderSeq);
    }
    renderStatusBar(
      statusbarEl,
      computeDocumentStats(active.source),
      active.path,
    );
    // 差分強調を縮退（省略）した場合のみ非モーダル通知を出す（無音失敗禁止）。
    setStatusNotice(
      statusbarEl,
      result.diffDegraded ? DIFF_DEGRADED_NOTICE : null,
    );
  }

  /** 現在アクティブタブのスクロール位置を記録する。 */
  function saveActiveScroll(): void {
    if (state.activeTabId !== null) {
      scrollPositions = setScrollPosition(
        scrollPositions,
        state.activeTabId,
        contentEl.scrollTop,
      );
    }
  }

  function onSelect(id: TabId): void {
    if (id === state.activeTabId) {
      return;
    }
    // 切替前に現在位置を保存し、切替後に対象タブの位置を復元する。
    saveActiveScroll();
    state = setActiveTab(state, id);
    render();
    const top = getScrollPosition(scrollPositions, id);
    requestAnimationFrame(() => {
      contentEl.scrollTop = top;
    });
  }

  async function onClose(id: TabId): Promise<void> {
    scrollPositions = removeScrollPosition(scrollPositions, id);
    state = closeTab(state, id);
    render();
    try {
      await stopWatch(id);
    } catch (error) {
      await reportError("監視の停止に失敗しました", error);
    }
  }

  function onSelectMode(mode: ViewMode): void {
    const active = getActiveTab(state);
    if (!active) {
      return;
    }
    state = setTabViewMode(state, active.id, mode);
    render();
  }

  /** 差分強調の ON/OFF を切り替える。原文モードでは無効。 */
  function onToggleDiff(): void {
    const active = getActiveTab(state);
    if (active?.viewMode !== "preview") {
      return;
    }
    diffHighlight = !diffHighlight;
    render();
  }

  /** 本文最大幅を順送りする。 */
  function onCycleWidth(): void {
    contentWidth = cycleContentWidth(contentWidth);
    applyContentWidth();
  }

  /** 文字サイズ（ズーム）を順送りする（末尾で先頭へ折り返す）。 */
  function onCycleZoom(): void {
    setContentZoom(cycleZoom(contentZoom));
  }

  /** テーマモードを切り替える（ライト/ダーク/システム）。初期化前は無視する。 */
  function onSelectTheme(mode: LaunchTheme): void {
    if (!themeController) {
      return;
    }
    const controller = themeController;
    void (async () => {
      try {
        await controller.setMode(mode);
        setThemeButtons(toolbarEls, mode);
      } catch (error) {
        await reportError("テーマの切り替えに失敗しました", error);
      }
    })();
  }

  /**
   * 印刷 / PDF 書き出し。現在の表示内容を「見たまま」印刷する。
   * 印刷用レイアウトは @media print（styles.css）が担い、ツールバー/タブを除外する。
   * 保存名・PDF Title（document.title）とヘッダー（@page）は render() で常時同期済みのため、
   * ここでは空状態をガードして印刷を起動するのみ。
   */
  function onPrint(): void {
    if (!getActiveTab(state)) {
      return;
    }
    window.print();
  }

  /** アクティブファイルを OS 既定アプリ（エディタ等）で開く。 */
  function onOpenInEditor(): void {
    const active = getActiveTab(state);
    if (!active) {
      return;
    }
    void (async () => {
      try {
        await openInEditor(active.path);
      } catch (error) {
        await reportError("エディタで開けませんでした", error);
      }
    })();
  }

  /** パスを開く。既存タブがあれば複製せずアクティブ化する。 */
  async function openPath(path: string): Promise<void> {
    try {
      const file = await readMarkdownFile(path);
      const existing = state.tabs.find((t) => t.path === file.path);
      if (existing) {
        state = setActiveTab(state, existing.id);
        render();
        return;
      }
      const id = nextTabId();
      const tab: Tab = {
        id,
        path: file.path,
        fileName: basename(file.path),
        source: file.content,
        previousSource: file.content,
        viewMode: DEFAULT_VIEW_MODE,
        isWatching: true,
      };
      state = openTab(state, tab);
      render();
      await startWatch(id, file.path);
    } catch (error) {
      await reportError("ファイルを開けませんでした", error);
    }
  }

  /** ダイアログでファイルを選んで開く。 */
  async function onOpenFile(): Promise<void> {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      });
      if (typeof selected === "string") {
        await openPath(selected);
      }
    } catch (error) {
      await reportError("ファイル選択に失敗しました", error);
    }
  }

  /** 監視通知を受けて該当タブを再読込し、アクティブなら再描画する。 */
  async function reloadTab(tabId: TabId): Promise<void> {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) {
      return;
    }
    try {
      const file = await readMarkdownFile(tab.path);
      state = updateTabSource(state, tabId, file.content);
      if (state.activeTabId === tabId) {
        // 再描画で本文高さが変わるため、スクロール位置を比率で近似復元する。
        const prevTop = contentEl.scrollTop;
        const prevHeight = contentEl.scrollHeight;
        render();
        const restoreScroll = (): void => {
          const nextTop = preserveScrollRatio(
            prevTop,
            prevHeight,
            contentEl.scrollHeight,
          );
          contentEl.scrollTop = nextTop;
          scrollPositions = setScrollPosition(scrollPositions, tabId, nextTop);
        };
        requestAnimationFrame(restoreScroll);
        // mermaid は遅延描画で完了後に高さが変わるため、完了後にもう一度復元する。
        void pendingMermaid.then(() => requestAnimationFrame(restoreScroll));
      }
    } catch (error) {
      await reportError("変更の再読込に失敗しました", error);
    }
  }

  // テーマ追従：Tauri のウィンドウテーマを ThemeSource として注入。
  // 起動引数で dark/light が指定された場合は固定適用し OS 追従しない。
  const win = getCurrentWindow();
  const themeSource: ThemeSource = {
    current: async () => toAppTheme(await win.theme()),
    onChange: (handler) =>
      win.onThemeChanged(({ payload }) => {
        handler(toAppTheme(payload));
      }),
  };

  // 副次コマンドを束ねる「…」メニュー。終端操作では閉じ、調整系（本文幅）は開いたまま。
  const overflowMenu = initOverflowMenu({
    button: requireEl("more-menu-button", HTMLButtonElement),
    menu: requireEl("more-menu", HTMLElement),
  });

  initToolbar(toolbarEls, {
    onOpenFile: () => {
      overflowMenu.close();
      void onOpenFile();
    },
    onSelectMode,
    onToggleDiff,
    // 本文幅はメニュー内で連続切替できるよう、クリックしても閉じない。
    onCycleWidth,
    onCycleZoom,
    onPrint: () => {
      overflowMenu.close();
      onPrint();
    },
    onOpenInEditor: () => {
      overflowMenu.close();
      onOpenInEditor();
    },
    // テーマ切替はメニューを開いたまま（選択状態を見比べられるように）。
    onSelectTheme,
  });

  // ウェルカム画面の「ファイルを開く」。ツールバーと同じ導線。
  welcomeOpenEl.addEventListener("click", () => void onOpenFile());

  /** ドロップされた Markdown を順に開く。md 以外のみのドロップは無視する。 */
  async function onDrop(paths: readonly string[]): Promise<void> {
    const mdPaths = filterMarkdownPaths([...paths]);
    for (const path of mdPaths) {
      await openPath(path);
    }
  }

  // Ctrl+P で印刷。空状態での既定印刷を抑止するため横取りしてガード経由で呼ぶ。
  // Ctrl + +/-/0 で本文ズーム。素のキーは横取りしない。
  // 右クリックのカスタムコンテキストメニュー（コピー/表示幅/印刷/エディタ）。
  // WebView 既定メニューは抑止し、本メニューを表示する。動作は既存ハンドラを再利用。
  initContextMenu(
    {
      menu: requireEl("context-menu", HTMLElement),
      copy: requireEl("ctx-copy", HTMLButtonElement),
      width: requireEl("ctx-width", HTMLButtonElement),
      print: requireEl("ctx-print", HTMLButtonElement),
      editor: requireEl("ctx-editor", HTMLButtonElement),
    },
    {
      resolve: () => {
        const selection = window.getSelection();
        const text =
          selection && !selection.isCollapsed ? selection.toString() : "";
        return {
          selectionText: text.length > 0 ? text : null,
          hasActiveTab: Boolean(getActiveTab(state)),
          widthLabel: contentWidthLabel(contentWidth),
        };
      },
      onCopy: (text) => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(text);
          } catch (error) {
            await reportError("コピーに失敗しました", error);
          }
        })();
      },
      onWidth: onCycleWidth,
      onPrint,
      onEditor: onOpenInEditor,
    },
  );

  window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "p") {
      event.preventDefault();
      onPrint();
      return;
    }
    // "+"（=/;+）は "=" として、テンキーは "Add"/"Subtract" として届くため両対応。
    if (key === "+" || key === "=" || event.key === "Add") {
      event.preventDefault();
      setContentZoom(zoomIn(contentZoom));
    } else if (key === "-" || event.key === "Subtract") {
      event.preventDefault();
      setContentZoom(zoomOut(contentZoom));
    } else if (key === "0") {
      event.preventDefault();
      setContentZoom(resetZoom());
    }
  });

  // Ctrl+ホイールで本文ズーム（素のホイールはスクロールのまま）。
  // passive:false でないと preventDefault が効かないため明示する。
  contentEl.addEventListener(
    "wheel",
    (event) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      event.preventDefault();
      setContentZoom(
        event.deltaY < 0 ? zoomIn(contentZoom) : zoomOut(contentZoom),
      );
    },
    { passive: false },
  );

  // data-theme の変更（メニュー手動切替・OS 追従の両方）で mermaid 図の配色を追従させる。
  // mermaid の色は生成時に SVG へ焼き込まれ CSS 変数では追従しないため、再描画が要る。
  // mermaid 在時のみ再描画し、非 mermaid 文書のスクロール位置は維持する（回帰防止）。
  const themeObserver = new MutationObserver(() => {
    if (previewHasMermaid) {
      render();
    }
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  // イベント購読と初期描画。失敗は通知して握りつぶさない。
  void (async () => {
    try {
      const launchTheme = await getLaunchTheme();
      themeController = await createThemeController(
        document.documentElement,
        themeSource,
        launchTheme,
      );
      setThemeButtons(toolbarEls, launchTheme);
      // 2 回目以降の起動（「送る」/関連付け等）で転送されたファイルを開く。
      await onOpenFiles((paths) => {
        void onDrop(paths);
      });
      await onFileChanged(({ tabId }) => void reloadTab(tabId));
      await onWatchError(
        ({ message: msg }) =>
          void reportError("ファイル監視でエラーが発生しました", msg),
      );
      // ドラッグ&ドロップでファイルを開く。enter/over でハイライト、drop で開く。
      await onFileDrop((event) => {
        if (event.kind === "drop") {
          contentEl.classList.remove("is-drop-target");
          void onDrop(event.paths);
        } else if (event.kind === "leave") {
          contentEl.classList.remove("is-drop-target");
        } else {
          contentEl.classList.add("is-drop-target");
        }
      });
      const launchFiles = await getLaunchFiles();
      for (const path of launchFiles) {
        await openPath(path);
      }
    } catch (error) {
      await reportError("初期化に失敗しました", error);
    } finally {
      render();
    }
  })();
}

window.addEventListener("DOMContentLoaded", bootstrap);
