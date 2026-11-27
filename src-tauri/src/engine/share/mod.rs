//! Sharing the library with TVs on the home network.
//!
//! When it's switched on, Movie Monkey runs a small web server. A TV opens the
//! TV screens from it, lists the library, and streams files: as they are when
//! the TV can play them, or repackaged / converted on the fly with ffmpeg when
//! it can't (see `media`). Only devices on the local network that were paired
//! with a one-time code get in.

mod media;
mod routes;
mod subs;

pub use media::{MediaInfo, Tools};

use super::images::ImageCache;
use super::library::Library;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::oneshot;

/// The port TVs look for first. If it's taken, the next few are tried.
pub const DEFAULT_PORT: u16 = 46766;
const PAIRING_TTL: Duration = Duration::from_secs(10 * 60);
const PAIRING_MAX_TRIES: u32 = 5;

const K_ENABLED: &str = "share.enabled";
const K_KEEP_RUNNING: &str = "share.keepRunning";
const K_DEVICES: &str = "share.devices";

/// Files for the TV screens (the built `tv.html` and its assets), looked up by
/// path. Inside the app they come from the bundle; the headless example reads
/// them from `dist/`.
pub type Assets = Arc<dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync>;
/// Called when something the Settings screen shows has changed.
pub type OnChange = Arc<dyn Fn() + Send + Sync>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub token: String,
    pub paired_at: i64,
    pub last_seen: Option<i64>,
}

/// What Settings shows. Tokens are left out.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: Option<u16>,
    /// e.g. "http://192.168.1.23:46766"
    pub address: Option<String>,
    pub name: String,
    pub keep_running: bool,
    pub pairing_code: Option<String>,
    pub pairing_expires_in: Option<u64>,
    pub devices: Vec<DeviceInfo>,
    /// Whether ffmpeg was found, so files the TV can't play can be converted.
    pub can_convert: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub paired_at: i64,
    pub last_seen: Option<i64>,
}

struct Pairing {
    code: String,
    started: Instant,
    tries: u32,
}

struct Running {
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
}

pub struct Share {
    pub(crate) lib: Arc<Library>,
    pub(crate) images: ImageCache,
    pub(crate) assets: Assets,
    pub(crate) media: Arc<media::Media>,
    pub(crate) name: String,
    running: Mutex<Option<Running>>,
    pairing: Mutex<Option<Pairing>>,
    error: Mutex<Option<String>>,
    on_change: Mutex<Option<OnChange>>,
}

