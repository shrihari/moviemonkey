//! Picks the right title for a parsed file name from provider search results.

use super::models::{Candidate, TitleKind};
use super::parse::{country_hint, normalise_for_compare, search_title, Parsed, ParsedKind};
use super::providers::Providers;

/// Scores at or above this are accepted automatically…
pub const ACCEPT: f64 = 0.66;
/// …but only if the titles themselves are this similar (a matching year must
/// never carry a weak title match – "Goa Trip 2019" is not "Rodina Trip").
pub const MIN_SIMILARITY: f64 = 0.8;

pub fn title_similarity(a: &str, b: &str) -> f64 {
    let (a, b) = (normalise_for_compare(a), normalise_for_compare(b));
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a == b {
        return 1.0;
    }
    let lev = strsim::normalized_levenshtein(&a, &b);
    let jw = strsim::jaro_winkler(&a, &b);
    // Token overlap handles re-ordered or subtitle-truncated names
    // ("Dune Part Two" vs "Dune: Part Two", "Mission Impossible Fallout" vs
    // "Mission: Impossible - Fallout").
    let ta: Vec<&str> = a.split(' ').collect();
    let tb: Vec<&str> = b.split(' ').collect();
    let common = ta.iter().filter(|t| tb.contains(t)).count() as f64;
    let dice = 2.0 * common / (ta.len() + tb.len()) as f64;
    // Jaro-Winkler rewards shared prefixes, which makes sequels look identical
    // ("Matrix" vs "Matrix Resurrections"); only trust it for typo-level differences.
    let base = if ta.len() == tb.len() {
        lev.max(dice * 0.97).max(jw * 0.9)
    } else {
        lev.max(dice * 0.97)
    };
    // Penalise when one side has significant extra words.
    let len_ratio = (ta.len().min(tb.len()) as f64) / (ta.len().max(tb.len()) as f64);
    if len_ratio <= 0.5 {
        base * 0.85
    } else {
        base
    }
}

pub fn score(parsed: &Parsed, c: &Candidate) -> f64 {
    let wanted_kind = match parsed.kind {
        ParsedKind::Movie => TitleKind::Movie,
        ParsedKind::Episode => TitleKind::Series,
    };
    let sim = title_similarity(&search_title(parsed), &c.title);
    let mut sc = sim * 0.78;
    sc += match (parsed.year, c.year) {
        (Some(q), Some(y)) if q == y => 0.22,
        (Some(q), Some(y)) if (q - y).abs() == 1 => 0.12,
        (Some(_), Some(_)) => -0.30,
        // A dated file against an undated entry: usually a placeholder or
        // unreleased title ("Goa Trip 2019" home video vs an empty "Goa Trip").
        (Some(_), None) => -0.15,
        // Without a year, lean on popularity a little more
        _ => 0.06,
    };
    if c.kind != wanted_kind {
        sc -= 0.5;
    }
    sc *= 0.7 + 0.3 * c.type_weight;
    if let Some(pop) = c.popularity {
        sc += 0.08 * pop.clamp(0.0, 1.0);
    }
    sc
}

#[derive(Debug, Clone)]
pub struct MatchResult {
    pub candidate: Candidate,
    pub score: f64,
    pub similarity: f64,
}

impl MatchResult {
    pub fn accepted(&self) -> bool {
        self.score >= ACCEPT && self.similarity >= MIN_SIMILARITY
    }
}

fn best(parsed: &Parsed, cands: &[Candidate]) -> Option<MatchResult> {
    cands
        .iter()
        .map(|c| MatchResult {
            candidate: c.clone(),
            score: score(parsed, c),
            similarity: title_similarity(&search_title(parsed), &c.title),
        })
        .max_by(|a, b| a.score.partial_cmp(&b.score).unwrap_or(std::cmp::Ordering::Equal))
}

/// Score a candidate as if its title were `alt` (an alternate / foreign title).
fn as_alt_title(parsed: &Parsed, c: &Candidate, alt: &str) -> MatchResult {
    let mut probe = c.clone();
    probe.title = alt.to_string();
    MatchResult {
        candidate: c.clone(),
        score: score(parsed, &probe),
        similarity: title_similarity(&search_title(parsed), alt),
    }
}

