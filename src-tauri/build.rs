fn main() {
    // The TMDB API token is compiled into the app. It comes from the
    // environment (CI: a repository secret) or from the git-ignored
    // `src-tauri/.env` (local builds), so it never lives in the repository.
    println!("cargo:rerun-if-env-changed=TMDB_API_TOKEN");
    println!("cargo:rerun-if-changed=.env");
    let token = std::env::var("TMDB_API_TOKEN")
        .ok()
        .or_else(|| {
            std::fs::read_to_string(".env").ok()?.lines().find_map(|l| {
                l.trim()
                    .strip_prefix("TMDB_API_TOKEN=")
                    .map(|v| v.trim().trim_matches('"').to_string())
            })
        })
        .filter(|t| !t.is_empty());
    match token {
        Some(t) => println!("cargo:rustc-env=TMDB_API_TOKEN={t}"),
        None => println!(
            "cargo:warning=TMDB_API_TOKEN is not set, so movies can't be identified. Put it in src-tauri/.env (see README)."
        ),
    }
    tauri_build::build()
}
