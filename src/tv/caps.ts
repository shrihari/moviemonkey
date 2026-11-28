// What this TV (or browser) can play, so Movie Monkey only converts what it
// has to. Mirrors `Caps` in src-tauri/src/engine/share/media.rs.

export interface Caps {
  containers: string[];
  video: string[];
  audio: string[];
  hdr: string[];
  nativeHls: boolean;
  maxHeight: number;
}

let cached: Caps | null = null;

export function detectCaps(): Caps {
  if (cached) return cached;
  const v = document.createElement('video');
  const ms = (window as unknown as { MediaSource?: { isTypeSupported(t: string): boolean } }).MediaSource;
  const can = (type: string) => {
    try {
      if (v.canPlayType(type) !== '') return true;
    } catch {
      /* some TVs throw on unknown types */
    }
    try {
      return ms?.isTypeSupported(type) ?? false;
    } catch {
      return false;
    }
  };
  const any = (...types: string[]) => types.some(can);

  const video: string[] = [];
  if (any('video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="avc1.4d401f"')) video.push('h264');
  if (any('video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"')) video.push('hevc');
  if (any('video/mp4; codecs="hvc1.2.4.L153.B0"', 'video/mp4; codecs="hev1.2.4.L153.B0"')) video.push('hevc10');
  if (any('video/mp4; codecs="av01.0.08M.08"', 'video/webm; codecs="av01.0.08M.08"')) video.push('av1');
  if (any('video/webm; codecs="vp9"', 'video/mp4; codecs="vp09.00.40.08"')) video.push('vp9');

  const audio: string[] = [];
  if (any('audio/mp4; codecs="mp4a.40.2"')) audio.push('aac');
  if (any('audio/mpeg', 'audio/mp4; codecs="mp4a.6B"')) audio.push('mp3');
  if (any('audio/mp4; codecs="ac-3"', 'audio/ac3')) audio.push('ac3');
  if (any('audio/mp4; codecs="ec-3"', 'audio/eac3')) audio.push('eac3');
  if (any('audio/webm; codecs="opus"', 'audio/mp4; codecs="opus"')) audio.push('opus');
  if (any('audio/mp4; codecs="flac"', 'audio/flac')) audio.push('flac');
  if (any('audio/mp4; codecs="dtsc"', 'audio/vnd.dts', 'audio/mp4; codecs="dtse"')) audio.push('dts');
  if (any('audio/mp4; codecs="mlpa"')) audio.push('truehd');

  const containers = ['mp4'];
  if (any('video/webm', 'video/webm; codecs="vp9"')) containers.push('webm');
  if (any('video/x-matroska', 'video/mkv', 'video/x-matroska; codecs="avc1.640028"')) containers.push('mkv');
  if (any('video/mp2t')) containers.push('ts');

  const hdr: string[] = [];
  const hdrScreen = window.matchMedia?.('(dynamic-range: high)').matches || /Web0S|Tizen/i.test(navigator.userAgent);
  if (hdrScreen && video.includes('hevc10')) hdr.push('hdr10', 'hlg');
  if (any('video/mp4; codecs="dvh1.05.06"', 'video/mp4; codecs="dvhe.05.06"')) hdr.push('dv');

  cached = {
    containers,
    video,
    audio,
    hdr,
    nativeHls: any('application/vnd.apple.mpegurl', 'application/x-mpegURL'),
    maxHeight: 2160,
  };
  return cached;
}

/** After the TV failed to play something it claimed it could: the safest set. */
export function basicCaps(): Caps {
  const c = detectCaps();
  return { ...c, containers: ['mp4'], video: ['h264'], audio: ['aac'], hdr: [] };
}
