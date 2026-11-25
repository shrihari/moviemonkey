//! Picks the right title for a parsed file name from provider search results.

use super::models::{Candidate, TitleKind};
use super::parse::{normalise_for_compare, search_title, Parsed, ParsedKind};
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
    let base = if ta.len() == tb.len() { lev.max(dice * 0.97).max(jw * 0.9) } else { lev.max(dice * 0.97) };
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
        // Without a year, lean on popularity a little more
        _ => 0.06,
    };
    if c.kind != wanted_kind {
        sc -= 0.5;
    }
    sc *= 0.7 + 0.3 * c.type_weight;
    if let Some(rank) = c.rank {
        let pop = 1.0 - ((rank.max(1) as f64).log10() / 7.0).clamp(0.0, 1.0);
        sc += 0.08 * pop;
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

/// Query providers in order of quality until a confident match appears.
/// Returns the best candidate even when below the threshold, so the UI can
/// offer it as a suggestion.
pub async fn identify(p: &Providers, parsed: &Parsed) -> Option<MatchResult> {
    let title = search_title(parsed);
    if title.trim().is_empty() {
        return None;
    }
    let kind = match parsed.kind {
        ParsedKind::Movie => TitleKind::Movie,
        ParsedKind::Episode => TitleKind::Series,
    };
    let mut best_so_far: Option<MatchResult> = None;
    fn take(best: &mut Option<MatchResult>, m: Option<MatchResult>) {
        if let Some(m) = m {
            if best.as_ref().map(|b| m.score > b.score).unwrap_or(true) {
                *best = Some(m);
            }
        }
    }
    macro_rules! consider {
        ($m:expr) => {
            take(&mut best_so_far, $m)
        };
    }

    // 1. IMDb suggestions with year
    let q1 = match parsed.year {
        Some(y) => format!("{title} {y}"),
        None => title.clone(),
    };
    if let Ok(c) = p.imdb_search(&q1).await {
        consider!(best(parsed, &c));
    }
    if best_so_far.as_ref().map(|b| b.accepted()).unwrap_or(false) {
        return best_so_far;
    }

    // 2. IMDb without year (year in the query sometimes hurts)
    if parsed.year.is_some() {
        if let Ok(c) = p.imdb_search(&title).await {
            consider!(best(parsed, &c));
        }
        if best_so_far.as_ref().map(|b| b.accepted()).unwrap_or(false) {
            return best_so_far;
        }
    }

    // 3. Cinemeta catalogue search
    if let Ok(c) = p.cinemeta_search(&title, kind).await {
        consider!(best(parsed, &c));
    }
    if best_so_far.as_ref().map(|b| b.accepted()).unwrap_or(false) {
        return best_so_far;
    }

    // 4. TVMaze for shows
    if kind == TitleKind::Series {
        if let Ok(c) = p.tvmaze_search(&title).await {
            consider!(best(parsed, &c));
        }
    }
    best_so_far
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::parse::parse_name;

    fn cand(title: &str, year: i32, kind: TitleKind, rank: u64) -> Candidate {
        Candidate {
            id: format!("tt{rank}"),
            kind,
            title: title.into(),
            year: Some(year),
            rank: Some(rank),
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
    }
}
