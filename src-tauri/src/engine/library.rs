//! The library orchestrator: scans folders, identifies files, keeps the
//! database in sync with the disk and tells the UI what changed.

use super::db::{episode_key, now, Db, FileRow, FolderRow};
use super::matcher;
use super::models::*;
use super::parse::{is_video_file, normalise_for_compare, parse_path, search_title, ParsedKind};
use super::providers::{is_not_found, Providers};
use anyhow::{anyhow, Result};
use futures::StreamExt;
use notify_debouncer_mini::{
    new_debouncer, notify::RecursiveMode, DebounceEventResult, DebouncedEventBatch, Debouncer,
};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// Files smaller than this are almost certainly samples, trailers or junk.
const MIN_VIDEO_BYTES: u64 = 15 * 1024 * 1024;
/// How many titles are identified in parallel (be polite to free APIs).
const CONCURRENCY: usize = 4;
/// When the metadata services are unreachable, try again after this long.
const OFFLINE_RETRY: Duration = Duration::from_secs(90);
/// Re-fetch metadata this old. TMDB's terms allow caching it for 6 months.
const REFRESH_AFTER: Duration = Duration::from_secs(150 * 24 * 3600);

const SKIP_DIRS: &[&str] = &[
    "@eaDir",
    "$RECYCLE.BIN",
    "System Volume Information",
    "#recycle",
    "lost+found",
    "node_modules",
];

pub enum Event {
    Progress(Progress),
    Changed,
}

pub type Sink = Arc<dyn Fn(Event) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Job {
    ScanAll,
    ScanFolder(i64),
    /// Re-try files that previously failed to match.
    RetryUnmatched,
}

pub struct Library {
    db: Mutex<Db>,
    providers: Providers,
    sink: Sink,
    progress: Mutex<Progress>,
    jobs: mpsc::UnboundedSender<Job>,
    jobs_rx: Mutex<Option<mpsc::UnboundedReceiver<Job>>>,
    last_changed: Mutex<Instant>,
    watcher: Mutex<Option<Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>>>,
    retry_scheduled: Arc<std::sync::atomic::AtomicBool>,
}

fn quality_rank(q: Option<&str>) -> u32 {
    match q {
        Some("2160p") => 5,
        Some("1080p") => 4,
        Some("720p") => 3,
        Some("576p") => 2,
        Some("480p") => 1,
        _ => 0,
    }
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(path)
        .to_string()
}

impl Library {
    pub fn new(db_path: &Path, sink: Sink) -> Result<Arc<Self>> {
        let db = Db::open(db_path)?;
        let (tx, rx) = mpsc::unbounded_channel();
        Ok(Arc::new(Self {
            db: Mutex::new(db),
            providers: Providers::new(),
            sink,
            progress: Mutex::new(Progress {
                phase: "idle".into(),
                ..Default::default()
            }),
            jobs: tx,
            jobs_rx: Mutex::new(Some(rx)),
            last_changed: Mutex::new(Instant::now() - Duration::from_secs(10)),
            watcher: Mutex::new(None),
            retry_scheduled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }))
    }

    pub fn providers(&self) -> &Providers {
        &self.providers
    }

