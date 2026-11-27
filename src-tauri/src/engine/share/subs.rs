//! Subtitles for the TV. Browsers (and LG's TVs) only show WebVTT, so SRT and
//! ASS files are converted. Files next to the video are converted here, with no
//! ffmpeg needed; subtitles inside the video are read out with ffmpeg.

use super::media::SubTrack;
use anyhow::{anyhow, Context, Result};
use std::path::{Path, PathBuf};
use std::process::Stdio;

const SUB_EXTS: &[&str] = &["srt", "vtt", "ass", "ssa"];

/// Subtitle files that belong to a video: `Film.srt`, `Film.en.srt`,
/// `Film.English.forced.srt`, or anything in a `Subs` folder beside it.
pub fn sidecars(video: &Path) -> Vec<SubTrack> {
    let Some(dir) = video.parent() else { return vec![] };
    let stem = video.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    let mut found: Vec<PathBuf> = vec![];
    let mut scan = |d: &Path, any: bool| {
        if let Ok(rd) = std::fs::read_dir(d) {
            for e in rd.flatten() {
                let p = e.path();
                let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
                if !SUB_EXTS.contains(&ext.as_str()) {
                    continue;
                }
                let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
                if any || name == stem || name.starts_with(&format!("{stem}.")) {
                    found.push(p);
                }
            }
        }
    };
    scan(dir, false);
    // Folder names are matched by listing them, not by trying spellings: on a
    // case-insensitive disk "Subs" and "subs" are the same folder.
    let sub_dirs: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .filter(|p| {
                    let n = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
                    n == "subs" || n == "subtitles"
                })
                .collect()
        })
        .unwrap_or_default();
    for d in sub_dirs {
        scan(&d, true);
        // RARBG-style: Subs/<video name>/2_English.srt
        let nested = d.join(video.file_stem().unwrap_or_default());
        if nested.is_dir() {
            scan(&nested, true);
        }
    }
    found.sort();
    found.dedup();
    found
        .into_iter()
        .enumerate()
        .map(|(i, p)| {
            let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
            let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            let tail = name.strip_prefix(&stem).unwrap_or(&name);
            let parts: Vec<String> = tail
                .split(['.', '_', ' ', '-'])
                .filter(|s| !s.is_empty() && s.parse::<u32>().is_err())
                .map(str::to_lowercase)
                .collect();
            let forced = parts.iter().any(|p| p == "forced");
            let sdh = parts.iter().any(|p| p == "sdh" || p == "cc" || p == "hi");
            let language = parts
                .iter()
                .find(|p| !matches!(p.as_str(), "forced" | "sdh" | "cc" | "hi" | "default"))
                .cloned();
            SubTrack {
                id: format!("x{i}"),
                codec: ext,
                language,
                title: sdh.then(|| "SDH".to_string()),
                forced,
                default: false,
                text: true,
                external: Some(p),
                stream: None,
            }
        })
        .collect()
}

/// A readable label: "English", "French (forced)", "English SDH".
pub fn label(t: &SubTrack) -> String {
    let lang = t
        .language
        .as_deref()
        .map(language_name)
        .unwrap_or_else(|| "Subtitles".to_string());
    let mut s = lang;
    if let Some(title) = t.title.as_deref().filter(|x| !x.eq_ignore_ascii_case(&s)) {
        s = format!("{s} · {title}");
    }
    if t.forced {
        s.push_str(" (forced)");
    }
    s
}

pub fn language_name(code: &str) -> String {
    let c = code.to_lowercase();
    let name = match c.as_str() {
        "en" | "eng" | "english" => "English",
        "fr" | "fre" | "fra" | "french" => "French",
        "es" | "spa" | "spanish" => "Spanish",
        "de" | "ger" | "deu" | "german" => "German",
        "it" | "ita" | "italian" => "Italian",
        "pt" | "por" | "portuguese" => "Portuguese",
        "nl" | "dut" | "nld" | "dutch" => "Dutch",
        "ru" | "rus" | "russian" => "Russian",
        "ja" | "jpn" | "japanese" => "Japanese",
        "ko" | "kor" | "korean" => "Korean",
        "zh" | "chi" | "zho" | "chinese" => "Chinese",
        "hi" | "hin" | "hindi" => "Hindi",
        "ta" | "tam" | "tamil" => "Tamil",
        "te" | "tel" | "telugu" => "Telugu",
        "ml" | "mal" | "malayalam" => "Malayalam",
        "kn" | "kan" | "kannada" => "Kannada",
        "bn" | "ben" | "bengali" => "Bengali",
        "ar" | "ara" | "arabic" => "Arabic",
        "tr" | "tur" | "turkish" => "Turkish",
        "pl" | "pol" | "polish" => "Polish",
        "sv" | "swe" | "swedish" => "Swedish",
        "no" | "nor" | "nob" | "norwegian" => "Norwegian",
        "da" | "dan" | "danish" => "Danish",
        "fi" | "fin" | "finnish" => "Finnish",
        "el" | "gre" | "ell" | "greek" => "Greek",
        "he" | "heb" | "hebrew" => "Hebrew",
        "th" | "tha" | "thai" => "Thai",
        "vi" | "vie" | "vietnamese" => "Vietnamese",
        "id" | "ind" | "indonesian" => "Indonesian",
        "ms" | "may" | "msa" | "malay" => "Malay",
        "cs" | "cze" | "ces" | "czech" => "Czech",
        "hu" | "hun" | "hungarian" => "Hungarian",
        "ro" | "rum" | "ron" | "romanian" => "Romanian",
        "uk" | "ukr" | "ukrainian" => "Ukrainian",
        _ => {
            let mut chars = code.chars();
            return match chars.next() {
                Some(f) => f.to_uppercase().chain(chars).collect(),
                None => "Unknown".into(),
            };
        }
    };
    name.to_string()
}

