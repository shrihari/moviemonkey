//! Working out how a TV can play a file, and making it playable when it can't.
//!
//! The TV reports what it can decode. If the file fits, it streams as it is.
//! Otherwise ffmpeg repackages it on the fly into HLS (small chunks the TV
//! fetches one by one), copying the picture when the TV can decode it and only
//! converting the audio or video that it can't.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::process::{Child, Command};

/// HLS chunk length, in seconds.
pub const SEGMENT_SECS: u32 = 4;
/// How far ahead of the TV ffmpeg may run before it's paused.
const AHEAD_SEGMENTS: u64 = 60;
/// Chunks the TV has already played are deleted, keeping this many.
const KEEP_BEHIND: u64 = 30;
/// A session nobody has asked anything of for this long is stopped.
const IDLE_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// Streams kept per device (the newest ones). A player that restarts quickly
/// may still be reading the previous one for a moment.
const SESSIONS_PER_DEVICE: usize = 2;
/// Streams across all devices, so a few TVs can't swamp the computer.
const SESSIONS_MAX: usize = 6;

// ------------------------------------------------------------------- tools

#[derive(Debug, Clone, Default)]
pub struct Tools {
    pub ffmpeg: Option<PathBuf>,
    pub ffprobe: Option<PathBuf>,
    pub encoders: HashSet<String>,
}

impl Tools {
    /// Find ffmpeg: next to the app (a bundled copy), then where package
    /// managers put it. Apps started from Finder don't get the shell's PATH,
    /// so the usual folders are checked by name.
    pub fn detect() -> Tools {
        let find = |name: &str| -> Option<PathBuf> {
            if let Ok(p) = std::env::var(format!("MM_{}", name.to_uppercase())) {
                return Some(PathBuf::from(p)).filter(|p| p.is_file());
            }
            let exe = if cfg!(windows) {
                format!("{name}.exe")
            } else {
                name.to_string()
            };
            let mut dirs: Vec<PathBuf> = vec![];
            if let Some(d) = std::env::current_exe()
                .ok()
                .and_then(|e| e.parent().map(Path::to_path_buf))
            {
                dirs.push(d);
            }
            for d in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"] {
                dirs.push(PathBuf::from(d));
            }
            if let Some(path) = std::env::var_os("PATH") {
                dirs.extend(std::env::split_paths(&path));
            }
            dirs.into_iter().map(|d| d.join(&exe)).find(|p| p.is_file())
        };
        let ffmpeg = find("ffmpeg");
        let ffprobe = find("ffprobe");
        let encoders = ffmpeg.as_ref().map(|f| list_encoders(f)).unwrap_or_default();
        Tools {
            ffmpeg,
            ffprobe,
            encoders,
        }
    }

    fn h264_encoder(&self) -> Option<&'static str> {
        ["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf", "libx264"]
            .into_iter()
            .find(|e| self.encoders.contains(*e))
    }
}

fn list_encoders(ffmpeg: &Path) -> HashSet<String> {
    let Ok(out) = std::process::Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .stdin(Stdio::null())
        .output()
    else {
        return HashSet::new();
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            let mut parts = l.split_whitespace();
            let flags = parts.next()?;
            (flags.len() == 6 && flags.starts_with(['V', 'A', 'S'])).then(|| parts.next().map(str::to_string))?
        })
        .collect()
}

// -------------------------------------------------------------- media info

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    /// "mp4", "mkv", "webm", "avi", "ts", …
    pub container: String,
    pub duration: Option<f64>,
    pub video: Option<VideoInfo>,
    pub audio: Vec<AudioTrack>,
    pub subs: Vec<SubTrack>,
    /// False when ffprobe wasn't available and this was guessed from the name.
    pub probed: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    /// "h264", "hevc", "av1", "vp9", "mpeg4", …
    pub codec: String,
    pub bit_depth: u8,
    pub width: u32,
    pub height: u32,
    /// "hdr10", "hlg" or "dv"
    pub hdr: Option<String>,
    pub dv_profile: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    /// ffmpeg stream index
    pub index: u32,
    pub codec: String,
    pub channels: u32,
    pub language: Option<String>,
    pub title: Option<String>,
    pub default: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SubTrack {
    /// "e3" for embedded stream 3, "x0" for the first file next to the video.
    pub id: String,
    pub codec: String,
    pub language: Option<String>,
    pub title: Option<String>,
    pub forced: bool,
    pub default: bool,
    /// Text subtitles can be shown by the TV; picture-based ones (Blu-ray PGS,
    /// DVD) would have to be burned into the video.
    pub text: bool,
    #[serde(skip)]
    pub external: Option<PathBuf>,
    #[serde(skip)]
    pub stream: Option<u32>,
}

