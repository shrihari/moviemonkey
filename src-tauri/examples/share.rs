//! Run the TV sharing server without the app, against its own database.
//!
//!   npm run vite:build   # builds dist/tv.html
//!   cargo run --example share -- --db /tmp/mm-test.sqlite --folder ~/Movies
//!
//! It prints a pairing code; open http://localhost:46766 in a browser.

use movie_monkey_lib::engine::images::ImageCache;
use movie_monkey_lib::engine::library::{Event, Job, Library, Sink};
use movie_monkey_lib::engine::share::{Assets, Share};
use std::path::PathBuf;
use std::sync::Arc;

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut db = PathBuf::from("/tmp/mm-share-test.sqlite");
    let mut folders = vec![];
    let mut dist = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../dist"));
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--db" => db = args.next().expect("--db <path>").into(),
            "--folder" => folders.push(args.next().expect("--folder <path>")),
            "--dist" => dist = args.next().expect("--dist <path>").into(),
            other => anyhow::bail!("unknown argument {other}"),
        }
    }
    let sink: Sink = Arc::new(|ev| {
        if let Event::Progress(p) = ev {
            if !p.active {
                eprintln!("library: {} found, {} matched", p.found, p.matched);
            }
        }
    });
    let lib = Library::new(&db, sink)?;
    tokio::spawn(lib.clone().run_worker());
    if !folders.is_empty() {
        lib.add_folders(&folders)?;
    }
    lib.request(Job::ScanAll);
    let work = db.with_extension("work");
    let images = ImageCache::new(work.join("images"), lib.providers().client().clone());
    let assets: Assets = Arc::new(move |path: &str| {
        let bytes = std::fs::read(dist.join(path)).ok()?;
        Some((bytes, mime(path).to_string()))
    });
    let share = Share::new(lib.clone(), images, assets, work);
    share.set_enabled(true).await?;
    let code = share.begin_pairing();
    let st = share.status();
    println!(
        "sharing on port {} ({})",
        st.port.unwrap_or(0),
        st.address.unwrap_or_default()
    );
    println!("converting with ffmpeg: {}", st.can_convert);
    println!("pairing code: {code}");
    std::future::pending::<()>().await;
    Ok(())
}
