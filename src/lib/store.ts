import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from './api';
import type { LibrarySnapshot, Progress, StatePatch, TitleKind, TitleSummary } from './types';

export type Route =
  | { name: 'home' }
  | { name: 'movies' }
  | { name: 'shows' }
  | { name: 'watchlist' }
  | { name: 'favorites' }
  | { name: 'unwatched' }
  | { name: 'genre'; genre: string }
  | { name: 'review' }
  | { name: 'settings' };

export type SortKey = 'added' | 'title' | 'year' | 'rating' | 'runtime' | 'size';
export type Filter = 'all' | 'unwatched' | 'watched';
export type Theme = 'system' | 'light' | 'dark';

export interface FixTarget {
  paths: string[];
  query: string;
  kind: TitleKind | null;
  label: string;
}

interface Prefs {
  posterSize: number;
  sort: SortKey;
  sortDesc: boolean;
  filter: Filter;
  theme: Theme;
  sidebarCollapsed: boolean;
}

interface Toast {
  id: number;
  text: string;
  tone?: 'default' | 'success' | 'error';
}

interface State extends Prefs {
  snapshot: LibrarySnapshot | null;
  progress: Progress;
  route: Route;
  openTitleId: string | null;
  titleStack: string[];
  paletteOpen: boolean;
  paletteQuery: string;
  fixTarget: FixTarget | null;
  dragging: boolean;
  toasts: Toast[];
  detailVersion: number;

  refresh(): Promise<void>;
  navigate(route: Route): void;
  openTitle(id: string): void;
  closeTitle(): void;
  setPrefs(p: Partial<Prefs>): void;
  setPalette(open: boolean, query?: string): void;
  setFixTarget(t: FixTarget | null): void;
  setDragging(d: boolean): void;
  setProgress(p: Progress): void;
  toast(text: string, tone?: Toast['tone']): void;
  updateTitleState(key: string, patch: StatePatch): Promise<void>;
  addFolders(paths?: string[]): Promise<void>;
}

const idle: Progress = {
  active: false,
  phase: 'idle',
  done: 0,
  total: 0,
  current: null,
  found: 0,
  matched: 0,
  failed: 0,
  deferred: 0,
};

let toastId = 0;

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      posterSize: 168,
      sort: 'added',
      sortDesc: true,
      filter: 'all',
      theme: 'system',
      sidebarCollapsed: false,

      snapshot: null,
      progress: idle,
      route: { name: 'home' },
      openTitleId: null,
      titleStack: [],
      paletteOpen: false,
      paletteQuery: '',
      fixTarget: null,
      dragging: false,
      toasts: [],
      detailVersion: 0,

      async refresh() {
        const snapshot = await api.getLibrary();
        set((s) => ({ snapshot, detailVersion: s.detailVersion + 1 }));
      },
      navigate(route) {
        set({ route, openTitleId: null, titleStack: [] });
      },
      openTitle(id) {
        const cur = get().openTitleId;
        set((s) => ({ openTitleId: id, titleStack: cur ? [...s.titleStack, cur] : s.titleStack }));
      },
      closeTitle() {
        const stack = [...get().titleStack];
        const prev = stack.pop() ?? null;
        set({ openTitleId: prev, titleStack: stack });
      },
      setPrefs(p) {
        set(p);
      },
      setPalette(open, query = '') {
        set({ paletteOpen: open, paletteQuery: query });
      },
      setFixTarget(t) {
        set({ fixTarget: t });
      },
      setDragging(d) {
        set({ dragging: d });
      },
      setProgress(p) {
        set({ progress: p });
      },
      toast(text, tone = 'default') {
        const id = ++toastId;
        set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
      },
      async updateTitleState(key, patch) {
        // Optimistic update for snappy toggles.
        const id = key.split(':')[0];
        if (!key.includes(':')) {
          set((s) => ({
            snapshot: s.snapshot && {
              ...s.snapshot,
              titles: s.snapshot.titles.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      ...(patch.watched !== undefined && {
                        watched: patch.watched,
                        watchedEpisodes: t.kind === 'series' ? (patch.watched ? t.episodeCount : 0) : t.watchedEpisodes,
                      }),
                      ...(patch.favorite !== undefined && { favorite: patch.favorite }),
                      ...(patch.watchlist !== undefined && { watchlist: patch.watchlist }),
                    }
                  : t,
              ),
            },
          }));
        }
        try {
          await api.setState(key, patch);
        } catch (e) {
          get().toast(`Couldn't save: ${e}`, 'error');
          await get().refresh();
        }
      },
      async addFolders(paths) {
        const chosen = paths ?? (await api.pickFolders());
        if (!chosen.length) return;
        try {
          const ids = await api.addFolders(chosen);
          if (!ids.length) get().toast('Those folders are already in your library');
          else
            get().toast(
              `Scanning ${chosen.length === 1 ? chosen[0].split(/[\\/]/).pop() : `${chosen.length} folders`}…`,
            );
          await get().refresh();
        } catch (e) {
          get().toast(`Couldn't add folder: ${e}`, 'error');
        }
      },
    }),
    {
      name: 'movie-monkey-prefs',
      partialize: (s) => ({
        posterSize: s.posterSize,
        sort: s.sort,
        sortDesc: s.sortDesc,
        filter: s.filter,
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    },
  ),
);