fn tag(v: &Value, key: &str) -> Option<String> {
    let tags = v.get("tags")?;
    tags.get(key)
        .or_else(|| tags.get(key.to_uppercase()))
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|s| !s.is_empty() && s != "und")
}

pub fn parse_probe(json: &Value, path: &Path) -> MediaInfo {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let format = json["format"]["format_name"].as_str().unwrap_or("");
    let container = if format.contains("matroska") {
        if ext == "webm" {
            "webm"
        } else {
            "mkv"
        }
    } else if format.contains("mp4") || format.contains("mov") {
        "mp4"
    } else if format.contains("mpegts") {
        "ts"
    } else if format.contains("avi") {
        "avi"
    } else {
        format.split(',').next().unwrap_or("")
    };
    let mut info = MediaInfo {
        container: container.to_string(),
        duration: json["format"]["duration"].as_str().and_then(|d| d.parse().ok()),
        probed: true,
        ..Default::default()
    };
    for s in json["streams"].as_array().into_iter().flatten() {
        let index = s["index"].as_u64().unwrap_or(0) as u32;
        let codec = s["codec_name"].as_str().unwrap_or("").to_string();
        let default = s["disposition"]["default"].as_i64() == Some(1);
        match s["codec_type"].as_str() {
            Some("video") if info.video.is_none() && s["disposition"]["attached_pic"].as_i64() != Some(1) => {
                let pix = s["pix_fmt"].as_str().unwrap_or("");
                let bit_depth = if pix.contains("10") || pix.contains("12") {
                    10
                } else {
                    8
                };
                let transfer = s["color_transfer"].as_str().unwrap_or("");
                let dv_profile = s["side_data_list"].as_array().into_iter().flatten().find_map(|d| {
                    (d["side_data_type"].as_str() == Some("DOVI configuration record"))
                        .then(|| d["dv_profile"].as_u64().map(|p| p as u8))
                        .flatten()
                });
                let hdr = if dv_profile.is_some() {
                    Some("dv")
                } else if transfer == "smpte2084" {
                    Some("hdr10")
                } else if transfer == "arib-std-b67" {
                    Some("hlg")
                } else {
                    None
                };
                info.video = Some(VideoInfo {
                    codec,
                    bit_depth,
                    width: s["width"].as_u64().unwrap_or(0) as u32,
                    height: s["height"].as_u64().unwrap_or(0) as u32,
                    hdr: hdr.map(str::to_string),
                    dv_profile,
                });
            }
            Some("audio") => info.audio.push(AudioTrack {
                index,
                codec: match (codec.as_str(), s["profile"].as_str()) {
                    // DTS-HD MA/HRA and DTS:X all report "dts"; that's fine,
                    // a TV that takes DTS takes the core.
                    ("dts", _) => "dts".into(),
                    _ => codec,
                },
                channels: s["channels"].as_u64().unwrap_or(2) as u32,
                language: tag(s, "language"),
                title: tag(s, "title"),
                default,
            }),
            Some("subtitle") => info.subs.push(SubTrack {
                id: format!("e{index}"),
                text: !matches!(
                    codec.as_str(),
                    "hdmv_pgs_subtitle" | "dvd_subtitle" | "dvb_subtitle" | "xsub"
                ),
                codec,
                language: tag(s, "language"),
                title: tag(s, "title"),
                forced: s["disposition"]["forced"].as_i64() == Some(1),
                default,
                external: None,
                stream: Some(index),
            }),
            _ => {}
        }
    }
    info
}

