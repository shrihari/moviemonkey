# Movie Monkey in the LG Content Store

Everything needed to submit the LG TV app in [LG Seller Lounge](https://seller.lgappstv.com). Where LG's rules come
from (with links): `research_notes/LG Content Store submission/notes.md` in the local checkout (not committed).

| File                                      | What it is                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `com.getmoviemonkey.tv_1.0.0_all.ipk`     | The app (built from `tv-apps/webos` with `ares-package`; git-ignored, rebuild with the command below) |
| `app-icon-400.png`                        | Store icon: square, opaque, gold `#FFCB3D` (LG rejects rounded or transparent icons)                  |
| `screenshots/1-home.png` … `5-movies.png` | 1920x1080, the sample films (Blender Foundation, Creative Commons)                                    |
| `self-checklist-5.0-movie-monkey.xlsx`    | LG's self-evaluation checklist v5.0, filled in: **review before uploading**                           |

Rebuild the package: `ares-package tv-apps/webos -o store/lg`.

## 1. Before submitting

- **Release Movie Monkey for Mac with Watch on TV first** (or ask LG for a publish date after it, in the tester note).
  People who install the TV app need it. The sample films work without it.
- getmoviemonkey.com/tv/ (sample films) and getmoviemonkey.com/privacy must stay online through review.

## 2. Seller Lounge, step by step

**Register** at seller.lgappstv.com: LG account, Seller type **Individual**, verify your email. Free, no documents.

**Create the app**

- App ID: `com.getmoviemonkey.tv` (can't change after submitting)
- Upload: `com.getmoviemonkey.tv_1.0.0_all.ipk`, chipset **web › All**
- SDK version (oldest TVs): **6.0.0** (2021 and later, Chrome 79). Older TVs aren't supported by the build.

**Images**

- App icon: `app-icon-400.png` · Tile color: `#FFCB3D`
- Screenshots: the five in `screenshots/`, in order (the first is shown on the Apps main screen)
- Splash: already in the package (`tv-apps/webos/splash.png`)

**Service info**

- Title: `Movie Monkey`
- Category: **Entertainment** · Age rating: **All**
- Language: **English** · Countries: your choice (selecting the UK makes the privacy fields mandatory; fill them anyway)
- Support e-mail: `gfxindia@gmail.com` · Website: `https://getmoviemonkey.com`
- Privacy policy: `https://getmoviemonkey.com/privacy`
- Keywords: movies, TV shows, media player, home network, Mac, library

**Short description**

> Watch the movies and shows on your Mac on your TV.

**Description**

> Movie Monkey plays the movies and TV shows on your computer on your TV.
>
> Install the free Movie Monkey app on your Mac (getmoviemonkey.com) and switch on Watch on TV. This app finds it on
> your home network and shows your whole library, made for the remote: posters, seasons and episodes, and where you
> left off.
>
> Videos stream straight from your computer over your home network. No account, no media server to set up, and
> nothing is sent anywhere else. Files your TV can play stream as they are; Movie Monkey converts the rest as you
> watch.
>
> Don't have Movie Monkey yet? Choose "Try with sample films" to see it with four free films from the Blender
> Foundation.
>
> Requires Movie Monkey for Mac (free) on the same network.

**Data safety**

- Data collected: **none**
- Device identifiers / IP address: not collected. The app reads the TV's own address on the home network only to
  look for Movie Monkey on that network; nothing is stored or sent elsewhere.
- Content viewing information: not collected. Watched marks and resume points stay on the user's computer (or on the
  TV for the sample films).
- Microphone, camera, USB: not used · Shared with third parties: nothing
- Contact: `gfxindia@gmail.com` · Policy: `https://getmoviemonkey.com/privacy`

**Note for testers** (tick "test account / test information" and paste):

> Movie Monkey for LG plays videos from the free Movie Monkey app on the user's own computer, over the home network.
> On a network without it, the app shows "Can't find Movie Monkey".
>
> To test without a computer, choose **Try with sample films** on that screen. It opens the same TV screens with four
> Blender Foundation films (Creative Commons), streamed from archive.org: home rows, the Movies tab, a film's page,
> the player (play/pause, seek, back 10 s, forward 30 s), resume, and the About screen all work exactly as with a
> computer. The films are H.264/AAC at 1.3–2.7 Mbps without adaptive bitrate, so they buffer on connections slower
> than that.
>
> Privacy policy in the app: the **Privacy** button on the "Can't find Movie Monkey" screen, and **About** (the
> button at the top right of the home screen).
>
> To find the user's computer, the app checks the addresses on the TV's own network on port 46766. Nothing leaves the
> home network.

**UX scenario**: LG's template (`ux_scenario_document_4.3.ppt`, from the QA documents zip) asks for each screen and
what the keys do. The content:

1. **Launch** → "Looking for Movie Monkey…" (searches the home network, a few seconds).
   - Found one computer → its **Home**. Found several → "Which computer?" with a button each.
   - Found none → **Can't find Movie Monkey**: address field + Connect, Look again, Try with sample films, Privacy.
     BACK: leaves the app (TV Home). Privacy page: BACK or the Back button returns.
2. **Pairing** (first time with a computer): enter the 4-digit code shown on the computer, with the number keys or
   the on-screen keypad. BACK deletes a digit.
3. **Home**: top bar (logo, Home / Movies / TV Shows, and the computer's name, which opens About); a featured title
   (Play/Resume, More info); rows: Continue watching, Recently added, Movies, TV shows. OK opens a title. BACK on
   Movies/TV Shows returns to Home; on Home it leaves the app.
4. **Title page**: Play/Resume, From the start, Mark watched, Watchlist; for shows, seasons and episodes. BACK →
   previous screen.
5. **Player**: OK/PLAY/PAUSE toggle play; left/right seek 10 s; FF +30 s, REW −30 s; up/down show the controls
   (play/pause, back 10, forward 30, subtitles, audio, next episode). BACK hides the controls, then leaves the
   player; STOP leaves it. Both keep the position. HOME pauses and saves the position.
6. **About**: privacy policy, credits, Back button.

**Self-check list**: upload `self-checklist-5.0-movie-monkey.xlsx`. Every item is Pass or NA with a comment. Please
check these, which I could only judge, not test:

- **#14 Abnormal end:** tested on Wi-Fi with DHCP only, not wired or a static IP.
- **#43 Play contents at 512 Kbps–17.5 Mbps:** the sample films buffer below their bitrate (1.3–2.7 Mbps). This is
  the riskiest item.
- **#15–17 Virtual keyboard:** not yet tried with LG's keyboard on the TV.

Then agree to the seller agreement and **Submit**. Review takes 2–3 weeks; answer defect reports in Applications ›
Defect Info, raise the version (`tv-apps/webos/appinfo.json`), rebuild and resubmit. Five failed function tests in a
row lock submissions for 3 months.