/// The subtitle as WebVTT, with every cue moved `shift` seconds earlier (the
/// TV's clock starts at 0 when playback starts partway through a film).
pub async fn webvtt(t: &SubTrack, video: &Path, ffmpeg: Option<&Path>, cache: &Path, shift: f64) -> Result<String> {
    let vtt = if let Some(file) = &t.external {
        let bytes = tokio::fs::read(file).await.context("reading the subtitle file")?;
        let text = decode_text(&bytes);
        match t.codec.as_str() {
            "srt" => srt_to_vtt(&text),
            "ass" | "ssa" => ass_to_vtt(&text),
            _ => text,
        }
    } else {
        let stream = t.stream.ok_or_else(|| anyhow!("no stream"))?;
        let ffmpeg = ffmpeg.ok_or_else(|| anyhow!("reading subtitles inside a video needs ffmpeg"))?;
        let key = format!("{}-{stream}.vtt", super::file_id(&video.to_string_lossy()));
        let cached = cache.join("subs").join(key);
        match tokio::fs::read_to_string(&cached).await {
            Ok(s) => s,
            Err(_) => {
                let out = tokio::process::Command::new(ffmpeg)
                    .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
                    .arg(video)
                    .args(["-map", &format!("0:{stream}"), "-f", "webvtt", "pipe:1"])
                    .stdin(Stdio::null())
                    .output()
                    .await
                    .context("running ffmpeg")?;
                if !out.status.success() {
                    return Err(anyhow!("{}", String::from_utf8_lossy(&out.stderr).trim()));
                }
                let s = String::from_utf8_lossy(&out.stdout).to_string();
                let _ = tokio::fs::create_dir_all(cached.parent().unwrap()).await;
                let _ = tokio::fs::write(&cached, &s).await;
                s
            }
        }
    };
    Ok(if shift.abs() > 0.01 {
        shift_vtt(&vtt, shift)
    } else {
        vtt
    })
}

/// Subtitle files are often Windows-1252 rather than UTF-8.
fn decode_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| cp1252(b)).collect(),
    }
}

fn cp1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}', '\u{90}', '‘',
        '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
    ];
    match b {
        0x80..=0x9F => HIGH[(b - 0x80) as usize],
        _ => b as char,
    }
}

pub fn srt_to_vtt(srt: &str) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for line in srt.replace("\r\n", "\n").replace('\r', "\n").lines() {
        if line.contains("-->") {
            out.push_str(&line.replace(',', "."));
        } else {
            // SRT allows <font> tags that WebVTT doesn't.
            out.push_str(&strip_tags(line, &["font"]));
        }
        out.push('\n');
    }
    out
}

fn strip_tags(line: &str, tags: &[&str]) -> String {
    let mut s = line.to_string();
    for t in tags {
        while let Some(start) = s.to_lowercase().find(&format!("<{t}")) {
            let Some(end) = s[start..].find('>') else { break };
            s.replace_range(start..start + end + 1, "");
        }
        s = s
            .replace(&format!("</{t}>"), "")
            .replace(&format!("</{}>", t.to_uppercase()), "");
    }
    s
}

/// ASS/SSA to WebVTT: the text of each Dialogue line, without styling.
pub fn ass_to_vtt(ass: &str) -> String {
    let mut fields: Vec<String> = vec![];
    let mut cues: Vec<(f64, f64, String)> = vec![];
    let mut in_events = false;
    for line in ass.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_events = line.eq_ignore_ascii_case("[events]");
            continue;
        }
        if !in_events {
            continue;
        }
        if let Some(f) = line.strip_prefix("Format:") {
            fields = f.split(',').map(|x| x.trim().to_lowercase()).collect();
        } else if let Some(d) = line.strip_prefix("Dialogue:") {
            let n = fields.len().max(10);
            let parts: Vec<&str> = d.splitn(n, ',').collect();
            let idx = |name: &str, def: usize| fields.iter().position(|f| f == name).unwrap_or(def);
            let (Some(start), Some(end), Some(text)) = (
                parts.get(idx("start", 1)).and_then(|t| ass_time(t)),
                parts.get(idx("end", 2)).and_then(|t| ass_time(t)),
                parts.get(idx("text", n - 1)),
            ) else {
                continue;
            };
            let text = strip_ass(text);
            if !text.trim().is_empty() {
                cues.push((start, end, text));
            }
        }
    }
    cues.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut out = String::from("WEBVTT\n\n");
    for (s, e, t) in cues {
        out.push_str(&format!("{} --> {}\n{}\n\n", vtt_time(s), vtt_time(e), t));
    }
    out
}