impl Share {
    pub fn new(lib: Arc<Library>, images: ImageCache, assets: Assets, work_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            lib,
            images,
            assets,
            media: Arc::new(media::Media::new(work_dir)),
            name: computer_name(),
            running: Mutex::new(None),
            pairing: Mutex::new(None),
            error: Mutex::new(None),
            on_change: Mutex::new(None),
        })
    }

    pub fn set_on_change(&self, f: OnChange) {
        *self.on_change.lock().unwrap() = Some(f);
    }

    pub(crate) fn changed(&self) {
        let f = self.on_change.lock().unwrap().clone();
        if let Some(f) = f {
            f();
        }
    }

    pub fn enabled(&self) -> bool {
        self.lib.setting(K_ENABLED).as_deref() == Some("1")
    }

    pub fn keep_running(&self) -> bool {
        self.lib.setting(K_KEEP_RUNNING).as_deref() == Some("1")
    }

    pub fn set_keep_running(&self, on: bool) -> Result<()> {
        self.lib.set_setting(K_KEEP_RUNNING, if on { "1" } else { "0" })?;
        self.changed();
        Ok(())
    }

    /// Start sharing if it was left on.
    pub async fn resume(self: &Arc<Self>) {
        if self.enabled() {
            if let Err(e) = self.start().await {
                log::warn!("could not start sharing: {e:#}");
            }
        }
    }

    pub async fn set_enabled(self: &Arc<Self>, on: bool) -> Result<()> {
        self.lib.set_setting(K_ENABLED, if on { "1" } else { "0" })?;
        let res = if on {
            self.start().await.map(|_| ())
        } else {
            self.stop();
            Ok(())
        };
        self.changed();
        res
    }

    pub async fn start(self: &Arc<Self>) -> Result<u16> {
        if let Some(r) = self.running.lock().unwrap().as_ref() {
            return Ok(r.port);
        }
        let (listener, port) = bind().await.inspect_err(|e| {
            *self.error.lock().unwrap() = Some(format!("{e:#}"));
        })?;
        *self.error.lock().unwrap() = None;
        let (tx, rx) = oneshot::channel::<()>();
        let app = routes::router(self.clone());
        tokio::spawn(async move {
            let server = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                });
            if let Err(e) = server.await {
                log::warn!("share server stopped: {e}");
            }
        });
        *self.running.lock().unwrap() = Some(Running {
            port,
            shutdown: Some(tx),
        });
        log::info!("sharing on port {port}");
        Ok(port)
    }

    pub fn stop(&self) {
        if let Some(mut r) = self.running.lock().unwrap().take() {
            if let Some(tx) = r.shutdown.take() {
                let _ = tx.send(());
            }
        }
        self.media.stop_all();
        *self.pairing.lock().unwrap() = None;
    }

    pub fn port(&self) -> Option<u16> {
        self.running.lock().unwrap().as_ref().map(|r| r.port)
    }

    pub fn status(&self) -> ShareStatus {
        let port = self.port();
        let (pairing_code, pairing_expires_in) = match self.pairing.lock().unwrap().as_ref() {
            Some(p) if p.started.elapsed() < PAIRING_TTL && p.tries < PAIRING_MAX_TRIES => (
                Some(p.code.clone()),
                Some((PAIRING_TTL - p.started.elapsed()).as_secs()),
            ),
            _ => (None, None),
        };
        ShareStatus {
            enabled: self.enabled(),
            running: port.is_some(),
            port,
            address: port.and_then(|p| local_ip().map(|ip| format!("http://{ip}:{p}"))),
            name: self.name.clone(),
            keep_running: self.keep_running(),
            pairing_code,
            pairing_expires_in,
            devices: self
                .devices()
                .into_iter()
                .map(|d| DeviceInfo {
                    id: d.id,
                    name: d.name,
                    paired_at: d.paired_at,
                    last_seen: d.last_seen,
                })
                .collect(),
            can_convert: self.media.tools().ffmpeg.is_some(),
            error: self.error.lock().unwrap().clone(),
        }
    }

    // ---------------------------------------------------------------- pairing

    /// Show a fresh 4-digit code, valid for 10 minutes.
    pub fn begin_pairing(&self) -> String {
        let n = u32::from_le_bytes(random_bytes::<4>()) % 10_000;
        let code = format!("{n:04}");
        *self.pairing.lock().unwrap() = Some(Pairing {
            code: code.clone(),
            started: Instant::now(),
            tries: 0,
        });
        self.changed();
        code
    }

    pub fn cancel_pairing(&self) {
        *self.pairing.lock().unwrap() = None;
        self.changed();
    }

    /// A TV entered a code. Returns a token for it to keep.
    pub(crate) fn pair(&self, code: &str, name: &str) -> Option<String> {
        {
            let mut guard = self.pairing.lock().unwrap();
            let p = guard.as_mut()?;
            if p.started.elapsed() >= PAIRING_TTL || p.tries >= PAIRING_MAX_TRIES {
                *guard = None;
                return None;
            }
            if p.code != code.trim() {
                p.tries += 1;
                drop(guard);
                self.changed();
                return None;
            }
            *guard = None;
        }
        let token = hex(&random_bytes::<24>());
        let mut devices = self.devices();
        devices.push(Device {
            id: hex(&random_bytes::<6>()),
            name: clean_name(name),
            token: token.clone(),
            paired_at: self.lib.now(),
            last_seen: Some(self.lib.now()),
        });
        self.save_devices(&devices);
        self.changed();
        Some(token)
    }

    pub fn devices(&self) -> Vec<Device> {
        self.lib
            .setting(K_DEVICES)
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save_devices(&self, devices: &[Device]) {
        if let Ok(json) = serde_json::to_string(devices) {
            let _ = self.lib.set_setting(K_DEVICES, &json);
        }
    }

    pub fn remove_device(&self, id: &str) {
        let mut devices = self.devices();
        devices.retain(|d| d.id != id);
        self.save_devices(&devices);
        self.changed();
    }

    /// The paired device a token belongs to, if any. Updates "last seen" at
    /// most once a minute.
    pub(crate) fn check_token(&self, token: &str) -> bool {
        if token.len() < 32 {
            return false;
        }
        let mut devices = self.devices();
        let Some(d) = devices.iter_mut().find(|d| constant_eq(&d.token, token)) else {
            return false;
        };
        let now = self.lib.now();
        if d.last_seen.is_none_or(|t| now - t > 60_000) {
            d.last_seen = Some(now);
            self.save_devices(&devices);
        }
        true
    }
}