/// Without ffprobe, the release name is the best guess there is.
pub fn guess_from_name(path: &Path, codec: Option<&str>, audio: Option<&str>, hdr: Option<&str>) -> MediaInfo {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let container = match ext.as_str() {
        "m4v" | "mov" | "mp4" => "mp4",
        "mkv" => "mkv",
        "webm" => "webm",
        "ts" | "m2ts" => "ts",
        "avi" => "avi",
        other => other,
    };
    let lc = |s: Option<&str>| s.unwrap_or("").to_ascii_lowercase();
    let vc = lc(codec);
    let video_codec = if vc.contains("265") || vc.contains("hevc") {
        "hevc"
    } else if vc.contains("av1") {
        "av1"
    } else if vc.contains("xvid") || vc.contains("divx") {
        "mpeg4"
    } else {
        "h264"
    };
    let ac = lc(audio);
    let audio_codec = if ac.contains("truehd") || ac.contains("atmos") {
        "truehd"
    } else if ac.contains("dts") {
        "dts"
    } else if ac.contains("ddp") || ac.contains("eac3") || ac.contains("dd+") {
        "eac3"
    } else if ac.contains("ac3") || ac.contains("dd5") || ac == "dd" {
        "ac3"
    } else if ac.contains("flac") {
        "flac"
    } else {
        "aac"
    };
    let hdr = lc(hdr);
    MediaInfo {
        container: container.to_string(),
        video: Some(VideoInfo {
            codec: video_codec.into(),
            bit_depth: if video_codec == "hevc" && !hdr.is_empty() {
                10
            } else {
                8
            },
            hdr: (!hdr.is_empty()).then(|| {
                if hdr.contains("dv") || hdr.contains("dolby") {
                    "dv"
                } else {
                    "hdr10"
                }
                .into()
            }),
            ..Default::default()
        }),
        audio: vec![AudioTrack {
            index: 1,
            codec: audio_codec.into(),
            channels: 6,
            default: true,
            ..Default::default()
        }],
        ..Default::default()
    }
}

// ----------------------------------------------------------- capabilities

/// What the TV says it can play, worked out in its browser with
/// `canPlayType` / `MediaSource.isTypeSupported`.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Caps {
    pub containers: Vec<String>,
    /// "h264", "hevc", "hevc10", "av1", "vp9"
    pub video: Vec<String>,
    /// "aac", "mp3", "ac3", "eac3", "opus", "flac", "dts", "truehd"
    pub audio: Vec<String>,
    /// "hdr10", "hlg", "dv"
    pub hdr: Vec<String>,
    /// Plays HLS itself (Safari, smart TVs). Otherwise the page uses hls.js.
    pub native_hls: bool,
    pub max_height: Option<u32>,
}

impl Caps {
    fn has(list: &[String], v: &str) -> bool {
        list.iter().any(|x| x == v)
    }
    fn video_ok(&self, v: &VideoInfo) -> bool {
        let key = match (v.codec.as_str(), v.bit_depth) {
            ("hevc", d) if d > 8 => "hevc10",
            ("h264", d) if d > 8 => return false, // 10-bit H.264 (some anime): nothing plays it
            (c, _) => c,
        };
        if !Self::has(&self.video, key) {
            return false;
        }
        if self.max_height.is_some_and(|m| v.height > m + 16) {
            return false;
        }
        // Dolby Vision profile 5 has no HDR10 fallback layer: without DV
        // support its colours come out green and purple.
        !(v.dv_profile == Some(5) && !Self::has(&self.hdr, "dv"))
    }
    fn audio_ok(&self, a: &AudioTrack) -> bool {
        Self::has(&self.audio, &a.codec)
    }
}

// --------------------------------------------------------------------- plan

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Copy,
    Convert,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    /// "direct": stream the file as it is. "hls": ffmpeg repackages it.
    /// "unsupported": the TV can't play it and there's no ffmpeg.
    pub mode: &'static str,
    pub video: Action,
    pub audio: Action,
    pub audio_index: Option<u32>,
    /// A sentence for the player's info panel, e.g. "Converting DTS audio".
    pub note: Option<String>,
}

fn codec_label(c: &str) -> String {
    match c {
        "hevc" => "HEVC".into(),
        "h264" => "H.264".into(),
        "eac3" => "Dolby Digital Plus".into(),
        "ac3" => "Dolby Digital".into(),
        "truehd" => "Dolby TrueHD".into(),
        "dts" => "DTS".into(),
        "mpeg4" => "MPEG-4".into(),
        other => other.to_uppercase(),
    }
}

