//! Release-name parser: turns `The.Matrix.1999.1080p.BluRay.x264-GRP.mkv`
//! into `{ title: "The Matrix", year: 1999, resolution: "1080p", ... }`.
//!
//! Strategy: normalise separators, find the first "hard" marker (year,
//! episode tag, resolution, source, codec …) and treat everything before it
//! as the title. Folder names are used as a fallback when the file name is
//! generic, and `Show/Season 1/01 - Pilot.mkv` style layouts are understood.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::LazyLock;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ParsedKind {
    #[default]
    Movie,
    Episode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Parsed {
    pub kind: ParsedKind,
    pub title: String,
    pub year: Option<i32>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub episode_end: Option<u32>,
    pub resolution: Option<String>,
    pub source: Option<String>,
    pub codec: Option<String>,
    pub hdr: Option<String>,
    pub audio: Option<String>,
    pub edition: Option<String>,
    pub part: Option<u32>,
    pub is_sample: bool,
    pub is_extra: bool,
}

impl Parsed {
    /// Short, human label for the best quality signal ("4K", "1080p" …).
    pub fn quality_label(&self) -> Option<String> {
        self.resolution.as_deref().map(|r| match r {
            "2160p" => "4K".to_string(),
            other => other.to_string(),
        })
    }
}

pub const VIDEO_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "m4v", "avi", "mov", "wmv", "mpg", "mpeg", "m2ts", "mts", "ts", "webm", "flv",
    "divx", "ogm", "ogv", "3gp", "iso", "rmvb",
];

pub fn is_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| VIDEO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn re(s: &str) -> Regex {
    Regex::new(s).expect("valid regex")
}

static LEADING_BRACKETS: LazyLock<Regex> =
    LazyLock::new(|| re(r"^\s*(?:[\[\{【][^\]\}】]*[\]\}】]\s*[-_.]?\s*)+"));
static LEADING_SITE: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)^\s*(?:www\.)?[a-z0-9-]+\.(?:com|org|net|to|mx|ag|se|me|cc|in|io)\s*[-_]+\s*"));
static SPACES: LazyLock<Regex> = LazyLock::new(|| re(r"\s+"));
static ACRONYM: LazyLock<Regex> = LazyLock::new(|| re(r"\b(?:[A-Za-z] ){2,}[A-Za-z]\b"));

// Episode patterns (applied to the normalised, space-separated string).
static EP_SXXEXX: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?i)\bs(\d{1,2}) ?e(\d{1,3})(?:(?: ?-? ?e| ?- ?)(\d{1,3}))?\b")
});
static EP_NXNN: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)\b(\d{1,2})x(\d{2,3})\b"));
static EP_WORDS: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?i)\bseason ?(\d{1,2}) ?(?:-|,)? ?episode ?(\d{1,3})\b")
});
static EP_ANIME: LazyLock<Regex> =
    LazyLock::new(|| re(r"\s-\s(\d{1,3})(?:v\d)?(?:\s|$|\[|\()"));
static SEASON_ONLY: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)\b(?:s|season ?|series ?)(\d{1,2})\b"));
static SEASON_FOLDER: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?i)^\s*(?:season|series|staffel|saison|temporada|s)[ ._-]*(\d{1,2})\b")
});
static SPECIALS_FOLDER: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)^\s*specials?\s*$"));
static EPISODE_IN_STEM: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)^\s*(?:e|ep|episode)?[ ._-]*(\d{1,3})\b"));
static EPISODE_E_ANYWHERE: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)\b(?:e|ep|episode)[ ._-]?(\d{1,3})\b"));

static YEAR: LazyLock<Regex> = LazyLock::new(|| re(r"\b(19[0-9]{2}|20[0-9]{2})\b"));

