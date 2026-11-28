<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="112" alt="Movie Monkey" />
</p>

<h1 align="center">Movie Monkey</h1>

<p align="center">
  A beautiful, local-first movie &amp; TV library for your desktop.<br/>
  Drop in a folder of messy files, get back posters, artwork, cast, ratings and episode guides.<br/>
  <b>No accounts. No setup. No tracking.</b>
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
- **Fixes itself when it's unsure.** Anything it can't confidently identify lands in _Needs review_ with a search
  dialog to pick the right title.
- **Watch on your TV.** Switch on _Settings › Watch on TV_ and pair a TV with a 4-digit code. The TV gets a
  remote-friendly version of your library and plays files straight from your computer over the home network. Files the
  TV can play stream as they are; for the rest (DTS audio, MKV on some TVs, old XviD rips…) Movie Monkey converts only
  what the TV can't take, on the fly, with the ffmpeg built into the app. Optionally it keeps sharing from the menu
  bar after you close the window. There's an [LG TV app](tv-apps/webos), and a demo with sample films at
  [getmoviemonkey.com/tv](https://getmoviemonkey.com/tv/).
- **Works offline.** Artwork is cached on disk after first view. Files added while offline wait quietly and are
  identified automatically once the network is back. They're never wrongly flagged for review.

## Where the data comes from

| Source                                          | Used for                                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [TMDB](https://www.themoviedb.org)              | Search, details, cast with photos, age ratings, posters, backdrops, title logos, trailers, episode guides |
| [TVMaze](https://www.tvmaze.com/api) (CC BY-SA) | Fallback search and episode guides for shows                                                              |

Users don't need an account or a key: the app ships with a TMDB API token (free for non-commercial use, credited in
Settings › About). Shows marked with a country (`The.Office.UK`) are resolved by their country of origin, and
foreign or romaji titles (`Sousou no Frieren`) via TMDB's alternative titles. Library titles keep their IMDb ids,
so watched state survives a metadata refresh. Metadata and cached artwork are refreshed after 5 months (TMDB allows
caching for 6). A live regression suite of 52 deliberately hard file names (remakes, sequels, one-word titles,
foreign films, Radarr/Sonarr naming, anime) currently passes 52/52.

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
- **Watch on TV** (`src-tauri/src/engine/share`): a small axum web server, off unless switched on.
  - `mod.rs`: pairing (4-digit code → per-TV token), local-network-only access, settings
  - `routes.rs`: the API the TV screens use, artwork, direct file streaming with seeking
  - `media.rs`: reads a file's streams (ffprobe), decides what the TV can play, and runs ffmpeg to make HLS when it
    can't. ffmpeg is paused when it gets 4 minutes ahead and watched chunks are deleted.
  - `subs.rs`: subtitles beside or inside the video, as WebVTT
- **TV screens** (`tv.html`, `src/tv`): the same React stack, sized in rem so it looks the same on any TV, with
  spatial navigation for remotes. Served by the app itself, so updating Movie Monkey updates the TV.
- **UI**: React 19, TypeScript, Tailwind CSS 4, Motion, cmdk, zustand. Vite 8.

The engine has no Tauri dependency on purpose. A future mobile companion (watchlists, "what should I watch") can reuse
it, either through Tauri's iOS/Android targets or behind a small sync server.

## Run it

Prerequisites: Node 20+, Rust (via [rustup](https://rustup.rs)), Xcode Command Line Tools on macOS, and a free
TMDB API token: create an account at [themoviedb.org](https://www.themoviedb.org/settings/api), copy the
"API Read Access Token", and put it in `src-tauri/.env` (git-ignored):

```bash
echo "TMDB_API_TOKEN=<your token>" > src-tauri/.env
```

The build compiles it into the app (`src-tauri/build.rs`). In CI, set `TMDB_API_TOKEN` as a repository secret instead.
Without a token the app still runs, but only shows can be identified (via TVMaze).

```bash
npm install
npm run dev                      # launches the app with hot reload
```

Don't have a movie folder handy? Generate a demo library of realistic, messy release names. The files are _sparse_,
so they report multi-GB sizes but take ~0 bytes on disk:

```bash
npm run demo                     # creates ./demo-library
npx tauri dev -- -- "$PWD/demo-library"   # opens with it added (or drag the folder onto the window)
```

Other scripts:

```bash
npm test                         # Vitest (UI logic) + cargo test (parser, matcher, db, cache, perf guard)
npm run test:live                # live identification suite against TMDB/TVMaze (52 hard cases)
npm run lint                     # tsc + prettier --check + clippy -D warnings
npm run format                   # prettier + rustfmt
npm run build                    # release .app + .dmg in src-tauri/target/release/bundle
npm run preview:web              # UI in a plain browser with real fixture data (no Rust needed)
                                 #   ?empty replays onboarding + import, ?big simulates ~2,000 titles
```

Try the TV screens without a TV: `npm run vite:build`, then run the sharing server headless against its own
database and open http://localhost:46766 in a browser (arrow keys, Enter and Esc stand in for the remote). It prints
the pairing code.

```bash
cd src-tauri && cargo run --example share -- --db /tmp/mm-tv.sqlite --folder ~/Movies
```

Headless engine run (great for tuning the matcher):

```bash
cd src-tauri && cargo run --example scan -- ../demo-library
```

App icon: `npm run icon` renders it from `src/assets/monkey.svg` and regenerates every size. Try a variant first with
`node scripts/make-icon.mjs --preview out.png --width 600`.

## Releasing (macOS)

A Mac app that people download has to be signed with a Developer ID certificate and notarized by Apple. Otherwise
macOS refuses to open it.

One-time setup:

1. **Developer ID Application certificate.** Only the Account Holder of the Apple developer team can create one.
   - Easiest, in Xcode: Settings → Accounts → your team → Manage Certificates → **+** → Developer ID Application.
   - Or at [developer.apple.com](https://developer.apple.com/account/resources/certificates/list): Certificates →
     **+** → Developer ID Application. It asks for a certificate signing request. Make one in Keychain Access →
     Certificate Assistant → Request a Certificate From a Certificate Authority → "Saved to disk", on the Mac you'll
     build on (its private key stays in that Mac's keychain). Upload it, download the `.cer`, and double-click it to
     install.
   - Check that it's installed: `security find-identity -v -p codesigning` lists "Developer ID Application: …".
2. **App Store Connect API key** for notarization:
   [App Store Connect](https://appstoreconnect.apple.com/access/integrations/api) → Users and Access → Integrations →
   Team Keys → **+**, with Developer access. Download the `.p8` file (you can only do this once), keep it outside the
   repo, and note the Key ID and the Issuer ID.
3. Add them to `src-tauri/.env` (git-ignored), next to the TMDB token:

   ```bash
   APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
   APPLE_API_ISSUER=<issuer id>
   APPLE_API_KEY=<key id>
   APPLE_API_KEY_PATH=/Users/<you>/keys/AuthKey_<key id>.p8
   ```

4. To support Intel Macs as well as Apple Silicon: `rustup target add x86_64-apple-darwin`.

Each release: bump `version` in `src-tauri/tauri.conf.json`, then

```bash
npm run release:mac
```

This builds ffmpeg for the app the first time (`npm run build:ffmpeg`, about 10 minutes, cached after that), then
the app (universal if the Intel target is installed), signs it, and has Apple notarize both the app and the `.dmg`. It then runs the same checks Gatekeeper will on someone else's Mac, and prints the path of the `.dmg` to
upload. Notarization usually takes a few minutes. The app needs macOS 13 or later.

## Keyboard

|          |                                      |
| -------- | ------------------------------------ |
| ⌘K / ⌘F  | Search everything                    |
| ⌘O       | Add folder                           |
| ⌘1–4     | Home · Movies · TV Shows · Watchlist |
| ⌘,       | Settings                             |
| Esc / ⌘[ | Back                                 |

## Where things live

- Library database: `~/Library/Application Support/com.getmoviemonkey.app/library.sqlite`
- Artwork cache: `~/Library/Caches/com.getmoviemonkey.app/images` (clear it from Settings)

Movie Monkey never modifies, moves or renames your media files.

## Performance

A synthetic 2,000-title / 5,000-file library builds its full UI snapshot in ~50 ms (`tests/large_library.rs`).
Grids render the first screenful immediately and stream in the rest, and the ⌘K palette ranks and caps results,
so both stay responsive at that size.

## History

Movie Monkey v1 (2017) was an Electron + React 15 app using OMDb, TMDB and OpenSubtitles. v2 is a ground-up rewrite;
the old code is preserved on the `v1-electron` branch.

## License

CC0-1.0