pub fn decide(info: &MediaInfo, caps: &Caps, audio_pref: Option<u32>, have_ffmpeg: bool) -> Decision {
    let default_audio = info.audio.iter().find(|a| a.default).or_else(|| info.audio.first());
    let audio = audio_pref
        .and_then(|i| info.audio.iter().find(|a| a.index == i))
        .or(default_audio);
    let video_ok = info.video.as_ref().is_none_or(|v| caps.video_ok(v));
    let audio_ok = audio.is_none_or(|a| caps.audio_ok(a));
    let container_ok = Caps::has(&caps.containers, &info.container);
    // Picking a track other than the file's default needs repackaging: TVs
    // can't switch audio tracks inside a file reliably.
    let non_default_audio = matches!((audio, default_audio), (Some(a), Some(d)) if a.index != d.index);
    let video_action = if video_ok { Action::Copy } else { Action::Convert };
    let audio_action = if audio_ok { Action::Copy } else { Action::Convert };
    let mut notes = vec![];
    if !container_ok && video_ok {
        notes.push(format!("Repackaging {}", info.container.to_uppercase()));
    }
    if let (Action::Convert, Some(v)) = (video_action, info.video.as_ref()) {
        notes.push(format!("Converting {} video", codec_label(&v.codec)));
    }
    if let (Action::Convert, Some(a)) = (audio_action, audio) {
        notes.push(format!("Converting {} audio", codec_label(&a.codec)));
    }
    let mode = if container_ok && video_ok && audio_ok && !non_default_audio {
        "direct"
    } else if have_ffmpeg {
        "hls"
    } else {
        "unsupported"
    };
    Decision {
        mode,
        video: video_action,
        audio: audio_action,
        audio_index: audio.map(|a| a.index),
        note: (!notes.is_empty()).then(|| notes.join(" · ")),
    }
}

// ----------------------------------------------------------------- sessions

pub struct Session {
    pub id: String,
    /// The paired device that asked for it.
    owner: String,
    created: i64,
    pub dir: PathBuf,
    child: Mutex<Option<Child>>,
    /// Tells the task that owns ffmpeg to stop it.
    kill: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    pid: Option<u32>,
    paused: AtomicBool,
    last_request: AtomicI64,
    /// Highest chunk number the TV has asked for.
    wanted: AtomicU64,
    pub done: AtomicBool,
    pub failed: Mutex<Option<String>>,
}

fn now_ms() -> i64 {
    super::super::db::now()
}

impl Session {
    pub fn touch(&self, segment: Option<u64>) {
        self.last_request.store(now_ms(), Ordering::Relaxed);
        if let Some(s) = segment {
            self.wanted.fetch_max(s, Ordering::Relaxed);
        }
    }

    fn produced(&self) -> u64 {
        std::fs::read_dir(&self.dir)
            .map(|rd| {
                rd.flatten()
                    .filter_map(|e| segment_number(&e.file_name().to_string_lossy()))
                    .max()
                    .map(|n| n + 1)
                    .unwrap_or(0)
            })
            .unwrap_or(0)
    }

    fn signal(&self, stop: bool) {
        #[cfg(unix)]
        if let Some(pid) = self.pid {
            // SAFETY: plain kill(2) on our own child process.
            unsafe {
                libc::kill(pid as i32, if stop { libc::SIGSTOP } else { libc::SIGCONT });
            }
        }
        #[cfg(not(unix))]
        let _ = stop;
    }

    /// Keep ffmpeg a few minutes ahead of the TV, and delete what's been
    /// watched, so a long film doesn't fill the disk.
    fn throttle(&self) {
        let produced = self.produced();
        let wanted = self.wanted.load(Ordering::Relaxed);
        let paused = self.paused.load(Ordering::Relaxed);
        if !paused && produced > wanted + AHEAD_SEGMENTS {
            self.signal(true);
            self.paused.store(true, Ordering::Relaxed);
        } else if paused && produced < wanted + AHEAD_SEGMENTS / 2 {
            self.signal(false);
            self.paused.store(false, Ordering::Relaxed);
        }
        if wanted > KEEP_BEHIND {
            if let Ok(rd) = std::fs::read_dir(&self.dir) {
                for e in rd.flatten() {
                    if segment_number(&e.file_name().to_string_lossy()).is_some_and(|n| n + KEEP_BEHIND < wanted) {
                        let _ = std::fs::remove_file(e.path());
                    }
                }
            }
        }
    }

    fn idle(&self) -> bool {
        now_ms() - self.last_request.load(Ordering::Relaxed) > IDLE_TIMEOUT.as_millis() as i64
    }

    /// Stop ffmpeg. Its chunks are deleted once it has exited (ffmpeg would
    /// otherwise recreate the folder for the chunk it was writing).
    pub fn stop(&self) {
        if self.paused.swap(false, Ordering::Relaxed) {
            self.signal(false);
        }
        match self.kill.lock().unwrap().take() {
            Some(tx) if !self.done.load(Ordering::Relaxed) => {
                let _ = tx.send(());
            }
            _ => {
                let _ = std::fs::remove_dir_all(&self.dir);
            }
        }
    }
}

