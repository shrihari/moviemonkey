//! SQLite persistence. One small file in the app-data dir holds everything.

use super::models::{StatePatch, TitleKind, TitleMeta, UserState};
use super::parse::Parsed;
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::path::Path;

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS folders (
    id        INTEGER PRIMARY KEY,
    path      TEXT NOT NULL UNIQUE,
    added_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS titles (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    year        INTEGER,
    meta        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
    path         TEXT PRIMARY KEY,
    folder_id    INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    size         INTEGER NOT NULL,
    mtime        INTEGER NOT NULL,
    parsed       TEXT NOT NULL,
    status       TEXT NOT NULL,           -- pending | matched | manual | unmatched | ignored
    title_id     TEXT,
    season       INTEGER,
    episode      INTEGER,
    episode_end  INTEGER,
    confidence   REAL,
    guess_id     TEXT,
    added_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_title ON files(title_id);
CREATE INDEX IF NOT EXISTS files_status ON files(status);

CREATE TABLE IF NOT EXISTS user_state (
    key             TEXT PRIMARY KEY,     -- title id, or "tt123:S:E" for an episode
    watched         INTEGER NOT NULL DEFAULT 0,
    watched_at      INTEGER,
    favorite        INTEGER NOT NULL DEFAULT 0,
    watchlist       INTEGER NOT NULL DEFAULT 0,
    rating          INTEGER,
    last_played_at  INTEGER,
    play_count      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
"#;

#[derive(Debug, Clone)]
pub struct FolderRow {
    pub id: i64,
    pub path: String,
    pub added_at: i64,
}

#[derive(Debug, Clone)]
pub struct FileRow {
    pub path: String,
    pub folder_id: i64,
    pub size: u64,
    pub mtime: i64,
    pub parsed: Parsed,
    pub status: String,
    pub title_id: Option<String>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub episode_end: Option<u32>,
    pub confidence: Option<f64>,
    pub guess_id: Option<String>,
    pub added_at: i64,
}

#[derive(Debug, Clone)]
pub struct TitleRow {
    pub meta: TitleMeta,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct Db {
    pub conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { conn })
    }

    // ---------------------------------------------------------------- folders

    pub fn folders(&self) -> Result<Vec<FolderRow>> {
        let mut st = self
            .conn
            .prepare("SELECT id, path, added_at FROM folders ORDER BY added_at")?;
        let rows = st
            .query_map([], |r| {
                Ok(FolderRow {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    added_at: r.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn add_folder(&self, path: &str) -> Result<i64> {
        self.conn.execute(
            "INSERT OR IGNORE INTO folders(path, added_at) VALUES (?1, ?2)",
            params![path, now()],
        )?;
        Ok(self
            .conn
            .query_row("SELECT id FROM folders WHERE path = ?1", params![path], |r| r.get(0))?)
    }

    pub fn remove_folder(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM files WHERE folder_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
        self.prune_titles()?;
        Ok(())
    }

    // ------------------------------------------------------------------ files

    fn file_from_row(r: &rusqlite::Row) -> rusqlite::Result<FileRow> {
        let parsed: String = r.get(4)?;
        Ok(FileRow {
            path: r.get(0)?,
            folder_id: r.get(1)?,
            size: r.get::<_, i64>(2)? as u64,
            mtime: r.get(3)?,
            parsed: serde_json::from_str(&parsed).unwrap_or_default(),
            status: r.get(5)?,
            title_id: r.get(6)?,
            season: r.get(7)?,
            episode: r.get(8)?,
            episode_end: r.get(9)?,
            confidence: r.get(10)?,
            guess_id: r.get(11)?,
            added_at: r.get(12)?,
        })
    }

    const FILE_COLS: &'static str =
        "path, folder_id, size, mtime, parsed, status, title_id, season, episode, episode_end, confidence, guess_id, added_at";

    pub fn files(&self) -> Result<Vec<FileRow>> {
        let mut st = self.conn.prepare(&format!("SELECT {} FROM files", Self::FILE_COLS))?;
        let rows = st
            .query_map([], Self::file_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn files_in_folder(&self, folder_id: i64) -> Result<Vec<FileRow>> {
        let mut st = self
            .conn
            .prepare(&format!("SELECT {} FROM files WHERE folder_id = ?1", Self::FILE_COLS))?;
        let rows = st
            .query_map(params![folder_id], Self::file_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn files_with_status(&self, status: &str) -> Result<Vec<FileRow>> {
        let mut st = self
            .conn
            .prepare(&format!("SELECT {} FROM files WHERE status = ?1", Self::FILE_COLS))?;
        let rows = st
            .query_map(params![status], Self::file_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn files_for_title(&self, title_id: &str) -> Result<Vec<FileRow>> {
        let mut st = self
            .conn
            .prepare(&format!("SELECT {} FROM files WHERE title_id = ?1", Self::FILE_COLS))?;
        let rows = st
            .query_map(params![title_id], Self::file_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn insert_file(&self, folder_id: i64, path: &str, size: u64, mtime: i64, parsed: &Parsed) -> Result<()> {
        self.conn.execute(
            "INSERT INTO files(path, folder_id, size, mtime, parsed, status, season, episode, episode_end, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8, ?9)
             ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime",
            params![
                path,
                folder_id,
                size as i64,
                mtime,
                serde_json::to_string(parsed)?,
                parsed.season,
                parsed.episode,
                parsed.episode_end,
                now()
            ],
        )?;
        Ok(())
    }

    pub fn delete_files(&self, paths: &[String]) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        for p in paths {
            tx.execute("DELETE FROM files WHERE path = ?1", params![p])?;
        }
        tx.commit()?;
        self.prune_titles()?;
        Ok(())
    }

    pub fn set_file_match(
        &self,
        path: &str,
        status: &str,
        title_id: Option<&str>,
        confidence: Option<f64>,
        guess_id: Option<&str>,
    ) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET status = ?2, title_id = ?3, confidence = ?4, guess_id = ?5 WHERE path = ?1",
            params![path, status, title_id, confidence, guess_id],
        )?;
        Ok(())
    }

    pub fn set_file_episode(&self, path: &str, season: Option<u32>, episode: Option<u32>) -> Result<()> {
        self.conn.execute(
            "UPDATE files SET season = ?2, episode = ?3 WHERE path = ?1",
            params![path, season, episode],
        )?;
        Ok(())
    }

    /// Remove titles that no longer have any files and aren't on the watchlist.
    pub fn prune_titles(&self) -> Result<()> {
        self.conn.execute(
            "DELETE FROM titles WHERE id NOT IN (SELECT DISTINCT title_id FROM files WHERE title_id IS NOT NULL)
               AND id NOT IN (SELECT key FROM user_state WHERE watchlist = 1)",
            [],
        )?;
        Ok(())
    }

    // ----------------------------------------------------------------- titles

    pub fn upsert_title(&self, meta: &TitleMeta) -> Result<()> {
        let t = now();
        self.conn.execute(
            "INSERT INTO titles(id, kind, name, year, meta, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name, year = excluded.year,
               meta = excluded.meta, updated_at = excluded.updated_at",
            params![
                meta.id,
                meta.kind.as_str(),
                meta.name,
                meta.year,
                serde_json::to_string(meta)?,
                t
            ],
        )?;
        Ok(())
    }

    pub fn title(&self, id: &str) -> Result<Option<TitleRow>> {
        Ok(self
            .conn
            .query_row(
                "SELECT meta, created_at, updated_at FROM titles WHERE id = ?1",
                params![id],
                |r| {
                    let meta: String = r.get(0)?;
                    Ok((meta, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
                },
            )
            .optional()?
            .map(|(m, c, u)| TitleRow {
                meta: serde_json::from_str(&m).unwrap_or_default(),
                created_at: c,
                updated_at: u,
            }))
    }

    pub fn titles(&self) -> Result<Vec<TitleRow>> {
        let mut st = self.conn.prepare("SELECT meta, created_at, updated_at FROM titles")?;
        let rows = st
            .query_map([], |r| {
                let meta: String = r.get(0)?;
                Ok(TitleRow {
                    meta: serde_json::from_str(&meta).unwrap_or_default(),
                    created_at: r.get(1)?,
                    updated_at: r.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// The library title already matched to this TMDB entry, if any.
    pub fn title_id_for_tmdb(&self, kind: TitleKind, tmdb_id: u64) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row(
                "SELECT id FROM titles WHERE kind = ?1 AND json_extract(meta, '$.tmdbId') = ?2 LIMIT 1",
                params![kind.as_str(), tmdb_id as i64],
                |r| r.get(0),
            )
            .optional()?)
    }

    /// Titles whose metadata should be fetched again: last updated before
    /// `before`, or still from a source the app no longer uses.
    pub fn stale_titles(&self, before: i64) -> Result<Vec<(String, TitleKind)>> {
        let mut st = self.conn.prepare(
            "SELECT id, kind FROM titles
             WHERE updated_at < ?1 OR json_extract(meta, '$.source') IN ('cinemeta', 'imdb')
             ORDER BY updated_at",
        )?;
        let rows = st
            .query_map(params![before], |r| {
                Ok((r.get::<_, String>(0)?, TitleKind::from_db(&r.get::<_, String>(1)?)))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// A refresh found no newer data for this title: keep what we have and
    /// don't ask again until it's due.
    pub fn mark_title_checked(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE titles SET updated_at = ?2,
               meta = CASE WHEN json_extract(meta, '$.source') IN ('cinemeta', 'imdb')
                           THEN json_set(meta, '$.source', 'legacy') ELSE meta END
             WHERE id = ?1",
            params![id, now()],
        )?;
        Ok(())
    }

    pub fn title_kind(&self, id: &str) -> Result<Option<TitleKind>> {
        Ok(self
            .conn
            .query_row("SELECT kind FROM titles WHERE id = ?1", params![id], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
            .map(|k| TitleKind::from_db(&k)))
    }

    // ------------------------------------------------------------- user state

    pub fn all_state(&self) -> Result<HashMap<String, UserState>> {
        let mut st = self.conn.prepare(
            "SELECT key, watched, watched_at, favorite, watchlist, rating, last_played_at, play_count FROM user_state",
        )?;
        let rows = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    UserState {
                        watched: r.get::<_, i64>(1)? != 0,
                        watched_at: r.get(2)?,
                        favorite: r.get::<_, i64>(3)? != 0,
                        watchlist: r.get::<_, i64>(4)? != 0,
                        rating: r.get(5)?,
                        last_played_at: r.get(6)?,
                        play_count: r.get(7)?,
                    },
                ))
            })?
            .collect::<rusqlite::Result<HashMap<_, _>>>()?;
        Ok(rows)
    }

    pub fn state(&self, key: &str) -> Result<UserState> {
        Ok(self.all_state_for(&[key.to_string()])?.remove(key).unwrap_or_default())
    }

    fn all_state_for(&self, keys: &[String]) -> Result<HashMap<String, UserState>> {
        let all = self.all_state()?;
        Ok(all.into_iter().filter(|(k, _)| keys.contains(k)).collect())
    }

    pub fn patch_state(&self, key: &str, patch: &StatePatch) -> Result<UserState> {
        let mut s = self.state(key)?;
        if let Some(w) = patch.watched {
            s.watched = w;
            s.watched_at = if w { Some(now()) } else { None };
        }
        if let Some(f) = patch.favorite {
            s.favorite = f;
        }
        if let Some(w) = patch.watchlist {
            s.watchlist = w;
        }
        if patch.rating.is_some() {
            s.rating = patch.rating.filter(|r| *r > 0);
        }
        self.write_state(key, &s)?;
        Ok(s)
    }

    pub fn write_state(&self, key: &str, s: &UserState) -> Result<()> {
        self.conn.execute(
            "INSERT INTO user_state(key, watched, watched_at, favorite, watchlist, rating, last_played_at, play_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(key) DO UPDATE SET watched = excluded.watched, watched_at = excluded.watched_at,
               favorite = excluded.favorite, watchlist = excluded.watchlist, rating = excluded.rating,
               last_played_at = excluded.last_played_at, play_count = excluded.play_count",
            params![
                key,
                s.watched as i64,
                s.watched_at,
                s.favorite as i64,
                s.watchlist as i64,
                s.rating,
                s.last_played_at,
                s.play_count
            ],
        )?;
        Ok(())
    }

    pub fn record_play(&self, key: &str) -> Result<()> {
        let mut s = self.state(key)?;
        s.last_played_at = Some(now());
        s.play_count += 1;
        self.write_state(key, &s)
    }

    // --------------------------------------------------------------- settings

    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .conn
            .query_row("SELECT value FROM settings WHERE key = ?1", params![key], |r| r.get(0))
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

pub fn episode_key(title_id: &str, season: u32, episode: u32) -> String {
    format!("{title_id}:{season}:{episode}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::parse::parse_name;

    #[test]
    fn roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let f = db.add_folder("/movies").unwrap();
        assert_eq!(db.add_folder("/movies").unwrap(), f);
        let p = parse_name("Heat.1995.1080p");
        db.insert_file(f, "/movies/Heat.1995.1080p.mkv", 10, 1, &p).unwrap();
        assert_eq!(db.files_with_status("pending").unwrap().len(), 1);

        let meta = TitleMeta {
            id: "tt0113277".into(),
            name: "Heat".into(),
            year: Some(1995),
            ..Default::default()
        };
        db.upsert_title(&meta).unwrap();
        db.set_file_match(
            "/movies/Heat.1995.1080p.mkv",
            "matched",
            Some("tt0113277"),
            Some(0.9),
            None,
        )
        .unwrap();
        assert_eq!(db.files_for_title("tt0113277").unwrap().len(), 1);

        let s = db
            .patch_state(
                "tt0113277",
                &StatePatch {
                    watched: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(s.watched && s.watched_at.is_some());
        db.record_play("tt0113277").unwrap();
        assert_eq!(db.state("tt0113277").unwrap().play_count, 1);

        db.delete_files(&["/movies/Heat.1995.1080p.mkv".into()]).unwrap();
        assert!(db.title("tt0113277").unwrap().is_none(), "orphan titles are pruned");
    }
}
