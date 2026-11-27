# Movie Monkey for LG TVs (webOS)

A small launcher. It finds Movie Monkey on the home network and opens the TV screens that Movie Monkey serves, so
the TV always shows the version that matches the app on the computer.

How it finds the computer: the last address that worked, then every address on the TV's network on port 46766
(it asks webOS for the TV's own address), then an address typed in by hand.

## Try it on your TV

1. Create a free account at [webostv.developer.lge.com](https://webostv.developer.lge.com).
2. On the TV, install **Developer Mode** from the LG Content Store, sign in with that account, switch Dev Mode on and
   restart the TV. Developer Mode switches itself off after about 50 hours unless you press _Extend_ in that app.
3. Install LG's command-line tools (`npm install -g @webos-tools/cli`) and add the TV:
   `ares-setup-device -a tv -i "host=<TV IP>" -i "port=9922" -i "username=prisoner"`, then switch on Key Server
   in the Developer Mode app and run `ares-novacom --device tv --getkey` (it asks for the passphrase shown there).
4. Package and install:

   ```bash
   ares-package tv-apps/webos
   ares-install --device tv com.getmoviemonkey.tv_0.1.0_all.ipk
   ares-launch --device tv com.getmoviemonkey.tv
   ```

Without the app, any TV's web browser works too: open the address shown in _Settings › Watch on TV_.

## Before the LG Content Store

- Go through LG's [self checklist](https://webostv.developer.lge.com/distribute/app-self-checklist).
- Icons at the sizes LG asks for, and screenshots.
- LG reviews every app; there's no published timeframe.

## Debugging on the TV

`ares-inspect --device tv --app com.getmoviemonkey.tv` opens Chrome's inspector for the app. Apps on LG's 2021 TVs
(webOS 6) run Chrome 79, older than the TV's own web browser, so test there: the build writes the TV screens for it
(see `scripts/tv-legacy-css.ts`).
