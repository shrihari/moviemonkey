//! The Movie Database (TMDB): the main metadata source.
//!
//! Free for non-commercial use with attribution (Settings › About). The API
//! token is compiled in by `build.rs` and sent as a Bearer header, so it never
//! appears in URLs or logs. Rate limit: roughly 40 requests a second; the
//! shared HTTP helper backs off on 429.

use super::models::{Candidate, EpisodeMeta, Person, TitleKind, TitleMeta};
use super::providers::{clean_query, first_year, s, strings, Providers};
use anyhow::Result;
use serde_json::Value;
use std::cmp::Ordering;

pub const API: &str = "https://api.themoviedb.org/3";
const IMG: &str = "https://image.tmdb.org/t/p";
/// TMDB allows at most 20 appended sub-requests per call.
const APPEND_MAX: usize = 20;
const TV_APPENDS: [&str; 5] = [
    "aggregate_credits",
    "images",
    "videos",
    "external_ids",
    "content_ratings",
];

pub fn image(size: &str, path: Option<&str>) -> Option<String> {
    let p = path?.trim();
    p.starts_with('/').then(|| format!("{IMG}/{size}{p}"))
}

fn ns(kind: TitleKind) -> &'static str {
    match kind {
        TitleKind::Movie => "movie",
        TitleKind::Series => "tv",
    }
}

/// Our id for a TMDB title: "tmdb-movie-603", "tmdb-tv-1396". Library titles
/// use the IMDb id instead whenever TMDB knows it, so these mostly appear in
/// search results.
pub fn tmdb_key(kind: TitleKind, id: u64) -> String {
    format!("tmdb-{}-{id}", ns(kind))
}

pub fn parse_tmdb_key(id: &str) -> Option<(TitleKind, u64)> {
    let (k, n) = id.strip_prefix("tmdb-")?.split_once('-')?;
    let kind = match k {
        "movie" => TitleKind::Movie,
        "tv" => TitleKind::Series,
        _ => return None,
    };
    Some((kind, n.parse().ok()?))
}

/// Vote count → how well known a title is, 0–1: 1 vote ≈ 0.07, 1,000 ≈ 0.7,
/// 20,000+ = 1. Used to break ties between titles with the same name.
pub fn popularity(votes: u64) -> f64 {
    ((votes as f64 + 1.0).log10() / 4.3).clamp(0.0, 1.0)
}

/// TMDB's TV genres pair two up ("Sci-Fi & Fantasy"). Split them and use the
/// movie names so the sidebar shows one list.
pub fn normalize_genres(names: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for name in names {
        for part in name.split(" & ") {
            let g = match part.trim() {
                "Science Fiction" => "Sci-Fi",
                "TV Movie" => continue,
                other => other,
            };
            if !g.is_empty() && !out.iter().any(|o| o == g) {
                out.push(g.to_string());
            }
        }
    }
    out
}

fn names(list: &Value, key: &str) -> Vec<String> {
    list.as_array()
        .map(|a| a.iter().filter_map(|x| s(&x[key])).collect())
        .unwrap_or_default()
}

fn countries(v: &Value) -> Option<String> {
    let mut n: Vec<String> = names(&v["production_countries"], "name")
        .into_iter()
        .map(|c| match c.as_str() {
            "United States of America" => "United States".to_string(),
            _ => c,
        })
        .collect();
    if n.is_empty() {
        n = strings(&v["origin_country"]);
    }
    (!n.is_empty()).then(|| n.join(", "))
}

fn rating(v: &Value) -> Option<f64> {
    let votes = v["vote_count"].as_u64().unwrap_or(0);
    let avg = v["vote_average"].as_f64()?;
    (votes >= 5 && avg > 0.0).then(|| (avg * 10.0).round() / 10.0)
}

