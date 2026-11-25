//! Free, key-less metadata providers.
//!
//! * IMDb suggestion API – fast title search, returns IMDb ids, year, type, poster.
//! * Cinemeta (Stremio's public metadata service) – rich details keyed by IMDb id:
//!   overview, cast, director, genres, runtime, rating, backdrop, logo, episodes.
//! * TVMaze – official free TV API, used as a fallback for shows.
//!
//! Everything degrades gracefully: if one service is down, the next one is tried.

use super::models::{Candidate, EpisodeMeta, TitleKind, TitleMeta};
use anyhow::{anyhow, Result};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::time::Duration;

const UA: &str = concat!("MovieMonkey/", env!("CARGO_PKG_VERSION"), " (+https://getmoviemonkey.com)");

#[derive(Clone)]
pub struct Providers {
    http: reqwest::Client,
}

impl Default for Providers {
    fn default() -> Self {
        Self::new()
    }
}

fn s(v: &Value) -> Option<String> {
    match v {
        Value::String(x) if !x.trim().is_empty() => Some(x.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn strings(v: &Value) -> Vec<String> {
    match v {
        Value::Array(a) => a.iter().filter_map(s).collect(),
        Value::String(x) => x.split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect(),
        _ => vec![],
    }
}

fn first_year(text: &str) -> Option<i32> {
    let digits: String = text.chars().skip_while(|c| !c.is_ascii_digit()).take(4).collect();
    (digits.len() == 4).then(|| digits.parse().ok()).flatten()
}

fn strip_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for c in text.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&amp;", "&").replace("&quot;", "\"").replace("&#39;", "'").trim().to_string()
}

/// IMDb image CDN supports on-the-fly resizing via the URL.
pub fn imdb_resized(url: &str, width: u32) -> String {
    if let Some(idx) = url.rfind("._V1_") {
        let ext = url.rsplit('.').next().unwrap_or("jpg");
        format!("{}._V1_QL80_UX{}_.{}", &url[..idx], width, ext)
    } else {
        url.to_string()
    }
}

pub fn metahub(kind: &str, imdb: &str) -> String {
    format!("https://images.metahub.space/{kind}/medium/{imdb}/img")
}

fn clean_query(q: &str) -> String {
    let q: String = q
        .to_lowercase()
        .chars()
        .filter(|c| *c != '\'' && *c != '\u{2019}')
        .map(|c| if c.is_alphanumeric() || c == ' ' { c } else { ' ' })
        .collect();
    q.split_whitespace().collect::<Vec<_>>().join(" ")
}

impl Providers {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(UA)
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("http client");
        Self { http }
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.http
    }

    async fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        let mut delay = Duration::from_millis(400);
        let mut last_err = anyhow!("request failed");
        for attempt in 0..3 {
            match self.http.get(url).send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return Ok(resp.json::<T>().await?);
                    }
                    if status.as_u16() == 404 {
                        return Err(anyhow!("not found: {url}"));
                    }
                    last_err = anyhow!("HTTP {status} for {url}");
                    if !(status.as_u16() == 429 || status.is_server_error()) {
                        break;
                    }
                }
                Err(e) => last_err = e.into(),
            }
            if attempt < 2 {
                tokio::time::sleep(delay).await;
                delay *= 3;
            }
        }
        Err(last_err)
    }

    // ---------------------------------------------------------------- search

    /// IMDb's public suggestion endpoint (what the imdb.com search box uses).
    pub async fn imdb_search(&self, query: &str) -> Result<Vec<Candidate>> {
        let q = clean_query(query);
        if q.is_empty() {
            return Ok(vec![]);
        }
        let url = format!(
            "https://v3.sg.media-imdb.com/suggestion/x/{}.json?includeVideos=0",
            urlencoding::encode(&q)
        );
        let v: Value = self.get_json(&url).await?;
        let mut out = vec![];
        for item in v["d"].as_array().cloned().unwrap_or_default() {
            let id = s(&item["id"]).unwrap_or_default();
            if !id.starts_with("tt") {
                continue;
            }
            let qid = s(&item["qid"]).unwrap_or_default();
            let (kind, weight) = match qid.as_str() {
                "movie" => (TitleKind::Movie, 1.0),
                "tvMovie" => (TitleKind::Movie, 0.9),
                "tvSpecial" => (TitleKind::Movie, 0.75),
                "video" => (TitleKind::Movie, 0.7),
                "short" | "tvShort" => (TitleKind::Movie, 0.55),
                "tvSeries" => (TitleKind::Series, 1.0),
                "tvMiniSeries" => (TitleKind::Series, 0.95),
                _ => continue,
            };
            out.push(Candidate {
                id,
                kind,
                title: s(&item["l"]).unwrap_or_default(),
                year: item["y"].as_i64().map(|y| y as i32),
                year_label: s(&item["yr"]).or_else(|| item["y"].as_i64().map(|y| y.to_string())),
                poster: item["i"]["imageUrl"].as_str().map(|u| imdb_resized(u, 500)),
                subtitle: s(&item["s"]),
                rank: item["rank"].as_u64(),
                type_weight: weight,
                source: "imdb".into(),
            });
        }
        Ok(out)
    }

    pub async fn cinemeta_search(&self, query: &str, kind: TitleKind) -> Result<Vec<Candidate>> {
        let q = clean_query(query);
        if q.is_empty() {
            return Ok(vec![]);
        }
        let url = format!(
            "https://v3-cinemeta.strem.io/catalog/{}/top/search={}.json",
            kind.as_str(),
            urlencoding::encode(&q)
        );
        let v: Value = self.get_json(&url).await?;
        Ok(v["metas"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|m| {
                let id = s(&m["imdb_id"]).or_else(|| s(&m["id"]))?;
                if !id.starts_with("tt") {
                    return None;
                }
                let release = s(&m["releaseInfo"]);
                Some(Candidate {
                    id: id.clone(),
                    kind,
                    title: s(&m["name"]).unwrap_or_default(),
                    year: release.as_deref().and_then(first_year),
                    year_label: release,
                    poster: Some(metahub("poster", &id)),
                    subtitle: None,
                    rank: None,
                    type_weight: 1.0,
                    source: "cinemeta".into(),
                })
            })
            .collect())
    }

    pub async fn tvmaze_search(&self, query: &str) -> Result<Vec<Candidate>> {
        let q = clean_query(query);
        let url = format!("https://api.tvmaze.com/search/shows?q={}", urlencoding::encode(&q));
        let v: Value = self.get_json(&url).await?;
        Ok(v.as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|r| {
                let show = &r["show"];
                let id = s(&show["externals"]["imdb"])?;
                Some(Candidate {
                    id,
                    kind: TitleKind::Series,
                    title: s(&show["name"]).unwrap_or_default(),
                    year: s(&show["premiered"]).as_deref().and_then(first_year),
                    year_label: s(&show["premiered"]).map(|p| p[..4.min(p.len())].to_string()),
                    poster: s(&show["image"]["medium"]),
                    subtitle: s(&show["network"]["name"]),
                    rank: None,
                    type_weight: 1.0,
                    source: "tvmaze".into(),
                })
            })
            .collect())
    }

    /// Combined search used by the "Fix match" dialog.
    pub async fn search_all(&self, query: &str, kind: Option<TitleKind>) -> Vec<Candidate> {
        let imdb = self.imdb_search(query);
        let cm_movie = self.cinemeta_search(query, TitleKind::Movie);
        let cm_series = self.cinemeta_search(query, TitleKind::Series);
        let (imdb, cm_movie, cm_series) = futures::join!(imdb, cm_movie, cm_series);
        let mut out: Vec<Candidate> = vec![];
        let mut push = |c: Candidate| {
            if kind.map(|k| k == c.kind).unwrap_or(true) && !out.iter().any(|o| o.id == c.id) {
                out.push(c);
            }
        };
        for c in imdb.unwrap_or_default() {
            push(c);
        }
        for c in cm_movie.unwrap_or_default().into_iter().take(8) {
            push(c);
        }
        for c in cm_series.unwrap_or_default().into_iter().take(8) {
            push(c);
        }
        out
    }

    // --------------------------------------------------------------- details

    pub async fn cinemeta_meta(&self, id: &str, kind: TitleKind) -> Result<TitleMeta> {
        let url = format!("https://v3-cinemeta.strem.io/meta/{}/{}.json", kind.as_str(), id);
        let v: Value = self.get_json(&url).await?;
        let m = &v["meta"];
        if m.is_null() || s(&m["name"]).is_none() {
            return Err(anyhow!("cinemeta has no entry for {id}"));
        }
        let release = s(&m["releaseInfo"]).or_else(|| s(&m["year"]));
        let mut genres = strings(&m["genres"]);
        if genres.is_empty() {
            genres = strings(&m["genre"]);
        }
        let runtime = s(&m["runtime"]).and_then(|r| {
            let digits: String = r.chars().take_while(|c| c.is_ascii_digit()).collect();
            // Some entries are "2h 16min"
            if r.contains('h') && !r.trim_start_matches(char::is_numeric).starts_with("min") {
                let mut mins = 0u32;
                for part in r.split_whitespace() {
                    let n: u32 = part.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0);
                    if part.ends_with('h') {
                        mins += n * 60
                    } else {
                        mins += n
                    }
                }
                (mins > 0).then_some(mins)
            } else {
                digits.parse().ok()
            }
        });
        let trailer = m["trailers"]
            .as_array()
            .and_then(|a| a.iter().find_map(|t| s(&t["source"])))
            .or_else(|| m["trailerStreams"].as_array().and_then(|a| a.iter().find_map(|t| s(&t["ytId"]))));
        let episodes = m["videos"]
            .as_array()
            .map(|vids| {
                vids.iter()
                    .filter_map(|e| {
                        let season = e["season"].as_u64()? as u32;
                        let episode = e["episode"].as_u64().or_else(|| e["number"].as_u64())? as u32;
                        Some(EpisodeMeta {
                            season,
                            episode,
                            name: s(&e["name"]).or_else(|| s(&e["title"])).unwrap_or_else(|| format!("Episode {episode}")),
                            overview: s(&e["overview"]).or_else(|| s(&e["description"])),
                            thumbnail: s(&e["thumbnail"]),
                            released: s(&e["released"]).or_else(|| s(&e["firstAired"])),
                            rating: s(&e["rating"]).and_then(|r| r.parse().ok()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(TitleMeta {
            id: id.to_string(),
            kind,
            name: s(&m["name"]).unwrap_or_default(),
            year: release.as_deref().and_then(first_year),
            year_label: release,
            overview: s(&m["description"]),
            genres,
            runtime,
            rating: s(&m["imdbRating"]).and_then(|r| r.parse().ok()),
            directors: strings(&m["director"]),
            writers: strings(&m["writer"]),
            cast: strings(&m["cast"]),
            country: s(&m["country"]),
            awards: s(&m["awards"]),
            released: s(&m["released"]),
            status: s(&m["status"]),
            poster: Some(metahub("poster", id)),
            poster_alt: s(&m["poster"]),
            backdrop: s(&m["background"]).map(|_| metahub("background", id)),
            logo: s(&m["logo"]).map(|_| metahub("logo", id)),
            trailer,
            tmdb_id: m["moviedb_id"].as_u64(),
            episodes,
            source: "cinemeta".into(),
        })
    }

    pub async fn tvmaze_meta(&self, imdb: &str) -> Result<TitleMeta> {
        let show: Value = self
            .get_json(&format!("https://api.tvmaze.com/lookup/shows?imdb={imdb}"))
            .await?;
        let show_id = show["id"].as_u64().ok_or_else(|| anyhow!("no tvmaze id"))?;
        let eps: Value = self
            .get_json(&format!("https://api.tvmaze.com/shows/{show_id}/episodes?specials=1"))
            .await
            .unwrap_or(Value::Null);
        let premiered = s(&show["premiered"]);
        let ended = s(&show["ended"]);
        let year_label = match (&premiered, &ended) {
            (Some(p), Some(e)) => Some(format!("{}–{}", &p[..4.min(p.len())], &e[..4.min(e.len())])),
            (Some(p), None) => Some(format!("{}–", &p[..4.min(p.len())])),
            _ => None,
        };
        Ok(TitleMeta {
            id: imdb.to_string(),
            kind: TitleKind::Series,
            name: s(&show["name"]).unwrap_or_default(),
            year: premiered.as_deref().and_then(first_year),
            year_label,
            overview: s(&show["summary"]).map(|h| strip_html(&h)),
            genres: strings(&show["genres"]),
            runtime: show["averageRuntime"].as_u64().or(show["runtime"].as_u64()).map(|r| r as u32),
            rating: show["rating"]["average"].as_f64(),
            status: s(&show["status"]),
            released: premiered,
            country: s(&show["network"]["country"]["name"]),
            poster: s(&show["image"]["original"]),
            backdrop: None,
            episodes: eps
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|e| {
                    Some(EpisodeMeta {
                        season: e["season"].as_u64()? as u32,
                        episode: e["number"].as_u64().unwrap_or(0) as u32,
                        name: s(&e["name"]).unwrap_or_default(),
                        overview: s(&e["summary"]).map(|h| strip_html(&h)),
                        thumbnail: s(&e["image"]["original"]),
                        released: s(&e["airdate"]),
                        rating: e["rating"]["average"].as_f64(),
                    })
                })
                .collect(),
            source: "tvmaze".into(),
            ..Default::default()
        })
    }

    /// Best-effort full metadata for an IMDb id, with fallbacks.
    pub async fn details(&self, id: &str, kind: TitleKind, hint: Option<&Candidate>) -> Result<TitleMeta> {
        match self.cinemeta_meta(id, kind).await {
            Ok(mut meta) => {
                if kind == TitleKind::Series && meta.episodes.is_empty() {
                    if let Ok(tv) = self.tvmaze_meta(id).await {
                        meta.episodes = tv.episodes;
                        if meta.overview.is_none() {
                            meta.overview = tv.overview;
                        }
                    }
                }
                if let Some(h) = hint {
                    if meta.poster_alt.is_none() || meta.poster_alt.as_deref().map(|p| p.contains("metahub")).unwrap_or(false) {
                        meta.poster_alt = h.poster.clone().or(meta.poster_alt);
                    }
                }
                Ok(meta)
            }
            Err(cm_err) => {
                if kind == TitleKind::Series {
                    if let Ok(mut tv) = self.tvmaze_meta(id).await {
                        tv.poster_alt = hint.and_then(|h| h.poster.clone());
                        return Ok(tv);
                    }
                }
                // Last resort: what the search result told us.
                let h = hint.ok_or(cm_err)?;
                Ok(TitleMeta {
                    id: id.to_string(),
                    kind,
                    name: h.title.clone(),
                    year: h.year,
                    year_label: h.year_label.clone(),
                    cast: h.subtitle.as_deref().map(|s| s.split(", ").map(String::from).collect()).unwrap_or_default(),
                    poster: h.poster.clone(),
                    source: h.source.clone(),
                    ..Default::default()
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(first_year("2008–2013"), Some(2008));
        assert_eq!(first_year("abc"), None);
        assert_eq!(
            imdb_resized("https://m.media-amazon.com/images/M/MV5Babc@._V1_.jpg", 500),
            "https://m.media-amazon.com/images/M/MV5Babc@._V1_QL80_UX500_.jpg"
        );
        assert_eq!(clean_query("Ocean's Eleven: (2001)"), "oceans eleven 2001");
        assert_eq!(strip_html("<p>Hi &amp; bye</p>"), "Hi & bye");
    }
}