    fn db(&self) -> std::sync::MutexGuard<'_, Db> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn request(&self, job: Job) {
        let _ = self.jobs.send(job);
    }

    pub fn progress(&self) -> Progress {
        self.progress.lock().unwrap().clone()
    }

    fn set_progress(&self, f: impl FnOnce(&mut Progress)) {
        let snapshot = {
            let mut p = self.progress.lock().unwrap();
            f(&mut p);
            p.clone()
        };
        (self.sink)(Event::Progress(snapshot));
    }

    /// Tell the UI to refetch, at most every 350 ms unless forced.
    fn changed(&self, force: bool) {
        let mut last = self.last_changed.lock().unwrap();
        if force || last.elapsed() > Duration::from_millis(350) {
            *last = Instant::now();
            drop(last);
            (self.sink)(Event::Changed);
        }
    }

    // ------------------------------------------------------------------ worker

    /// Long-running loop that processes scan jobs one batch at a time.
    pub async fn run_worker(self: Arc<Self>) {
        let mut rx = match self.jobs_rx.lock().unwrap().take() {
            Some(rx) => rx,
            None => return,
        };
        while let Some(first) = rx.recv().await {
            // Coalesce bursts of requests (e.g. watcher events) into one pass.
            tokio::time::sleep(Duration::from_millis(150)).await;
            let mut jobs: HashSet<Job> = HashSet::from([first]);
            while let Ok(j) = rx.try_recv() {
                jobs.insert(j);
            }
            if let Err(e) = self.process(jobs).await {
                log::error!("library job failed: {e:#}");
            }
        }
    }

    pub async fn process(&self, jobs: HashSet<Job>) -> Result<()> {
        let folders = self.db().folders()?;
        let targets: Vec<FolderRow> = if jobs.contains(&Job::ScanAll) {
            folders
        } else {
            folders
                .into_iter()
                .filter(|f| jobs.contains(&Job::ScanFolder(f.id)))
                .collect()
        };
        if jobs.contains(&Job::RetryUnmatched) {
            let db = self.db();
            for f in db.files_with_status("unmatched")? {
                db.set_file_match(&f.path, "pending", None, None, None)?;
            }
        }

        if !targets.is_empty() {
            self.set_progress(|p| {
                *p = Progress {
                    active: true,
                    phase: "scanning".into(),
                    ..Default::default()
                };
            });
            let mut found = 0;
            for f in &targets {
                self.set_progress(|p| p.current = Some(f.path.clone()));
                match self.scan_folder(f).await {
                    Ok(n) => found += n,
                    Err(e) => log::warn!("scan of {} failed: {e:#}", f.path),
                }
            }
            self.set_progress(|p| p.found = found);
            self.changed(true);
        }

        let deferred = self.identify_pending().await?;
        if deferred > 0 {
            self.schedule_retry();
        } else if jobs.contains(&Job::ScanAll) {
            if let Err(e) = self.refresh_stale().await {
                log::warn!("metadata refresh failed: {e:#}");
            }
        }
        self.set_progress(|p| {
            p.active = false;
            p.phase = "idle".into();
            p.current = None;
        });
        self.changed(true);
        Ok(())
    }

    /// Walk a folder and reconcile the `files` table with what is on disk.
    /// Returns the number of new files.
    async fn scan_folder(&self, folder: &FolderRow) -> Result<usize> {
        let root = PathBuf::from(&folder.path);
        if !root.exists() {
            // Unplugged drive: keep everything, the UI shows it as offline.
            return Ok(0);
        }
        let found = tokio::task::spawn_blocking(move || walk(&root)).await??;
        let existing: HashMap<String, FileRow> = self
            .db()
            .files_in_folder(folder.id)?
            .into_iter()
            .map(|f| (f.path.clone(), f))
            .collect();

        let mut new_count = 0;
        let seen: HashSet<&String> = found.iter().map(|(p, _, _)| p).collect();
        {
            let db = self.db();
            let tx = db.conn.unchecked_transaction()?;
            for (path, size, mtime) in &found {
                match existing.get(path) {
                    Some(row) if row.size == *size && row.mtime == *mtime => {}
                    Some(_) => {
                        tx.execute(
                            "UPDATE files SET size = ?2, mtime = ?3 WHERE path = ?1",
                            rusqlite::params![path, *size as i64, mtime],
                        )?;
                    }
                    None => {
                        let parsed = parse_path(Path::new(path));
                        if parsed.is_sample || parsed.is_extra {
                            continue;
                        }
                        db.insert_file(folder.id, path, *size, *mtime, &parsed)?;
                        new_count += 1;
                    }
                }
            }
            tx.commit()?;
            let gone: Vec<String> = existing.keys().filter(|p| !seen.contains(p)).cloned().collect();
            if !gone.is_empty() {
                db.delete_files(&gone)?;
            }
        }
        Ok(new_count)
    }

    /// Identify every pending file. Returns how many titles were deferred
    /// because the metadata services could not be reached.
    async fn identify_pending(&self) -> Result<usize> {
        let pending = self.db().files_with_status("pending")?;
        if pending.is_empty() {
            return Ok(0);
        }
        // Group files that refer to the same title so each title is looked up once.
        let mut groups: BTreeMap<String, Vec<FileRow>> = BTreeMap::new();
        for f in pending {
            let key = match f.parsed.kind {
                ParsedKind::Movie => format!("m:{}:{:?}", normalise_for_compare(&f.parsed.title), f.parsed.year),
                ParsedKind::Episode => format!(
                    "s:{}:{:?}",
                    normalise_for_compare(&search_title(&f.parsed)),
                    f.parsed.year
                ),
            };
            groups.entry(key).or_default().push(f);
        }
        let total = groups.len();
        self.set_progress(|p| {
            p.active = true;
            p.phase = "identifying".into();
            p.total = total;
            p.done = 0;
            p.matched = 0;
            p.failed = 0;
            p.deferred = 0;
        });

        // After a run of "unreachable" results, assume we're offline and stop
        // hammering the network; the rest is deferred and retried later.
        let offline_streak = std::sync::atomic::AtomicUsize::new(0);
        let offline_streak = &offline_streak;
        let stream = futures::stream::iter(groups.into_values())
            .map(|files| async move {
                let label = files[0].parsed.title.clone();
                use std::sync::atomic::Ordering::SeqCst;
                if offline_streak.load(SeqCst) >= CONCURRENCY * 2 {
                    return (label, Err(anyhow!("offline: skipped")));
                }
                let res = self.identify_group(&files).await;
                match &res {
                    Err(_) => offline_streak.fetch_add(1, SeqCst),
                    Ok(_) => offline_streak.swap(0, SeqCst),
                };
                (label, res)
            })
            .buffer_unordered(CONCURRENCY);
        futures::pin_mut!(stream);
        let mut deferred = 0;
        while let Some((label, res)) = stream.next().await {
            if let Err(e) = &res {
                log::warn!("identify '{label}' deferred: {e:#}");
                deferred += 1;
            }
            self.set_progress(|p| {
                p.done += 1;
                p.current = Some(label);
                match res {
                    Ok(true) => p.matched += 1,
                    Ok(false) => p.failed += 1,
                    Err(_) => p.deferred += 1,
                }
            });
            self.changed(false);
        }
        Ok(deferred)
    }

    /// Identify one group of files. Ok(true) when matched.
    async fn identify_group(&self, files: &[FileRow]) -> Result<bool> {
        let parsed = &files[0].parsed;
        // Err = every provider was unreachable: leave the files pending so a
        // later pass retries them, instead of wrongly flagging them for review.
        let result = matcher::identify(&self.providers, parsed).await?;
        let m = match result {
            Some(m) if m.accepted() => m,
            other => {
                let guess = other.map(|m| m.candidate.id);
                let db = self.db();
                for f in files {
                    db.set_file_match(&f.path, "unmatched", None, None, guess.as_deref())?;
                }
                return Ok(false);
            }
        };
        // TMDB results carry a TMDB id, but library titles are keyed by IMDb id
        // where one exists, so look for the title under either before fetching.
        let cand = &m.candidate;
        let known = {
            let db = self.db();
            match db.title(&cand.id)? {
                Some(_) => Some(cand.id.clone()),
                None => match cand.tmdb_id {
                    Some(tmdb_id) => db.title_id_for_tmdb(cand.kind, tmdb_id)?,
                    None => None,
                },
            }
        };
        let id = match known {
            Some(id) => id,
            None => {
                let meta = self.providers.details(&cand.id, cand.kind, Some(cand)).await?;
                self.db().upsert_title(&meta)?;
                meta.id
            }
        };
        let db = self.db();
        for f in files {
            db.set_file_match(&f.path, "matched", Some(&id), Some(m.score), None)?;
        }
        Ok(true)
    }

    /// Re-run identification later (at most one timer at a time).
    fn schedule_retry(&self) {
        if self.retry_scheduled.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let tx = self.jobs.clone();
        let flag = self.retry_scheduled.clone();
        tokio::spawn(async move {
            tokio::time::sleep(OFFLINE_RETRY).await;
            flag.store(false, std::sync::atomic::Ordering::SeqCst);
            let _ = tx.send(Job::ScanAll);
        });
    }

    // --------------------------------------------------------------- actions

    pub fn add_folders(self: &Arc<Self>, paths: &[String]) -> Result<Vec<i64>> {
        let mut ids = vec![];
        for p in paths {
            let path = PathBuf::from(p);
            let dir = if path.is_file() {
                path.parent()
                    .map(|d| d.to_path_buf())
                    .ok_or_else(|| anyhow!("bad path"))?
            } else {
                path
            };
            if !dir.is_dir() {
                continue;
            }
            let dir = dir.canonicalize().unwrap_or(dir);
            let dir_str = dir.to_string_lossy().to_string();
            // Skip folders already covered by an existing library folder.
            let covered = self
                .db()
                .folders()?
                .iter()
                .any(|f| dir_str == f.path || dir_str.starts_with(&format!("{}/", f.path)));
            if covered {
                continue;
            }
            let id = self.db().add_folder(&dir_str)?;
            ids.push(id);
            self.request(Job::ScanFolder(id));
        }
        self.rewatch();
        self.changed(true);
        Ok(ids)
    }

    pub fn remove_folder(self: &Arc<Self>, id: i64) -> Result<()> {
        self.db().remove_folder(id)?;
        self.rewatch();
        self.changed(true);
        Ok(())
    }

    pub fn set_state(&self, key: &str, patch: &StatePatch) -> Result<()> {
        let db = self.db();
        db.patch_state(key, patch)?;
        // Marking a whole show watched marks every local episode.
        if let (Some(w), false) = (patch.watched, key.contains(':')) {
            if db.title_kind(key)? == Some(TitleKind::Series) {
                for f in db.files_for_title(key)? {
                    if let (Some(s), Some(e)) = (f.season, f.episode) {
                        for ep in e..=f.episode_end.unwrap_or(e) {
                            db.patch_state(
                                &episode_key(key, s, ep),
                                &StatePatch {
                                    watched: Some(w),
                                    ..Default::default()
                                },
                            )?;
                        }
                    }
                }
            }
        }
        drop(db);
        self.changed(true);
        Ok(())
    }

    pub fn record_play(&self, path: &str) -> Result<()> {
        let db = self.db();
        let file = db.files()?.into_iter().find(|f| f.path == path);
        if let Some(f) = file {
            if let Some(tid) = &f.title_id {
                db.record_play(tid)?;
                if let (Some(s), Some(e)) = (f.season, f.episode) {
                    db.record_play(&episode_key(tid, s, e))?;
                }
            }
        }
        drop(db);
        self.changed(true);
        Ok(())
    }

    pub fn ignore_files(&self, paths: &[String]) -> Result<()> {
        let db = self.db();
        for p in paths {
            db.set_file_match(p, "ignored", None, None, None)?;
        }
        drop(db);
        self.changed(true);
        Ok(())
    }

    /// Manually assign files to a title (from the "Fix match" dialog).
    pub async fn assign(&self, paths: &[String], id: &str, kind: TitleKind) -> Result<()> {
        let meta = self.providers.details(id, kind, None).await?;
        let db = self.db();
        db.upsert_title(&meta)?;
        for p in paths {
            db.set_file_match(p, "manual", Some(&meta.id), Some(1.0), None)?;
            if kind == TitleKind::Movie {
                db.set_file_episode(p, None, None)?;
            }
        }
        db.prune_titles()?;
        drop(db);
        self.changed(true);
        Ok(())
    }

    pub async fn refresh_title(&self, id: &str) -> Result<()> {
        let kind = self.db().title_kind(id)?.unwrap_or_default();
        let meta = self.providers.details(id, kind, None).await?;
        self.db().upsert_title(&meta)?;
        self.changed(true);
        Ok(())
    }

    /// Re-fetch metadata older than `REFRESH_AFTER`, plus anything still from
    /// the sources used before TMDB. Stops at the first network error; the
    /// next full scan picks up the rest.
    async fn refresh_stale(&self) -> Result<()> {
        let cutoff = now() - REFRESH_AFTER.as_secs() as i64;
        let stale = self.db().stale_titles(cutoff)?;
        if stale.is_empty() {
            return Ok(());
        }
        log::info!("refreshing metadata for {} titles", stale.len());
        let stream = futures::stream::iter(stale)
            .map(|(id, kind)| async move {
                let res = self.providers.details(&id, kind, None).await;
                (id, res)
            })
            .buffer_unordered(CONCURRENCY);
        futures::pin_mut!(stream);
        let mut updated = 0;
        while let Some((id, res)) = stream.next().await {
            match res {
                Ok(meta) => {
                    self.db().upsert_title(&meta)?;
                    updated += 1;
                    if updated % 8 == 0 {
                        self.changed(false);
                    }
                }
                Err(e) if is_not_found(&e) => self.db().mark_title_checked(&id)?,
                Err(e) => {
                    log::warn!("refresh of {id} stopped: {e:#}");
                    break;
                }
            }
        }
        self.changed(true);
        Ok(())
    }

    // ------------------------------------------------------------- watching

    /// (Re)start the file-system watcher for all library folders.
    pub fn rewatch(self: &Arc<Self>) {
        let folders = match self.db().folders() {
            Ok(f) => f,
            Err(_) => return,
        };
        let weak = Arc::downgrade(self);
        let debouncer = new_debouncer(Duration::from_secs(3), move |res: DebounceEventResult| {
            if let (Ok(batch), Some(lib)) = (res, weak.upgrade()) {
                let relevant = match batch {
                    DebouncedEventBatch::Events(events) => events
                        .iter()
                        .any(|e| e.path.is_dir() || is_video_file(&e.path) || !e.path.exists()),
                    _ => true,
                };
                if relevant {
                    lib.request(Job::ScanAll);
                }
            }
        });
        match debouncer {
            Ok(mut d) => {
                for f in &folders {
                    if Path::new(&f.path).exists() {
                        if let Err(e) = d.watcher().watch(Path::new(&f.path), RecursiveMode::Recursive) {
                            log::warn!("cannot watch {}: {e}", f.path);
                        }
                    }
                }
                *self.watcher.lock().unwrap() = Some(d);
            }
            Err(e) => log::warn!("watcher unavailable: {e}"),
        }
    }

    // ---------------------------------------------------------------- views

    pub fn snapshot(&self) -> Result<LibrarySnapshot> {
        let db = self.db();
        let folders = db.folders()?;
        let files = db.files()?;
        let titles = db.titles()?;
        let state = db.all_state()?;
        drop(db);

        let online: HashMap<i64, bool> = folders.iter().map(|f| (f.id, Path::new(&f.path).exists())).collect();
        let mut by_title: HashMap<&str, Vec<&FileRow>> = HashMap::new();
        let mut per_folder: HashMap<i64, usize> = HashMap::new();
        let mut unmatched = vec![];
        let folder_path: HashMap<i64, &str> = folders.iter().map(|f| (f.id, f.path.as_str())).collect();
        for f in &files {
            *per_folder.entry(f.folder_id).or_default() += 1;
            match (f.status.as_str(), &f.title_id) {
                ("matched" | "manual", Some(t)) => by_title.entry(t.as_str()).or_default().push(f),
                ("unmatched", _) => unmatched.push(UnmatchedFile {
                    path: f.path.clone(),
                    file_name: file_name(&f.path),
                    folder: folder_path.get(&f.folder_id).map(|s| s.to_string()).unwrap_or_default(),
                    size: f.size,
                    added_at: f.added_at,
                    guess_title: f.parsed.title.clone(),
                    guess_year: f.parsed.year,
                    guess_kind: if f.parsed.kind == ParsedKind::Episode {
                        TitleKind::Series
                    } else {
                        TitleKind::Movie
                    },
                    season: f.season,
                    episode: f.episode,
                }),
                _ => {}
            }
        }

        let mut out = vec![];
        let mut stats = LibraryStats {
            unmatched: unmatched.len(),
            ..Default::default()
        };
        for t in &titles {
            let tf = by_title.get(t.meta.id.as_str()).cloned().unwrap_or_default();
            let st = state.get(&t.meta.id).cloned().unwrap_or_default();
            if tf.is_empty() && !st.watchlist {
                continue;
            }
            let s = build_summary(t, &tf, &state, &online);
            match s.kind {
                TitleKind::Movie => stats.movies += 1,
                TitleKind::Series => {
                    stats.shows += 1;
                    stats.episodes += s.episode_count;
                }
            }
            stats.total_size += s.total_size;
            out.push(s);
        }
        out.sort_by_key(|t| std::cmp::Reverse(t.added_at));
        unmatched.sort_by(|a, b| a.file_name.cmp(&b.file_name));

        Ok(LibrarySnapshot {
            titles: out,
            unmatched,
            folders: folders
                .iter()
                .map(|f| FolderInfo {
                    id: f.id,
                    path: f.path.clone(),
                    name: file_name(&f.path),
                    online: online.get(&f.id).copied().unwrap_or(false),
                    file_count: per_folder.get(&f.id).copied().unwrap_or(0),
                    added_at: f.added_at,
                })
                .collect(),
            stats,
        })
    }

    pub fn detail(&self, id: &str) -> Result<Option<TitleDetail>> {
        let db = self.db();
        let Some(t) = db.title(id)? else { return Ok(None) };
        let files: Vec<FileRow> = db
            .files_for_title(id)?
            .into_iter()
            .filter(|f| f.status == "matched" || f.status == "manual")
            .collect();
        let state = db.all_state()?;
        let folders = db.folders()?;
        drop(db);
        let online: HashMap<i64, bool> = folders.iter().map(|f| (f.id, Path::new(&f.path).exists())).collect();
        let refs: Vec<&FileRow> = files.iter().collect();
        let summary = build_summary(&t, &refs, &state, &online);

        let media: Vec<MediaFile> = files.iter().map(|f| media_file(f, &online)).collect();
        let mut seasons: Vec<SeasonView> = vec![];
        if t.meta.kind == TitleKind::Series {
            let mut map: BTreeMap<u32, BTreeMap<u32, EpisodeView>> = BTreeMap::new();
            for e in &t.meta.episodes {
                let st = state
                    .get(&episode_key(id, e.season, e.episode))
                    .cloned()
                    .unwrap_or_default();
                map.entry(e.season).or_default().insert(
                    e.episode,
                    EpisodeView {
                        season: e.season,
                        episode: e.episode,
                        name: e.name.clone(),
                        overview: e.overview.clone(),
                        thumbnail: e.thumbnail.clone(),
                        released: e.released.clone(),
                        rating: e.rating,
                        file: None,
                        watched: st.watched,
                        last_played_at: st.last_played_at,
                    },
                );
            }
            for (f, mf) in files.iter().zip(media.iter()) {
                let (Some(s), Some(e)) = (f.season, f.episode) else {
                    continue;
                };
                for ep in e..=f.episode_end.unwrap_or(e) {
                    let st = state.get(&episode_key(id, s, ep)).cloned().unwrap_or_default();
                    let entry = map.entry(s).or_default().entry(ep).or_insert_with(|| EpisodeView {
                        season: s,
                        episode: ep,
                        name: format!("Episode {ep}"),
                        watched: st.watched,
                        last_played_at: st.last_played_at,
                        ..Default::default()
                    });
                    if entry
                        .file
                        .as_ref()
                        .map(|x| quality_rank(x.quality.as_deref()) < quality_rank(mf.quality.as_deref()))
                        .unwrap_or(true)
                    {
                        entry.file = Some(mf.clone());
                    }
                }
            }
            for (num, eps) in map {
                let episodes: Vec<EpisodeView> = eps.into_values().collect();
                let available = episodes.iter().filter(|e| e.file.is_some()).count();
                seasons.push(SeasonView {
                    number: num,
                    episodes,
                    available,
                });
            }
            // Specials go last
            seasons.sort_by_key(|s| if s.number == 0 { u32::MAX } else { s.number });
        }

        Ok(Some(TitleDetail {
            summary,
            writers: t.meta.writers.clone(),
            people: t.meta.people.clone(),
            certification: t.meta.certification.clone(),
            tmdb_id: t.meta.tmdb_id,
            country: t.meta.country.clone(),
            awards: t.meta.awards.clone(),
            released: t.meta.released.clone(),
            status: t.meta.status.clone(),
            trailer: t.meta.trailer.clone(),
            files: media,
            seasons,
            source: t.meta.source.clone(),
        }))
    }

    pub fn file_title(&self, path: &str) -> Option<String> {
        self.db().files().ok()?.into_iter().find(|f| f.path == path)?.title_id
    }

    pub fn guess_for(&self, path: &str) -> Option<String> {
        self.db().files().ok()?.into_iter().find(|f| f.path == path)?.guess_id
    }

    pub fn now(&self) -> i64 {
        now()
    }
}

