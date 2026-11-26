//! Metadata providers.
//!
//! * TMDB (see `tmdb.rs`): search, details, artwork, cast, episodes. The main source.
//! * TVMaze: free, CC BY-SA TV data. A fallback for shows when TMDB has
//!   nothing (or can't be reached).
//!
//! Everything degrades gracefully: if one service is down, the next one is tried.

use super::matcher::title_similarity;
use super::models::{Candidate, EpisodeMeta, TitleKind, TitleMeta};
use super::tmdb;
use anyhow::{anyhow, Result};
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

const UA: &str = concat!(
    "MovieMonkey/",
    env!("CARGO_PKG_VERSION"),
    " (+https://getmoviemonkey.com)"
);

/// A provider answered, but doesn't know this title (HTTP 404, or no TMDB
/// entry for an IMDb id), or can't be asked (no or rejected TMDB token).
/// Unlike network errors, retrying right away won't help, so callers fall
/// back to other sources instead.
#[derive(Debug)]
pub struct NotFound(pub String);

impl std::fmt::Display for NotFound {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "not found: {}", self.0)
    }
}

impl std::error::Error for NotFound {}

pub fn is_not_found(e: &anyhow::Error) -> bool {
    e.downcast_ref::<NotFound>().is_some()
}

#[derive(Clone)]
pub struct Providers {
    http: reqwest::Client,
    tmdb_token: Option<Arc<str>>,
}

