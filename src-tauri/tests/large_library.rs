//! Performance guard: building the UI snapshot for a big library must stay fast,
//! because the UI refetches it every time something changes.
//!
//!   cargo test --release --test large_library -- --nocapture

use movie_monkey_lib::engine::db::Db;
use movie_monkey_lib::engine::library::{Library, Sink};
use movie_monkey_lib::engine::models::{EpisodeMeta, TitleKind, TitleMeta};
use movie_monkey_lib::engine::parse::parse_name;
use std::sync::Arc;
use std::time::Instant;

#[test]
fn snapshot_of_large_library_is_fast() {
    let dir = std::env::temp_dir().join(format!("mm-perf-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("library.sqlite");
    {
        let db = Db::open(&db_path).unwrap();
        let folder = db.add_folder(dir.to_str().unwrap()).unwrap();
        db.conn.execute_batch("BEGIN").unwrap();
        // 1,800 movies with one file each
        for i in 0..1800 {
            let id = format!("tt{:07}", i);
            let meta = TitleMeta {
                id: id.clone(),
                kind: TitleKind::Movie,
                name: format!("Movie number {i}"),
                year: Some(1950 + (i % 75)),
                overview: Some("A long overview sentence that is repeated. ".repeat(6)),
                genres: vec!["Drama".into(), "Thriller".into()],
                cast: vec!["Actor One".into(), "Actor Two".into(), "Actor Three".into()],
                directors: vec!["Some Director".into()],
                poster: Some(format!("https://images.metahub.space/poster/medium/{id}/img")),
                ..Default::default()
            };
            db.upsert_title(&meta).unwrap();
            let path = format!("{}/Movie.number.{i}.1080p.mkv", dir.display());
            db.insert_file(folder, &path, 4_000_000_000, 0, &parse_name(&path))
                .unwrap();
            db.set_file_match(&path, "matched", Some(&id), Some(0.9), None).unwrap();
        }
        // 200 shows with ~16 local episodes each (3,200 files)
        for s in 0..200 {
            let id = format!("tt9{:06}", s);
            let episodes = (1..=4)
                .flat_map(|season| {
                    (1..=10).map(move |e| EpisodeMeta {
                        season,
                        episode: e,
                        name: format!("Episode {e}"),
                        overview: Some("Episode overview. ".repeat(4)),
                        ..Default::default()
                    })
                })
                .collect();
            let meta = TitleMeta {
                id: id.clone(),
                kind: TitleKind::Series,
                name: format!("Show {s}"),
                episodes,
                ..Default::default()
            };
            db.upsert_title(&meta).unwrap();
            for season in 1..=2 {
                for e in 1..=8 {
                    let path = format!("{}/Show.{s}.S{season:02}E{e:02}.mkv", dir.display());
                    db.insert_file(folder, &path, 1_000_000_000, 0, &parse_name(&path))
                        .unwrap();
                    db.set_file_match(&path, "matched", Some(&id), Some(0.9), None).unwrap();
                }
            }
        }
        db.conn.execute_batch("COMMIT").unwrap();
    }

    let sink: Sink = Arc::new(|_| {});
    let lib = Library::new(&db_path, sink).unwrap();
    let t = Instant::now();
    let snap = lib.snapshot().unwrap();
    let snapshot_ms = t.elapsed().as_millis();
    let t = Instant::now();
    let json = serde_json::to_string(&snap).unwrap();
    let json_ms = t.elapsed().as_millis();
    let t = Instant::now();
    let detail = lib.detail("tt9000001").unwrap().unwrap();
    let detail_ms = t.elapsed().as_millis();

    println!(
        "titles {} files {} | snapshot {snapshot_ms} ms, json {json_ms} ms ({} KB), show detail {detail_ms} ms ({} seasons)",
        snap.titles.len(),
        snap.stats.episodes + snap.stats.movies,
        json.len() / 1024,
        detail.seasons.len()
    );
    assert_eq!(snap.titles.len(), 2000);
    assert_eq!(snap.stats.episodes, 3200);
    let _ = std::fs::remove_dir_all(&dir);
    // Generous bound so the test is stable on slow machines/debug builds.
    assert!(snapshot_ms < 1500, "snapshot too slow: {snapshot_ms} ms");
}
