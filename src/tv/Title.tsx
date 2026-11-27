import clsx from 'clsx';
import { Check, Play, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { runtime } from '../lib/format';
import type { TitleSummary } from '../lib/types';
import { api, img, type TvEpisode, type TvFile, type TvTitle } from './api';
import { focusDefault } from './nav';
import { Button, Img, Spinner } from './ui';

export interface PlayRequest {
  title: TvTitle;
  file: TvFile;
  /** "S1 · E3 · The Grim Barbarity…" for episodes. */
  label: string | null;
  start: number;
  episode?: { season: number; episode: number };
}

const QUALITY_RANK: Record<string, number> = { '4K': 5, '2160p': 5, '1080p': 4, '720p': 3, '576p': 2, '480p': 1 };

/** The best copy of a film that's on a connected drive. */
export function bestFile(files: TvFile[]): TvFile | null {
  const online = files.filter((f) => f.online);
  const pool = online.length ? online : files;
  return (
    [...pool].sort((a, b) => (QUALITY_RANK[b.quality ?? ''] ?? 0) - (QUALITY_RANK[a.quality ?? ''] ?? 0))[0] ?? null
  );
}

export function episodeLabel(e: TvEpisode) {
  return `S${e.season} · E${e.episode}${e.name && !/^Episode \d+$/.test(e.name) ? ` · ${e.name}` : ''}`;
}

/** The episode to play next: the one in progress, else the first unwatched one. */
export function nextEpisode(title: TvTitle): TvEpisode | null {
  const eps = title.seasons
    .filter((s) => s.number > 0)
    .flatMap((s) => s.episodes)
    .filter((e) => e.file);
  const started = eps
    .filter((e) => e.file?.position && !e.watched)
    .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))[0];
  if (started) return started;
  const lastWatched = eps.reduce((acc, e, i) => (e.watched ? i : acc), -1);
  return eps.slice(lastWatched + 1).find((e) => !e.watched) ?? eps[0] ?? null;
}

export function playRequestFor(title: TvTitle, fromStart = false): PlayRequest | null {
  if (title.summary.kind === 'series') {
    const e = nextEpisode(title);
    if (!e?.file) return null;
    return {
      title,
      file: e.file,
      label: episodeLabel(e),
      start: fromStart ? 0 : (e.file.position ?? 0),
      episode: { season: e.season, episode: e.episode },
    };
  }
  const f = bestFile(title.files);
  if (!f) return null;
  return { title, file: f, label: null, start: fromStart ? 0 : (f.position ?? 0) };
}