impl Default for Providers {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn s(v: &Value) -> Option<String> {
    match v {
        Value::String(x) if !x.trim().is_empty() => Some(x.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub(crate) fn strings(v: &Value) -> Vec<String> {
    match v {
        Value::Array(a) => a.iter().filter_map(s).collect(),
        Value::String(x) => x
            .split(',')
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty())
            .collect(),
        _ => vec![],
    }
}

pub(crate) fn first_year(text: &str) -> Option<i32> {
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
    out.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .trim()
        .to_string()
}

pub(crate) fn clean_query(q: &str) -> String {
    let q: String = q
        .to_lowercase()
        .chars()
        .filter(|c| *c != '\'' && *c != '\u{2019}')
        .map(|c| if c.is_alphanumeric() || c == ' ' { c } else { ' ' })
        .collect();
    q.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The TMDB token: a `TMDB_API_TOKEN` environment variable at run time wins
/// (handy for trying another key), otherwise the one compiled in by build.rs.
fn tmdb_token() -> Option<Arc<str>> {
    std::env::var("TMDB_API_TOKEN")
        .ok()
        .filter(|t| !t.trim().is_empty())
        .or_else(|| option_env!("TMDB_API_TOKEN").map(String::from))
        .filter(|t| !t.trim().is_empty())
        .map(|t| Arc::from(t.trim()))
}

fn is_imdb_id(q: &str) -> bool {
    let q = q.trim();
    q.len() >= 9 && q.starts_with("tt") && q[2..].chars().all(|c| c.is_ascii_digit())
}

impl Providers {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(UA)
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .expect("http client");
        let tmdb_token = tmdb_token();
        if tmdb_token.is_none() {
            log::error!("no TMDB token: movies can't be identified (set TMDB_API_TOKEN, see README)");
        }
        Self { http, tmdb_token }
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.http
    }

    pub(crate) async fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        let token = if url.starts_with(tmdb::API) {
            Some(
                self.tmdb_token
                    .clone()
                    // Treated like "not found" so shows still fall back to TVMaze.
                    .ok_or_else(|| NotFound("TMDB (no API token in this build)".into()))?,
            )
        } else {
            None
        };
        let mut delay = Duration::from_millis(400);
        let mut last_err = anyhow!("request failed");
        for attempt in 0..3 {
            let mut req = self.http.get(url);
            if let Some(t) = &token {
                req = req.bearer_auth(t);
            }
            match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        return Ok(resp.json::<T>().await?);
                    }
                    if status.as_u16() == 404 {
                        return Err(NotFound(url.to_string()).into());
                    }
                    // A missing or revoked TMDB token: shows can still use TVMaze.
                    if token.is_some() && matches!(status.as_u16(), 401 | 403) {
                        log::error!("TMDB rejected the API token (HTTP {status})");
                        return Err(NotFound(format!("TMDB (token rejected) {url}")).into());
                    }
                    last_err = anyhow!("HTTP {status} for {url}");
                    if !(status.as_u16() == 429 || status.is_server_error()) {
                        break;
                    }
                }
                // No route / refused / DNS failure: retrying won't help.
                Err(e) if e.is_connect() => return Err(e.into()),
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
                let network = if show["network"].is_object() {
                    &show["network"]
                } else {
                    &show["webChannel"]
                };
                Some(Candidate {
                    id,
                    kind: TitleKind::Series,
                    title: s(&show["name"]).unwrap_or_default(),
                    year: s(&show["premiered"]).as_deref().and_then(first_year),
                    year_label: s(&show["premiered"]).map(|p| p[..4.min(p.len())].to_string()),
                    poster: s(&show["image"]["medium"]),
                    subtitle: s(&network["name"]),
                    // TVMaze "weight" is popularity 0–100.
                    popularity: show["weight"].as_f64().map(|w| w.clamp(0.0, 100.0) / 100.0),
                    type_weight: 1.0,
                    source: "tvmaze".into(),
                    country: s(&network["country"]["code"]),
                    original_title: None,
                    tmdb_id: None,
                    tvmaze_id: show["id"].as_u64(),
                })
            })
            .collect())
    }

    /// Alternate (often foreign-language) titles of a TVMaze show.
    pub async fn tvmaze_akas(&self, tvmaze_id: u64) -> Result<Vec<String>> {
        let v: Value = self
            .get_json(&format!("https://api.tvmaze.com/shows/{tvmaze_id}/akas"))
            .await?;
        Ok(v.as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|a| s(&a["name"]))
            .collect())
    }

    /// Search used by the "Fix match" dialog: movies and shows from TMDB
    /// (an IMDb id like "tt0133093" works too), TVMaze if TMDB is unavailable.
    pub async fn search_all(&self, query: &str, kind: Option<TitleKind>) -> Vec<Candidate> {
        let wants = |k: TitleKind| kind.map(|x| x == k).unwrap_or(true);
        let mut out: Vec<Candidate> = if is_imdb_id(query) {
            self.tmdb_find_imdb(query.trim()).await.unwrap_or_default()
        } else {
            let movies = async {
                match wants(TitleKind::Movie) {
                    true => self.tmdb_search(query, TitleKind::Movie, None).await,
                    false => Ok(vec![]),
                }
            };
            let shows = async {
                match wants(TitleKind::Series) {
                    true => self.tmdb_search(query, TitleKind::Series, None).await,
                    false => Ok(vec![]),
                }
            };
            let (movies, shows) = futures::join!(movies, shows);
            let tmdb_failed = movies.is_err() && shows.is_err();
            let mut all: Vec<Candidate> = movies
                .unwrap_or_default()
                .into_iter()
                .take(12)
                .chain(shows.unwrap_or_default().into_iter().take(12))
                .collect();
            if tmdb_failed && wants(TitleKind::Series) {
                all = self.tvmaze_search(query).await.unwrap_or_default();
            }
            // Closest title first, popularity breaks ties.
            let rank = |c: &Candidate| {
                title_similarity(query, &c.title).max(
                    c.original_title
                        .as_deref()
                        .map(|o| title_similarity(query, o))
                        .unwrap_or(0.0),
                ) * 0.7
                    + c.popularity.unwrap_or(0.0) * 0.3
            };
            all.sort_by(|a, b| rank(b).partial_cmp(&rank(a)).unwrap_or(std::cmp::Ordering::Equal));
            all
        };
        out.retain(|c| wants(c.kind));
        out
    }

    // --------------------------------------------------------------- details

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
            runtime: show["averageRuntime"]
                .as_u64()
                .or(show["runtime"].as_u64())
                .map(|r| r as u32),
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

    /// Full metadata for a title id: an IMDb id ("tt…") or a TMDB key
    /// ("tmdb-movie-603"). IMDb ids are kept as the title's id, so a refresh
    /// never moves a title (and its watched state) to a new id.
    ///
    /// Network errors are returned as errors so the caller retries later.
    /// When TMDB simply doesn't know the title, shows fall back to TVMaze and
    /// anything else to what the search result (`hint`) said.
    pub async fn details(&self, id: &str, kind: TitleKind, hint: Option<&Candidate>) -> Result<TitleMeta> {
        let target: Result<(TitleKind, u64)> = if let Some(t) = tmdb::parse_tmdb_key(id) {
            Ok(t)
        } else if let Some(n) = hint.and_then(|h| h.tmdb_id) {
            Ok((kind, n))
        } else if id.starts_with("tt") {
            self.tmdb_find_imdb(id).await.and_then(|found| {
                found
                    .iter()
                    .find(|c| c.kind == kind)
                    .or(found.first())
                    .and_then(|c| Some((c.kind, c.tmdb_id?)))
                    .ok_or_else(|| NotFound(format!("{id} on TMDB")).into())
            })
        } else {
            Err(NotFound(id.to_string()).into())
        };
        let err = match target {
            Ok((k, n)) => match self.tmdb_details(k, n).await {
                Ok(mut meta) => {
                    if id.starts_with("tt") {
                        meta.id = id.to_string();
                    }
                    return Ok(meta);
                }
                Err(e) => e,
            },
            Err(e) => e,
        };
        if !is_not_found(&err) {
            return Err(err);
        }
        if kind == TitleKind::Series && id.starts_with("tt") {
            match self.tvmaze_meta(id).await {
                Ok(tv) => return Ok(tv),
                Err(e) if !is_not_found(&e) => return Err(e),
                Err(_) => {}
            }
        }
        // Last resort: what the search result told us.
        let h = hint.ok_or(err)?;
        Ok(TitleMeta {
            id: id.to_string(),
            kind,
            name: h.title.clone(),
            year: h.year,
            year_label: h.year_label.clone(),
            poster: h.poster.clone(),
            tmdb_id: h.tmdb_id,
            source: h.source.clone(),
            ..Default::default()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helpers() {
        assert_eq!(first_year("2008–2013"), Some(2008));
        assert_eq!(first_year("abc"), None);
        assert_eq!(clean_query("Ocean's Eleven: (2001)"), "oceans eleven 2001");
        assert_eq!(strip_html("<p>Hi &amp; bye</p>"), "Hi & bye");
        assert!(is_imdb_id(" tt0133093 "));
        assert!(!is_imdb_id("tt12") && !is_imdb_id("The Matrix"));
        assert!(is_not_found(&NotFound("x".into()).into()));
        assert!(!is_not_found(&anyhow!("HTTP 500")));
    }
}
