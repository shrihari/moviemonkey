import { isTauri } from './api';

const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
const base = isWindows ? 'http://mm.localhost/img' : 'mm://localhost/img';

/**
 * Artwork URL. Inside the app, images go through the `mm://` protocol, which
 * caches them on disk (so the library works offline). In a plain browser the
 * remote URL is used directly.
 */
export function img(url: string | null | undefined, fallback?: string | null): string | undefined {
  if (!url && !fallback) return undefined;
  const primary = url || fallback!;
  if (!isTauri) return primary;
  const q = new URLSearchParams({ u: primary });
  if (fallback && fallback !== primary) q.set('f', fallback);
  return `${base}?${q.toString()}`;
}
