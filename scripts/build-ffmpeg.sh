#!/usr/bin/env bash
# Builds the ffmpeg and ffprobe that ship inside Movie Monkey for macOS.
#
#   npm run build:ffmpeg
#
# Watch on TV uses them to repackage and convert videos for TVs. Building our
# own keeps the app self-contained and the licence simple: this is an LGPL
# build (no --enable-gpl, nothing non-free) that links only to macOS itself,
# so it runs on any Mac with macOS 13 or later.
#
# Writes src-tauri/binaries/{ffmpeg,ffprobe}-{aarch64,x86_64,universal}-apple-darwin
# (git-ignored), which `tauri build --config src-tauri/tauri.ffmpeg.conf.json`
# puts next to the app's executable. Sources and builds are cached in
# ~/Library/Caches/moviemonkey-ffmpeg; delete it to start over.
set -euo pipefail
cd "$(dirname "$0")/.."

FFMPEG_VERSION=9.1
FFMPEG_SHA256=1a4d394ae63d190a526cd052eb4415c156b5c5e2df37efab41a7de0b8fde2433
# Only needed to build the Intel half with ffmpeg's hand-written assembly.
NASM_VERSION=3.02
NASM_SHA256=87336eba53b4acfe917424ab5d500d2b0054d9f5148d35c2273ccf2cfb712f0d
MACOS_MIN=13.0

cache="${MM_FFMPEG_CACHE:-$HOME/Library/Caches/moviemonkey-ffmpeg}"
out="src-tauri/binaries"
jobs=$(sysctl -n hw.ncpu)
mkdir -p "$cache/downloads" "$out"

fetch() { # url sha256
  local file="$cache/downloads/$(basename "$1")"
  [ -f "$file" ] || curl -fL --retry 3 -o "$file.part" "$1" && { [ -f "$file" ] || mv "$file.part" "$file"; }
  local got
  got=$(shasum -a 256 "$file" | cut -d' ' -f1)
  if [ "$got" != "$2" ]; then
    echo "Checksum mismatch for $file: $got" >&2
    exit 1
  fi
  echo "$file"
}

unpack() { # tarball dir
  rm -rf "$2"
  mkdir -p "$2"
  tar -xJf "$1" -C "$2" --strip-components 1
}

# ------------------------------------------------------------------ nasm

nasm="$cache/nasm-$NASM_VERSION/bin/nasm"
if [ ! -x "$nasm" ]; then
  src=$(fetch "https://www.nasm.us/pub/nasm/releasebuilds/$NASM_VERSION/nasm-$NASM_VERSION.tar.xz" "$NASM_SHA256")
  unpack "$src" "$cache/nasm-src"
  (cd "$cache/nasm-src" && ./configure --prefix="$cache/nasm-$NASM_VERSION" >/dev/null && make -j"$jobs" >/dev/null && make install >/dev/null)
fi

# ------------------------------------------------------------------ ffmpeg

src=$(fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" "$FFMPEG_SHA256")

# What Movie Monkey asks of it: read what turns up in movie folders, copy
# streams into HLS (fMP4 segments), convert video with the Mac's hardware
# encoder and audio to AAC/AC-3/E-AC-3, scale down, and turn text subtitles
# into WebVTT. Every container is kept; decoders are the formats films and
# shows actually come in (all of them would triple the size).
video_decoders=h264,hevc,av1,vp8,vp9,mpeg1video,mpeg2video,mpeg4,msmpeg4v1,msmpeg4v2,msmpeg4v3,h263,h263p,flv,wmv1,wmv2,wmv3,vc1,mjpeg,png,theora,prores,dnxhd,rv30,rv40,vp6,vp6f
audio_decoders=aac,aac_latm,ac3,eac3,dca,truehd,mlp,mp1,mp1float,mp2,mp2float,mp3,mp3float,flac,opus,vorbis,alac,wmav1,wmav2,wmapro,cook,amrnb,amrwb,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_f32le,pcm_u8,pcm_bluray,pcm_dvd,pcm_alaw,pcm_mulaw,adpcm_ms,adpcm_ima_wav
subtitle_decoders=subrip,srt,ass,ssa,webvtt,mov_text,text,microdvd,subviewer,sami,dvdsub,dvbsub,pgssub
components=(
  --disable-decoders
  --enable-decoder=$video_decoders,$audio_decoders,$subtitle_decoders
  --disable-encoders
  --enable-encoder=aac,ac3,eac3,webvtt,h264_videotoolbox,hevc_videotoolbox
  --disable-muxers
  --enable-muxer=hls,mp4,mov,ipod,mpegts,webvtt,null
  --disable-filters
  --enable-filter=buffer,buffersink,abuffer,abuffersink,null,anull,copy,acopy,format,aformat,scale,aresample,setpts,asetpts,fps,trim,atrim,pad,crop,split,asplit,volume,pan,setsar,setdar
  --disable-protocols
  --enable-protocol=file,pipe
)

build() { # arch
  local arch=$1
  local dir="$cache/build-$arch" prefix="$cache/ffmpeg-$FFMPEG_VERSION-$arch"
  if [ -x "$prefix/bin/ffmpeg" ] && [ -x "$prefix/bin/ffprobe" ]; then
    return
  fi
  unpack "$src" "$dir"
  local asm=()
  if [ "$arch" = x86_64 ]; then
    asm=(--x86asmexe="$nasm")
  fi
  (
    cd "$dir"
    ./configure \
      --prefix="$prefix" \
      --arch="$arch" \
      --target-os=darwin \
      --enable-cross-compile \
      --cc="clang -arch $arch" \
      --extra-cflags="-mmacosx-version-min=$MACOS_MIN" \
      --extra-ldflags="-mmacosx-version-min=$MACOS_MIN" \
      --extra-libs=-liconv \
      --disable-autodetect \
      --enable-videotoolbox --enable-audiotoolbox \
      --enable-zlib --enable-bzlib --enable-iconv \
      --enable-static --disable-shared \
      --disable-network --disable-avdevice --disable-ffplay --disable-doc --disable-debug \
      ${asm[@]+"${asm[@]}"} \
      "${components[@]}" >"$cache/configure-$arch.log"
    make -j"$jobs" >"$cache/make-$arch.log" 2>&1
    make install >/dev/null
  )
}

build arm64
build x86_64

for tool in ffmpeg ffprobe; do
  arm="$cache/ffmpeg-$FFMPEG_VERSION-arm64/bin/$tool"
  intel="$cache/ffmpeg-$FFMPEG_VERSION-x86_64/bin/$tool"
  cp "$arm" "$out/$tool-aarch64-apple-darwin"
  cp "$intel" "$out/$tool-x86_64-apple-darwin"
  lipo -create "$arm" "$intel" -output "$out/$tool-universal-apple-darwin"
  strip -x "$out/$tool"-*-apple-darwin
done

# They must link to nothing but macOS itself.
if otool -L "$out"/ff*-universal-apple-darwin | grep -E '^\s' | grep -vE '^\s*(/usr/lib/|/System/Library/)'; then
  echo "ffmpeg links to something outside macOS (above)." >&2
  exit 1
fi

echo "ffmpeg $FFMPEG_VERSION (LGPL) for macOS $MACOS_MIN+:"
ls -lh "$out"
