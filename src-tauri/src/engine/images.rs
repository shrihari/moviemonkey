//! Disk cache for artwork. The UI asks for `mm://localhost/img?u=<url>&f=<fallback>`
//! and gets bytes from disk, downloading on first use. Works offline after that.
//!
//! Cached files older than `MAX_AGE` are downloaded again (TMDB's terms allow
//! caching for at most 6 months); if that fails, the old copy is still served.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::sync::Semaphore;

const MAX_AGE: Duration = Duration::from_secs(150 * 24 * 3600);

#[derive(Clone)]
pub struct ImageCache {
    dir: PathBuf,
    http: reqwest::Client,
    gate: Arc<Semaphore>,
}

/// Stable 64-bit FNV-1a, used for cache file names.
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0xFF, 0xD8, 0xFF, ..] => Some("image/jpeg"),
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        [b'G', b'I', b'F', ..] => Some("image/gif"),
        [_, _, _, _, b'f', b't', b'y', b'p', b'a', b'v', b'i', b'f', ..] => Some("image/avif"),
        _ => {
            // Some title logos are SVG.
            let head = std::str::from_utf8(&bytes[..bytes.len().min(256)]).unwrap_or("");
            let head = head.trim_start_matches('\u{feff}').trim_start();
            (head.starts_with("<svg") || (head.starts_with("<?xml") && head.contains("<svg")))
                .then_some("image/svg+xml")
        }
    }
}

async fn read_cached(path: &Path) -> Option<(Vec<u8>, &'static str, bool)> {
    let bytes = tokio::fs::read(path).await.ok()?;
    let ct = sniff(&bytes)?;
    let fresh = tokio::fs::metadata(path)
        .await
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .map(|age| age < MAX_AGE)
        .unwrap_or(true);
    Some((bytes, ct, fresh))
}

impl ImageCache {
    pub fn new(dir: PathBuf, http: reqwest::Client) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Self {
            dir,
            http,
            gate: Arc::new(Semaphore::new(8)),
        }
    }

    fn path_for(&self, url: &str) -> PathBuf {
        self.dir.join(format!("{:016x}", fnv1a(url)))
    }

    async fn fetch(&self, url: &str) -> Option<(Vec<u8>, &'static str)> {
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            return None;
        }
        let path = self.path_for(url);
        let mut stale = None;
        if let Some((bytes, ct, fresh)) = read_cached(&path).await {
            if fresh {
                return Some((bytes, ct));
            }
            stale = Some((bytes, ct));
        }
        let _permit = self.gate.acquire().await.ok()?;
        // Another request may have refreshed the cache while we waited.
        if let Some((bytes, ct, true)) = read_cached(&path).await {
            return Some((bytes, ct));
        }
        match self.download(url, &path).await {
            Some(hit) => Some(hit),
            None => stale,
        }
    }

    async fn download(&self, url: &str, path: &Path) -> Option<(Vec<u8>, &'static str)> {
        let resp = self.http.get(url).send().await.ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let bytes = resp.bytes().await.ok()?.to_vec();
        let ct = sniff(&bytes)?;
        let tmp = path.with_extension("part");
        if tokio::fs::write(&tmp, &bytes).await.is_ok() {
            let _ = tokio::fs::rename(&tmp, path).await;
        }
        Some((bytes, ct))
    }

    /// Try the primary URL, then the fallback.
    pub async fn get(&self, url: &str, fallback: Option<&str>) -> Option<(Vec<u8>, &'static str)> {
        if let Some(hit) = self.fetch(url).await {
            return Some(hit);
        }
        match fallback {
            Some(f) if !f.is_empty() && f != url => self.fetch(f).await,
            _ => None,
        }
    }

    pub fn size_bytes(&self) -> u64 {
        dir_size(&self.dir)
    }

    pub fn clear(&self) -> std::io::Result<()> {
        if self.dir.exists() {
            std::fs::remove_dir_all(&self.dir)?;
        }
        std::fs::create_dir_all(&self.dir)
    }
}

fn dir_size(p: &Path) -> u64 {
    std::fs::read_dir(p)
        .map(|rd| rd.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum())
        .unwrap_or(0)
}

/// Parse `img?u=...&f=...` from a protocol request URI.
pub fn parse_request(uri: &str) -> Option<(String, Option<String>)> {
    let query = uri.split_once('?')?.1;
    let mut u = None;
    let mut f = None;
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=')?;
        let v = urlencoding::decode(v).ok()?.into_owned();
        match k {
            "u" => u = Some(v),
            "f" => f = Some(v),
            _ => {}
        }
    }
    Some((u?, f))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_uri() {
        let (u, f) = parse_request("mm://localhost/img?u=https%3A%2F%2Fa.b%2Fc.jpg&f=https%3A%2F%2Fx.y").unwrap();
        assert_eq!(u, "https://a.b/c.jpg");
        assert_eq!(f.as_deref(), Some("https://x.y"));
        assert_eq!(fnv1a("abc"), fnv1a("abc"));
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0x00]), Some("image/jpeg"));
        assert_eq!(sniff(b"<?xml version=\"1.0\"?>\n<svg xmlns=..."), Some("image/svg+xml"));
        assert_eq!(sniff(b"<html>nope</html>"), None);
    }
}