/// Bind on every interface (TVs connect over Wi-Fi or Ethernet).
async fn bind() -> Result<(tokio::net::TcpListener, u16)> {
    let mut last = None;
    for port in DEFAULT_PORT..DEFAULT_PORT + 10 {
        match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(l) => return Ok((l, port)),
            Err(e) => last = Some(e),
        }
    }
    Err(last.unwrap()).context("no free port to share on")
}

/// Only devices on this computer or the local network may connect.
pub(crate) fn is_local(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local(),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_local(IpAddr::V4(v4));
            }
            let seg = v6.segments()[0];
            v6.is_loopback() || (seg & 0xfe00) == 0xfc00 || (seg & 0xffc0) == 0xfe80
        }
    }
}

/// This computer's address on the home network. Connecting a UDP socket sends
/// nothing; it only asks the OS which interface it would use.
pub fn local_ip() -> Option<IpAddr> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("1.1.1.1:80").ok()?;
    let ip = s.local_addr().ok()?.ip();
    (!ip.is_unspecified() && !ip.is_loopback()).then_some(ip)
}

fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("scutil")
        .args(["--get", "ComputerName"])
        .output()
    {
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !name.is_empty() {
            return name;
        }
    }
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "Movie Monkey".into())
}

fn clean_name(name: &str) -> String {
    let n: String = name.chars().filter(|c| !c.is_control()).take(40).collect();
    let n = n.trim();
    if n.is_empty() {
        "TV".into()
    } else {
        n.to_string()
    }
}

fn random_bytes<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("system randomness");
    b
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn constant_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Stable short id for a file, used in URLs instead of its path.
pub(crate) fn file_id(path: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in path.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_addresses() {
        for ip in [
            "127.0.0.1",
            "192.168.1.20",
            "10.0.0.5",
            "172.16.3.4",
            "169.254.1.1",
            "::1",
            "fe80::1",
            "fd00::5",
        ] {
            assert!(is_local(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "100.64.0.1", "2001:4860::8888"] {
            assert!(!is_local(ip.parse().unwrap()), "{ip}");
        }
        assert!(is_local("::ffff:192.168.0.9".parse().unwrap()));
    }

    #[test]
    fn helpers() {
        assert!(constant_eq("abc", "abc"));
        assert!(!constant_eq("abc", "abd"));
        assert!(!constant_eq("abc", "ab"));
        assert_eq!(file_id("/a/b.mkv"), file_id("/a/b.mkv"));
        assert_ne!(file_id("/a/b.mkv"), file_id("/a/c.mkv"));
        assert_eq!(clean_name("  "), "TV");
        assert_eq!(hex(&[0, 255]), "00ff");
    }
}