// "Hard" markers – the title never continues past these.
static HARD_MARKERS: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?ix)\b(
        2160p|1080p|1080i|720p|576p|480p|4k|uhd|
        blu-?ray|bdrip|brrip|bd-?remux|remux|web-?dl|web-?rip|webdl|hdtv|dvd-?rip|hdrip|hdcam|dvdscr|
        x ?264|x ?265|h ?264|h ?265|hevc|xvid|divx|av1|10 ?bit|
        hdr10\+?|hdr|dovi|dolby ?vision|
        directors? ?cut|extended ?(?:cut|edition)|unrated|remastered|theatrical ?cut|
        amzn|nf|hmax|dsnp|atvp|pcok
    )\b")
});
static BRACKET_OPEN: LazyLock<Regex> = LazyLock::new(|| re(r"[\[\(\{]"));

static RES: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd)\b"));
static SOURCE: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?i)\b(bd-?remux|remux|blu-?ray|bdrip|brrip|web-?dl|webdl|web-?rip|hdtv|dvd-?rip|hdrip|hdcam|dvdscr|web)\b")
});
static CODEC: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)\b(x ?264|x ?265|h ?264|h ?265|hevc|avc|av1|xvid|divx)\b"));
static HDR: LazyLock<Regex> =
    LazyLock::new(|| re(r"(?i)\b(hdr10\+|hdr10|hdr|dovi|dv|dolby ?vision)\b"));
static AUDIO: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?i)\b(atmos|truehd|dts-?hd(?: ?ma)?|dts-?x|dts|ddp ?[257] ?1|dd ?[257] ?1|eac3|ac3|aac|flac|opus)\b")
});
static EDITION: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?i)\b(directors? ?cut|extended ?(?:cut|edition)?|unrated|uncut|remastered|theatrical ?cut|imax|criterion|final ?cut|special ?edition)\b")
});
static PART: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)\b(?:cd|disc|disk)[ ._-]?(\d)\b"));
static SAMPLE: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)(?:^|[ ._-])sample(?:$|[ ._-])"));
static PLEX_EXTRA_SUFFIX: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(?i)-(trailer|featurette|behindthescenes|deleted|interview|scene|short|extra|other)$")
});
static COUNTRY_SUFFIX: LazyLock<Regex> = LazyLock::new(|| re(r"(?i)\s+(?:US|UK|AU|NZ|CA)$"));

const EXTRA_FOLDERS: &[&str] = &[
    "extras", "extra", "featurettes", "featurette", "behind the scenes", "deleted scenes",
    "interviews", "scenes", "shorts", "trailers", "trailer", "other", "bonus", "specials features",
    "sample", "samples",
];

const GENERIC_STEMS: &[&str] = &["movie", "film", "video", "feature", "main", "title", "cd1", "cd2"];

fn max_plausible_year() -> i32 {
    // Allow next year's releases (festival screeners, early drops).
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    1970 + (secs / 31_556_952) as i32 + 1
}

/// Replace separators with spaces, collapse whitespace, re-join spaced acronyms.
fn normalise(raw: &str) -> String {
    let s = LEADING_BRACKETS.replace(raw, "");
    let s = LEADING_SITE.replace(&s, "");
    let s: String = s
        .chars()
        .map(|c| match c {
            '.' | '_' | '+' => ' ',
            c => c,
        })
        .collect();
    let s = SPACES.replace_all(&s, " ").trim().to_string();
    // "S H I E L D" -> "SHIELD", "A I" left alone (needs 3+ letters)
    ACRONYM
        .replace_all(&s, |caps: &regex::Captures| caps[0].replace(' ', ""))
        .into_owned()
}

fn clean_title(t: &str) -> String {
    let t = t.trim().trim_matches(|c: char| c == '-' || c == ':' || c == ',' || c.is_whitespace());
    let t = t.trim_end_matches(|c: char| c == '(' || c == '[' || c == '{' || c.is_whitespace());
    let t = t.trim_end_matches(" -").trim();
    SPACES.replace_all(t, " ").to_string()
}

fn first_capture<'a>(re: &Regex, s: &'a str) -> Option<String> {
    re.captures(s).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
}

fn canon_resolution(r: &str) -> String {
    match r.to_ascii_lowercase().as_str() {
        "4k" | "uhd" | "2160p" => "2160p".into(),
        "1080i" => "1080p".into(),
        other => other.into(),
    }
}

