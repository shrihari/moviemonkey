import { describe, expect, it } from 'vitest';
import { bytes, epCode, runtime } from './format';
import { applyFilterSort, titlesFor, topGenres } from './store';
import type { TitleSummary } from './types';

const t = (p: Partial<TitleSummary>): TitleSummary =>
  ({
    id: p.name ?? 'x', kind: 'movie', name: 'x', year: 2000, yearLabel: null, poster: null, posterAlt: null,
    backdrop: null, logo: null, overview: null, rating: null, runtime: null, genres: [], directors: [], cast: [],
    addedAt: 0, updatedAt: 0, fileCount: 1, totalSize: 0, episodeCount: 0, watchedEpisodes: 0, seasonCount: 0,
    quality: null, hdr: false, online: true, watched: false, favorite: false, watchlist: false, userRating: null,
    lastPlayedAt: null, ...p,
  }) as TitleSummary;

describe('format', () => {
  it('formats sizes, runtimes and episode codes', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(31.4 * 1024 ** 3)).toBe('31.4 GB');
    expect(runtime(136)).toBe('2h 16m');
    expect(runtime(45)).toBe('45m');
    expect(epCode(1, 5)).toBe('S01E05');
  });
});

describe('library selectors', () => {
  const lib = [
    t({ name: 'The Matrix', year: 1999, rating: 8.7, genres: ['Action', 'Sci-Fi'], addedAt: 3 }),
    t({ name: 'Arrival', year: 2016, rating: 7.9, genres: ['Drama', 'Sci-Fi'], watched: true, addedAt: 1 }),
    t({ name: 'Severance', kind: 'series', year: 2022, genres: ['Drama'], watchlist: true, addedAt: 2 }),
  ];

  it('routes to the right subsets', () => {
    expect(titlesFor({ name: 'movies' }, lib).map((x) => x.name)).toEqual(['The Matrix', 'Arrival']);
    expect(titlesFor({ name: 'shows' }, lib).map((x) => x.name)).toEqual(['Severance']);
    expect(titlesFor({ name: 'watchlist' }, lib)).toHaveLength(1);
    expect(titlesFor({ name: 'genre', genre: 'Sci-Fi' }, lib)).toHaveLength(2);
  });

  it('sorts titles ignoring leading articles', () => {
    const byTitle = applyFilterSort(lib, 'all', 'title', false).map((x) => x.name);
    expect(byTitle).toEqual(['Arrival', 'The Matrix', 'Severance']);
  });

  it('filters by watched state and sorts by recency', () => {
    expect(applyFilterSort(lib, 'unwatched', 'added', true).map((x) => x.name)).toEqual(['The Matrix', 'Severance']);
    expect(applyFilterSort(lib, 'watched', 'added', true).map((x) => x.name)).toEqual(['Arrival']);
  });

  it('counts genres', () => {
    expect(topGenres(lib)[0]).toEqual({ genre: 'Drama', count: 2 });
  });
});
