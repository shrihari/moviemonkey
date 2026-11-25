// Thin, typed wrapper over the Rust commands. In a plain browser (vite dev
// without Tauri) it falls back to an in-memory mock backed by real fixture data,
// which makes UI work fast and lets the app be previewed anywhere.

import type { Candidate, LibrarySnapshot, Progress, StatePatch, TitleDetail, TitleKind } from './types';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface Backend {
  getLibrary(): Promise<LibrarySnapshot>;
  getTitle(id: string): Promise<TitleDetail | null>;
  getProgress(): Promise<Progress>;
  addFolders(paths: string[]): Promise<number[]>;
  removeFolder(id: number): Promise<void>;
  rescan(retryUnmatched?: boolean): Promise<void>;
  setState(key: string, patch: StatePatch): Promise<void>;
  play(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
  searchTitles(query: string, kind?: TitleKind | null): Promise<Candidate[]>;
  assignMatch(paths: string[], id: string, kind: TitleKind): Promise<void>;
  ignoreFiles(paths: string[]): Promise<void>;
  refreshTitle(id: string): Promise<void>;
  cacheSize(): Promise<number>;
  clearCache(): Promise<void>;
  pickFolders(): Promise<string[]>;
  openUrl(url: string): Promise<void>;
  onProgress(cb: (p: Progress) => void): Promise<() => void>;
  onChanged(cb: () => void): Promise<() => void>;
  onDragDrop(cb: (e: { type: 'enter' | 'over' | 'leave' | 'drop'; paths: string[] }) => void): Promise<() => void>;
}

async function tauriBackend(): Promise<Backend> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const { getCurrentWebview } = await import('@tauri-apps/api/webview');
  const dialog = await import('@tauri-apps/plugin-dialog');
  const opener = await import('@tauri-apps/plugin-opener');

  return {
    getLibrary: () => invoke('get_library'),
    getTitle: (id) => invoke('get_title', { id }),
    getProgress: () => invoke('get_progress'),
    addFolders: (paths) => invoke('add_folders', { paths }),
    removeFolder: (id) => invoke('remove_folder', { id }),
    rescan: (retryUnmatched) => invoke('rescan', { retryUnmatched: !!retryUnmatched }),
    setState: (key, patch) => invoke('set_state', { key, patch }),
    play: (path) => invoke('play', { path }),
    reveal: (path) => invoke('reveal', { path }),
    searchTitles: (query, kind) => invoke('search_titles', { query, kind: kind ?? null }),
    assignMatch: (paths, id, kind) => invoke('assign_match', { paths, id, kind }),
    ignoreFiles: (paths) => invoke('ignore_files', { paths }),
    refreshTitle: (id) => invoke('refresh_title', { id }),
    cacheSize: () => invoke('cache_size'),
    clearCache: () => invoke('clear_cache'),
    pickFolders: async () => {
      const res = await dialog.open({ directory: true, multiple: true, title: 'Add folders to Movie Monkey' });
      if (!res) return [];
      return Array.isArray(res) ? res : [res];
    },
    openUrl: (url) => opener.openUrl(url),
    onProgress: (cb) => listen<Progress>('mm://progress', (e) => cb(e.payload)),
    onChanged: (cb) => listen('mm://changed', () => cb()),
    onDragDrop: (cb) =>
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === 'enter') cb({ type: 'enter', paths: p.paths });
        else if (p.type === 'over') cb({ type: 'over', paths: [] });
        else if (p.type === 'drop') cb({ type: 'drop', paths: p.paths });
        else cb({ type: 'leave', paths: [] });
      }),
  };
}

let backendPromise: Promise<Backend> | null = null;

export function backend(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = isTauri ? tauriBackend() : import('../mock/mockBackend').then((m) => m.createMockBackend());
  }
  return backendPromise;
}

/** Convenience proxy: `api.play(path)` etc. */
export const api = new Proxy({} as Backend, {
  get(_t, prop: keyof Backend) {
    return async (...args: unknown[]) => {
      const b = await backend();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (b[prop] as any)(...args);
    };
  },
});
