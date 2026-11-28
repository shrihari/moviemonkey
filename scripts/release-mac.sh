#!/usr/bin/env bash
# Builds a signed, notarized Movie Monkey .dmg for macOS, ready to upload.
#
#   npm run release:mac
#
# Reads these from the git-ignored src-tauri/.env (or the environment):
#   TMDB_API_TOKEN          compiled into the app
#   APPLE_SIGNING_IDENTITY  "Developer ID Application: Your Name (TEAMID)"
#   APPLE_API_ISSUER        App Store Connect API key: Issuer ID
#   APPLE_API_KEY           App Store Connect API key: Key ID
#   APPLE_API_KEY_PATH      full path to the AuthKey_<KeyID>.p8 file (keep it outside the repo)
#
# Builds for both Intel and Apple Silicon when the x86_64 Rust target is
# installed (rustup target add x86_64-apple-darwin), otherwise Apple Silicon only.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

if [ -f src-tauri/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . src-tauri/.env
  set +a
fi

missing=()
for v in TMDB_API_TOKEN APPLE_SIGNING_IDENTITY APPLE_API_ISSUER APPLE_API_KEY APPLE_API_KEY_PATH; do
  [ -n "${!v:-}" ] || missing+=("$v")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing: ${missing[*]}. Add them to src-tauri/.env (see README, Releasing)." >&2
  exit 1
fi
case "$APPLE_SIGNING_IDENTITY" in
  "Developer ID Application:"*) ;;
  *)
    echo "APPLE_SIGNING_IDENTITY must be a \"Developer ID Application: …\" certificate." >&2
    exit 1
    ;;
esac
if ! security find-identity -v -p codesigning | grep -qF "$APPLE_SIGNING_IDENTITY"; then
  echo "That certificate isn't in your keychain: $APPLE_SIGNING_IDENTITY" >&2
  exit 1
fi
if [ ! -f "$APPLE_API_KEY_PATH" ]; then
  echo "API key file not found: $APPLE_API_KEY_PATH" >&2
  exit 1
fi

if rustup target list --installed | grep -q '^x86_64-apple-darwin$'; then
  target=universal-apple-darwin
else
  target=aarch64-apple-darwin
  echo "note: building for Apple Silicon only (run: rustup target add x86_64-apple-darwin for Intel Macs too)"
fi

# ffmpeg and ffprobe for Watch on TV, built from source (cached after the
# first time; see scripts/build-ffmpeg.sh).
bash scripts/build-ffmpeg.sh

# Tauri signs the app (and ffmpeg inside it) with the hardened runtime,
# notarizes it and staples the ticket, then wraps it in a disk image.
npx tauri build --target "$target" --bundles app,dmg --config src-tauri/tauri.ffmpeg.conf.json

bundle="src-tauri/target/$target/release/bundle"
app="$bundle/macos/Movie Monkey.app"
dmg=$(ls -t "$bundle"/dmg/*.dmg | head -1)

# Sign, notarize and staple the disk image too, so it opens cleanly even offline.
codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$dmg"
result=$(xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" \
  --issuer "$APPLE_API_ISSUER" --wait 2>&1) || true
echo "$result"
if ! grep -q "status: Accepted" <<<"$result"; then
  echo "Notarization of the disk image failed; see the log above (xcrun notarytool log <id> …)." >&2
  exit 1
fi
xcrun stapler staple "$dmg"

# Check it the way Gatekeeper will on someone else's Mac.
codesign --verify --deep --strict "$app"
spctl --assess --type execute "$app"
spctl --assess --type open --context context:primary-signature "$dmg"
xcrun stapler validate "$dmg"

echo
echo "Ready to upload: $dmg"