fn canon_source(s: &str) -> String {
    let l = s.to_ascii_lowercase().replace('-', "");
    match l.as_str() {
        "bdremux" | "remux" => "Remux".into(),
        "bluray" | "bdrip" | "brrip" => "BluRay".into(),
        "webdl" | "webrip" | "web" => "WEB".into(),
        "hdtv" => "HDTV".into(),
        "dvdrip" => "DVD".into(),
        "hdrip" => "HDRip".into(),
        "hdcam" => "CAM".into(),
        "dvdscr" => "Screener".into(),
        _ => s.to_string(),
    }
}

fn canon_codec(s: &str) -> String {
    let l = s.to_ascii_lowercase().replace(' ', "");
    match l.as_str() {
        "x264" | "h264" | "avc" => "H.264".into(),
        "x265" | "h265" | "hevc" => "HEVC".into(),
        "av1" => "AV1".into(),
        "xvid" => "XviD".into(),
        "divx" => "DivX".into(),
        _ => s.to_string(),
    }
}

fn canon_hdr(s: &str) -> String {
    let l = s.to_ascii_lowercase().replace(' ', "");
    match l.as_str() {
        "dv" | "dovi" | "dolbyvision" => "Dolby Vision".into(),
        "hdr10+" => "HDR10+".into(),
        _ => "HDR".into(),
    }
}

fn canon_edition(s: &str) -> String {
    let l = s.to_ascii_lowercase();
    if l.starts_with("director") {
        "Director's Cut".into()
    } else if l.starts_with("extended") {
        "Extended".into()
    } else if l.starts_with("theatrical") {
        "Theatrical".into()
    } else if l.starts_with("final") {
        "Final Cut".into()
    } else if l.starts_with("special") {
        "Special Edition".into()
    } else {
        let mut c = l.chars();
        match c.next() {
            Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            None => String::new(),
        }
    }
}

/// Parse a single release-style name (no path information).
pub fn parse_name(raw: &str) -> Parsed {
    let s = normalise(raw);
    let mut p = Parsed::default();
    let mut cut = s.len();

    // --- Episode detection -------------------------------------------------
    if let Some(c) = EP_SXXEXX.captures(&s) {
        p.kind = ParsedKind::Episode;
        p.season = c[1].parse().ok();
        p.episode = c[2].parse().ok();
        p.episode_end = c.get(3).and_then(|m| m.as_str().parse().ok());
        cut = cut.min(c.get(0).unwrap().start());
    } else if let Some(c) = EP_WORDS.captures(&s) {
        p.kind = ParsedKind::Episode;
        p.season = c[1].parse().ok();
        p.episode = c[2].parse().ok();
        cut = cut.min(c.get(0).unwrap().start());
    } else if let Some(c) = EP_NXNN.captures(&s).filter(|c| {
        // Avoid matching resolutions like 1920x1080
        c[1].len() <= 2 && c.get(0).unwrap().start() > 0
    }) {
        p.kind = ParsedKind::Episode;
        p.season = c[1].parse().ok();
        p.episode = c[2].parse().ok();
        cut = cut.min(c.get(0).unwrap().start());
    }

    // --- Year ----------------------------------------------------------------
    let max_year = max_plausible_year();
    let years: Vec<(usize, i32)> = YEAR
        .captures_iter(&s)
        .filter_map(|c| {
            let m = c.get(1).unwrap();
            let y: i32 = m.as_str().parse().ok()?;
            (1900..=max_year).contains(&y).then_some((m.start(), y))
        })
        .collect();
    // A year at position 0 is part of the title ("2001 A Space Odyssey", "1917").
    if let Some(&(pos, y)) = years.iter().rev().find(|(pos, _)| *pos > 0) {
        // Only accept a year that comes before the episode tag (show year) or
        // anywhere for movies.
        if p.kind == ParsedKind::Movie || pos < cut {
            p.year = Some(y);
            // The year itself might be wrapped in brackets: cut before them.
            let mut start = pos;
            let bytes = s.as_bytes();
            while start > 0 && matches!(bytes[start - 1], b'(' | b'[' | b' ') {
                start -= 1;
            }
            cut = cut.min(start.max(1));
        }
    }

    // --- Hard markers & brackets --------------------------------------------
    if let Some(m) = HARD_MARKERS.find(&s) {
        if m.start() > 0 {
            cut = cut.min(m.start());
        }
    }
    if let Some(m) = BRACKET_OPEN.find(&s) {
        if m.start() > 0 {
            cut = cut.min(m.start());
        }
    }

    // Anime style "Title - 05" (only when nothing else matched)
    if p.kind == ParsedKind::Movie {
        if let Some(c) = EP_ANIME.captures(&s) {
            let m = c.get(0).unwrap();
            let n: u32 = c[1].parse().unwrap_or(0);
            if m.start() > 0 && m.start() <= cut && !(1900..=2100).contains(&n) && n > 0 {
                p.kind = ParsedKind::Episode;
                p.season = Some(1);
                p.episode = Some(n);
                cut = cut.min(m.start());
            }
        }
    }

    let mut title = clean_title(&s[..cut.min(s.len())]);
    if title.is_empty() && !years.is_empty() && p.kind == ParsedKind::Movie {
        // e.g. "1917.mkv" – the leading year IS the title.
        title = years[0].1.to_string();
        p.year = None;
    }
    p.title = title;

    // --- Quality / extras -----------------------------------------------------
    let tail = &s[cut.min(s.len())..];
    let scan = if tail.is_empty() { s.as_str() } else { tail };
    p.resolution = first_capture(&RES, scan).map(|r| canon_resolution(&r));
    p.source = first_capture(&SOURCE, scan).map(|r| canon_source(&r));
    p.codec = first_capture(&CODEC, scan).map(|r| canon_codec(&r));
    p.hdr = first_capture(&HDR, scan).map(|r| canon_hdr(&r));
    p.audio = first_capture(&AUDIO, scan).map(|a| a.to_uppercase().replace(' ', "."));
    p.edition = first_capture(&EDITION, scan).map(|e| canon_edition(&e));
    p.part = first_capture(&PART, &s).and_then(|n| n.parse().ok());
    p.is_sample = SAMPLE.is_match(raw);
    p
}

