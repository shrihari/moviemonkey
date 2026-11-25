//! Headless end-to-end run of the engine against a folder.
//!
//!   cargo run --example scan -- <folder> [fixture.json]
//!
//! Prints what was identified. With a second argument, writes the library
//! snapshot + every title's detail as JSON (used by the UI's browser preview).

use movie_monkey_lib::engine::library::{Event, Job, Library, Sink};
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let folder = args.next().expect("usage: scan <folder> [fixture.json]");
    let fixture = args.next();
    let db = std::env::temp_dir().join(format!("mm-scan-{}.sqlite", std::process::id()));
    let sink: Sink = Arc::new(|ev| {
        if let Event::Progress(p) = ev {
            if p.phase == "identifying" {
                eprint!("\r  identifying {:>3}/{:<3} {:<50}", p.done, p.total, p.current.unwrap_or_default());
            }
        }
    });
    let lib = Library::new(&db, sink)?;
    let started = std::time::Instant::now();
    let root = std::fs::canonicalize(&folder)?.to_string_lossy().to_string();
    lib.add_folders(&[folder])?;
    lib.process(HashSet::from([Job::ScanAll])).await?;
    eprintln!("\n  done in {:.1}s\n", started.elapsed().as_secs_f32());

    let snap = lib.snapshot()?;
    for t in &snap.titles {
        let extra = if t.episode_count > 0 { format!("  [{} eps]", t.episode_count) } else { String::new() };
        println!(
            "  {:<7} {:<11} {:<44} {:<6} {:>4} {}{}",
            t.kind.as_str(),
            t.id,
            t.name,
            t.year.map(|y| y.to_string()).unwrap_or_default(),
            t.quality.clone().unwrap_or_default(),
            t.rating.map(|r| format!("★{r}")).unwrap_or_default(),
            extra
        );
    }
    for u in &snap.unmatched {
        println!("  UNMATCHED  {}  (guess: {} {:?})", u.file_name, u.guess_title, u.guess_year);
    }
    println!(
        "\n  {} movies, {} shows ({} episodes), {} unmatched",
        snap.stats.movies, snap.stats.shows, snap.stats.episodes, snap.stats.unmatched
    );

    if let Some(out) = fixture {
        let mut details = BTreeMap::new();
        for t in &snap.titles {
            if let Some(d) = lib.detail(&t.id)? {
                details.insert(t.id.clone(), d);
            }
        }
        let json = serde_json::json!({ "snapshot": snap, "details": details });
        // Don't leak local paths into a committed fixture.
        let text = serde_json::to_string(&json)?.replace(&root, "/Volumes/Media");
        std::fs::write(&out, text)?;
        println!("  wrote {out}");
    }
    let _ = std::fs::remove_file(&db);
    Ok(())
}
