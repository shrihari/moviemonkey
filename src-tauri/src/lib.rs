pub mod engine;

use engine::images::{parse_request, ImageCache};
use engine::library::{Event, Job, Library, Sink};
use engine::models::*;
use engine::share::{Assets, Share, ShareStatus};
use std::sync::Arc;
use tauri::http::Response;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

struct AppState {
    lib: Arc<Library>,
    images: ImageCache,
    share: Arc<Share>,
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
async fn assign_match(state: State<'_, AppState>, paths: Vec<String>, id: String, kind: TitleKind) -> CmdResult<()> {
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

// ------------------------------------------------------------ watch on TV

#[tauri::command]
fn share_status(state: State<'_, AppState>) -> ShareStatus {
    state.share.status()
}

#[tauri::command]
async fn share_set_enabled(app: AppHandle, state: State<'_, AppState>, on: bool) -> CmdResult<ShareStatus> {
    let res = state.share.set_enabled(on).await;
    update_tray(&app);
    res.map_err(err)?;
    Ok(state.share.status())
}

#[tauri::command]
fn share_pair(state: State<'_, AppState>) -> ShareStatus {
    state.share.begin_pairing();
    state.share.status()
}

#[tauri::command]
fn share_cancel_pairing(state: State<'_, AppState>) -> ShareStatus {
    state.share.cancel_pairing();
    state.share.status()
}

#[tauri::command]
fn share_remove_device(state: State<'_, AppState>, id: String) -> ShareStatus {
    state.share.remove_device(&id);
    state.share.status()
}

#[tauri::command]
fn share_set_keep_running(app: AppHandle, state: State<'_, AppState>, on: bool) -> CmdResult<ShareStatus> {
    state.share.set_keep_running(on).map_err(err)?;
    update_tray(&app);
    Ok(state.share.status())
}

/// Whether closing the window should leave Movie Monkey running in the menu
/// bar, still sharing with TVs.
fn keeps_running(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .is_some_and(|s| s.share.enabled() && s.share.keep_running())
}

fn show_main(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

const TRAY_ID: &str = "share";

/// The menu-bar icon exists while sharing is on and set to keep running.
fn update_tray(app: &AppHandle) {
    let want = keeps_running(app);
    match (app.tray_by_id(TRAY_ID), want) {
        (None, true) => {
            if let Err(e) = build_tray(app) {
                log::warn!("menu bar icon: {e}");
            }
        }
        (Some(_), false) => {
            app.remove_tray_by_id(TRAY_ID);
            // Nothing would be left to bring the window back.
            if app
                .get_webview_window("main")
                .is_some_and(|w| !w.is_visible().unwrap_or(true))
            {
                show_main(app);
            }
        }
        _ => {}
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "Sharing with your TVs", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open Movie Monkey", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop Sharing", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Movie Monkey", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&status, &sep, &open, &stop, &sep2, &quit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("Movie Monkey")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "stop" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = app.try_state::<AppState>() {
                        let _ = state.share.set_enabled(false).await;
                    }
                    update_tray(&app);
                    let _ = app.emit("mm://share", ());
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

/// The TV screens are part of the app's own frontend build (`tv.html`).
fn tv_assets(app: &AppHandle) -> Assets {
    let resolver = app.asset_resolver();
    Arc::new(move |path: &str| {
        if let Some(a) = resolver.get(path.to_string()) {
            return Some((a.bytes, a.mime_type));
        }
        // `tauri dev` serves the frontend from Vite; fall back to the last build.
        if cfg!(debug_assertions) {
            let file = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../dist")).join(path);
            let bytes = std::fs::read(&file).ok()?;
            let mime = match file.extension().and_then(|e| e.to_str()).unwrap_or("") {
                "html" => "text/html",
                "js" => "text/javascript",
                "css" => "text/css",
                "png" => "image/png",
                "svg" => "image/svg+xml",
                _ => "application/octet-stream",
            };
            return Some((bytes, mime.to_string()));
        }
        None
    })
}

pub fn run() {
    let app = tauri::Builder::default()
        // Must be first: a second launch focuses this window (and hands over
        // any folder arguments) instead of opening the database twice.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main(app);
            let dirs: Vec<String> = args
                .into_iter()
                .skip(1)
                .filter(|a| std::path::Path::new(a).is_dir())
                .collect();
            if let (false, Some(state)) = (dirs.is_empty(), app.try_state::<AppState>()) {
                let lib = state.lib.clone();
                tauri::async_runtime::spawn_blocking(move || lib.add_folders(&dirs));
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
        .on_window_event(|window, event| {
            // With "Keep sharing when the window is closed" on, closing the
            // window leaves Movie Monkey in the menu bar instead of quitting.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if keeps_running(app) {
                    api.prevent_close();
                    let _ = window.hide();
                    #[cfg(target_os = "macos")]
                    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
            }
        })
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
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
            let images = ImageCache::new(cache_dir.join("images"), lib.providers().client().clone());
            let share = Share::new(
                lib.clone(),
                images.clone(),
                tv_assets(app.handle()),
                cache_dir.join("share"),
            );
            let handle = app.handle().clone();
            share.set_on_change(Arc::new(move || {
                let _ = handle.emit("mm://share", ());
            }));
            app.manage(AppState {
                lib: lib.clone(),
                images,
                share: share.clone(),
            });
            tauri::async_runtime::spawn(lib.clone().run_worker());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                share.resume().await;
                update_tray(&handle);
                let _ = handle.emit("mm://share", ());
            });
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
            share_status,
            share_set_enabled,
            share_pair,
            share_cancel_pairing,
            share_remove_device,
            share_set_keep_running,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Movie Monkey");

    app.run(|_app, _event| {
        // Clicking the Dock icon while the window is hidden brings it back.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = _event {
            show_main(_app);
        }
    });
}