fn dir_name(path: Option<&Path>) -> Option<String> {
    path.and_then(|p| p.file_name()).and_then(|n| n.to_str()).map(|s| s.to_string())
}

fn looks_generic(p: &Parsed) -> bool {
    let t = p.title.to_ascii_lowercase();
    t.chars().filter(|c| c.is_alphanumeric()).count() < 2 || GENERIC_STEMS.contains(&t.as_str())
}

/// Parse a full path, using folder names for context.
pub fn parse_path(path: &Path) -> Parsed {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
    let parent = path.parent();
    let parent_name = dir_name(parent);
    let grand_name = dir_name(parent.and_then(|p| p.parent()));

    let mut p = parse_name(stem);

    // Extras / samples
    let lower_parent = parent_name.as_deref().unwrap_or("").to_ascii_lowercase();
    if EXTRA_FOLDERS.contains(&lower_parent.trim()) {
        p.is_extra = true;
    }
    if PLEX_EXTRA_SUFFIX.is_match(stem) {
        p.is_extra = true;
    }
    if lower_parent == "sample" || lower_parent == "samples" {
        p.is_sample = true;
    }

    // Season folder layouts: Show/Season 1/01 - Pilot.mkv, Show/S01/E01.mkv
    let season_from_folder = parent_name.as_deref().and_then(|n| {
        if SPECIALS_FOLDER.is_match(n) {
            Some(0)
        } else {
            SEASON_FOLDER
                .captures(n)
                .and_then(|c| c[1].parse::<u32>().ok())
        }
    });

    if let Some(season) = season_from_folder {
        let show = grand_name.as_deref().map(parse_name);
        if p.kind == ParsedKind::Movie {
            // Episode number from the file name ("01 - Pilot", "E05", "Episode 5")
            let ep = EPISODE_E_ANYWHERE
                .captures(stem)
                .or_else(|| EPISODE_IN_STEM.captures(stem))
                .and_then(|c| c[1].parse::<u32>().ok());
            if let Some(ep) = ep {
                p.kind = ParsedKind::Episode;
                p.season = Some(season);
                p.episode = Some(ep);
                if let Some(show) = &show {
                    p.title = show.title.clone();
                    p.year = show.year.or(p.year);
                }
            }
        } else if p.title.is_empty() || looks_generic(&p) {
            if let Some(show) = &show {
                p.title = show.title.clone();
                p.year = p.year.or(show.year);
            }
        }
    }

    if p.kind == ParsedKind::Episode && (p.title.is_empty() || looks_generic(&p)) {
        // "S01E02.mkv" inside "Breaking Bad" or "Breaking Bad S01"
        if let Some(pn) = parent_name.as_deref() {
            let pp = parse_name(pn);
            let candidate = if SEASON_FOLDER.is_match(pn) || pp.title.is_empty() {
                grand_name.as_deref().map(parse_name)
            } else {
                Some(pp)
            };
            if let Some(c) = candidate {
                if !c.title.is_empty() {
                    p.title = c.title;
                    p.year = p.year.or(c.year);
                }
            }
        }
    }

    if p.kind == ParsedKind::Movie {
        if let Some(pn) = parent_name.as_deref() {
            let pp = parse_name(pn);
            let parent_is_release = pp.year.is_some() || HARD_MARKERS.is_match(&normalise(pn));
            let stem_weak = looks_generic(&p) || p.year.is_none() && stem.len() <= 12;
            if !pp.title.is_empty()
                && pp.kind == ParsedKind::Movie
                && (stem_weak && parent_is_release || p.year.is_none() && pp.year.is_some() && same_title(&p.title, &pp.title))
            {
                p.title = pp.title.clone();
                p.year = pp.year;
                p.resolution = p.resolution.or(pp.resolution);
                p.source = p.source.or(pp.source);
                p.codec = p.codec.or(pp.codec);
                p.hdr = p.hdr.or(pp.hdr);
                p.edition = p.edition.or(pp.edition);
            }
        }
    }

    // Season packs: "Show.S02.1080p/..." → fill missing season
    if p.kind == ParsedKind::Episode && p.season.is_none() {
        if let Some(c) = parent_name.as_deref().and_then(|n| SEASON_ONLY.captures(&normalise(n)).map(|c| c[1].to_string())) {
            p.season = c.parse().ok();
        }
    }

    p
}

