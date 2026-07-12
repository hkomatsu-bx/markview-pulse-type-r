//! ファイル変更監視。
//!
//! `notify` の FS イベントを既定とし、イベントが届かない環境では mtime
//! ポーリングへ自動 fallback する。連続イベントはデバウンスして通知する。
//!
//! Tauri への依存を避けるため、通知は [`ChangeEmitter`] トレイト経由で行う。
//! 実アプリの emitter は `commands::watcher` 側で `AppHandle` を包んで実装する。
//! 純粋な判定ロジック（[`Debouncer`] / [`mtime_changed`]）を分離し単体試験可能にする。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::error::AppError;

/// 連続イベントを抑制するデバウンス間隔。
const DEBOUNCE_INTERVAL: Duration = Duration::from_millis(150);
/// mtime ポーリングの確認間隔。
const POLL_INTERVAL: Duration = Duration::from_millis(1000);

/// 変更通知の送出先。Tauri 非依存にしてテスト時はモックへ差し替える。
pub trait ChangeEmitter: Send + Sync + 'static {
    fn file_changed(&self, tab_id: &str, path: &str);
    fn watch_error(&self, tab_id: &str, message: &str);
}

/// 直近通知からの経過時間でイベント発火可否を判定する純粋なデバウンサ。
/// 本モジュール内（＋単体テスト）でのみ使う内部部品のため pub(crate)。
pub(crate) struct Debouncer {
    interval: Duration,
    last: Option<Instant>,
}

impl Debouncer {
    pub(crate) fn new(interval: Duration) -> Self {
        Self {
            interval,
            last: None,
        }
    }

    /// `now` 時点でイベントを通すべきなら true を返し、内部状態を更新する。
    pub(crate) fn accept(&mut self, now: Instant) -> bool {
        match self.last {
            Some(prev) if now.duration_since(prev) < self.interval => false,
            _ => {
                self.last = Some(now);
                true
            }
        }
    }
}

/// 前回と今回の mtime を比較し、変更があったかを判定する純関数（クレート内専用）。
pub(crate) fn mtime_changed(prev: Option<SystemTime>, current: Option<SystemTime>) -> bool {
    match (prev, current) {
        (Some(a), Some(b)) => a != b,
        (None, Some(_)) => true,
        _ => false,
    }
}

