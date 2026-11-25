// Title-level actions shared by the grid, context menu, detail view and palette.
import { api } from './api';
import { useStore } from './store';
import type { TitleDetail, TitleSummary } from './types';
import { epCode } from './format';

const toast = (t: string, tone?: 'default' | 'success' | 'error') => useStore.getState().toast(t, tone);

/** Pick what "Play" means for a title: the movie file, or the next unwatched episode. */
export function playTarget(d: TitleDetail): { path: string; label: string } | null {
  if (d.summary.kind === 'movie') {
    const best = [...d.files].sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality))[0];
    return best ? { path: best.path, label: 'Play' } : null;
  }
  const eps = d.seasons
    .filter((s) => s.number !== 0)
    .flatMap((s) => s.episodes)
    .filter((e) => e.file);
  if (!eps.length) return null;
  const lastPlayed = [...eps].filter((e) => e.lastPlayedAt).sort((a, b) => b.lastPlayedAt! - a.lastPlayedAt!)[0];
  let next = eps.find((e) => !e.watched);
  if (lastPlayed && !lastPlayed.watched) next = lastPlayed;
  next ??= eps[0];
  const started = eps.some((e) => e.watched || e.lastPlayedAt);
  return {
    path: next.file!.path,
    label: `${started ? 'Continue' : 'Play'} ${epCode(next.season, next.episode).replace('S0', 'S').replace('E0', 'E')}`,
  };
}

export function qualityRank(q: string | null): number {
  return { '4K': 5, '1080p': 4, '720p': 3, '576p': 2, '480p': 1 }[q ?? ''] ?? 0;
}

export async function playPath(path: string, name?: string) {
  try {
    await api.play(path);
    toast(name ? `Opening ${name}` : 'Opening in your default player', 'success');
  } catch (e) {
    toast(`Couldn't open the file. Is the drive connected? (${e})`, 'error');
  }
}

export async function playTitle(t: TitleSummary) {
  const d = await api.getTitle(t.id);
  const target = d && playTarget(d);
  if (!target) return toast('No playable file found', 'error');
  await playPath(target.path, t.name);
}

export async function revealTitle(t: TitleSummary) {
  const d = await api.getTitle(t.id);
  const f = d?.files[0];
  if (f) await api.reveal(f.path);
}

export function toggleWatched(t: TitleSummary) {
  void useStore.getState().updateTitleState(t.id, { watched: !t.watched });
  toast(t.watched ? `Marked “${t.name}” as unwatched` : `Marked “${t.name}” as watched`);
}

export function toggleWatchlist(t: TitleSummary) {
  void useStore.getState().updateTitleState(t.id, { watchlist: !t.watchlist });
  toast(t.watchlist ? 'Removed from Watchlist' : 'Added to Watchlist');
}

export function toggleFavorite(t: TitleSummary) {
  void useStore.getState().updateTitleState(t.id, { favorite: !t.favorite });
}

export async function fixMatch(t: TitleSummary) {
  const d = await api.getTitle(t.id);
  if (!d) return;
  useStore.getState().setFixTarget({
    paths: d.files.map((f) => f.path),
    query: t.name,
    kind: t.kind,
    label: d.files.length === 1 ? d.files[0].fileName : `${d.files.length} files`,
  });
}

export function imdbUrl(id: string) {
  return `https://www.imdb.com/title/${id}/`;
}
