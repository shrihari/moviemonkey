pub mod engine;

use engine::images::{parse_request, ImageCache};
use engine::library::{Event, Job, Library, Sink};
use engine::models::*;
use std::sync::Arc;
use tauri::http::Response;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

struct AppState {
    lib: Arc<Library>,
    images: ImageCache,
}

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
async fn get_library(state: State<'_, AppState>) -> CmdResult<LibrarySnapshot> {
    state.lib.snapshot().map_err(err)
}

#[tauri::command]
async fn get_title(state: State<'_, AppState>, id: String) -> CmdResult<Option<TitleDetail>> {
    state.lib.detail(&id).map_err(err)
}

#[tauri::command]
fn get_progress(state: State<'_, AppState>) -> Progress {
    state.lib.progress()
}

#[tauri::command]
async fn add_folders(state: State<'_, AppState>, paths: Vec<String>) -> CmdResult<Vec<i64>> {
    state.lib.add_folders(&paths).map_err(err)
}

#[tauri::command]
async fn remove_folder(state: State<'_, AppState>, id: i64) -> CmdResult<()> {
    state.lib.remove_folder(id).map_err(err)
}

#[tauri::command]
fn rescan(state: State<'_, AppState>, retry_unmatched: Option<bool>) {
    if retry_unmatched.unwrap_or(false) {
        state.lib.request(Job::RetryUnmatched);
    }
    state.lib.request(Job::ScanAll);
}

#[tauri::command]
async fn set_state(state: State<'_, AppState>, key: String, patch: StatePatch) -> CmdResult<()> {
    state.lib.set_state(&key, &patch).map_err(err)
}

#[tauri::command]
async fn play(app: AppHandle, state: State<'_, AppState>, path: String) -> CmdResult<()> {
    app.opener().open_path(&path, None::<&str>).map_err(err)?;
    state.lib.record_play(&path).map_err(err)
}

#[tauri::command]
async fn reveal(app: AppHandle, path: String) -> CmdResult<()> {
    app.opener().reveal_item_in_dir(&path).map_err(err)
}

#[tauri::command]
async fn search_titles(
    state: State<'_, AppState>,
    query: String,
    kind: Option<TitleKind>,
) -> CmdResult<Vec<Candidate>> {
    Ok(state.lib.providers().search_all(&query, kind).await)
}

#[tauri::command]
async fn assign_match(
    state: State<'_, AppState>,
    paths: Vec<String>,
    id: String,
    kind: TitleKind,
) -> CmdResult<()> {
    state.lib.assign(&paths, &id, kind).await.map_err(err)
}

#[tauri::command]
async fn ignore_files(state: State<'_, AppState>, paths: Vec<String>) -> CmdResult<()> {
    state.lib.ignore_files(&paths).map_err(err)
}

#[tauri::command]
async fn refresh_title(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    state.lib.refresh_title(&id).await.map_err(err)
}

#[tauri::command]
async fn cache_size(state: State<'_, AppState>) -> CmdResult<u64> {
    Ok(state.images.size_bytes())
}

#[tauri::command]
async fn clear_cache(state: State<'_, AppState>) -> CmdResult<()> {
    state.images.clear().map_err(err)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("mm", |ctx, request, responder| {
            let images = ctx.app_handle().try_state::<AppState>().map(|s| s.images.clone());
            let uri = request.uri().to_string();
            tauri::async_runtime::spawn(async move {
                let not_found = || Response::builder().status(404).body(Vec::new()).unwrap();
                let resp = match (images, parse_request(&uri)) {
                    (Some(images), Some((url, fallback))) => match images.get(&url, fallback.as_deref()).await {
                        Some((bytes, ct)) => Response::builder()
                            .status(200)
                            .header("Content-Type", ct)
                            .header("Cache-Control", "public, max-age=31536000, immutable")
                            .header("Access-Control-Allow-Origin", "*")
                            .body(bytes)
                            .unwrap(),
                        None => not_found(),
                    },
                    _ => not_found(),
                };
                responder.respond(resp);
            });
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let cache_dir = app.path().app_cache_dir()?.join("images");
            let handle = app.handle().clone();
            let sink: Sink = Arc::new(move |ev| match ev {
                Event::Progress(p) => {
                    let _ = handle.emit("mm://progress", p);
                }
                Event::Changed => {
                    let _ = handle.emit("mm://changed", ());
                }
            });
            let lib = Library::new(&data_dir.join("library.sqlite"), sink)?;
            let images = ImageCache::new(cache_dir, lib.providers().client().clone());
            app.manage(AppState { lib: lib.clone(), images });
            tauri::async_runtime::spawn(lib.clone().run_worker());
            // Touching the library folders can block (slow/network drives, or a
            // macOS privacy prompt for Documents / external volumes), so never do
            // it on the main thread: the window must appear immediately.
            tauri::async_runtime::spawn_blocking(move || {
                lib.rewatch();
                lib.request(Job::ScanAll);
                // `movie-monkey ~/Movies ~/TV` adds those folders on launch.
                let dirs: Vec<String> = std::env::args()
                    .skip(1)
                    .filter(|a| std::path::Path::new(a).is_dir())
                    .collect();
                if !dirs.is_empty() {
                    if let Err(e) = lib.add_folders(&dirs) {
                        log::warn!("could not add folders from arguments: {e:#}");
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_library,
            get_title,
            get_progress,
            add_folders,
            remove_folder,
            rescan,
            set_state,
            play,
            reveal,
            search_titles,
            assign_match,
            ignore_files,
            refresh_title,
            cache_size,
            clear_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Movie Monkey");
}