/// Who a new stream is for and where it starts.
pub struct NewSession {
    pub id: String,
    pub owner: String,
    pub offset: f64,
}

pub fn segment_number(name: &str) -> Option<u64> {
    name.strip_prefix("seg")?.strip_suffix(".m4s")?.parse().ok()
}

pub struct Media {
    work: PathBuf,
    tools: OnceLock<Tools>,
    probes: Mutex<HashMap<String, (u64, Arc<MediaInfo>)>>,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    reaper: AtomicBool,
}

impl Media {
    pub fn new(work: PathBuf) -> Self {
        // Chunks from a previous run are of no use now.
        let _ = std::fs::remove_dir_all(work.join("hls"));
        Self {
            work,
            tools: OnceLock::new(),
            probes: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
            reaper: AtomicBool::new(false),
        }
    }

    pub fn tools(&self) -> &Tools {
        self.tools.get_or_init(Tools::detect)
    }

    pub fn work_dir(&self) -> &Path {
        &self.work
    }

    /// Read the file's streams with ffprobe (cached), or guess from its name.
    pub async fn info(&self, path: &Path, guess: impl FnOnce() -> MediaInfo) -> Arc<MediaInfo> {
        let key = path.to_string_lossy().to_string();
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if let Some((s, info)) = self.probes.lock().unwrap().get(&key) {
            if *s == size {
                return info.clone();
            }
        }
        let mut info = match &self.tools().ffprobe {
            Some(ffprobe) => match probe(ffprobe, path).await {
                Ok(i) => i,
                Err(e) => {
                    log::warn!("ffprobe failed for {}: {e:#}", path.display());
                    guess()
                }
            },
            None => guess(),
        };
        info.subs.extend(super::subs::sidecars(path));
        let info = Arc::new(info);
        self.probes.lock().unwrap().insert(key, (size, info.clone()));
        info
    }

    pub fn session(&self, id: &str) -> Option<Arc<Session>> {
        self.sessions.lock().unwrap().get(id).cloned()
    }

    pub fn stop_session(&self, id: &str) {
        if let Some(s) = self.sessions.lock().unwrap().remove(id) {
            s.stop();
        }
    }

    pub fn stop_all(&self) {
        for (_, s) in self.sessions.lock().unwrap().drain() {
            s.stop();
        }
    }

    /// Start ffmpeg writing HLS chunks for `path` from `offset` seconds.
    pub fn start_session(
        self: &Arc<Self>,
        path: &Path,
        info: &MediaInfo,
        decision: &Decision,
        caps: &Caps,
        new: NewSession,
    ) -> Result<Arc<Session>> {
        let NewSession { id, owner, offset } = new;
        let owner = owner.as_str();
        let tools = self.tools();
        let ffmpeg = tools.ffmpeg.clone().ok_or_else(|| anyhow!("ffmpeg isn't installed"))?;
        let dir = self.work.join("hls").join(&id);
        std::fs::create_dir_all(&dir).context("creating the chunk folder")?;
        let args = ffmpeg_args(path, info, decision, caps, offset, &dir, tools)?;
        log::info!("ffmpeg {}", args.join(" "));
        let child = Command::new(&ffmpeg)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .context("starting ffmpeg")?;
        let pid = child.id();
        let (kill_tx, kill_rx) = tokio::sync::oneshot::channel();
        let session = Arc::new(Session {
            id: id.clone(),
            owner: owner.to_string(),
            created: now_ms(),
            dir,
            child: Mutex::new(Some(child)),
            kill: Mutex::new(Some(kill_tx)),
            pid,
            paused: AtomicBool::new(false),
            last_request: AtomicI64::new(now_ms()),
            wanted: AtomicU64::new(0),
            done: AtomicBool::new(false),
            failed: Mutex::new(None),
        });
        let old: Vec<Arc<Session>> = {
            let mut map = self.sessions.lock().unwrap();
            let mut all: Vec<Arc<Session>> = map.values().cloned().collect();
            all.sort_by_key(|s| s.created);
            let mut drop_ids: Vec<String> = vec![];
            let mine: Vec<&Arc<Session>> = all.iter().filter(|s| s.owner == owner).collect();
            if mine.len() >= SESSIONS_PER_DEVICE {
                drop_ids.extend(mine[..=mine.len() - SESSIONS_PER_DEVICE].iter().map(|s| s.id.clone()));
            }
            let remaining: Vec<&Arc<Session>> = all.iter().filter(|s| !drop_ids.contains(&s.id)).collect();
            if remaining.len() >= SESSIONS_MAX {
                drop_ids.extend(
                    remaining[..=remaining.len() - SESSIONS_MAX]
                        .iter()
                        .map(|s| s.id.clone()),
                );
            }
            let old = drop_ids.iter().filter_map(|i| map.remove(i)).collect();
            map.insert(id, session.clone());
            old
        };
        for s in old {
            s.stop();
        }
        self.watch(session.clone(), kill_rx);
        self.start_reaper();
        Ok(session)
    }