// ------------------------------------------------------------------ selectors

export function titlesFor(route: Route, titles: TitleSummary[]): TitleSummary[] {
  switch (route.name) {
    case 'movies':
      return titles.filter((t) => t.kind === 'movie');
    case 'shows':
      return titles.filter((t) => t.kind === 'series');
    case 'watchlist':
      return titles.filter((t) => t.watchlist);
    case 'favorites':
      return titles.filter((t) => t.favorite);
    case 'unwatched':
      return titles.filter((t) => !t.watched);
    case 'genre':
      return titles.filter((t) => t.genres.includes(route.genre));
    default:
      return titles;
  }
}

export function applyFilterSort(titles: TitleSummary[], filter: Filter, sort: SortKey, desc: boolean): TitleSummary[] {
  const f = titles.filter((t) => (filter === 'all' ? true : filter === 'watched' ? t.watched : !t.watched));
  const dir = desc ? -1 : 1;
  const sortName = (t: TitleSummary) => t.name.replace(/^(the|a|an)\s+/i, '').toLowerCase();
  const by: Record<SortKey, (a: TitleSummary, b: TitleSummary) => number> = {
    added: (a, b) => (a.addedAt - b.addedAt) * dir,
    title: (a, b) => sortName(a).localeCompare(sortName(b)) * dir,
    year: (a, b) => ((a.year ?? 0) - (b.year ?? 0)) * dir,
    rating: (a, b) => ((a.rating ?? 0) - (b.rating ?? 0)) * dir,
    runtime: (a, b) => ((a.runtime ?? 0) - (b.runtime ?? 0)) * dir,
    size: (a, b) => (a.totalSize - b.totalSize) * dir,
  };
  return [...f].sort((a, b) => by[sort](a, b) || sortName(a).localeCompare(sortName(b)));
}

export function topGenres(titles: TitleSummary[], n = 12): { genre: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of titles) for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
    .slice(0, n);
}

export interface SearchHit {
  t: TitleSummary;
  /** Why it matched when it wasn't the title ("Keanu Reeves", "dir. Denis Villeneuve"). */
  via: string | null;
}

/**
 * Library search for the command palette: every word must match somewhere;
 * title-prefix matches rank first, then title matches, then people/genre/year.
 */
export function searchLibrary(titles: TitleSummary[], query: string, limit = 40): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { hit: SearchHit; rank: number }[] = [];
  for (const t of titles) {
    const name = t.name.toLowerCase();
    const people = [...t.cast, ...t.directors.map((d) => `dir. ${d}`)];
    const hay = [
      name,
      String(t.year ?? ''),
      ...people,
      ...t.genres,
      t.kind === 'series' ? 'tv show series' : 'movie film',
    ]
      .join(' | ')
      .toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    const q = words.join(' ');
    const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : words.every((w) => name.includes(w)) ? 2 : 3;
    const via = rank < 3 ? null : (people.find((p) => words.some((w) => p.toLowerCase().includes(w))) ?? null);
    scored.push({ hit: { t, via }, rank });
  }
  return scored
    .sort((a, b) => a.rank - b.rank || (b.hit.t.rating ?? 0) - (a.hit.t.rating ?? 0))
    .slice(0, limit)
    .map((x) => x.hit);
}

export function routeTitle(route: Route): string {
  switch (route.name) {
    case 'home':
      return 'Home';
    case 'movies':
      return 'Movies';
    case 'shows':
      return 'TV Shows';
    case 'watchlist':
      return 'Watchlist';
    case 'favorites':
      return 'Favorites';
    case 'unwatched':
      return 'Unwatched';
    case 'genre':
      return route.genre;
    case 'review':
      return 'Needs review';
    case 'settings':
      return 'Settings';
  }
}
