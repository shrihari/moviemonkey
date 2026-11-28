//! The web API the TV screens talk to.

use super::media::{self, Caps, MediaInfo};
use super::{file_id, is_local, subs, Share};
use crate::engine::db::FileRow;
use crate::engine::models::StatePatch;
use axum::body::Body;
use axum::extract::{ConnectInfo, Path, Query, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tower::ServiceExt;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeFile;

type S = State<Arc<Share>>;

pub fn router(share: Arc<Share>) -> Router {
    let private = Router::new()
        .route("/api/library", get(library))
        .route("/api/title/{id}", get(title))
        .route("/api/state", post(set_state))
        .route("/api/img", get(image))
        .route("/api/play/{file}", post(play))
        .route("/api/file/{file}", get(file))
        .route("/api/subs/{file}/{sub}", get(subtitle))
        .route("/api/progress", post(progress))
        .route_layer(middleware::from_fn_with_state(share.clone(), require_token));
    Router::new()
        .route("/api/info", get(info))
        .route("/api/pair", post(pair))
        // The session id in the path is the key: only a paired TV gets one,
        // and players fetch chunks by relative URL, which drops query strings.
        .route("/api/hls/{session}/{name}", get(hls).delete(stop_hls))
        .merge(private)
        .fallback(static_files)
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .layer(middleware::from_fn(local_only))
        .with_state(share)
}

fn error(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

async fn local_only(ConnectInfo(addr): ConnectInfo<SocketAddr>, req: Request, next: Next) -> Response {
    if !is_local(addr.ip()) {
        return error(StatusCode::FORBIDDEN, "Only devices on your home network can connect.");
    }
    next.run(req).await
}

fn token_of(headers: &HeaderMap, query: Option<&str>) -> Option<String> {
    if let Some(v) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(t) = v.strip_prefix("Bearer ") {
            return Some(t.trim().to_string());
        }
    }
    query?
        .split('&')
        .find_map(|kv| kv.strip_prefix("t="))
        .map(|t| urlencoding::decode(t).map(|s| s.into_owned()).unwrap_or_default())
}

async fn require_token(State(share): S, req: Request, next: Next) -> Response {
    let ok = token_of(req.headers(), req.uri().query()).is_some_and(|t| share.check_token(&t));
    if !ok {
        return error(StatusCode::UNAUTHORIZED, "This TV isn't paired yet.");
    }
    next.run(req).await
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    tokio::task::spawn_blocking(f).await.expect("blocking task")
}

// -------------------------------------------------------------- handshake

async fn info(State(share): S, headers: HeaderMap, req: Request) -> Json<Value> {
    let paired = token_of(&headers, req.uri().query()).is_some_and(|t| share.check_token(&t));
    Json(json!({
        "app": "Movie Monkey",
        "version": env!("CARGO_PKG_VERSION"),
        "name": share.name,
        "paired": paired,
    }))
}

#[derive(Deserialize)]
struct PairBody {
    code: String,
    #[serde(default)]
    name: String,
}

async fn pair(State(share): S, Json(b): Json<PairBody>) -> Response {
    match share.pair(&b.code, &b.name) {
        Some(token) => Json(json!({ "token": token, "name": share.name })).into_response(),
        None => error(
            StatusCode::FORBIDDEN,
            "That code didn't work. Check the code in Movie Monkey's Settings on your computer.",
        ),
    }
}

// ---------------------------------------------------------------- library

async fn library(State(share): S) -> Response {
    let lib = share.lib.clone();
    match blocking(move || lib.snapshot()).await {
        Ok(s) => Json(json!({ "titles": s.titles, "name": share.name })).into_response(),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

async fn title(State(share): S, Path(id): Path<String>) -> Response {
    let lib = share.lib.clone();
    let res = blocking(move || {
        let detail = lib.detail(&id)?;
        Ok::<_, anyhow::Error>(detail.map(|d| {
            let mut v = serde_json::to_value(d).unwrap_or(Value::Null);
            // Files are referred to by id; paths stay on the computer.
            let fix = |f: &mut Value| {
                if let Some(path) = f.get("path").and_then(Value::as_str).map(str::to_string) {
                    let pos = lib.position(&path);
                    f["id"] = json!(file_id(&path));
                    f["position"] = json!(pos.map(|p| p.0));
                    f["duration"] = json!(pos.and_then(|p| p.1));
                    if let Some(o) = f.as_object_mut() {
                        o.remove("path");
                    }
                }
            };
            if let Some(files) = v["files"].as_array_mut() {
                files.iter_mut().for_each(fix);
            }
            if let Some(seasons) = v["seasons"].as_array_mut() {
                for s in seasons {
                    if let Some(eps) = s["episodes"].as_array_mut() {
                        for e in eps {
                            if e["file"].is_object() {
                                fix(&mut e["file"]);
                            }
                        }
                    }
                }
            }
            v
        }))
    })
    .await;
    match res {
        Ok(Some(v)) => Json(v).into_response(),
        Ok(None) => error(StatusCode::NOT_FOUND, "Not in the library"),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

#[derive(Deserialize)]
struct StateBody {
    key: String,
    patch: StatePatch,
}

async fn set_state(State(share): S, Json(b): Json<StateBody>) -> Response {
    let lib = share.lib.clone();
    match blocking(move || lib.set_state(&b.key, &b.patch)).await {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// Artwork from the on-disk cache. Only the metadata services' image hosts,
/// so this can't be used to fetch anything else.
async fn image(State(share): S, Query(q): Query<HashMap<String, String>>) -> Response {
    let allowed = |u: &str| {
        ["https://image.tmdb.org/", "https://static.tvmaze.com/"]
            .iter()
            .any(|p| u.starts_with(p))
    };
    let Some(u) = q.get("u").filter(|u| allowed(u)) else {
        return error(StatusCode::BAD_REQUEST, "unknown image");
    };
    let f = q.get("f").filter(|f| allowed(f));
    match share.images.get(u, f.map(String::as_str)).await {
        Some((bytes, ct)) => (
            [
                (header::CONTENT_TYPE, ct),
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            ],
            bytes,
        )
            .into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// --------------------------------------------------------------- playback

impl Share {
    fn find_file(&self, id: &str) -> Option<FileRow> {
        let mut cache = self.files.lock().unwrap();
        let fresh = cache.0.elapsed() < Duration::from_secs(30);
        if !fresh || !cache.1.contains_key(id) {
            let rows = self.lib.playable_files().ok()?;
            *cache = (
                std::time::Instant::now(),
                rows.into_iter().map(|f| (file_id(&f.path), f)).collect(),
            );
        }
        cache
            .1
            .get(id)
            .filter(|f| std::path::Path::new(&f.path).is_file())
            .cloned()
    }

    async fn file_and_info(self: &Arc<Self>, id: &str) -> Option<(FileRow, Arc<MediaInfo>)> {
        let me = self.clone();
        let id = id.to_string();
        let f = blocking(move || me.find_file(&id)).await?;
        let p = &f.parsed;
        let path = PathBuf::from(&f.path);
        let info = self
            .media
            .info(&path, || {
                media::guess_from_name(&path, p.codec.as_deref(), p.audio.as_deref(), p.hdr.as_deref())
            })
            .await;
        Some((f, info))
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct PlayBody {
    caps: Caps,
    audio: Option<u32>,
    /// Seconds into the file. Starting partway through repackages the file
    /// from there; the player adds `offset` to its clock.
    start: Option<f64>,
    /// Always repackage, e.g. after direct play failed on the TV.
    force_hls: bool,
}

async fn play(
    State(share): S,
    Path(id): Path<String>,
    headers: HeaderMap,
    uri: axum::http::Uri,
    Json(b): Json<PlayBody>,
) -> Response {
    let owner = token_of(&headers, uri.query())
        .and_then(|t| share.device_id(&t))
        .unwrap_or_default();
    let Some((f, info)) = share.file_and_info(&id).await else {
        return error(
            StatusCode::NOT_FOUND,
            "That file isn't available. Is the drive connected?",
        );
    };
    let have_ffmpeg = share.media.tools().ffmpeg.is_some();
    let mut d = media::decide(&info, &b.caps, b.audio, have_ffmpeg);
    let start = b.start.unwrap_or(0.0).max(0.0);
    // Direct play seeks by itself, so `start` only matters for HLS.
    if d.mode == "direct" && b.force_hls && have_ffmpeg {
        d.mode = "hls";
    }
    let resume = share.lib.position(&f.path).map(|p| p.0);
    let (url, offset, session) = match d.mode {
        "direct" => (Some(format!("/api/file/{id}")), 0.0, None),
        "hls" => {
            let sid = super::hex(&super::random_bytes::<12>());
            match share.media.start_session(
                std::path::Path::new(&f.path),
                &info,
                &d,
                &b.caps,
                media::NewSession {
                    id: sid.clone(),
                    owner: owner.clone(),
                    offset: start,
                },
            ) {
                Ok(_) => (Some(format!("/api/hls/{sid}/index.m3u8")), start, Some(sid)),
                Err(e) => return error(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}")),
            }
        }
        _ => (None, 0.0, None),
    };
    let audio: Vec<Value> = info
        .audio
        .iter()
        .map(|a| {
            let lang = a.language.as_deref().map(subs::language_name);
            let ch = match a.channels {
                1 => "Mono".to_string(),
                2 => "Stereo".to_string(),
                6 => "5.1".to_string(),
                8 => "7.1".to_string(),
                n => format!("{n} ch"),
            };
            let label = [lang, a.title.clone(), Some(ch)]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" · ");
            json!({ "index": a.index, "label": label, "codec": a.codec, "selected": Some(a.index) == d.audio_index })
        })
        .collect();
    let subtitles: Vec<Value> = info
        .subs
        .iter()
        .filter(|s| s.text)
        .map(|s| {
            json!({
                "id": s.id,
                "label": subs::label(s),
                "language": s.language,
                "forced": s.forced,
                "default": s.default,
                "url": format!("/api/subs/{id}/{}.vtt?shift={offset}", s.id),
            })
        })
        .collect();
    let unsupported_reason = (d.mode == "unsupported").then(|| {
        format!(
            "Your TV can't play this file as it is{}. Movie Monkey can convert it when ffmpeg is installed on your computer.",
            d.note.as_ref().map(|n| format!(" ({n})")).unwrap_or_default()
        )
    });
    // A TV that starts playing counts as a play, like opening it on the computer.
    if d.mode != "unsupported" && start < 1.0 {
        let lib = share.lib.clone();
        let path = f.path.clone();
        tokio::task::spawn_blocking(move || lib.record_play(&path));
    }
    Json(json!({
        "mode": d.mode,
        "url": url,
        "session": session,
        "offset": offset,
        "duration": info.duration,
        "resume": resume,
        "note": d.note,
        "video": d.video,
        "audioAction": d.audio,
        "audio": audio,
        "subtitles": subtitles,
        "error": unsupported_reason,
        "fileName": std::path::Path::new(&f.path).file_name().map(|n| n.to_string_lossy().to_string()),
    }))
    .into_response()
}

async fn file(State(share): S, Path(id): Path<String>, req: Request) -> Response {
    let me = share.clone();
    let Some(f) = blocking(move || me.find_file(&id)).await else {
        return error(StatusCode::NOT_FOUND, "That file isn't available.");
    };
    match ServeFile::new(&f.path).oneshot(req).await {
        Ok(res) => {
            let mut res = res.map(Body::new);
            // Matroska isn't always recognised by its official type.
            if f.path.to_lowercase().ends_with(".mkv") {
                res.headers_mut()
                    .insert(header::CONTENT_TYPE, HeaderValue::from_static("video/x-matroska"));
            }
            res
        }
        Err(never) => match never {},
    }
}

async fn hls(State(share): S, Path((sid, name)): Path<(String, String)>) -> Response {
    let Some(s) = share.media.session(&sid) else {
        return error(StatusCode::GONE, "This stream has ended.");
    };
    let seg = media::segment_number(&name);
    let is_playlist = name == "index.m3u8";
    if !(is_playlist || name == "init.mp4" || seg.is_some()) {
        return StatusCode::NOT_FOUND.into_response();
    }
    s.touch(seg);
    let path = s.dir.join(&name);
    // Wait for ffmpeg to write it (the first chunk of a 4K file can take a
    // few seconds).
    for _ in 0..150 {
        let ready = if is_playlist {
            tokio::fs::read_to_string(&path)
                .await
                .is_ok_and(|t| t.contains("#EXTINF"))
        } else {
            tokio::fs::metadata(&path).await.is_ok()
        };
        if ready {
            break;
        }
        if let Some(msg) = s.failed.lock().unwrap().clone() {
            return error(StatusCode::INTERNAL_SERVER_ERROR, format!("Converting failed: {msg}"));
        }
        if s.done.load(std::sync::atomic::Ordering::Relaxed) && !is_playlist {
            return StatusCode::NOT_FOUND.into_response();
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let Ok(mut bytes) = tokio::fs::read(&path).await else {
        return error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Still preparing this part of the video.",
        );
    };
    if is_playlist {
        // Until ffmpeg finishes, the playlist is still growing and players
        // treat it like live TV, starting at the newest chunk. Ask them to
        // start at the beginning.
        let text = String::from_utf8_lossy(&bytes);
        if !text.contains("#EXT-X-START") {
            bytes = text
                .replacen("#EXTM3U\n", "#EXTM3U\n#EXT-X-START:TIME-OFFSET=0,PRECISE=YES\n", 1)
                .into_bytes();
        }
    }
    let ct = if is_playlist {
        "application/vnd.apple.mpegurl"
    } else if name.ends_with(".m4s") {
        "video/iso.segment"
    } else {
        "video/mp4"
    };
    ([(header::CONTENT_TYPE, ct), (header::CACHE_CONTROL, "no-cache")], bytes).into_response()
}

async fn stop_hls(State(share): S, Path((sid, _)): Path<(String, String)>) -> StatusCode {
    share.media.stop_session(&sid);
    StatusCode::NO_CONTENT
}

async fn subtitle(
    State(share): S,
    Path((id, sub)): Path<(String, String)>,
    Query(q): Query<HashMap<String, String>>,
) -> Response {
    let Some((f, info)) = share.file_and_info(&id).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let sub_id = sub.trim_end_matches(".vtt");
    let Some(track) = info.subs.iter().find(|s| s.id == sub_id) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let shift = q.get("shift").and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let ffmpeg = share.media.tools().ffmpeg.clone();
    match subs::webvtt(
        track,
        std::path::Path::new(&f.path),
        ffmpeg.as_deref(),
        share.media.work_dir(),
        shift,
    )
    .await
    {
        Ok(vtt) => ([(header::CONTENT_TYPE, "text/vtt; charset=utf-8")], vtt).into_response(),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}")),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProgressBody {
    file: String,
    position: f64,
    duration: Option<f64>,
}

async fn progress(State(share): S, Json(b): Json<ProgressBody>) -> Response {
    let me = share.clone();
    let res = blocking(move || {
        let f = me.find_file(&b.file)?;
        me.lib.save_position(&f.path, b.position, b.duration).ok()
    })
    .await;
    match res {
        Some(watched) => Json(json!({ "watched": watched })).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

// ----------------------------------------------------------------- screens

async fn static_files(State(share): S, req: Request) -> Response {
    let path = req.uri().path().trim_start_matches('/');
    if path.is_empty() {
        return Redirect::temporary("/tv.html").into_response();
    }
    if path.contains("..") {
        return StatusCode::NOT_FOUND.into_response();
    }
    match (share.assets)(path) {
        Some((bytes, mime)) => {
            let cache = if path.starts_with("assets/") {
                "public, max-age=31536000, immutable"
            } else {
                "no-cache"
            };
            (
                [(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, cache.to_string())],
                bytes,
            )
                .into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