function clock(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function TitleScreen({
  summary,
  version,
  onPlay,
  onChanged,
}: {
  summary: TitleSummary;
  version: number;
  onPlay: (r: PlayRequest) => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState<TvTitle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [logoOk, setLogoOk] = useState(true);

  const load = () =>
    api
      .title(summary.id)
      .then((t) => {
        setTitle(t);
        setSeason((cur) => cur ?? nextEpisode(t)?.season ?? t.seasons[0]?.number ?? null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.id, version]);
  useEffect(() => {
    if (title) focusDefault();
  }, [title?.summary.id]);

  const s = title?.summary ?? summary;
  const req = title ? playRequestFor(title) : null;
  const resumeAt = req && req.start > 30 ? req.start : 0;
  const shownSeason = title?.seasons.find((x) => x.number === season);

  const toggle = async (patch: { watched?: boolean; watchlist?: boolean }) => {
    await api.setState(s.id, patch).catch(() => {});
    await load();
    onChanged();
  };

  const meta = useMemo(
    () =>
      [
        s.year,
        title?.certification,
        s.kind === 'series' ? (s.seasonCount === 1 ? '1 season' : `${s.seasonCount} seasons`) : runtime(s.runtime),
        s.rating ? `★ ${s.rating.toFixed(1)}` : null,
        s.quality,
        s.hdr ? 'HDR' : null,
      ].filter(Boolean),
    [s, title?.certification],
  );

  return (
    <div data-scroll-y className="h-full overflow-y-auto no-scrollbar fade-in">
      <div className="fixed inset-0">
        <Img src={img(s.backdrop, s.poster)} className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/75 to-bg/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/30 to-transparent" />
      </div>
      <div data-nav-row="top" className="relative px-24 pt-[14rem] max-w-[62rem]">
        {s.logo && logoOk ? (
          <img
            src={img(s.logo)}
            alt={s.name}
            onError={() => setLogoOk(false)}
            className="max-h-[9rem] max-w-[32rem] object-contain object-left drop-shadow-lg"
            draggable={false}
          />
        ) : (
          <h1 className="font-display text-[4rem] font-bold leading-[1.02] tracking-[-0.02em]">{s.name}</h1>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3 text-[1.3rem] font-medium text-ink-2">
          {meta.map((m, i) => (
            <span key={i} className="flex items-center gap-3">
              {i > 0 && <span className="text-ink-3">·</span>}
              {m}
            </span>
          ))}
        </div>
        {s.genres.length > 0 && <div className="mt-2 text-[1.2rem] text-ink-3">{s.genres.join(' · ')}</div>}
        {s.overview && <p className="mt-5 text-[1.35rem] leading-[1.55] text-ink-2 line-clamp-4">{s.overview}</p>}
        {s.cast.length > 0 && (
          <p className="mt-4 text-[1.15rem] text-ink-3 line-clamp-1">Starring {s.cast.slice(0, 4).join(', ')}</p>
        )}

        <div className="mt-9 flex items-center gap-4 min-h-14">
          {!title && !error && <Spinner />}
          {error && <p className="text-[1.3rem] text-[#ff8a80]">{error}</p>}
          {title && req && (
            <>
              <Button
                primary
                autoDefault
                navId="play"
                onClick={() => onPlay(req)}
                icon={<Play className="size-6" fill="currentColor" />}
              >
                {[resumeAt ? 'Resume' : 'Play', req.label?.split(' · ').slice(0, 2).join(' ')]
                  .filter(Boolean)
                  .join(' ')}
              </Button>
              {resumeAt > 0 && (
                <Button
                  navId="restart"
                  onClick={() => onPlay({ ...req, start: 0 })}
                  icon={<RotateCcw className="size-5" />}
                >
                  From the start
                </Button>
              )}
            </>
          )}
          {title && !req && (
            <p className="text-[1.3rem] text-ink-2">The files for this aren't available. Is the drive connected?</p>
          )}
          {title && (
            <>
              <Button
                navId="watched"
                onClick={() => toggle({ watched: !s.watched })}
                icon={<Check className={clsx('size-6', s.watched && 'text-accent')} />}
              >
                {s.watched ? 'Watched' : 'Mark watched'}
              </Button>
              <Button
                navId="watchlist"
                onClick={() => toggle({ watchlist: !s.watchlist })}
                icon={s.watchlist ? <Check className="size-6 text-accent" /> : <Plus className="size-6" />}
              >
                Watchlist
              </Button>
            </>
          )}
        </div>
        {resumeAt > 0 && <div className="mt-4 text-[1.15rem] text-ink-3">{clock(resumeAt)} in</div>}
      </div>

      {title && title.seasons.length > 0 && (
        <div className="relative mt-14 pb-24">
          {title.seasons.length > 1 && (
            <div data-nav-row="" data-nav-group className="flex gap-2 px-24 mb-6">
              {title.seasons.map((x) => (
                <button
                  key={x.number}
                  data-nav
                  data-nav-id={`season-${x.number}`}
                  onClick={() => setSeason(x.number)}
                  onFocus={() => setSeason(x.number)}
                  className={clsx(
                    'h-12 px-6 rounded-full text-[1.25rem] font-semibold transition-[background-color,color] duration-200',
                    season === x.number ? 'bg-white/14 text-ink' : 'text-ink-2',
                    'focus:bg-white focus:text-black',
                  )}
                >
                  {x.number === 0 ? 'Specials' : `Season ${x.number}`}
                </button>
              ))}
            </div>
          )}
          {shownSeason && (
            <div data-nav-row="">
              <div
                data-nav-group
                data-scroll-x
                className="flex gap-6 overflow-x-auto no-scrollbar px-24 py-5 -my-5 scroll-px-24"
              >
                {shownSeason.episodes.map((e) => (
                  <EpisodeCard
                    key={`${e.season}-${e.episode}`}
                    e={e}
                    onPlay={() =>
                      e.file &&
                      onPlay({
                        title,
                        file: e.file,
                        label: episodeLabel(e),
                        start: e.file.position ?? 0,
                        episode: { season: e.season, episode: e.episode },
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EpisodeCard({ e, onPlay }: { e: TvEpisode; onPlay: () => void }) {
  const has = !!e.file;
  const progress = e.file?.position && e.file.duration ? e.file.position / e.file.duration : 0;
  return (
    <button
      data-nav
      data-nav-id={`ep-${e.season}-${e.episode}`}
      onClick={onPlay}
      disabled={!has}
      className={clsx(
        'group shrink-0 w-[22rem] text-left transition-transform duration-300 ease-[var(--ease-out-expo)] focus:scale-[1.05]',
        !has && 'opacity-40',
      )}
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-card">
        <Img src={img(e.thumbnail)} className="absolute inset-0 size-full object-cover" />
        {e.watched && (
          <span className="absolute top-2.5 right-2.5 size-7 rounded-full bg-black/70 text-accent flex items-center justify-center text-[1rem] font-bold">
            ✓
          </span>
        )}
        {progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-[0.3rem] bg-white/25">
            <div className="h-full bg-accent" style={{ width: `${Math.min(progress, 1) * 100}%` }} />
          </div>
        )}
        <span className="pointer-events-none absolute inset-0 rounded-xl ring-inset group-focus:ring-[0.25rem] group-focus:ring-white" />
      </div>
      <div className="mt-3 text-[1.15rem] font-semibold text-ink truncate">
        {e.episode}. {e.name}
      </div>
      <div className="mt-1 text-[1.05rem] text-ink-3 line-clamp-2 h-[2.8em]">
        {has ? (e.overview ?? '') : 'Not in your library'}
      </div>
    </button>
  );
}