fn cast(list: &Value, tv: bool) -> Vec<Person> {
    list.as_array()
        .map(|a| {
            a.iter()
                .take(20)
                .filter_map(|c| {
                    let role = if tv {
                        c["roles"]
                            .as_array()
                            .and_then(|r| r.first())
                            .and_then(|r| s(&r["character"]))
                    } else {
                        s(&c["character"])
                    };
                    Some(Person {
                        name: s(&c["name"])?,
                        role,
                        photo: image("w185", c["profile_path"].as_str()),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn crew(list: &Value, jobs: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for c in list.as_array().into_iter().flatten() {
        if c["job"].as_str().map(|j| jobs.contains(&j)).unwrap_or(false) {
            if let Some(n) = s(&c["name"]) {
                if !out.contains(&n) {
                    out.push(n);
                }
            }
        }
    }
    out
}

/// English title art as PNG, the community's favourite first. SVGs and
/// text-less logos are only used when nothing better exists.
fn pick_logo(images: &Value) -> Option<String> {
    let mut logos: Vec<&Value> = images["logos"]
        .as_array()?
        .iter()
        .filter(|l| matches!(l["iso_639_1"].as_str(), Some("en") | None))
        .collect();
    let key = |l: &Value| {
        let svg = l["file_path"].as_str().map(|p| p.ends_with(".svg")).unwrap_or(true);
        let not_en = l["iso_639_1"].as_str() != Some("en");
        (svg, not_en)
    };
    logos.sort_by(|a, b| {
        key(a).cmp(&key(b)).then_with(|| {
            let (va, vb) = (
                a["vote_average"].as_f64().unwrap_or(0.0),
                b["vote_average"].as_f64().unwrap_or(0.0),
            );
            vb.partial_cmp(&va).unwrap_or(Ordering::Equal)
        })
    });
    image("w500", logos.first()?["file_path"].as_str())
}

/// YouTube key of the best trailer: official first, then any trailer, then a teaser.
fn pick_trailer(videos: &Value) -> Option<String> {
    let list: Vec<&Value> = videos["results"]
        .as_array()?
        .iter()
        .filter(|v| v["site"].as_str() == Some("YouTube"))
        .collect();
    let is = |v: &&&Value, t: &str| v["type"].as_str() == Some(t);
    let pick = list
        .iter()
        .find(|v| is(v, "Trailer") && v["official"].as_bool() == Some(true))
        .or_else(|| list.iter().find(|v| is(v, "Trailer")))
        .or_else(|| list.iter().find(|v| is(v, "Teaser")))?;
    s(&pick["key"])
}

fn certification_movie(v: &Value) -> Option<String> {
    let us = v["release_dates"]["results"]
        .as_array()?
        .iter()
        .find(|r| r["iso_3166_1"].as_str() == Some("US"))?;
    us["release_dates"]
        .as_array()?
        .iter()
        .find_map(|d| s(&d["certification"]).filter(|c| c != "NR"))
}

fn certification_tv(v: &Value) -> Option<String> {
    v["content_ratings"]["results"]
        .as_array()?
        .iter()
        .find(|r| r["iso_3166_1"].as_str() == Some("US"))
        .and_then(|r| s(&r["rating"]).filter(|c| c != "NR"))
}

fn imdb_id(v: &Value) -> Option<String> {
    s(&v["imdb_id"])
        .or_else(|| s(&v["external_ids"]["imdb_id"]))
        .filter(|i| i.starts_with("tt"))
}

/// A movie or TV search result (or a /find result) as a match candidate.
pub fn candidate(r: &Value, kind: TitleKind) -> Option<Candidate> {
    let id = r["id"].as_u64()?;
    let (title, original, date) = match kind {
        TitleKind::Movie => (s(&r["title"]), s(&r["original_title"]), s(&r["release_date"])),
        TitleKind::Series => (s(&r["name"]), s(&r["original_name"]), s(&r["first_air_date"])),
    };
    let title = title?;
    let year = date.as_deref().and_then(first_year);
    let origin = strings(&r["origin_country"]);
    let original_title = original.filter(|o| *o != title);
    let mut sub: Vec<String> = original_title.iter().cloned().collect();
    if kind == TitleKind::Series && !origin.is_empty() {
        sub.push(origin.join(", "));
    }
    Some(Candidate {
        id: tmdb_key(kind, id),
        kind,
        title,
        year,
        year_label: year.map(|y| y.to_string()),
        poster: image("w342", r["poster_path"].as_str()),
        subtitle: (!sub.is_empty()).then(|| sub.join(" · ")),
        popularity: Some(popularity(r["vote_count"].as_u64().unwrap_or(0))),
        type_weight: if r["video"].as_bool() == Some(true) { 0.7 } else { 1.0 },
        source: "tmdb".into(),
        country: (!origin.is_empty()).then(|| origin.join(",")),
        original_title,
        tmdb_id: Some(id),
        tvmaze_id: None,
    })
}

pub fn map_movie(v: &Value) -> TitleMeta {
    let id = v["id"].as_u64().unwrap_or(0);
    let released = s(&v["release_date"]);
    let year = released.as_deref().and_then(first_year);
    let people = cast(&v["credits"]["cast"], false);
    TitleMeta {
        id: imdb_id(v).unwrap_or_else(|| tmdb_key(TitleKind::Movie, id)),
        kind: TitleKind::Movie,
        name: s(&v["title"]).unwrap_or_default(),
        year,
        year_label: year.map(|y| y.to_string()),
        overview: s(&v["overview"]),
        genres: normalize_genres(names(&v["genres"], "name")),
        runtime: v["runtime"].as_u64().filter(|r| *r > 0).map(|r| r as u32),
        rating: rating(v),
        directors: crew(&v["credits"]["crew"], &["Director"]),
        writers: crew(&v["credits"]["crew"], &["Screenplay", "Writer"]),
        cast: people.iter().map(|p| p.name.clone()).collect(),
        people,
        certification: certification_movie(v),
        country: countries(v),
        released,
        status: s(&v["status"]),
        poster: image("w500", v["poster_path"].as_str()),
        backdrop: image("w1280", v["backdrop_path"].as_str()),
        logo: pick_logo(&v["images"]),
        trailer: pick_trailer(&v["videos"]),
        tmdb_id: Some(id),
        source: "tmdb".into(),
        ..Default::default()
    }
}

/// A show plus the season objects fetched for it (`/tv/{id}/season/{n}` shape).
pub fn map_tv(v: &Value, seasons: &[Value]) -> TitleMeta {
    let id = v["id"].as_u64().unwrap_or(0);
    let first = s(&v["first_air_date"]);
    let start = first.as_deref().and_then(first_year);
    let end = s(&v["last_air_date"]).as_deref().and_then(first_year);
    let status = s(&v["status"]);
    let ended = matches!(status.as_deref(), Some("Ended") | Some("Canceled"));
    let year_label = match (start, end) {
        (Some(a), Some(b)) if ended && b > a => Some(format!("{a}–{b}")),
        (Some(a), _) if ended => Some(a.to_string()),
        (Some(a), _) => Some(format!("{a}–")),
        _ => None,
    };
    let raw_episodes: Vec<&Value> = seasons
        .iter()
        .flat_map(|season| season["episodes"].as_array().into_iter().flatten())
        .collect();
    let mut episodes: Vec<EpisodeMeta> = raw_episodes
        .iter()
        .filter_map(|e| {
            let number = e["episode_number"].as_u64()? as u32;
            Some(EpisodeMeta {
                season: e["season_number"].as_u64()? as u32,
                episode: number,
                name: s(&e["name"]).unwrap_or_else(|| format!("Episode {number}")),
                overview: s(&e["overview"]),
                thumbnail: image("w300", e["still_path"].as_str()),
                released: s(&e["air_date"]),
                rating: e["vote_average"].as_f64().filter(|r| *r > 0.0),
            })
        })
        .collect();
    episodes.sort_by_key(|e| (e.season, e.episode));
    // Newer shows leave episode_run_time empty; use the typical episode instead.
    let runtime = v["episode_run_time"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|r| r.as_u64())
        .or_else(|| {
            let mut r: Vec<u64> = raw_episodes
                .iter()
                .filter_map(|e| e["runtime"].as_u64())
                .filter(|r| *r > 0)
                .collect();
            r.sort_unstable();
            r.get(r.len() / 2).copied()
        })
        .map(|r| r as u32);
    let people = cast(&v["aggregate_credits"]["cast"], true);
    TitleMeta {
        id: imdb_id(v).unwrap_or_else(|| tmdb_key(TitleKind::Series, id)),
        kind: TitleKind::Series,
        name: s(&v["name"]).unwrap_or_default(),
        year: start,
        year_label,
        overview: s(&v["overview"]),
        genres: normalize_genres(names(&v["genres"], "name")),
        runtime,
        rating: rating(v),
        directors: names(&v["created_by"], "name"),
        cast: people.iter().map(|p| p.name.clone()).collect(),
        people,
        certification: certification_tv(v),
        country: countries(v),
        released: first,
        status,
        poster: image("w500", v["poster_path"].as_str()),
        backdrop: image("w1280", v["backdrop_path"].as_str()),
        logo: pick_logo(&v["images"]),
        trailer: pick_trailer(&v["videos"]),
        tmdb_id: Some(id),
        episodes,
        source: "tmdb".into(),
        ..Default::default()
    }
}

impl Providers {
    /// Search movies or shows. TMDB matches original, translated and
    /// alternative titles. For movies, `year` matches a release in any country.
    pub async fn tmdb_search(&self, query: &str, kind: TitleKind, year: Option<i32>) -> Result<Vec<Candidate>> {
        let q = clean_query(query);
        if q.is_empty() {
            return Ok(vec![]);
        }
        let mut url = format!(
            "{API}/search/{}?query={}&include_adult=false&language=en-US",
            ns(kind),
            urlencoding::encode(&q)
        );
        if let Some(y) = year {
            let param = match kind {
                TitleKind::Movie => "year",
                TitleKind::Series => "first_air_date_year",
            };
            url.push_str(&format!("&{param}={y}"));
        }
        let v: Value = self.get_json(&url).await?;
        Ok(v["results"]
            .as_array()
            .map(|a| a.iter().filter_map(|r| candidate(r, kind)).collect())
            .unwrap_or_default())
    }

    /// Alternative titles in every language ("Sousou no Frieren", "Star Wars:
    /// Episode IV - A New Hope").
    pub async fn tmdb_alt_titles(&self, kind: TitleKind, id: u64) -> Result<Vec<String>> {
        let v: Value = self
            .get_json(&format!("{API}/{}/{id}/alternative_titles", ns(kind)))
            .await?;
        let list = match kind {
            TitleKind::Movie => &v["titles"],
            TitleKind::Series => &v["results"],
        };
        Ok(names(list, "title"))
    }

    /// Titles with this IMDb id, as candidates (any kind).
    pub async fn tmdb_find_imdb(&self, imdb: &str) -> Result<Vec<Candidate>> {
        let v: Value = self
            .get_json(&format!("{API}/find/{imdb}?external_source=imdb_id&language=en-US"))
            .await?;
        let movies = v["movie_results"].as_array().into_iter().flatten();
        let shows = v["tv_results"].as_array().into_iter().flatten();
        Ok(movies
            .filter_map(|r| candidate(r, TitleKind::Movie))
            .chain(shows.filter_map(|r| candidate(r, TitleKind::Series)))
            .collect())
    }

    /// Full metadata. Shows come with every season's episodes: the first 15
    /// seasons ride along in the same request (TMDB leaves out ones that don't
    /// exist), longer runs take one more request per 20 seasons.
    pub async fn tmdb_details(&self, kind: TitleKind, id: u64) -> Result<TitleMeta> {
        const COMMON: &str = "language=en-US&include_image_language=en,null";
        match kind {
            TitleKind::Movie => {
                let v: Value = self
                    .get_json(&format!(
                        "{API}/movie/{id}?{COMMON}&append_to_response=credits,images,videos,external_ids,release_dates"
                    ))
                    .await?;
                Ok(map_movie(&v))
            }
            TitleKind::Series => {
                let blind = (APPEND_MAX - TV_APPENDS.len()) as u64;
                let appends: Vec<String> = TV_APPENDS
                    .iter()
                    .map(|a| a.to_string())
                    .chain((0..blind).map(|n| format!("season/{n}")))
                    .collect();
                let v: Value = self
                    .get_json(&format!(
                        "{API}/tv/{id}?{COMMON}&append_to_response={}",
                        appends.join(",")
                    ))
                    .await?;
                let mut seasons = appended_seasons(&v);
                let missing: Vec<u64> = v["seasons"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|x| x["season_number"].as_u64())
                    .filter(|n| *n >= blind)
                    .collect();
                for chunk in missing.chunks(APPEND_MAX) {
                    let list: Vec<String> = chunk.iter().map(|n| format!("season/{n}")).collect();
                    let more: Value = self
                        .get_json(&format!("{API}/tv/{id}?{COMMON}&append_to_response={}", list.join(",")))
                        .await?;
                    seasons.extend(appended_seasons(&more));
                }
                Ok(map_tv(&v, &seasons))
            }
        }
    }
}

fn appended_seasons(v: &Value) -> Vec<Value> {
    v.as_object()
        .map(|o| {
            o.iter()
                .filter(|(k, _)| k.starts_with("season/"))
                .map(|(_, season)| season.clone())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keys_and_genres() {
        assert_eq!(tmdb_key(TitleKind::Series, 1396), "tmdb-tv-1396");
        assert_eq!(parse_tmdb_key("tmdb-movie-603"), Some((TitleKind::Movie, 603)));
        assert_eq!(parse_tmdb_key("tt0133093"), None);
        assert_eq!(
            normalize_genres(
                [
                    "Sci-Fi & Fantasy",
                    "Drama",
                    "Science Fiction",
                    "TV Movie",
                    "Action & Adventure"
                ]
                .map(String::from)
            ),
            vec!["Sci-Fi", "Fantasy", "Drama", "Action", "Adventure"]
        );
        assert!(popularity(0) < 0.01 && popularity(1000) > 0.65 && popularity(50_000) == 1.0);
    }

    #[test]
    fn maps_a_movie() {
        let v = json!({
            "id": 129, "imdb_id": "tt0245429", "title": "Spirited Away", "release_date": "2001-07-20",
            "overview": "A girl…", "runtime": 125, "vote_average": 8.537, "vote_count": 17000, "status": "Released",
            "genres": [{"name": "Animation"}, {"name": "Family"}, {"name": "Fantasy"}],
            "production_countries": [{"name": "Japan"}],
            "poster_path": "/p.jpg", "backdrop_path": "/b.jpg",
            "credits": {
                "cast": [{"name": "Rumi Hiiragi", "character": "Chihiro (voice)", "profile_path": "/r.jpg"}],
                "crew": [{"name": "Hayao Miyazaki", "job": "Director"}, {"name": "Hayao Miyazaki", "job": "Screenplay"}]
            },
            "images": {"logos": [
                {"file_path": "/x.svg", "iso_639_1": "en", "vote_average": 9.0},
                {"file_path": "/ja.png", "iso_639_1": "ja", "vote_average": 9.0},
                {"file_path": "/en.png", "iso_639_1": "en", "vote_average": 5.0}
            ]},
            "videos": {"results": [
                {"site": "YouTube", "type": "Teaser", "key": "tease"},
                {"site": "YouTube", "type": "Trailer", "official": false, "key": "fan"},
                {"site": "YouTube", "type": "Trailer", "official": true, "key": "real"}
            ]},
            "release_dates": {"results": [{"iso_3166_1": "US", "release_dates": [{"certification": ""}, {"certification": "PG"}]}]}
        });
        let m = map_movie(&v);
        assert_eq!(m.id, "tt0245429");
        assert_eq!(m.year, Some(2001));
        assert_eq!(m.rating, Some(8.5));
        assert_eq!(m.directors, vec!["Hayao Miyazaki"]);
        assert_eq!(m.people[0].role.as_deref(), Some("Chihiro (voice)"));
        assert_eq!(
            m.people[0].photo.as_deref(),
            Some("https://image.tmdb.org/t/p/w185/r.jpg")
        );
        assert_eq!(m.logo.as_deref(), Some("https://image.tmdb.org/t/p/w500/en.png"));
        assert_eq!(m.trailer.as_deref(), Some("real"));
        assert_eq!(m.certification.as_deref(), Some("PG"));
        assert_eq!(m.poster.as_deref(), Some("https://image.tmdb.org/t/p/w500/p.jpg"));
        assert_eq!(m.source, "tmdb");
    }

    #[test]
    fn maps_a_show() {
        let v = json!({
            "id": 2316, "name": "The Office", "first_air_date": "2005-03-24", "last_air_date": "2013-05-16",
            "status": "Ended", "episode_run_time": [], "external_ids": {"imdb_id": "tt0386676"},
            "genres": [{"name": "Comedy"}], "origin_country": ["US"], "production_countries": [],
            "created_by": [{"name": "Greg Daniels"}],
            "aggregate_credits": {"cast": [{"name": "Steve Carell", "roles": [{"character": "Michael Scott"}]}]},
            "content_ratings": {"results": [{"iso_3166_1": "US", "rating": "TV-14"}]}
        });
        let seasons = vec![
            json!({"episodes": [{"season_number": 1, "episode_number": 2, "name": "Diversity Day", "runtime": 22, "vote_average": 0.0}]}),
            json!({"episodes": [{"season_number": 0, "episode_number": 1, "name": "Special", "runtime": 30, "still_path": "/s.jpg"}]}),
        ];
        let m = map_tv(&v, &seasons);
        assert_eq!(m.id, "tt0386676");
        assert_eq!(m.year_label.as_deref(), Some("2005–2013"));
        assert_eq!(m.country.as_deref(), Some("US"));
        assert_eq!(m.directors, vec!["Greg Daniels"]);
        assert_eq!(m.people[0].role.as_deref(), Some("Michael Scott"));
        assert_eq!(m.certification.as_deref(), Some("TV-14"));
        assert_eq!((m.episodes[0].season, m.episodes[1].season), (0, 1), "sorted by season");
        assert_eq!(m.episodes[1].rating, None, "0.0 means unrated");
        assert_eq!(
            m.episodes[0].thumbnail.as_deref(),
            Some("https://image.tmdb.org/t/p/w300/s.jpg")
        );
        assert!(m.runtime == Some(22) || m.runtime == Some(30));
    }

    #[test]
    fn search_result_candidates() {
        let r = json!({"id": 209867, "name": "Frieren: Beyond Journey's End", "original_name": "葬送のフリーレン",
            "first_air_date": "2023-09-29", "origin_country": ["JP"], "vote_count": 600, "poster_path": "/f.jpg"});
        let c = candidate(&r, TitleKind::Series).unwrap();
        assert_eq!(c.id, "tmdb-tv-209867");
        assert_eq!(c.year, Some(2023));
        assert_eq!(c.country.as_deref(), Some("JP"));
        assert_eq!(c.original_title.as_deref(), Some("葬送のフリーレン"));
        assert_eq!(c.subtitle.as_deref(), Some("葬送のフリーレン · JP"));
    }
}