    /// Own ffmpeg until it finishes or is told to stop, and record why if it
    /// failed.
    fn watch(self: &Arc<Self>, s: Arc<Session>, kill: tokio::sync::oneshot::Receiver<()>) {
        tokio::spawn(async move {
            let child = s.child.lock().unwrap().take();
            let Some(mut child) = child else { return };
            let stderr = child.stderr.take();
            let log = tokio::spawn(async move {
                let mut buf = String::new();
                if let Some(mut e) = stderr {
                    use tokio::io::AsyncReadExt;
                    let _ = e.read_to_string(&mut buf).await;
                }
                buf
            });
            let killed = tokio::select! {
                status = child.wait() => {
                    let log = log.await.unwrap_or_default();
                    match status {
                        Ok(st) if st.success() => {}
                        Ok(st) => {
                            let tail: Vec<&str> = log.lines().rev().take(6).collect();
                            let msg = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
                            log::warn!("ffmpeg failed ({st}): {msg}");
                            *s.failed.lock().unwrap() = Some(if msg.is_empty() { st.to_string() } else { msg });
                        }
                        Err(e) => *s.failed.lock().unwrap() = Some(e.to_string()),
                    }
                    false
                }
                _ = kill => {
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    true
                }
            };
            s.done.store(true, Ordering::Relaxed);
            if killed {
                let _ = tokio::fs::remove_dir_all(&s.dir).await;
            }
        });
    }

    fn start_reaper(self: &Arc<Self>) {
        if self.reaper.swap(true, Ordering::Relaxed) {
            return;
        }
        let me = self.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let sessions: Vec<Arc<Session>> = me.sessions.lock().unwrap().values().cloned().collect();
                for s in sessions {
                    if s.idle() {
                        me.stop_session(&s.id);
                    } else if !s.done.load(Ordering::Relaxed) {
                        s.throttle();
                    }
                }
            }
        });
    }
}

