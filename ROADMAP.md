# Roadmap

A rolling list of what's next for Movie Monkey. Add ideas anywhere. When an item ships, move it to **Done** with the
date.

## Watch on TV

The first version works from a TV's web browser (any TV) and a desktop browser. Next:

- [ ] **Bundle ffmpeg** (a trimmed LGPL build, hardware encoders only) so converting works without installing it.
- [ ] **LG webOS app**: a small app that finds Movie Monkey on the network (scan the TV's subnet for port 46766) and
      opens the TV screens. Needs an LG developer account and Developer Mode on the TV to install; LG Content Store
      review later.
- [ ] **Test on real TVs**: LG first. Check what `canPlayType` really reports on webOS (MKV, DTS, Dolby Vision),
      native HLS with HEVC, and the remote's Back key.
- [ ] **Android TV / Google TV app** with its own player (ExoPlayer or libVLC), so it can play almost anything without
      converting. Discovery over Bonjour (`_moviemonkey._tcp`).
- [ ] **Picture subtitles** (Blu-ray PGS, DVD): burn them into the converted video when chosen.
- [ ] **HDR to SDR tone mapping** when converting HDR video for a TV that can't show it (needs zscale/libplacebo).
- [ ] **Resume positions on the computer**: show the TV's positions in Continue watching, and play from there.
- [ ] **Search** on the TV.

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
- [ ] **Local subtitles.** Detect `.srt`/`.ass` files next to videos and show the languages on the detail page.
- [ ] **Check drag-and-drop from Finder** in the built app (not yet tested end to end).

## Before public release

These block offering a download, not day-to-day use.

- [ ] **Signed, notarized Mac download.** `npm run release:mac` is ready (README, Releasing); it needs a Developer
      ID Application certificate and an App Store Connect API key in `src-tauri/.env`. Then host the `.dmg` (GitHub
      Releases) and link it from the website.
- [ ] **Auto-update** with the Tauri updater plugin and signed releases on GitHub Releases.
- [ ] **Windows and Linux builds:** test them, use Mica instead of vibrancy on Windows, and fix anything
      macOS-specific.

## Later

- [ ] **Ratings from Rotten Tomatoes and Metacritic** via OMDb (free key, 1,000 requests per day). This was on the v1
      roadmap.
- [ ] **HD logos and clear art** from fanart.tv (free personal key).
- [ ] **Collections, person pages, recommendations, "where to stream"** (TMDB; streaming data must credit
      JustWatch).
- [ ] **IMDb ratings** alongside TMDB's score, from IMDb's official ratings dataset (free for non-commercial use,
      updated daily).
- [ ] **"Use your own TMDB key"** field in Settings, in case the shared key is ever rate-limited.
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
  - Switched to TMDB as the main metadata source (52/52 on the live suite). Dropped the IMDb suggestion
    endpoint, Cinemeta and metahub. Adds cast photos, age ratings, original release years, TMDB/TVMaze credits,
    and a 5-month refresh of metadata and artwork. Existing libraries migrate on first launch.
  - TMDB's official logo and required notice in Settings › About.
  - New app icon: full-bleed gold with a larger monkey (`npm run icon` regenerates every size).
  - Mac release script and bundle settings (hardened runtime, macOS 13+, DMG layout).
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