fn media_file(f: &FileRow, online: &HashMap<i64, bool>) -> MediaFile {
    MediaFile {
        path: f.path.clone(),
        file_name: file_name(&f.path),
        size: f.size,
        added_at: f.added_at,
        season: f.season,
        episode: f.episode,
        episode_end: f.episode_end,
        quality: f.parsed.quality_label(),
        source: f.parsed.source.clone(),
        codec: f.parsed.codec.clone(),
        hdr: f.parsed.hdr.clone(),
        audio: f.parsed.audio.clone(),
        edition: f.parsed.edition.clone(),
        status: f.status.clone(),
        online: online.get(&f.folder_id).copied().unwrap_or(false),
    }
}

fn build_summary(
    t: &super::db::TitleRow,
    files: &[&FileRow],
    state: &HashMap<String, UserState>,
    online: &HashMap<i64, bool>,
) -> TitleSummary {
    let m = &t.meta;
    let st = state.get(&m.id).cloned().unwrap_or_default();
    let best = files
        .iter()
        .max_by_key(|f| quality_rank(f.parsed.resolution.as_deref()))
        .and_then(|f| f.parsed.quality_label());

    let mut episodes: HashSet<(u32, u32)> = HashSet::new();
    for f in files {
        if let (Some(s), Some(e)) = (f.season, f.episode) {
            for ep in e..=f.episode_end.unwrap_or(e) {
                episodes.insert((s, ep));
            }
        }
    }
    let watched_eps = episodes
        .iter()
        .filter(|(s, e)| {
            state
                .get(&episode_key(&m.id, *s, *e))
                .map(|x| x.watched)
                .unwrap_or(false)
        })
        .count();
    let last_ep_play = episodes
        .iter()
        .filter_map(|(s, e)| state.get(&episode_key(&m.id, *s, *e)).and_then(|x| x.last_played_at))
        .max();
    let seasons: HashSet<u32> = episodes.iter().map(|(s, _)| *s).collect();

    let watched = match m.kind {
        TitleKind::Movie => st.watched,
        TitleKind::Series => !episodes.is_empty() && watched_eps == episodes.len(),
    };

    TitleSummary {
        id: m.id.clone(),
        kind: m.kind,
        name: m.name.clone(),
        year: m.year,
        year_label: m.year_label.clone(),
        poster: m.poster.clone(),
        poster_alt: m.poster_alt.clone(),
        backdrop: m.backdrop.clone(),
        logo: m.logo.clone(),
        overview: m.overview.clone(),
        rating: m.rating,
        runtime: m.runtime,
        genres: m.genres.clone(),
        directors: m.directors.clone(),
        cast: m.cast.clone(),
        added_at: files.iter().map(|f| f.added_at).max().unwrap_or(t.created_at),
        updated_at: t.updated_at,
        file_count: files.len(),
        total_size: files.iter().map(|f| f.size).sum(),
        episode_count: episodes.len(),
        watched_episodes: watched_eps,
        season_count: seasons.len(),
        quality: best,
        hdr: files.iter().any(|f| f.parsed.hdr.is_some()),
        online: files.iter().any(|f| online.get(&f.folder_id).copied().unwrap_or(false)),
        watched,
        favorite: st.favorite,
        watchlist: st.watchlist,
        user_rating: st.rating,
        last_played_at: st.last_played_at.max(last_ep_play),
    }
}

/// Recursively list video files: (path, size, mtime-ms).
fn walk(root: &Path) -> Result<Vec<(String, u64, i64)>> {
    let mut out = vec![];
    let it = walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            if e.depth() == 0 {
                return true;
            }
            !(name.starts_with('.') || SKIP_DIRS.contains(&name.as_ref()))
        });
    for entry in it.flatten() {
        if !entry.file_type().is_file() || !is_video_file(entry.path()) {
            continue;
        }
        let Ok(md) = entry.metadata() else { continue };
        if md.len() < MIN_VIDEO_BYTES {
            continue;
        }
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        out.push((entry.path().to_string_lossy().to_string(), md.len(), mtime));
    }
    Ok(out)
}
