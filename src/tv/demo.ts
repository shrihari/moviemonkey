// The sample-films demo: the TV screens without a computer. getmoviemonkey.com
// serves a build of them (`npm run build:tv-demo`) that reads this small
// library instead of asking Movie Monkey, and plays four Blender Foundation
// films (Creative Commons) straight from the Internet Archive. It's what the
// LG app's "Try with sample films" opens, so people (and LG's testers) can see
// Movie Monkey on a TV before installing it on a computer.
//
// Resume points and watched/watchlist marks stay on the TV, like the real app
// keeps them on the computer: same rules (watched at 92%, resume after 5s).

import type { StatePatch, TitleSummary } from '../lib/types';
import type { PlayPlan, TvTitle } from './api';
import films from './demo-films.json';

type Film = (typeof films)[number];

interface Saved {
  positions: Record<string, { position: number; duration: number | null; at: number }>;
  state: Record<string, StatePatch>;
}

const KEY = 'mm.demo';

function load(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '') as Saved;
    if (s && s.positions && s.state) return s;
  } catch {
    /* nothing saved yet */
  }
  return { positions: {}, state: {} };
}

function save(s: Saved) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

function byTitle(id: string): Film {
  const f = films.find((x) => x.summary.id === id);
  if (!f) throw new Error('Not in the sample library.');
  return f;
}

function byFile(id: string): Film {
  const f = films.find((x) => x.files[0].id === id);
  if (!f) throw new Error('Not in the sample library.');
  return f;
}

function summaryOf(f: Film, s: Saved): TitleSummary {
  const marks = s.state[f.summary.id] ?? {};
  const played = s.positions[f.files[0].id];
  return {
    ...f.summary,
    watched: marks.watched ?? false,
    watchlist: marks.watchlist ?? false,
    favorite: marks.favorite ?? false,
    lastPlayedAt: played?.at ?? null,
  } as TitleSummary;
}

/** Credits for the About screen. */
export function demoCredits(): string[] {
  return films.map((f) => f.demo.credit);
}

export const demoApi = {
  info: async () => ({ app: 'Movie Monkey', name: 'Sample films', version: '', paired: true }),
  pair: async (_code: string, _name: string) => ({ token: 'demo', name: 'Sample films' }),
  library: async () => {
    const s = load();
    return { titles: films.map((f) => summaryOf(f, s)), name: 'Sample films' };
  },
  title: async (id: string): Promise<TvTitle> => {
    const f = byTitle(id);
    const s = load();
    const file = f.files[0];
    return {
      ...f,
      summary: summaryOf(f, s),
      files: [{ ...file, position: s.positions[file.id]?.position ?? null }],
    } as unknown as TvTitle;
  },
  setState: async (key: string, patch: StatePatch) => {
    const s = load();
    s.state[key] = { ...s.state[key], ...patch };
    if (patch.watched !== undefined) delete s.positions[byTitle(key).files[0].id];
    save(s);
  },
  play: async (file: string, _body: unknown): Promise<PlayPlan> => {
    const f = byFile(file);
    return {
      mode: 'direct',
      url: f.demo.url,
      session: null,
      offset: 0,
      duration: f.files[0].duration,
      resume: load().positions[file]?.position ?? null,
      note: null,
      audio: [],
      subtitles: [],
      error: null,
      fileName: f.files[0].fileName,
    };
  },
  stop: async (_session: string) => {},
  progress: async (file: string, position: number, duration: number | null) => {
    const s = load();
    const id = byFile(file).summary.id;
    const finished = !!duration && duration > 0 && position / duration >= 0.92;
    if (finished) {
      delete s.positions[file];
      s.state[id] = { ...s.state[id], watched: true };
    } else if (position > 5) {
      s.positions[file] = { position, duration, at: Date.now() };
    }
    save(s);
    return { watched: finished };
  },
};
