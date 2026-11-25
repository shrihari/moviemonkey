# Roadmap

A rolling list of what's next for Movie Monkey. Add ideas anywhere. When an item ships, move it to **Done** with the
date.

## Next: small, high-value

- [ ] **ID hints in folder and file names.** Exact matches that skip the search entirely. Every major library app
      supports these, and anyone organizing with Radarr/Sonarr already has them:
  - Plex: `Batman Begins (2005) {imdb-tt0372784}`, `{tmdb-272}`, `{tvdb-…}`
  - Jellyfin/Emby: `[imdbid-tt0372784]`, `[tmdbid-272]`, `[tvdbid-…]`
  - IMDb ids work with today's sources. TMDB/TVDB ids need TMDB (see _Before public release_); TVMaze can look up a
    show by its TVDB id.
- [ ] **NFO sidecars.** Read `movie.nfo`, `<video name>.nfo` and `tvshow.nfo`, as written by Kodi, Jellyfin, Radarr
      and Sonarr. Use `<uniqueid type="imdb|tmdb|tvdb">`, `<imdbid>`, or an IMDb/TMDB URL inside the file.
- [ ] **Read the video file itself** (Rust MP4/Matroska header parsing, no ffmpeg). This gives true resolution, HDR
      and runtime for the quality badges, which today come from the file name. Runtime also breaks ties between
      remakes in matching.
- [ ] **Credit TVMaze** with a visible link in About (their CC BY-SA licence asks for it).
- [ ] **Local subtitles.** Detect `.srt`/`.ass` files next to videos and show the languages on the detail page.
- [ ] **Check drag-and-drop from Finder** in the built app (not yet tested end to end).

## Before public release

These block offering a download, not day-to-day use.

- [ ] **Move to official metadata sources.** Make TMDB the main source, keep TVMaze, and drop the IMDb suggestion
      endpoint and Cinemeta/metahub. IMDb's terms forbid automated data gathering. Cinemeta is Stremio's service
      with no terms covering other apps, and its artwork is TMDB's without TMDB's licence or credit.
  - **TMDB free tier:** free for non-commercial use with no daily or monthly quota. There is a soft rate limit
    "somewhere in the 40 requests per second range"; back off on HTTP 429.
  - **TMDB conditions:**
    - Credit TMDB in About/Credits with an approved TMDB logo, less prominent than ours.
    - Include the notice: _"This product uses the TMDB API but is not endorsed or certified by TMDB."_
    - Cache data for 6 months at most.
    - Don't use the data for AI/ML training.
    - A free download with no ads or charges counts as non-commercial. Charging money or earning revenue needs a
      written commercial agreement.
  - **Gains:**
    - search that knows alternate and foreign titles
    - cast and crew photos
    - collections and franchises
    - localized titles and plots
    - age ratings and recommendations
    - "where to stream"
    - trending and discover lists
  - **API key:** ship a project key inside the app, as Jellyfin and Kodi do. Optionally let users paste their own key
    in Settings. A proxy can come later (see _Infrastructure_).
- [ ] **About / Credits screen** listing every data source with the required attributions.
- [ ] **Update the "No API keys" copy** in the README, onboarding and Settings › About once a key ships.
- [ ] **Code signing and notarization.** This needs an Apple Developer ID ($99/year); without it, macOS warns people
      on first launch.
- [ ] **Auto-update** with the Tauri updater plugin and signed releases on GitHub Releases.
- [ ] **Windows and Linux builds:** test them, use Mica instead of vibrancy on Windows, and fix anything
      macOS-specific.

## Later

- [ ] **Ratings from Rotten Tomatoes and Metacritic** via OMDb (free key, 1,000 requests per day). This was on the v1
      roadmap.
- [ ] **HD logos and clear art** from fanart.tv (free personal key).
- [ ] **Collections, cast pages with photos, recommendations** (TMDB, once it's in).
- [ ] **Better anime matching and artwork** from AniList (no key needed).
- [ ] **Subtitle downloads and hash matching via OpenSubtitles.** The API is free, but downloads are capped at
      5 a day without an account and 20 a day with a free one; VIP is paid. Make it opt-in with the user's own
      OpenSubtitles login. Still to check: whether hash _search_ (identifying a file without downloading) counts
      against the cap.
- [ ] **Real resume positions for "Continue watching".** Today it's based on played/watched flags. Options: read IINA,
      mpv and VLC "watch later" data, or embed a player (libmpv).
- [ ] **Edit metadata by hand:** title, year, and poster choice.
- [ ] **Sync watched history and watchlist** via Trakt (free key, non-commercial).
- [ ] **Mobile companion** for watchlists and "what should I watch". Needs a sync server; see below.

## Infrastructure: a key proxy, when it's worth it

A small Cloudflare Worker or Vercel function that holds the API keys, caches responses for everyone, rate-limits, and
lets us change providers without shipping an app update. Hobby usage fits the free tiers. It's not needed while one
built-in key does the job; build it when the mobile companion needs a sync server anyway, or when usage outgrows a
shared key.

## Done

- **2026-11-25**
  - Sidebar: removed the small logo; every genre has its own icon.
  - Sidebar matches the window frame (both use the native macOS material).
  - Search, filter and sort moved to a toolbar at the top right of the main pane.
  - Poster hover animates smoothly and is no longer clipped.
  - v2: a ground-up rewrite on Tauri 2 + React.
  - Live matching suite with 52 hard file names, all passing.
  - Offline-safe identification.
  - A 2,000-title library stays fast.
  - The old app is kept on the `v1-electron` branch.

## Sources

- TMDB [API terms of use](https://www.themoviedb.org/api-terms-of-use),
  [FAQ](https://developer.themoviedb.org/docs/faq), [rate limiting](https://developer.themoviedb.org/docs/rate-limiting)
- [IMDb Conditions of Use](https://m.imdb.com/conditions)
- [TVMaze API and licence](https://www.tvmaze.com/api)
- [OpenSubtitles: about the API](https://opensubtitles.tawk.help/article/about-the-api)
- Naming guides: [Plex](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/),
  [Jellyfin](https://jellyfin.org/docs/general/server/media/movies)
