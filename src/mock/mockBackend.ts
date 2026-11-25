// In-browser stand-in for the Rust backend, fed by a fixture generated from a
// real run of the engine (`cargo run --example scan -- demo-library src/mock/fixture.json`).
// Open the dev server with `?empty` to experience onboarding + live identification.

import type { Backend } from '../lib/api';
import type { LibrarySnapshot, Progress, TitleDetail, TitleSummary } from '../lib/types';

type Fixture = { snapshot: LibrarySnapshot; details: Record<string, TitleDetail> };

export async function createMockBackend(): Promise<Backend> {
  const fixture = (await import('./fixture.json')).default as unknown as Fixture;
  const full: Fixture = structuredClone(fixture);
  const startEmpty = new URLSearchParams(location.search).has('empty');

  let snap: LibrarySnapshot = startEmpty
    ? { titles: [], unmatched: [], folders: [], stats: { movies: 0, shows: 0, episodes: 0, unmatched: 0, totalSize: 0 } }
    : structuredClone(full.snapshot);
  const details = structuredClone(full.details);

  const progressCbs = new Set<(p: Progress) => void>();
  const changedCbs = new Set<() => void>();
  let progress: Progress = { active: false, phase: 'idle', done: 0, total: 0, current: null, found: 0, matched: 0, failed: 0 };

  const emitProgress = (p: Partial<Progress>) => {
    progress = { ...progress, ...p };
    progressCbs.forEach((cb) => cb(progress));
  };
  const emitChanged = () => changedCbs.forEach((cb) => cb());

  const recomputeStats = () => {
    const movies = snap.titles.filter((t) => t.kind === 'movie');
    const shows = snap.titles.filter((t) => t.kind === 'series');
    snap.stats = {
      movies: movies.length,
      shows: shows.length,
      episodes: shows.reduce((a, s) => a + s.episodeCount, 0),
      unmatched: snap.unmatched.length,
      totalSize: snap.titles.reduce((a, t) => a + t.totalSize, 0),
    };
  };

  const patchTitle = (id: string, fn: (t: TitleSummary) => void) => {
    const t = snap.titles.find((x) => x.id === id);
    if (t) fn(t);
    const d = details[id];
    if (d) fn(d.summary);
  };

  async function simulateImport() {
    const titles = structuredClone(full.snapshot.titles);
    snap.folders = structuredClone(full.snapshot.folders);
    emitProgress({ active: true, phase: 'scanning', done: 0, total: 0, current: snap.folders[0]?.path ?? null });
    emitChanged();
    await sleep(700);
    emitProgress({ phase: 'identifying', total: titles.length + 1, found: 73 });
    for (let i = 0; i < titles.length; i++) {
      await sleep(90 + Math.random() * 140);
      const t = titles[i];
      t.addedAt = Date.now();
      snap.titles = [t, ...snap.titles];
      recomputeStats();
      emitProgress({ done: i + 1, current: t.name, matched: i + 1 });
      emitChanged();
    }
    snap.unmatched = structuredClone(full.snapshot.unmatched);
    recomputeStats();
    emitProgress({ done: titles.length + 1, failed: 1 });
    await sleep(300);
    emitProgress({ active: false, phase: 'idle', current: null });
    emitChanged();
  }

  return {
    async getLibrary() {
      return structuredClone(snap);
    },
    async getTitle(id) {
      const d = details[id];
      if (!d) return null;
      const s = snap.titles.find((t) => t.id === id);
      return structuredClone({ ...d, summary: s ? { ...d.summary, ...s } : d.summary });
    },
    async getProgress() {
      return progress;
    },
    async addFolders() {
      if (snap.titles.length === 0) void simulateImport();
      return [1];
    },
    async removeFolder() {
      snap = { titles: [], unmatched: [], folders: [], stats: { movies: 0, shows: 0, episodes: 0, unmatched: 0, totalSize: 0 } };
      emitChanged();
    },
    async rescan() {
      emitProgress({ active: true, phase: 'scanning', current: '/Volumes/Media' });
      await sleep(900);
      emitProgress({ active: false, phase: 'idle', current: null });
    },
    async setState(key, patch) {
      const [id, s, e] = key.split(':');
      if (s !== undefined) {
        const d = details[id];
        const ep = d?.seasons.find((x) => x.number === +s)?.episodes.find((x) => x.episode === +e);
        if (ep && patch.watched !== undefined) ep.watched = patch.watched;
        if (d) {
          const local = d.seasons.flatMap((x) => x.episodes).filter((x) => x.file);
          const w = local.filter((x) => x.watched).length;
          patchTitle(id, (t) => {
            t.watchedEpisodes = w;
            t.watched = w === local.length && local.length > 0;
          });
        }
      } else {
        patchTitle(id, (t) => {
          if (patch.watched !== undefined) {
            t.watched = patch.watched;
            if (t.kind === 'series') {
              t.watchedEpisodes = patch.watched ? t.episodeCount : 0;
              details[id]?.seasons.forEach((x) => x.episodes.forEach((ep) => ep.file && (ep.watched = !!patch.watched)));
            }
          }
          if (patch.favorite !== undefined) t.favorite = patch.favorite;
          if (patch.watchlist !== undefined) t.watchlist = patch.watchlist;
          if (patch.rating !== undefined) t.userRating = patch.rating || null;
        });
      }
      emitChanged();
    },
    async play(path) {
      console.info('[mock] play', path);
      const t = Object.values(details).find((d) => d.files.some((f) => f.path === path));
      if (t) patchTitle(t.summary.id, (x) => (x.lastPlayedAt = Date.now()));
      emitChanged();
    },
    async reveal(path) {
      console.info('[mock] reveal', path);
    },
    async searchTitles(query, kind) {
      await sleep(250);
      const q = query.toLowerCase();
      return full.snapshot.titles
        .filter((t) => (!kind || t.kind === kind) && t.name.toLowerCase().includes(q))
        .map((t) => ({
          id: t.id,
          kind: t.kind,
          title: t.name,
          year: t.year,
          yearLabel: t.yearLabel,
          poster: t.poster,
          subtitle: t.cast.slice(0, 2).join(', '),
          rank: null,
          source: 'mock',
        }));
    },
    async assignMatch(paths) {
      snap.unmatched = snap.unmatched.filter((u) => !paths.includes(u.path));
      recomputeStats();
      emitChanged();
    },
    async ignoreFiles(paths) {
      snap.unmatched = snap.unmatched.filter((u) => !paths.includes(u.path));
      recomputeStats();
      emitChanged();
    },
    async refreshTitle() {
      await sleep(400);
    },
    async cacheSize() {
      return 48_211_337;
    },
    async clearCache() {},
    async pickFolders() {
      return ['/Volumes/Media'];
    },
    async openUrl(url) {
      window.open(url, '_blank');
    },
    async onProgress(cb) {
      const wrapped = (p: Progress) => cb(p);
      progressCbs.add(wrapped);
      return () => progressCbs.delete(wrapped);
    },
    async onChanged(cb) {
      const wrapped = () => cb();
      changedCbs.add(wrapped);
      return () => changedCbs.delete(wrapped);
    },
    async onDragDrop(cb) {
      let depth = 0;
      const enter = (e: DragEvent) => {
        e.preventDefault();
        if (depth++ === 0) cb({ type: 'enter', paths: [] });
      };
      const over = (e: DragEvent) => e.preventDefault();
      const leave = () => {
        if (--depth <= 0) {
          depth = 0;
          cb({ type: 'leave', paths: [] });
        }
      };
      const drop = (e: DragEvent) => {
        e.preventDefault();
        depth = 0;
        cb({ type: 'drop', paths: ['/Volumes/Media'] });
      };
      window.addEventListener('dragenter', enter);
      window.addEventListener('dragover', over);
      window.addEventListener('dragleave', leave);
      window.addEventListener('drop', drop);
      return () => {
        window.removeEventListener('dragenter', enter);
        window.removeEventListener('dragover', over);
        window.removeEventListener('dragleave', leave);
        window.removeEventListener('drop', drop);
      };
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