/// Shows whose country of origin is `country` ("GB" for "The.Office.UK").
fn from_country(cands: Vec<Candidate>, country: &str) -> Vec<Candidate> {
    cands
        .into_iter()
        .filter(|c| {
            c.country
                .as_deref()
                .map(|cs| cs.split(',').any(|x| x == country))
                .unwrap_or(false)
        })
        .collect()
}

/// Query providers in order of quality until a confident match appears.
///
/// Returns the best candidate even when below the threshold, so the UI can
/// offer it as a suggestion. Returns `Err` only when *every* provider request
/// failed (e.g. no network) – the caller should retry later rather than
/// conclude the file is unidentifiable.
pub async fn identify(p: &Providers, parsed: &Parsed) -> anyhow::Result<Option<MatchResult>> {
    let title = search_title(parsed);
    if title.trim().is_empty() {
        return Ok(None);
    }
    let kind = match parsed.kind {
        ParsedKind::Movie => TitleKind::Movie,
        ParsedKind::Episode => TitleKind::Series,
    };
    let mut best_so_far: Option<MatchResult> = None;
    let mut reached = false;
    let mut last_err: Option<anyhow::Error> = None;
    // Every TMDB result seen, for the alternative-title pass.
    let mut pool: Vec<Candidate> = vec![];

    fn take(best: &mut Option<MatchResult>, m: Option<MatchResult>) {
        if let Some(m) = m {
            let better = match best.as_ref() {
                None => true,
                // An accepted match always beats a merely higher-scoring one.
                Some(b) => (m.accepted(), m.score) > (b.accepted(), b.score),
            };
            if better {
                *best = Some(m);
            }
        }
    }
    macro_rules! search {
        ($fut:expr, |$c:ident| $pick:expr) => {
            match $fut.await {
                Ok($c) => {
                    reached = true;
                    take(&mut best_so_far, $pick);
                }
                Err(e) => last_err = Some(e),
            }
        };
    }
    macro_rules! done {
        () => {
            best_so_far.as_ref().map(|b| b.accepted()).unwrap_or(false)
        };
    }

    // 0. "The Office UK" / "Shameless US": choose among shows from that country.
    let country = country_hint(parsed).filter(|_| kind == TitleKind::Series);
    if let Some(country) = country {
        search!(p.tmdb_search(&title, kind, None), |c| {
            pool.extend(c.iter().cloned());
            best(parsed, &from_country(c, country))
        });
        if done!() {
            return Ok(best_so_far);
        }
    }

    // 1. TMDB with the year from the file name (for movies it matches a
    //    release in any country, so festival or foreign dates still hit).
    if parsed.year.is_some() {
        search!(p.tmdb_search(&title, kind, parsed.year), |c| {
            pool.extend(c.iter().cloned());
            best(parsed, &c)
        });
        if done!() {
            return Ok(best_so_far);
        }
    }

    // 2. TMDB without the year (the file's year is sometimes off).
    if parsed.year.is_some() || country.is_none() {
        search!(p.tmdb_search(&title, kind, None), |c| {
            pool.extend(c.iter().cloned());
            best(parsed, &c)
        });
        if done!() {
            return Ok(best_so_far);
        }
    }

    // 3. Original and alternative titles of the closest results.
    //    "Sousou no Frieren" is the romaji title of "Frieren: Beyond Journey's
    //    End"; "Star Wars Episode IV A New Hope" is an alternative title of
    //    "Star Wars". TMDB's search finds them, but under their main title.
    let mut seen = std::collections::HashSet::new();
    pool.retain(|c| seen.insert(c.id.clone()));
    if let Some(country) = country {
        pool = from_country(pool, country);
    }
    for c in &pool {
        if let Some(original) = &c.original_title {
            take(&mut best_so_far, Some(as_alt_title(parsed, c, original)));
        }
    }
    if done!() {
        return Ok(best_so_far);
    }
    let mut closest: Vec<&Candidate> = pool.iter().collect();
    closest.sort_by(|a, b| {
        score(parsed, b)
            .partial_cmp(&score(parsed, a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    for cand in closest.into_iter().take(3) {
        let Some(tmdb_id) = cand.tmdb_id else { continue };
        search!(p.tmdb_alt_titles(cand.kind, tmdb_id), |alts| alts
            .iter()
            .map(|a| as_alt_title(parsed, cand, a))
            .max_by(|a, b| a
                .score
                .partial_cmp(&b.score)
                .unwrap_or(std::cmp::Ordering::Equal)));
        if done!() {
            return Ok(best_so_far);
        }
    }

    // 4. TVMaze for shows, with its alternate titles: a fallback for when
    //    TMDB has nothing or can't be reached.
    if kind == TitleKind::Series {
        match p.tvmaze_search(&title).await {
            Ok(c) => {
                reached = true;
                let c = match country {
                    Some(country) => from_country(c, country),
                    None => c,
                };
                take(&mut best_so_far, best(parsed, &c));
                if !done!() {
                    for cand in c.iter().take(3) {
                        let Some(tvmaze_id) = cand.tvmaze_id else { continue };
                        let akas = p.tvmaze_akas(tvmaze_id).await.unwrap_or_default();
                        let alt = akas.iter().map(|a| as_alt_title(parsed, cand, a)).max_by(|a, b| {
                            a.similarity
                                .partial_cmp(&b.similarity)
                                .unwrap_or(std::cmp::Ordering::Equal)
                        });
                        take(&mut best_so_far, alt);
                        if done!() {
                            break;
                        }
                    }
                }
            }
            Err(e) => last_err = Some(e),
        }
    }

    match (reached, last_err) {
        (false, Some(e)) => Err(e),
        _ => Ok(best_so_far),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::parse::parse_name;

    /// `rank`: an IMDb-style popularity rank (lower = better known).
    fn cand(title: &str, year: i32, kind: TitleKind, rank: u64) -> Candidate {
        Candidate {
            id: format!("tt{rank}"),
            kind,
            title: title.into(),
            year: Some(year),
            popularity: Some(1.0 - ((rank.max(1) as f64).log10() / 7.0).clamp(0.0, 1.0)),
            type_weight: 1.0,
            ..Default::default()
        }
    }

    #[test]
    fn similarity() {
        assert_eq!(title_similarity("The Matrix", "Matrix"), 1.0);
        assert!(title_similarity("Dune Part Two", "Dune: Part Two") > 0.99);
        assert!(title_similarity("Mission Impossible Fallout", "Mission: Impossible - Fallout") > 0.95);
        assert!(title_similarity("The Matrix", "The Matrix Resurrections") < 0.75);
        assert!(title_similarity("Amelie", "Amélie") > 0.8);
    }

    #[test]
    fn picks_right_year_and_kind() {
        let p = parse_name("The.Matrix.1999.1080p");
        let cands = vec![
            cand("The Matrix Resurrections", 2021, TitleKind::Movie, 900),
            cand("The Matrix", 1999, TitleKind::Movie, 349),
            cand("Making 'The Matrix'", 1999, TitleKind::Movie, 380000),
        ];
        let b = best(&p, &cands).unwrap();
        assert_eq!(b.candidate.title, "The Matrix");
        assert!(b.score >= ACCEPT, "score {}", b.score);

        let p = parse_name("The.Office.US.S02E01");
        let cands = vec![
            cand("The Office", 2001, TitleKind::Series, 2000),
            cand("The Office", 2005, TitleKind::Series, 120),
            cand("Office Space", 1999, TitleKind::Movie, 3000),
        ];
        let b = best(&p, &cands).unwrap();
        assert_eq!(b.candidate.year, Some(2005));
        assert!(b.score >= ACCEPT);
    }

    #[test]
    fn rejects_garbage() {
        let p = parse_name("Holiday Video 2019");
        let cands = vec![cand("The Holiday", 2006, TitleKind::Movie, 3000)];
        let b = best(&p, &cands).unwrap();
        assert!(!b.accepted(), "score {}", b.score);
        let p = parse_name("Goa Trip 2019 - Day 2");
        let b = best(&p, &[cand("Rodina trip", 2019, TitleKind::Movie, 900000)]).unwrap();
        assert!(!b.accepted(), "score {} sim {}", b.score, b.similarity);
        // Same name, but an undated entry nobody has rated.
        let mut empty = cand("Goa Trip", 2019, TitleKind::Movie, 10_000_000);
        empty.year = None;
        let b = best(&p, &[empty]).unwrap();
        assert!(!b.accepted(), "score {} sim {}", b.score, b.similarity);
    }
}