/// Search-friendly title (drops trailing country codes for shows).
pub fn search_title(p: &Parsed) -> String {
    if p.kind == ParsedKind::Episode {
        COUNTRY_SUFFIX.replace(&p.title, "").to_string()
    } else {
        p.title.clone()
    }
}

/// Lower-case, punctuation-free, article-free form for comparisons.
pub fn normalise_for_compare(s: &str) -> String {
    let s = s.to_lowercase().replace('&', " and ");
    let s: String = s
        .chars()
        .filter(|c| *c != '\'' && *c != '\u{2019}')
        .map(fold_accent)
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    let words: Vec<&str> = s.split_whitespace().collect();
    let words: Vec<&str> = match words.first() {
        Some(&"the") | Some(&"a") | Some(&"an") if words.len() > 1 => words[1..].to_vec(),
        _ => words,
    };
    words.join(" ")
}

fn fold_accent(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => 'a',
        'ç' | 'č' | 'ć' => 'c',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ę' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'ī' => 'i',
        'ñ' | 'ń' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' => 'o',
        'ù' | 'ú' | 'û' | 'ü' | 'ū' => 'u',
        'ý' | 'ÿ' => 'y',
        'š' | 'ś' => 's',
        'ž' | 'ź' | 'ż' => 'z',
        'ł' => 'l',
        other => other,
    }
}

