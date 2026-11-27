import clsx from 'clsx';
import { Info, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { runtime } from '../lib/format';
import type { TitleSummary } from '../lib/types';
import { img } from './api';
import { BackdropCard, Button, Img, Monkey, PosterCard, Row } from './ui';

export type Tab = 'home' | 'movies' | 'shows';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'movies', label: 'Movies' },
  { id: 'shows', label: 'TV Shows' },
];

function inProgress(t: TitleSummary) {
  if (!t.lastPlayedAt || t.watched) return false;
  return t.kind === 'movie' || t.watchedEpisodes < t.episodeCount;
}

function continueCaption(t: TitleSummary) {
  if (t.kind === 'series') {
    const left = t.episodeCount - t.watchedEpisodes;
    return left === 1 ? '1 episode left' : `${left} episodes left`;
  }
  return 'Resume';
}

export function HomeScreen({
  titles,
  server,
  tab,
  setTab,
  onOpen,
  onPlay,
}: {
  titles: TitleSummary[];
  server: string;
  tab: Tab;
  setTab: (t: Tab) => void;
  onOpen: (t: TitleSummary) => void;
  onPlay: (t: TitleSummary) => void;
}) {
  return (
    <div data-scroll-y className="relative h-full overflow-y-auto no-scrollbar">
      <div data-nav-row="top" className="absolute top-0 inset-x-0 z-20 flex items-center gap-3 px-24 pt-10">
        <Monkey className="size-11 mr-5" />
        <div data-nav-group className="flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-nav
              data-nav-id={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
              onFocus={() => setTab(t.id)}
              className={clsx(
                'h-12 px-6 rounded-full text-[1.3rem] font-semibold transition-[background-color,color] duration-200',
                tab === t.id ? 'text-ink bg-white/14' : 'text-ink-2',
                'focus:bg-white focus:text-black',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto text-[1.15rem] text-ink-3">{server}</div>
      </div>
      {tab === 'home' ? (
        <HomeRows titles={titles} onOpen={onOpen} onPlay={onPlay} />
      ) : (
        <Grid
          titles={titles.filter((t) => t.kind === (tab === 'movies' ? 'movie' : 'series'))}
          onOpen={onOpen}
          tab={tab}
        />
      )}
    </div>
  );
}

function HomeRows({
  titles,
  onOpen,
  onPlay,
}: {
  titles: TitleSummary[];
  onOpen: (t: TitleSummary) => void;
  onPlay: (t: TitleSummary) => void;
}) {
  const rows = useMemo(() => {
    const byAdded = [...titles].sort((a, b) => b.addedAt - a.addedAt);
    const cont = titles.filter(inProgress).sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
    const movies = byAdded.filter((t) => t.kind === 'movie');
    const shows = byAdded.filter((t) => t.kind === 'series');
    const watchlist = byAdded.filter((t) => t.watchlist && t.fileCount > 0);
    const counts = new Map<string, number>();
    for (const t of titles) for (const g of t.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    const genres = [...counts.entries()]
      .filter(([, n]) => n >= 6)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([g]) => g);
    return { byAdded, cont, movies, shows, watchlist, genres };
  }, [titles]);

  const hero = rows.cont[0] ?? rows.byAdded.find((t) => t.backdrop) ?? rows.byAdded[0];
  if (!hero) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-24">
        <h1 className="font-display text-[3rem] font-bold">Nothing here yet</h1>
        <p className="mt-4 text-[1.5rem] text-ink-2 max-w-[44rem]">
          Add a folder of movies or shows in Movie Monkey on your computer, and they'll show up here.
        </p>
      </div>
    );
  }
  return (
    <>
      <Hero t={hero} resume={inProgress(hero)} onOpen={() => onOpen(hero)} onPlay={() => onPlay(hero)} />
      <div className="relative z-10 -mt-[9rem] pb-24">
        {rows.cont.length > 0 && (
          <Row title="Continue watching">
            {rows.cont.map((t) => (
              <BackdropCard
                key={t.id}
                t={t}
                navId={`cont-${t.id}`}
                caption={continueCaption(t)}
                onOpen={() => onOpen(t)}
              />
            ))}
          </Row>
        )}
        <Row title="Recently added">
          {rows.byAdded.slice(0, 24).map((t) => (
            <PosterCard key={t.id} t={t} navId={`recent-${t.id}`} onOpen={() => onOpen(t)} />
          ))}
        </Row>
        {rows.watchlist.length > 0 && (
          <Row title="Your watchlist">
            {rows.watchlist.map((t) => (
              <PosterCard key={t.id} t={t} navId={`wl-${t.id}`} onOpen={() => onOpen(t)} />
            ))}
          </Row>
        )}
        {rows.movies.length > 0 && (
          <Row title="Movies">
            {rows.movies.slice(0, 40).map((t) => (
              <PosterCard key={t.id} t={t} navId={`mov-${t.id}`} onOpen={() => onOpen(t)} />
            ))}
          </Row>
        )}
        {rows.shows.length > 0 && (
          <Row title="TV shows">
            {rows.shows.slice(0, 40).map((t) => (
              <PosterCard key={t.id} t={t} navId={`show-${t.id}`} onOpen={() => onOpen(t)} />
            ))}
          </Row>
        )}
        {rows.genres.map((g) => (
          <Row key={g} title={g}>
            {rows.byAdded
              .filter((t) => t.genres.includes(g))
              .slice(0, 30)
              .map((t) => (
                <PosterCard key={t.id} t={t} navId={`g-${g}-${t.id}`} onOpen={() => onOpen(t)} />
              ))}
          </Row>
        ))}
      </div>
    </>
  );
}

function Hero({
  t,
  resume,
  onOpen,
  onPlay,
}: {
  t: TitleSummary;
  resume: boolean;
  onOpen: () => void;
  onPlay: () => void;
}) {
  const [logoOk, setLogoOk] = useState(true);
  const meta = [
    t.year,
    t.kind === 'series' ? (t.seasonCount === 1 ? '1 season' : `${t.seasonCount} seasons`) : runtime(t.runtime),
    t.genres.slice(0, 2).join(' · ') || null,
    t.quality,
  ].filter(Boolean);
  return (
    <section data-nav-row="top" className="relative h-[100vh] min-h-[40rem]">
      <Img src={img(t.backdrop, t.poster)} className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/60 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/20 to-transparent" />
      <div className="absolute left-24 bottom-[15rem] max-w-[46rem]">
        {t.logo && logoOk ? (
          <img
            src={img(t.logo)}
            alt={t.name}
            onError={() => setLogoOk(false)}
            className="max-h-[10rem] max-w-[34rem] object-contain object-left drop-shadow-lg"
            draggable={false}
          />
        ) : (
          <h1 className="font-display text-[4.4rem] font-bold leading-[1.02] tracking-[-0.02em]">{t.name}</h1>
        )}
        <div className="mt-6 flex items-center gap-3 text-[1.3rem] font-medium text-ink-2">
          {meta.map((m, i) => (
            <span key={i} className="flex items-center gap-3">
              {i > 0 && <span className="text-ink-3">·</span>}
              <span>{m}</span>
            </span>
          ))}
        </div>
        {t.overview && <p className="mt-5 text-[1.35rem] leading-[1.5] text-ink-2 line-clamp-3">{t.overview}</p>}
        <div className="mt-8 flex gap-4">
          <Button
            primary
            autoDefault
            navId="hero-play"
            onClick={onPlay}
            icon={<Play className="size-6" fill="currentColor" />}
          >
            {resume ? 'Resume' : 'Play'}
          </Button>
          <Button navId="hero-info" onClick={onOpen} icon={<Info className="size-6" />}>
            More info
          </Button>
        </div>
      </div>
    </section>
  );
}

function Grid({ titles, onOpen, tab }: { titles: TitleSummary[]; onOpen: (t: TitleSummary) => void; tab: Tab }) {
  const sorted = useMemo(() => [...titles].sort((a, b) => b.addedAt - a.addedAt), [titles]);
  return (
    <div className="pt-[9rem] px-24 pb-24">
      <h1 className="font-display text-[2.6rem] font-bold">{tab === 'movies' ? 'Movies' : 'TV Shows'}</h1>
      {sorted.length === 0 ? (
        <p className="mt-6 text-[1.5rem] text-ink-2">None yet.</p>
      ) : (
        <div className="mt-8 grid grid-cols-7 gap-x-6 gap-y-8">
          {sorted.map((t) => (
            <div key={t.id} data-nav-row="">
              <PosterCard fluid t={t} navId={`grid-${t.id}`} onOpen={() => onOpen(t)} />
              <div className="mt-3 text-[1.1rem] font-medium text-ink-2 truncate">{t.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
