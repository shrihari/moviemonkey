//! Data shapes shared between the engine, the database and the UI.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "lowercase")]
pub enum TitleKind {
    #[default]
    Movie,
    Series,
}

impl TitleKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            TitleKind::Movie => "movie",
            TitleKind::Series => "series",
        }
    }
    pub fn from_str(s: &str) -> Self {
        if s == "series" {
            TitleKind::Series
        } else {
            TitleKind::Movie
        }
    }
}

/// Normalised metadata for a movie or show, regardless of which provider it came from.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TitleMeta {
    pub id: String,
    pub kind: TitleKind,
    pub name: String,
    pub year: Option<i32>,
    pub year_label: Option<String>,
    pub overview: Option<String>,
    pub genres: Vec<String>,
    pub runtime: Option<u32>,
    pub rating: Option<f64>,
    pub directors: Vec<String>,
    pub writers: Vec<String>,
    pub cast: Vec<String>,
    pub country: Option<String>,
    pub awards: Option<String>,
    pub released: Option<String>,
    pub status: Option<String>,
    pub poster: Option<String>,
    pub poster_alt: Option<String>,
    pub backdrop: Option<String>,
    pub logo: Option<String>,
    pub trailer: Option<String>,
    pub tmdb_id: Option<u64>,
    pub episodes: Vec<EpisodeMeta>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EpisodeMeta {
    pub season: u32,
    pub episode: u32,
    pub name: String,
    pub overview: Option<String>,
    pub thumbnail: Option<String>,
    pub released: Option<String>,
    pub rating: Option<f64>,
}

/// A candidate returned by a search provider.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    pub kind: TitleKind,
    pub title: String,
    pub year: Option<i32>,
    pub year_label: Option<String>,
    pub poster: Option<String>,
    pub subtitle: Option<String>,
    /// IMDb popularity rank (lower = more popular).
    pub rank: Option<u64>,
    /// Weight for non-standard types (TV movie, short, video …).
    pub type_weight: f64,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserState {
    pub watched: bool,
    pub watched_at: Option<i64>,
    pub favorite: bool,
    pub watchlist: bool,
    pub rating: Option<i32>,
    pub last_played_at: Option<i64>,
    pub play_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StatePatch {
    pub watched: Option<bool>,
    pub favorite: Option<bool>,
    pub watchlist: Option<bool>,
    pub rating: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub id: i64,
    pub path: String,
    pub name: String,
    pub online: bool,
    pub file_count: usize,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    pub path: String,
    pub file_name: String,
    pub size: u64,
    pub added_at: i64,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub episode_end: Option<u32>,
    pub quality: Option<String>,
    pub source: Option<String>,
    pub codec: Option<String>,
    pub hdr: Option<String>,
    pub audio: Option<String>,
    pub edition: Option<String>,
    pub status: String,
    pub online: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TitleSummary {
    pub id: String,
    pub kind: TitleKind,
    pub name: String,
    pub year: Option<i32>,
    pub year_label: Option<String>,
    pub poster: Option<String>,
    pub poster_alt: Option<String>,
    pub backdrop: Option<String>,
    pub logo: Option<String>,
    pub overview: Option<String>,
    pub rating: Option<f64>,
    pub runtime: Option<u32>,
    pub genres: Vec<String>,
    pub directors: Vec<String>,
    pub cast: Vec<String>,
    pub added_at: i64,
    pub updated_at: i64,
    pub file_count: usize,
    pub total_size: u64,
    pub episode_count: usize,
    pub watched_episodes: usize,
    pub season_count: usize,
    pub quality: Option<String>,
    pub hdr: bool,
    pub online: bool,
    pub watched: bool,
    pub favorite: bool,
    pub watchlist: bool,
    pub user_rating: Option<i32>,
    pub last_played_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeView {
    pub season: u32,
    pub episode: u32,
    pub name: String,
    pub overview: Option<String>,
    pub thumbnail: Option<String>,
    pub released: Option<String>,
    pub rating: Option<f64>,
    pub file: Option<MediaFile>,
    pub watched: bool,
    pub last_played_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SeasonView {
    pub number: u32,
    pub episodes: Vec<EpisodeView>,
    pub available: usize,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TitleDetail {
    pub summary: TitleSummary,
    pub writers: Vec<String>,
    pub country: Option<String>,
    pub awards: Option<String>,
    pub released: Option<String>,
    pub status: Option<String>,
    pub trailer: Option<String>,
    pub files: Vec<MediaFile>,
    pub seasons: Vec<SeasonView>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UnmatchedFile {
    pub path: String,
    pub file_name: String,
    pub folder: String,
    pub size: u64,
    pub added_at: i64,
    pub guess_title: String,
    pub guess_year: Option<i32>,
    pub guess_kind: TitleKind,
    pub season: Option<u32>,
    pub episode: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub movies: usize,
    pub shows: usize,
    pub episodes: usize,
    pub unmatched: usize,
    pub total_size: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub titles: Vec<TitleSummary>,
    pub unmatched: Vec<UnmatchedFile>,
    pub folders: Vec<FolderInfo>,
    pub stats: LibraryStats,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub active: bool,
    /// "idle" | "scanning" | "identifying"
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub current: Option<String>,
    pub found: usize,
    pub matched: usize,
    pub failed: usize,
}
