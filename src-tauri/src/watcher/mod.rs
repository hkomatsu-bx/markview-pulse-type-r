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

/// 変更検知の出どころ。notify の実イベントか、mtime ポーリングか。
/// notify 側は mtime 同値でも通知する（[`emit_if_changed`] の判定を参照）。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Trigger {
    Notify,
    Poll,
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
    trigger: Trigger,
) {
    // mtime の読取はロック内で行う。ロック外だと notify とポーリングが古い値を
    // 後勝ちで書き戻し、last_mtime が巻き戻って同一変更を二重通知し得る。
    let mut last = shared
        .last_mtime
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let current = read_mtime(target);

    // 監視対象が消えた（Some → None）。mtime 比較では「変更なし」に見えてしまい、
    // タブが古い内容を表示したまま無音で取り残されるため、明示的に通知する。
    // 通知は 1 回だけにしたいので last を None へ落として再検知を止める。
    if last.is_some() && current.is_none() {
        *last = None;
        drop(last);
        emitter.watch_error(tab_id, &format!("ファイルが見つかりません: {path_str}"));
        return;
    }
    // notify の実イベントは「変更があった」ことの一次情報なので mtime 同値でも通す。
    // FAT32/exFAT のように mtime 粒度が粗い媒体（2 秒）では、粒度内の 2 回目以降の
    // 保存が mtime 同値になり、mtime 比較だけに頼ると恒久的に取りこぼすため。
    // ポーリングは mtime 変化しか手掛かりが無いので従来どおり比較する。
    if trigger == Trigger::Poll && !mtime_changed(*last, current) {
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

/// 破棄されたら必ずポーリングを止める。
///
/// 停止フラグの設定を `stop_watch` の明示呼び出しだけに頼ると、同一 tab_id への
/// `start_watch` が並行したときに `HashMap::insert` が旧エントリを黙って置換し、
/// 旧スレッドが誰にも止められないまま残留する（二重通知＋スレッドリーク）。
/// Drop に置けば、置換・削除・マネージャ破棄のどの経路でも確実に停止する。
impl Drop for ActiveWatch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
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
    /// 停止・失敗しても自動再読込を維持する。両経路は状態を共有し
    /// 二重通知しない。
    pub fn start_watch(&self, tab_id: String, path: PathBuf, emitter: Arc<dyn ChangeEmitter>) {
        self.stop_watch(&tab_id);

        // 監視・mtime 比較には正規化パスを使う。相対パスや大文字小文字差で起動
        // されても notify のイベントパス（cwd で絶対化・on-disk 実名）と一致させ、
        // 監視の無音化を防ぐ。フロントへ送るパスは同定・表示の一貫性のため元の
        // パスを維持する（正規化した `\\?\` 付きパスは渡さない）。
        let path_str = path.display().to_string();
        let watch_path = std::fs::canonicalize(&path).unwrap_or(path);

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
    /// 停止フラグの設定と notify の解除はいずれも `ActiveWatch` の drop が担う。
    pub fn stop_watch(&self, tab_id: &str) {
        self.lock_watches().remove(tab_id);
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
            let event = match res {
                Ok(event) => event,
                Err(err) => {
                    // notify 自体の失敗（バッファ溢れ等）。検知はポーリング安全網が
                    // 引き継ぐため致命ではないが、無音にはしない。
                    eprintln!("[watcher] notify のイベント受信に失敗 (tab={tab}): {err}");
                    return;
                }
            };
            // Remove も拾う。削除は emit_if_changed が Some→None として検知し
            // watch-error を出す（ポーリング待ちにせず即時に伝える）。
            if !matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_) | EventKind::Any
            ) {
                return;
            }
            if !event.paths.iter().any(|p| p == &target) {
                return;
            }
            emit_if_changed(&shared, &target, &emitter, &tab, &path_str, Trigger::Notify);
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
                // sleep 中に停止された場合、目覚めてすぐ抜ける（閉じたタブ宛の
                // 余剰イベントを出さないため、sleep 後にも停止を確認する）。
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                emit_if_changed(
                    &shared,
                    &watch_path,
                    &emitter,
                    &tab_id,
                    &path_str,
                    Trigger::Poll,
                );
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
        errors: StdMutex<Vec<(String, String)>>,
    }

    impl ChangeEmitter for RecordingEmitter {
        fn file_changed(&self, tab_id: &str, path: &str) {
            self.changes
                .lock()
                .unwrap()
                .push((tab_id.to_string(), path.to_string()));
        }
        fn watch_error(&self, tab_id: &str, message: &str) {
            self.errors
                .lock()
                .unwrap()
                .push((tab_id.to_string(), message.to_string()));
        }
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

    /// notify の実イベントは mtime が同値でも通知する。mtime 粒度の粗い媒体
    /// （FAT32/exFAT は 2 秒）で粒度内の再保存を取りこぼさないため。
    #[test]
    fn notify_trigger_emits_even_when_mtime_is_unchanged() {
        let dir = std::env::temp_dir().join(format!("mviewr_trig_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("same_mtime.md");
        std::fs::write(&file, "a").expect("write");

        let recorder = Arc::new(RecordingEmitter::default());
        let emitter: Arc<dyn ChangeEmitter> = Arc::clone(&recorder) as Arc<dyn ChangeEmitter>;
        // last_mtime を現在値に揃え、「mtime に変化が無い」状況を作る。
        let shared = WatchShared {
            debouncer: Mutex::new(Debouncer::new(Duration::from_millis(0))),
            last_mtime: Mutex::new(read_mtime(&file)),
        };

        emit_if_changed(&shared, &file, &emitter, "tab-1", "p", Trigger::Poll);
        assert_eq!(
            recorder.changes.lock().unwrap().len(),
            0,
            "ポーリングは mtime 同値なら通知しない"
        );

        emit_if_changed(&shared, &file, &emitter, "tab-1", "p", Trigger::Notify);
        assert_eq!(
            recorder.changes.lock().unwrap().len(),
            1,
            "notify の実イベントは mtime 同値でも通知する"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 監視対象が消えたら watch-error で通知する（無音で古い内容を表示し続けない）。
    #[test]
    fn reports_watch_error_when_the_file_disappears() {
        let dir = std::env::temp_dir().join(format!("mviewr_del_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("gone.md");
        std::fs::write(&file, "a").expect("write");

        let recorder = Arc::new(RecordingEmitter::default());
        let emitter: Arc<dyn ChangeEmitter> = Arc::clone(&recorder) as Arc<dyn ChangeEmitter>;
        let shared = WatchShared {
            debouncer: Mutex::new(Debouncer::new(Duration::from_millis(0))),
            last_mtime: Mutex::new(read_mtime(&file)),
        };

        std::fs::remove_file(&file).expect("remove");
        emit_if_changed(&shared, &file, &emitter, "tab-1", "p", Trigger::Poll);

        assert_eq!(recorder.errors.lock().unwrap().len(), 1, "削除は通知される");
        assert_eq!(
            recorder.changes.lock().unwrap().len(),
            0,
            "削除は file-changed ではない"
        );

        // 2 回目以降は繰り返さない（毎秒のポーリングで鳴り続けない）。
        emit_if_changed(&shared, &file, &emitter, "tab-1", "p", Trigger::Poll);
        assert_eq!(recorder.errors.lock().unwrap().len(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// ActiveWatch の drop でポーリング停止フラグが立つ（置換・削除の双方で残留しない）。
    #[test]
    fn dropping_active_watch_stops_polling() {
        let stop = Arc::new(AtomicBool::new(false));
        {
            let _active = ActiveWatch {
                _watcher: None,
                stop: Arc::clone(&stop),
            };
        }
        assert!(stop.load(Ordering::Relaxed), "drop で停止フラグが立つこと");
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
