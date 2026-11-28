// Talking to Movie Monkey on the computer. When the TV screens are served by
// Movie Monkey itself, the API is on the same address. During development
// (Vite on :1420) or from a TV app shell, `?server=http://…:46766` says where.

import type { EpisodeView, SeasonView, StatePatch, TitleDetail, TitleSummary } from '../lib/types';
import type { Caps } from './caps';
import { demoApi } from './demo';

/** The sample-films build on getmoviemonkey.com (see demo.ts): no computer involved. */
export const DEMO = import.meta.env.VITE_TV_DEMO === '1';

const params = new URLSearchParams(location.search);
const fromParam = params.get('server');
if (fromParam) localStorage.setItem('mm.server', fromParam);

export const base = (
  fromParam ||
  (location.port === '1420' ? `http://${location.hostname}:46766` : '') ||
  localStorage.getItem('mm.server') ||
  ''
).replace(/\/$/, '');

const tokenKey = `mm.token:${base || location.host}`;
export const token = {
  get: () => localStorage.getItem(tokenKey),
  set: (t: string) => localStorage.setItem(tokenKey, t),
  clear: () => localStorage.removeItem(tokenKey),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (init.body) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Can't reach Movie Monkey on your computer.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Error ${res.status}`);
  return data as T;
}

/** A URL the TV loads directly (video, subtitles): the token goes in the query. */
export function mediaUrl(path: string): string {
  // Somewhere else entirely (the demo's films): no token for them.
  if (/^https?:\/\//.test(path)) return path;
  const t = token.get() ?? '';
  return `${base}${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(t)}`;
}

/** Artwork through Movie Monkey's cache. `size` swaps TMDB's size, e.g. "w342". */
export function img(url: string | null | undefined, fallback?: string | null, size?: string): string | undefined {
  const pick = url || fallback;
  if (!pick) return undefined;
  const sized = (u: string) => (size ? u.replace(/\/t\/p\/w\d+\//, `/t/p/${size}/`) : u);
  if (DEMO) return sized(pick);
  const q = new URLSearchParams({ u: sized(pick) });
  if (fallback && fallback !== pick) q.set('f', sized(fallback));
  return mediaUrl(`/api/img?${q.toString()}`);
}

export interface TvFile {
  id: string;
  fileName: string;
  size: number;
  quality: string | null;
  hdr: string | null;
  audio: string | null;
  edition: string | null;
  season: number | null;
  episode: number | null;
  online: boolean;
  /** Seconds where playback stopped last time. */
  position: number | null;
  duration: number | null;
}

export type TvEpisode = Omit<EpisodeView, 'file'> & { file: TvFile | null };
export type TvSeason = Omit<SeasonView, 'episodes'> & { episodes: TvEpisode[] };
export type TvTitle = Omit<TitleDetail, 'files' | 'seasons'> & { files: TvFile[]; seasons: TvSeason[] };

export interface Track {
  index: number;
  label: string;
  codec: string;
  selected: boolean;
}

export interface SubOption {
  id: string;
  label: string;
  language: string | null;
  forced: boolean;
  default: boolean;
  url: string;
}

export interface PlayPlan {
  mode: 'direct' | 'hls' | 'unsupported';
  url: string | null;
  session: string | null;
  /** The video's clock starts at this many seconds into the film. */
  offset: number;
  duration: number | null;
  resume: number | null;
  note: string | null;
  audio: Track[];
  subtitles: SubOption[];
  error: string | null;
  fileName: string | null;
}

const serverApi = {
  info: () => call<{ app: string; name: string; version: string; paired: boolean }>('/api/info'),
  pair: (code: string, name: string) =>
    call<{ token: string; name: string }>('/api/pair', { method: 'POST', body: JSON.stringify({ code, name }) }),
  library: () => call<{ titles: TitleSummary[]; name: string }>('/api/library'),
  title: (id: string) => call<TvTitle>(`/api/title/${encodeURIComponent(id)}`),
  setState: (key: string, patch: StatePatch) =>
    call('/api/state', { method: 'POST', body: JSON.stringify({ key, patch }) }),
  play: (file: string, body: { caps: Caps; audio?: number | null; start?: number; forceHls?: boolean }) =>
    call<PlayPlan>(`/api/play/${file}`, { method: 'POST', body: JSON.stringify(body) }),
  stop: (session: string) => fetch(`${base}/api/hls/${session}/stop`, { method: 'DELETE' }).catch(() => {}),
  progress: (file: string, position: number, duration: number | null) =>
    call<{ watched: boolean }>('/api/progress', {
      method: 'POST',
      body: JSON.stringify({ file, position, duration }),
    }),
};

export const api: typeof serverApi = DEMO ? demoApi : serverApi;

/** A name for this device in Movie Monkey's list of paired TVs. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/Web0S|webOS/i.test(ua)) return 'LG TV';
  if (/Tizen/i.test(ua)) return 'Samsung TV';
  if (/Android/i.test(ua) && /TV|AFT|BRAVIA|SHIELD/i.test(ua)) return 'Android TV';
  if (/AppleTV|tvOS/i.test(ua)) return 'Apple TV';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Mac OS X/.test(ua)
    ? 'Mac'
    : /Windows/.test(ua)
      ? 'Windows'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}