fn strip_ass(text: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in text.chars() {
        match c {
            '{' => depth += 1,
            '}' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
}

fn ass_time(t: &str) -> Option<f64> {
    let mut p = t.trim().split(':');
    let h: f64 = p.next()?.parse().ok()?;
    let m: f64 = p.next()?.parse().ok()?;
    let s: f64 = p.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

fn vtt_time(t: f64) -> String {
    let t = t.max(0.0);
    let ms = (t * 1000.0).round() as u64;
    format!(
        "{:02}:{:02}:{:02}.{:03}",
        ms / 3_600_000,
        (ms / 60_000) % 60,
        (ms / 1000) % 60,
        ms % 1000
    )
}

fn parse_vtt_time(t: &str) -> Option<f64> {
    let t = t.trim();
    let (main, frac) = t.split_once('.').unwrap_or((t, "0"));
    let parts: Vec<f64> = main.split(':').map(|x| x.parse().ok()).collect::<Option<_>>()?;
    let secs = match parts.as_slice() {
        [h, m, s] => h * 3600.0 + m * 60.0 + s,
        [m, s] => m * 60.0 + s,
        _ => return None,
    };
    Some(secs + format!("0.{frac}").parse::<f64>().ok()?)
}

/// Move every cue `shift` seconds earlier; cues that end before 0 are dropped.
pub fn shift_vtt(vtt: &str, shift: f64) -> String {
    let mut out = String::new();
    for block in vtt.replace("\r\n", "\n").split("\n\n") {
        let mut kept = vec![];
        let mut skip = false;
        for line in block.lines() {
            if let Some((a, rest)) = line.split_once("-->") {
                let (b, settings) = rest.trim().split_once(' ').unwrap_or((rest.trim(), ""));
                match (parse_vtt_time(a), parse_vtt_time(b)) {
                    (Some(s), Some(e)) if e - shift > 0.0 => {
                        kept.push(
                            format!("{} --> {} {}", vtt_time(s - shift), vtt_time(e - shift), settings)
                                .trim_end()
                                .to_string(),
                        );
                    }
                    (Some(_), Some(_)) => {
                        skip = true;
                        break;
                    }
                    _ => kept.push(line.to_string()),
                }
            } else {
                kept.push(line.to_string());
            }
        }
        if !skip && !kept.is_empty() {
            out.push_str(&kept.join("\n"));
            out.push_str("\n\n");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srt() {
        let v = srt_to_vtt("1\r\n00:00:01,500 --> 00:00:03,000\r\n<font color=\"#fff\">Hello</font>\r\n\r\n");
        assert!(
            v.starts_with("WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nHello\n"),
            "{v}"
        );
    }

    #[test]
    fn ass() {
        let a = "[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:04.50,Default,,0,0,0,,{\\i1}Hi,{\\i0} there\\Nfriend\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,First\n";
        let v = ass_to_vtt(a);
        assert_eq!(
            v,
            "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFirst\n\n00:00:02.000 --> 00:00:04.500\nHi, there\nfriend\n\n"
        );
    }

    #[test]
    fn shifting() {
        let v = "WEBVTT\n\n00:00:05.000 --> 00:00:07.000\nGone\n\n00:01:10.000 --> 00:01:12.500 line:90%\nKept\n\n";
        assert_eq!(
            shift_vtt(v, 60.0),
            "WEBVTT\n\n00:00:10.000 --> 00:00:12.500 line:90%\nKept\n\n"
        );
    }

    #[test]
    fn sidecar_names() {
        let dir = std::env::temp_dir().join(format!("mm-subs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Subs")).unwrap();
        for f in [
            "Film.2019.mkv",
            "Film.2019.srt",
            "Film.2019.en.forced.srt",
            "Other.srt",
            "Subs/2_French.srt",
        ] {
            std::fs::write(dir.join(f), "x").unwrap();
        }
        let subs = sidecars(&dir.join("Film.2019.mkv"));
        let _ = std::fs::remove_dir_all(&dir);
        let labels: Vec<String> = subs.iter().map(label).collect();
        assert_eq!(labels, ["English (forced)", "Subtitles", "French"]);
        assert!(subs.iter().all(|s| s.text && s.external.is_some()));
    }

    #[test]
    fn windows_1252() {
        assert_eq!(decode_text(&[b'c', b'a', b'f', 0xE9]), "café");
        assert_eq!(decode_text("ok ✓".as_bytes()), "ok ✓");
    }
}