/// 対象パスの最終更新時刻を読む。取得できなければ `None`。
fn read_mtime(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// notify コールバックとポーリングスレッドが共有する監視状態。
/// 両経路で `last_mtime` と `debouncer` を共有し、同一変更の二重通知を防ぐ。
struct WatchShared {
    debouncer: Mutex<Debouncer>,
    last_mtime: Mutex<Option<SystemTime>>,
}

/// mtime の変化を検知したときだけ（デバウンスを通して）通知する。
/// notify・ポーリングのどちらから呼ばれても `last_mtime`/`debouncer` を共有するため
/// 二重発火せず、片方が取りこぼしても他方が拾える。
/// デバウンス却下時は `last_mtime` を据え置き、末尾変更を次のポーリングで再検知させる。
fn emit_if_changed(
    shared: &WatchShared,
    target: &Path,
    emitter: &Arc<dyn ChangeEmitter>,
    tab_id: &str,
    path_str: &str,
) {
    let current = read_mtime(target);
    let mut last = shared
        .last_mtime
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !mtime_changed(*last, current) {
        return;
    }
    let allowed = shared
        .debouncer
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .accept(Instant::now());
    if !allowed {
        // 据え置き（*last は更新しない）→ 次のポーリングで再検知される。
        return;
    }
    *last = current;
    drop(last);
    emitter.file_changed(tab_id, path_str);
}

/// 1 タブ分の監視ハンドル。drop で notify 監視は停止し、ポーリングは停止フラグで止める。
struct ActiveWatch {
    _watcher: Option<RecommendedWatcher>,
    stop: Arc<AtomicBool>,
}

/// タブ単位のファイル監視を管理する。Tauri の managed state として共有する。
#[derive(Default)]
pub struct WatchManager {
    watches: Mutex<HashMap<String, ActiveWatch>>,
}

impl WatchManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// `watches` ロックを取得する。毒された場合も内部値を回収して継続する。
    /// 監視マップへの各操作は独立しており、別スレッドの panic 後も論理的に有効なため、
    /// poison で再 panic させず処理を続ける。
    fn lock_watches(&self) -> std::sync::MutexGuard<'_, HashMap<String, ActiveWatch>> {
        self.watches
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 指定タブの監視を開始する。既存監視があれば置き換える。
    ///
    /// notify による即時検知と、mtime ポーリングの安全網を**常時併走**させる。
    /// notify 8 の Windows バックエンドはバッファ溢れ等の未知エラーで監視を黙って
    /// 解除するため（再アームせず、ハンドラへも通知されない）、notify 単独では
    /// 変更が無音で拾えなくなり得る。ポーリングを常に走らせることで、notify が
    /// 停止・失敗しても FR-02（自動再読込）を維持する。両経路は状態を共有し
    /// 二重通知しない。
    pub fn start_watch(&self, tab_id: String, path: PathBuf, emitter: Arc<dyn ChangeEmitter>) {
        self.stop_watch(&tab_id);

        // 監視・mtime 比較には正規化パスを使う。相対パスや大文字小文字差で起動
        // されても notify のイベントパス（cwd で絶対化・on-disk 実名）と一致させ、
        // 監視の無音化を防ぐ。フロントへ送るパスは同定・表示の一貫性のため元の
        // パスを維持する（正規化した `\\?\` 付きパスは渡さない）。
        let watch_path = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        let path_str = path.display().to_string();

        let shared = Arc::new(WatchShared {
            debouncer: Mutex::new(Debouncer::new(DEBOUNCE_INTERVAL)),
            last_mtime: Mutex::new(read_mtime(&watch_path)),
        });

        // notify は即時検知のベストエフォート。失敗しても致命ではない（ポーリングが
        // 検知を担う）ため、利用者へ通知しつつ継続する。
        let watcher = match Self::spawn_notify(
            &tab_id,
            &watch_path,
            &path_str,
            Arc::clone(&emitter),
            Arc::clone(&shared),
        ) {
            Ok(watcher) => Some(watcher),
            Err(err) => {
                emitter.watch_error(&tab_id, &err.to_string());
                None
            }
        };

        // ポーリングを安全網として常時起動する。
        let stop = Arc::new(AtomicBool::new(false));
        Self::spawn_polling(
            tab_id.clone(),
            watch_path,
            path_str,
            emitter,
            shared,
            Arc::clone(&stop),
        );

        self.lock_watches().insert(
            tab_id,
            ActiveWatch {
                _watcher: watcher,
                stop,
            },
        );
    }

    /// 指定タブの監視を停止し、ハンドルを破棄する。
    pub fn stop_watch(&self, tab_id: &str) {
        if let Some(active) = self.lock_watches().remove(tab_id) {
            active.stop.store(true, Ordering::Relaxed);
            // _watcher は drop で監視解除される。
        }
    }

    /// notify ベースの監視を構築する。親ディレクトリを監視し対象パスのイベントのみ拾う
    /// （エディタの atomic rename 保存に対応するため）。実際の通知可否は
    /// [`emit_if_changed`] が `shared`（mtime/デバウンス）を見て判定する。
    fn spawn_notify(
        tab_id: &str,
        watch_path: &Path,
        path_str: &str,
        emitter: Arc<dyn ChangeEmitter>,
        shared: Arc<WatchShared>,
    ) -> Result<RecommendedWatcher, AppError> {
        let watch_dir = watch_path.parent().unwrap_or(watch_path).to_path_buf();
        let target = watch_path.to_path_buf();
        let path_str = path_str.to_string();
        let tab = tab_id.to_string();

        let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            let Ok(event) = res else { return };
            if !matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Any
            ) {
                return;
            }
            if !event.paths.iter().any(|p| p == &target) {
                return;
            }
            emit_if_changed(&shared, &target, &emitter, &tab, &path_str);
        })
        .map_err(|e| AppError::Watch(format!("watcher 生成失敗: {e}")))?;

        watcher
            .watch(&watch_dir, RecursiveMode::NonRecursive)
            .map_err(|e| AppError::Watch(format!("watch 登録失敗: {e}")))?;

        Ok(watcher)
    }

    /// mtime ポーリングによる安全網スレッドを起動する。notify と併走し、
    /// [`emit_if_changed`] を通じて `shared` を notify 側と共有する。
    fn spawn_polling(
        tab_id: String,
        watch_path: PathBuf,
        path_str: String,
        emitter: Arc<dyn ChangeEmitter>,
        shared: Arc<WatchShared>,
        stop: Arc<AtomicBool>,
    ) {
        thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                thread::sleep(POLL_INTERVAL);
                emit_if_changed(&shared, &watch_path, &emitter, &tab_id, &path_str);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// 通知を記録するテスト用 emitter。
    #[derive(Default)]
    struct RecordingEmitter {
        changes: StdMutex<Vec<(String, String)>>,
    }

    impl ChangeEmitter for RecordingEmitter {
        fn file_changed(&self, tab_id: &str, path: &str) {
            self.changes
                .lock()
                .unwrap()
                .push((tab_id.to_string(), path.to_string()));
        }
        fn watch_error(&self, _tab_id: &str, _message: &str) {}
    }

    #[test]
    fn debouncer_allows_first_event() {
        let mut d = Debouncer::new(Duration::from_millis(150));
        assert!(d.accept(Instant::now()));
    }

    #[test]
    fn debouncer_suppresses_event_within_interval() {
        let mut d = Debouncer::new(Duration::from_millis(150));
        let t0 = Instant::now();
        assert!(d.accept(t0));
        assert!(!d.accept(t0 + Duration::from_millis(50)));
    }

    #[test]
    fn debouncer_allows_event_after_interval() {
        let mut d = Debouncer::new(Duration::from_millis(150));
        let t0 = Instant::now();
        assert!(d.accept(t0));
        assert!(d.accept(t0 + Duration::from_millis(200)));
    }

    #[test]
    fn mtime_changed_detects_difference() {
        let a = SystemTime::UNIX_EPOCH;
        let b = a + Duration::from_secs(5);
        assert!(mtime_changed(Some(a), Some(b)));
    }

    #[test]
    fn mtime_unchanged_when_equal() {
        let a = SystemTime::UNIX_EPOCH + Duration::from_secs(10);
        assert!(!mtime_changed(Some(a), Some(a)));
    }

    #[test]
    fn mtime_changed_when_file_appears() {
        assert!(mtime_changed(None, Some(SystemTime::UNIX_EPOCH)));
    }

    #[test]
    fn stop_watch_on_unknown_tab_is_noop() {
        let manager = WatchManager::new();
        manager.stop_watch("no-such-tab"); // パニックしないこと
    }

    #[test]
    fn recording_emitter_captures_change() {
        let emitter = RecordingEmitter::default();
        emitter.file_changed("tab-1", "/a.md");
        let changes = emitter.changes.lock().unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].0, "tab-1");
    }

    /// 実ファイルを開始→変更し、実際に通知が発火することを確認する統合的テスト。
    /// notify かポーリング安全網のいずれかが拾えばよい（FR-02 の実挙動を担保）。
    /// 純ヘルパ単体では通らない「登録→OS/ポーリング→判定→emit」の経路を実行する。
    #[test]
    fn start_watch_detects_real_file_modification() {
        use std::io::Write;

        // 一意な一時ファイル（乱数不使用・PID で他プロセスと衝突回避）。
        let file = std::env::temp_dir().join(format!("mviewr_watch_{}.md", std::process::id()));
        std::fs::write(&file, "initial").expect("write initial");

        let recorder = Arc::new(RecordingEmitter::default());
        let emitter: Arc<dyn ChangeEmitter> = Arc::clone(&recorder) as Arc<dyn ChangeEmitter>;
        let manager = WatchManager::new();
        manager.start_watch("tab-1".to_string(), file.clone(), emitter);

        // 変更前は通知が無いこと。
        thread::sleep(Duration::from_millis(200));
        assert_eq!(recorder.changes.lock().unwrap().len(), 0);

        // mtime を確実に変えるため十分待ってから書き換える。
        thread::sleep(Duration::from_millis(1100));
        {
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .truncate(true)
                .open(&file)
                .expect("open for write");
            f.write_all(b"updated content").expect("write update");
            f.sync_all().expect("sync");
        }

        // notify（即時）かポーリング（<=1s）で検知されるまで待つ（最大 ~6s）。
        let mut detected = false;
        for _ in 0..30 {
            thread::sleep(Duration::from_millis(200));
            if !recorder.changes.lock().unwrap().is_empty() {
                detected = true;
                break;
            }
        }

        manager.stop_watch("tab-1");
        let _ = std::fs::remove_file(&file);

        assert!(
            detected,
            "ファイル変更は notify かポーリング安全網で検知されるべき"
        );
    }
}
