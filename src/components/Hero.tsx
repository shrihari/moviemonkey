import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Bookmark, Info, Play } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { playTitle, toggleWatchlist } from '../lib/actions';
import { runtime } from '../lib/format';
import { img } from '../lib/img';
import { useStore } from '../lib/store';
import type { TitleSummary } from '../lib/types';
import { Star } from './PosterCard';
import { Button, IconButton } from './ui';

/** Stable per-day shuffle so the hero changes daily but not on every render. */
function dailyPicks(titles: TitleSummary[], n: number): TitleSummary[] {
  const day = Math.floor(Date.now() / 86_400_000);
  const score = (t: TitleSummary) => {
    let h = day;
    for (const c of t.id) h = (h * 33 + c.charCodeAt(0)) >>> 0;
    return (h % 1000) / 1000 + (t.watched ? 0 : 0.6) + (t.rating ?? 6) / 10;
  };
  return titles
    .filter((t) => t.backdrop && t.overview)
    .map((t) => ({ t, s: score(t) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.t);
}

export function Hero({ titles }: { titles: TitleSummary[] }) {
  const picks = useMemo(() => dailyPicks(titles, 6), [titles]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const openTitle = useStore((s) => s.openTitle);
  const live = useStore((s) => s.snapshot?.titles);

  useEffect(() => {
    if (paused || picks.length < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % picks.length), 8000);
    return () => clearInterval(t);
  }, [paused, picks.length]);

  if (!picks.length) return null;
  const pick = picks[index % picks.length];
  const t = live?.find((x) => x.id === pick.id) ?? pick;

  return (
    <div
      className="relative h-[clamp(380px,60vh,600px)] w-full overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={t.id}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 1 }, scale: { duration: 9, ease: 'linear' } }}
        >
          <img src={img(t.backdrop)} alt="" className="absolute inset-0 size-full object-cover object-top" draggable={false} />
        </motion.div>
      </AnimatePresence>

      {/* legibility gradients, fading into the pane */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(0_0_0/0.8)_0%,rgb(0_0_0/0.5)_38%,rgb(0_0_0/0.02)_72%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[80%] bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-pane to-transparent" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/40 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 px-10 pb-16">
        <AnimatePresence mode="wait">
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-[560px]"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70 mb-3">
              {t.watched ? 'From your library' : t.kind === 'series' ? 'Pick up a show' : 'Tonight’s pick'}
            </div>
            <HeroLogo t={t} />
            <div className="mt-4 flex items-center gap-2 text-[13px] text-white/85 font-medium">
              {t.rating ? (
                <span className="inline-flex items-center gap-1">
                  <Star className="size-3.5 text-accent" />
                  {t.rating.toFixed(1)}
                </span>
              ) : null}
              <Dot />
              <span>{t.kind === 'series' ? t.yearLabel : t.year}</span>
              {t.runtime && t.kind === 'movie' && (
                <>
                  <Dot />
                  <span>{runtime(t.runtime)}</span>
                </>
              )}
              {t.kind === 'series' && (
                <>
                  <Dot />
                  <span>
                    {t.seasonCount} season{t.seasonCount === 1 ? '' : 's'}
                  </span>
                </>
              )}
              {t.genres.length > 0 && (
                <>
                  <Dot />
                  <span className="truncate">{t.genres.slice(0, 3).join(', ')}</span>
                </>
              )}
              {t.quality === '4K' && <span className="ml-1 px-1.5 h-[18px] rounded-[5px] ring-1 ring-white/50 text-[10px] font-bold flex items-center">4K</span>}
            </div>
            <p className="mt-3 text-[14px] leading-relaxed text-white/80 line-clamp-3 drop-shadow-sm">{t.overview}</p>
            <div className="mt-6 flex items-center gap-2.5">
              <Button variant="white" size="lg" onClick={() => playTitle(t)}>
                <Play className="size-4" fill="currentColor" />
                Play
              </Button>
              <Button variant="glass" size="lg" onClick={() => openTitle(t.id)}>
                <Info className="size-4" />
                Details
              </Button>
              <IconButton tone="glass" label={t.watchlist ? 'Remove from Watchlist' : 'Add to Watchlist'} onClick={() => toggleWatchlist(t)} className="size-11">
                <Bookmark className="size-4" fill={t.watchlist ? 'currentColor' : 'none'} />
              </IconButton>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {picks.length > 1 && (
        <div className="absolute right-10 bottom-[70px] flex gap-1.5">
          {picks.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setIndex(i)}
              className={clsx('h-1.5 rounded-full transition-all duration-500', i === index % picks.length ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70')}
              aria-label={`Show ${p.name}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HeroLogo({ t }: { t: TitleSummary }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [t.id]);
  if (t.logo && !failed) {
    return (
      <img
        src={img(t.logo)}
        alt={t.name}
        onError={() => setFailed(true)}
        className="max-h-[120px] max-w-[440px] object-contain object-left drop-shadow-[0_4px_24px_rgb(0_0_0/0.5)]"
        draggable={false}
      />
    );
  }
  return <h1 className="font-serif text-white text-[48px] leading-[1.05] tracking-tight drop-shadow-lg">{t.name}</h1>;
}

function Dot() {
  return <span className="text-white/40">·</span>;
}