async fn probe(ffprobe: &Path, path: &Path) -> Result<MediaInfo> {
    let out = tokio::time::timeout(
        Duration::from_secs(20),
        Command::new(ffprobe)
            .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams"])
            .arg(path)
            .stdin(Stdio::null())
            .output(),
    )
    .await
    .context("ffprobe timed out")??;
    if !out.status.success() {
        return Err(anyhow!("{}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let json: Value = serde_json::from_slice(&out.stdout)?;
    Ok(parse_probe(&json, path))
}

fn ffmpeg_args(
    path: &Path,
    info: &MediaInfo,
    d: &Decision,
    caps: &Caps,
    offset: f64,
    dir: &Path,
    tools: &Tools,
) -> Result<Vec<String>> {
    let s = |x: &str| x.to_string();
    let mut a: Vec<String> = vec![s("-hide_banner"), s("-loglevel"), s("error"), s("-nostdin"), s("-y")];
    if offset > 0.5 {
        a.extend([s("-ss"), format!("{offset:.3}")]);
    }
    a.extend([s("-i"), path.to_string_lossy().to_string()]);
    a.extend([s("-map"), s("0:v:0")]);
    if let Some(i) = d.audio_index {
        a.extend([s("-map"), format!("0:{i}")]);
    }
    a.extend([
        s("-sn"),
        s("-dn"),
        s("-map_metadata"),
        s("-1"),
        s("-map_chapters"),
        s("-1"),
    ]);

    let video = info.video.as_ref();
    match d.video {
        Action::Copy => {
            a.extend([s("-c:v"), s("copy")]);
            if video.is_some_and(|v| v.codec == "hevc") {
                // Apple-style tag; TVs and browsers want hvc1 in MP4.
                a.extend([s("-tag:v"), s("hvc1")]);
            }
        }
        Action::Convert => {
            let enc = tools
                .h264_encoder()
                .ok_or_else(|| anyhow!("this ffmpeg can't encode H.264"))?;
            let src_h = video.map(|v| v.height).filter(|h| *h > 0).unwrap_or(1080);
            let h = src_h.min(caps.max_height.unwrap_or(1080)).min(1080);
            let mut vf = vec![format!("scale=-2:'min({h},ih)'")];
            if video.is_some_and(|v| v.bit_depth > 8 || v.hdr.is_some()) {
                // 8-bit for H.264. HDR colours aren't tone-mapped yet, so they
                // look flatter than they should.
                vf.push(s("format=yuv420p"));
            }
            let kbps = if h > 720 { 10_000 } else { 5_000 };
            a.extend([s("-vf"), vf.join(",")]);
            a.extend([s("-c:v"), s(enc)]);
            match enc {
                "libx264" => a.extend([s("-preset"), s("veryfast"), s("-crf"), s("21")]),
                "h264_videotoolbox" => a.extend([s("-realtime"), s("0"), s("-allow_sw"), s("1")]),
                _ => {}
            }
            a.extend([
                s("-b:v"),
                format!("{kbps}k"),
                s("-maxrate"),
                format!("{}k", kbps * 3 / 2),
                s("-bufsize"),
                format!("{}k", kbps * 2),
                s("-profile:v"),
                s("high"),
                s("-pix_fmt"),
                s("yuv420p"),
                // A key frame at every chunk boundary.
                s("-force_key_frames"),
                format!("expr:gte(t,n_forced*{SEGMENT_SECS})"),
            ]);
        }
    }

    let src_audio = d.audio_index.and_then(|i| info.audio.iter().find(|t| t.index == i));
    match (d.audio, src_audio) {
        (_, None) => {}
        (Action::Copy, Some(_)) => a.extend([s("-c:a"), s("copy")]),
        (Action::Convert, Some(t)) => {
            // Keep surround sound when the TV takes Dolby Digital.
            if t.channels > 2 && Caps::has(&caps.audio, "eac3") && tools.encoders.contains("eac3") {
                a.extend([s("-c:a"), s("eac3"), s("-b:a"), s("640k"), s("-ac"), s("6")]);
            } else if t.channels > 2 && Caps::has(&caps.audio, "ac3") && tools.encoders.contains("ac3") {
                a.extend([s("-c:a"), s("ac3"), s("-b:a"), s("640k"), s("-ac"), s("6")]);
            } else {
                a.extend([s("-c:a"), s("aac"), s("-b:a"), s("192k"), s("-ac"), s("2")]);
            }
        }
    }

    a.extend([
        s("-f"),
        s("hls"),
        s("-hls_time"),
        SEGMENT_SECS.to_string(),
        s("-hls_list_size"),
        s("0"),
        s("-hls_playlist_type"),
        s("event"),
        s("-hls_segment_type"),
        s("fmp4"),
        s("-hls_fmp4_init_filename"),
        s("init.mp4"),
        s("-hls_flags"),
        s("independent_segments+temp_file"),
        s("-hls_segment_filename"),
        dir.join("seg%05d.m4s").to_string_lossy().to_string(),
        dir.join("index.m3u8").to_string_lossy().to_string(),
    ]);
    Ok(a)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tv() -> Caps {
        Caps {
            containers: vec!["mp4".into(), "mkv".into()],
            video: vec!["h264".into(), "hevc".into(), "hevc10".into()],
            audio: vec!["aac".into(), "ac3".into(), "eac3".into()],
            hdr: vec!["hdr10".into()],
            native_hls: true,
            max_height: Some(2160),
        }
    }

    fn info(container: &str, vcodec: &str, depth: u8, acodec: &str) -> MediaInfo {
        MediaInfo {
            container: container.into(),
            video: Some(VideoInfo {
                codec: vcodec.into(),
                bit_depth: depth,
                height: 1080,
                ..Default::default()
            }),
            audio: vec![AudioTrack {
                index: 1,
                codec: acodec.into(),
                channels: 6,
                default: true,
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn decisions() {
        let d = decide(&info("mkv", "hevc", 10, "eac3"), &tv(), None, true);
        assert_eq!(d.mode, "direct");

        // DTS on a TV without it: keep the picture, convert only the sound.
        let d = decide(&info("mkv", "hevc", 10, "dts"), &tv(), None, true);
        assert_eq!((d.mode, d.video, d.audio), ("hls", Action::Copy, Action::Convert));
        assert_eq!(d.note.as_deref(), Some("Converting DTS audio"));

        // Chrome-like: no MKV, no HEVC.
        let chrome = Caps {
            containers: vec!["mp4".into(), "webm".into()],
            video: vec!["h264".into(), "vp9".into()],
            audio: vec!["aac".into(), "mp3".into(), "opus".into()],
            ..Default::default()
        };
        let d = decide(&info("mkv", "h264", 8, "aac"), &chrome, None, true);
        assert_eq!((d.mode, d.video, d.audio), ("hls", Action::Copy, Action::Copy));
        let d = decide(&info("mkv", "hevc", 10, "ac3"), &chrome, None, true);
        assert_eq!((d.video, d.audio), (Action::Convert, Action::Convert));
        // Nothing to convert with.
        assert_eq!(
            decide(&info("mkv", "h264", 8, "aac"), &chrome, None, false).mode,
            "unsupported"
        );
        // 10-bit H.264 is never direct.
        assert_eq!(
            decide(&info("mp4", "h264", 10, "aac"), &tv(), None, true).video,
            Action::Convert
        );
    }

    #[test]
    fn picking_another_audio_track_repackages() {
        let mut i = info("mp4", "h264", 8, "aac");
        i.audio.push(AudioTrack {
            index: 2,
            codec: "aac".into(),
            channels: 2,
            ..Default::default()
        });
        assert_eq!(decide(&i, &tv(), Some(1), true).mode, "direct");
        let d = decide(&i, &tv(), Some(2), true);
        assert_eq!((d.mode, d.audio_index), ("hls", Some(2)));
    }

    #[test]
    fn dolby_vision_profile_5_needs_dv() {
        let mut i = info("mkv", "hevc", 10, "eac3");
        i.video.as_mut().unwrap().dv_profile = Some(5);
        assert_eq!(decide(&i, &tv(), None, true).video, Action::Convert);
        i.video.as_mut().unwrap().dv_profile = Some(8);
        assert_eq!(decide(&i, &tv(), None, true).mode, "direct");
    }

    #[test]
    fn parses_ffprobe_output() {
        let j = json!({
            "format": {"format_name": "matroska,webm", "duration": "5400.5"},
            "streams": [
                {"index": 0, "codec_type": "video", "codec_name": "hevc", "pix_fmt": "yuv420p10le",
                 "width": 3840, "height": 1600, "color_transfer": "smpte2084",
                 "side_data_list": [{"side_data_type": "DOVI configuration record", "dv_profile": 8}]},
                {"index": 1, "codec_type": "audio", "codec_name": "truehd", "channels": 8,
                 "disposition": {"default": 1}, "tags": {"language": "eng", "title": "Atmos"}},
                {"index": 2, "codec_type": "audio", "codec_name": "ac3", "channels": 6, "tags": {"language": "fre"}},
                {"index": 3, "codec_type": "subtitle", "codec_name": "subrip", "tags": {"language": "eng"}},
                {"index": 4, "codec_type": "subtitle", "codec_name": "hdmv_pgs_subtitle", "disposition": {"forced": 1}},
                {"index": 5, "codec_type": "video", "codec_name": "mjpeg", "disposition": {"attached_pic": 1}}
            ]
        });
        let i = parse_probe(&j, Path::new("/m/Film.mkv"));
        assert_eq!(i.container, "mkv");
        assert_eq!(i.duration, Some(5400.5));
        let v = i.video.unwrap();
        assert_eq!((v.codec.as_str(), v.bit_depth, v.height), ("hevc", 10, 1600));
        assert_eq!((v.hdr.as_deref(), v.dv_profile), (Some("dv"), Some(8)));
        assert_eq!(i.audio.len(), 2);
        assert!(i.audio[0].default && i.audio[0].codec == "truehd");
        assert_eq!(i.audio[1].language.as_deref(), Some("fre"));
        assert_eq!(i.subs.len(), 2);
        assert!(i.subs[0].text && !i.subs[1].text && i.subs[1].forced);
        assert_eq!(i.subs[0].id, "e3");
    }

    #[test]
    fn guesses_from_release_names() {
        let i = guess_from_name(
            Path::new("/m/Film.2019.2160p.mkv"),
            Some("x265"),
            Some("DTS-HD.MA"),
            Some("HDR"),
        );
        assert_eq!(i.container, "mkv");
        assert_eq!(i.video.as_ref().unwrap().codec, "hevc");
        assert_eq!(i.audio[0].codec, "dts");
        assert!(!i.probed);
    }

    #[test]
    fn segment_names() {
        assert_eq!(segment_number("seg00012.m4s"), Some(12));
        assert_eq!(segment_number("init.mp4"), None);
        assert_eq!(segment_number("seg00001.m4s.tmp"), None);
    }
}
