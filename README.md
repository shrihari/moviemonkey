<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="112" alt="Movie Monkey" />
</p>

<h1 align="center">Movie Monkey</h1>

<p align="center">
  A beautiful, local-first movie &amp; TV library for your desktop.<br/>
  Drop in a folder of messy files, get back posters, artwork, cast, ratings and episode guides.<br/>
  <b>No accounts. No API keys. No tracking.</b>
</p>

---

## What it does

- **Drag a folder in, anywhere on the window.** Movie Monkey walks it (nested as deep as you like), parses release names like
  `Interstellar.2014.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-SWTYBLZ.mkv`, and identifies each title.
- **Movies and TV shows.** Understands `S01E02`, `1x02`, `Show/Season 1/01 - Pilot.mkv`, anime-style `Show - 05`,
  multi-episode files, CD1/CD2 splits, editions (Director's Cut, Extended…), and ignores samples and featurettes.
- **Cinematic UI.** Rotating hero, logo art, backdrops, a poster grid with a size slider, a detail page with parallax,
  an episode guide with stills, "More like this", and a ⌘K palette that searches titles, actors, directors and genres.
- **Your library, your state.** Watched (per episode, too), Watchlist, Favorites, your own star rating,
  "Continue watching", and Play opens the file in your default player.
- **Keeps itself up to date.** Watches your folders; new files show up on their own. Unplugged drives show as offline
  instead of being wiped.
- **Fixes itself when it's unsure.** Anything it can't confidently identify lands in *Needs review* with a search
  dialog to pick the right title.
- **Works offline.** Artwork is cached on disk after first view.

## Where the data comes from (all free, no keys)

| Source | Used for |
| --- | --- |
| IMDb suggestion endpoint | Fast title search → IMDb ids, year, type |
| [Cinemeta](https://v3-cinemeta.strem.io) (Stremio's public metadata service) | Overview, cast, director, genres, runtime, rating, trailer, episode lists |
| metahub / TMDB image CDN | Posters, backdrops, transparent title logos, episode stills |
| [TVMaze](https://www.tvmaze.com/api) | Fallback search and episode guides for shows |

Each lookup falls through to the next source if one is down. The IMDb and Cinemeta endpoints are unofficial, so if
one changes, only `src-tauri/src/engine/providers.rs` needs updating.

## Tech

- **[Tauri 2](https://v2.tauri.app)**: a Rust backend with the native system WebView (≈10 MB app instead of ≈150 MB with Electron).
  Native macOS sidebar vibrancy and an inset title bar.
- **Rust engine** (`src-tauri/src/engine`), independent of Tauri:
  - `parse.rs`: release-name parser
  - `matcher.rs`: candidate scoring (title similarity, year, type, popularity)
  - `providers.rs`: HTTP clients with retries and fallbacks
  - `library.rs`: scanning, grouping, concurrent identification, file watching, view assembly
  - `db.rs`: SQLite (bundled) for folders, files, titles and user state
  - `images.rs`: on-disk artwork cache served to the UI over a custom `mm://` protocol
- **UI**: React 19, TypeScript, Tailwind CSS 4, Motion, cmdk, zustand. Vite 8.

The engine has no Tauri dependency on purpose. A future mobile companion (watchlists, "what should I watch") can reuse
it, either through Tauri's iOS/Android targets or behind a small sync server.

## Run it

Prerequisites: Node 20+, Rust (via [rustup](https://rustup.rs)), Xcode Command Line Tools on macOS.

```bash
npm install
npm run dev                      # launches the app with hot reload
```

Don't have a movie folder handy? Generate a demo library of realistic, messy release names. The files are *sparse*,
so they report multi-GB sizes but take ~0 bytes on disk:

```bash
npm run demo                     # creates ./demo-library
npx tauri dev -- -- "$PWD/demo-library"   # opens with it added (or drag the folder onto the window)
```

Other scripts:

```bash
npm test                         # Vitest (UI logic) + cargo test (parser, matcher, db, cache)
npm run build                    # release .app + .dmg in src-tauri/target/release/bundle
npm run preview:web              # UI in a plain browser with real fixture data (no Rust needed)
                                 #   open http://localhost:1420/?empty to replay onboarding + import
```

Headless engine run (great for tuning the matcher):

```bash
cd src-tauri && cargo run --example scan -- ../demo-library
```

## Keyboard

| | |
| --- | --- |
| ⌘K / ⌘F | Search everything |
| ⌘O | Add folder |
| ⌘1–4 | Home · Movies · TV Shows · Watchlist |
| ⌘, | Settings |
| Esc / ⌘[ | Back |

## Where things live

- Library database: `~/Library/Application Support/com.getmoviemonkey.app/library.sqlite`
- Artwork cache: `~/Library/Caches/com.getmoviemonkey.app/images` (clear it from Settings)

Movie Monkey never modifies, moves or renames your media files.

## History

Movie Monkey v1 (2017) was an Electron + React 15 app using OMDb, TMDB and OpenSubtitles. v2 is a ground-up rewrite;
the old code lives in git history on `master`.

## License

CC0-1.0