fn same_title(a: &str, b: &str) -> bool {
    let (a, b) = (normalise_for_compare(a), normalise_for_compare(b));
    if a.is_empty() || b.is_empty() {
        return false;
    }
    let (pa, pb) = (format!(" {a} "), format!(" {b} "));
    pa.contains(&pb) || pb.contains(&pa)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn name(s: &str) -> Parsed {
        parse_name(s)
    }
    fn path(s: &str) -> Parsed {
        parse_path(&PathBuf::from(s))
    }

    #[test]
    fn classic_scene_names() {
        let p = name("The.Matrix.1999.1080p.BluRay.x264-GRP");
        assert_eq!(p.title, "The Matrix");
        assert_eq!(p.year, Some(1999));
        assert_eq!(p.resolution.as_deref(), Some("1080p"));
        assert_eq!(p.source.as_deref(), Some("BluRay"));
        assert_eq!(p.codec.as_deref(), Some("H.264"));
        assert_eq!(p.kind, ParsedKind::Movie);
    }

    #[test]
    fn brackets_and_groups() {
        let p = name("Inception (2010) [1080p] [BluRay] [5.1] [YTS.MX]");
        assert_eq!(p.title, "Inception");
        assert_eq!(p.year, Some(2010));
        let p = name("[YTS.MX] Parasite (2019) [2160p]");
        assert_eq!(p.title, "Parasite");
        assert_eq!(p.year, Some(2019));
        assert_eq!(p.quality_label().as_deref(), Some("4K"));
        let p = name("www.Torrenting.com - Dune.Part.Two.2024.1080p.WEB-DL");
        assert_eq!(p.title, "Dune Part Two");
        assert_eq!(p.year, Some(2024));
        assert_eq!(p.source.as_deref(), Some("WEB"));
    }

    #[test]
    fn uhd_hdr() {
        let p = name("Interstellar.2014.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-SWTYBLZ");
        assert_eq!(p.title, "Interstellar");
        assert_eq!(p.year, Some(2014));
        assert_eq!(p.resolution.as_deref(), Some("2160p"));
        assert_eq!(p.hdr.as_deref(), Some("HDR"));
        assert_eq!(p.codec.as_deref(), Some("HEVC"));
        let p = name("Dune.2021.2160p.WEB-DL.DV.HDR.DDP5.1.Atmos.H.265");
        assert_eq!(p.hdr.as_deref(), Some("Dolby Vision"));
    }

    #[test]
    fn years_inside_titles() {
        let p = name("2001.A.Space.Odyssey.1968.1080p");
        assert_eq!(p.title, "2001 A Space Odyssey");
        assert_eq!(p.year, Some(1968));
        let p = name("Blade Runner 2049 (2017)");
        assert_eq!(p.title, "Blade Runner 2049");
        assert_eq!(p.year, Some(2017));
        let p = name("1917");
        assert_eq!(p.title, "1917");
        assert_eq!(p.year, None);
        let p = name("1917.2019.1080p");
        assert_eq!(p.title, "1917");
        assert_eq!(p.year, Some(2019));
        let p = name("2012 (2009)");
        assert_eq!(p.title, "2012");
        assert_eq!(p.year, Some(2009));
    }

    #[test]
    fn ambiguous_words_stay_in_title() {
        let p = name("Charlotte's.Web.2006.720p");
        assert_eq!(p.title, "Charlotte's Web");
        assert_eq!(p.year, Some(2006));
        let p = name("Spider-Man.Into.the.Spider-Verse.2018.1080p");
        assert_eq!(p.title, "Spider-Man Into the Spider-Verse");
        let p = name("Harry.Potter.and.the.Deathly.Hallows.Part.1.2010.1080p");
        assert_eq!(p.title, "Harry Potter and the Deathly Hallows Part 1");
    }

    #[test]
    fn editions_and_parts() {
        let p = name("Blade.Runner.1982.The.Final.Cut.1080p.BluRay");
        assert_eq!(p.title, "Blade Runner");
        assert_eq!(p.year, Some(1982));
        assert_eq!(p.edition.as_deref(), Some("Final Cut"));
        let p = name("Kingdom.of.Heaven.2005.Directors.Cut.720p");
        assert_eq!(p.edition.as_deref(), Some("Director's Cut"));
        let p = name("Lawrence.of.Arabia.1962.CD2");
        assert_eq!(p.part, Some(2));
        assert_eq!(p.title, "Lawrence of Arabia");
    }

    #[test]
    fn episodes() {
        let p = name("Breaking.Bad.S01E01.720p.HDTV.x264-CTU");
        assert_eq!(p.kind, ParsedKind::Episode);
        assert_eq!(p.title, "Breaking Bad");
        assert_eq!((p.season, p.episode), (Some(1), Some(1)));
        let p = name("Game of Thrones S08E06 The Iron Throne 1080p AMZN WEB-DL DDP5.1 H.264-GoT");
        assert_eq!(p.title, "Game of Thrones");
        assert_eq!((p.season, p.episode), (Some(8), Some(6)));
        let p = name("the.office.us.s03e12.720p.hdtv");
        assert_eq!(p.title, "the office us");
        assert_eq!(search_title(&p), "the office");
        let p = name("Friends - 1x05 - The One with the East German Laundry Detergent");
        assert_eq!(p.title, "Friends");
        assert_eq!((p.season, p.episode), (Some(1), Some(5)));
        let p = name("Seinfeld.S04E23E24.The.Pilot");
        assert_eq!((p.season, p.episode, p.episode_end), (Some(4), Some(23), Some(24)));
        let p = name("Doctor.Who.2005.S01E01.Rose");
        assert_eq!(p.title, "Doctor Who");
        assert_eq!(p.year, Some(2005));
        let p = name("Marvels.Agents.of.S.H.I.E.L.D.S01E01.720p");
        assert_eq!(p.title, "Marvels Agents of SHIELD");
    }

    #[test]
    fn anime_absolute() {
        let p = name("[SubsPlease] Frieren - 05 (1080p) [ABCD1234]");
        assert_eq!(p.kind, ParsedKind::Episode);
        assert_eq!(p.title, "Frieren");
        assert_eq!(p.episode, Some(5));
    }

    #[test]
    fn folder_layouts() {
        let p = path("/tv/Breaking Bad/Season 1/01 - Pilot.mkv");
        assert_eq!(p.kind, ParsedKind::Episode);
        assert_eq!(p.title, "Breaking Bad");
        assert_eq!((p.season, p.episode), (Some(1), Some(1)));

        let p = path("/tv/The Wire (2002)/Season 03/Episode 4.mp4");
        assert_eq!(p.title, "The Wire");
        assert_eq!(p.year, Some(2002));
        assert_eq!((p.season, p.episode), (Some(3), Some(4)));

        let p = path("/tv/Fargo/S02/S02E03.mkv");
        assert_eq!(p.title, "Fargo");
        assert_eq!((p.season, p.episode), (Some(2), Some(3)));

        let p = path("/tv/Sherlock/Specials/E01 The Abominable Bride.mkv");
        assert_eq!(p.season, Some(0));
        assert_eq!(p.title, "Sherlock");
    }

    #[test]
    fn movie_folder_fallback() {
        let p = path("/movies/Heat (1995)/movie.mkv");
        assert_eq!(p.title, "Heat");
        assert_eq!(p.year, Some(1995));

        let p = path("/movies/Arrival.2016.1080p.BluRay.x264-SPARKS/sparks-arrival-1080p.mkv");
        assert_eq!(p.title, "Arrival");
        assert_eq!(p.year, Some(2016));

        let p = path("/movies/Amelie (2001)/Amelie.mkv");
        assert_eq!(p.title, "Amelie");
        assert_eq!(p.year, Some(2001));

        // A good file name wins over a generic parent folder
        let p = path("/Users/me/Movies/Downloads/Whiplash.2014.720p.mkv");
        assert_eq!(p.title, "Whiplash");
        assert_eq!(p.year, Some(2014));
    }

    #[test]
    fn extras_and_samples() {
        assert!(path("/m/Heat (1995)/Sample/heat-sample.mkv").is_sample);
        assert!(path("/m/Heat (1995)/Featurettes/Making Of.mkv").is_extra);
        assert!(path("/m/Heat (1995)/Heat-trailer.mp4").is_extra);
        assert!(!path("/m/Heat (1995)/Heat.mkv").is_extra);
    }

    #[test]
    fn compare_normalisation() {
        assert_eq!(normalise_for_compare("The Lord of the Rings: The Fellowship"), "lord of the rings the fellowship");
        assert_eq!(normalise_for_compare("Fast & Furious"), "fast and furious");
        assert!(is_video_file(Path::new("/a/b.MKV")));
        assert!(!is_video_file(Path::new("/a/b.srt")));
    }
}
