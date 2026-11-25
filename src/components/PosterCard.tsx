import clsx from 'clsx';
import { Bookmark, Check, Eye, EyeOff, FolderOpen, Heart, Play, Wand2 } from 'lucide-react';
import { memo, type MouseEvent } from 'react';
import { fixMatch, playTitle, revealTitle, toggleFavorite, toggleWatched, toggleWatchlist } from '../lib/actions';
import { useStore } from '../lib/store';
import type { TitleSummary } from '../lib/types';
import { useContextMenu } from './ContextMenu';
import { Poster } from './Poster';
import type { MenuItem } from './ui';

export function titleMenu(t: TitleSummary): MenuItem[] {
  return [
    { label: 'Play', icon: <Play />, onSelect: () => playTitle(t) },
    { separator: true, label: '' },
    {
      label: t.watched ? 'Mark as unwatched' : 'Mark as watched',
      icon: t.watched ? <EyeOff /> : <Eye />,
      onSelect: () => toggleWatched(t),
    },
    {
      label: t.watchlist ? 'Remove from Watchlist' : 'Add to Watchlist',
      icon: <Bookmark />,
      onSelect: () => toggleWatchlist(t),
    },
    {
      label: t.favorite ? 'Remove from Favorites' : 'Add to Favorites',
      icon: <Heart />,
      onSelect: () => toggleFavorite(t),
    },
    { separator: true, label: '' },
    { label: 'Show in Finder', icon: <FolderOpen />, onSelect: () => revealTitle(t) },
    { label: 'Fix match…', icon: <Wand2 />, onSelect: () => fixMatch(t) },
  ];
}

// Fields a card actually displays. The library is refetched on every change,
// so object identity changes constantly; compare what matters instead.
const CARD_FIELDS = [
  'id',
  'name',
  'year',
  'yearLabel',
  'poster',
  'posterAlt',
  'rating',
  'kind',
  'quality',
  'hdr',
  'online',
  'watched',
  'watchlist',
  'favorite',
  'episodeCount',
  'watchedEpisodes',
] as const;

function sameCard(
  a: { t: TitleSummary; eager?: boolean; showMeta?: boolean },
  b: { t: TitleSummary; eager?: boolean; showMeta?: boolean },
) {
  return a.eager === b.eager && a.showMeta === b.showMeta && CARD_FIELDS.every((k) => a.t[k] === b.t[k]);
}

export const PosterCard = memo(function PosterCard({
  t,
  eager,
  showMeta = true,
}: {
  t: TitleSummary;
  eager?: boolean;
  showMeta?: boolean;
}) {
  const openTitle = useStore((s) => s.openTitle);
  const showMenu = useContextMenu((s) => s.show);
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY, titleMenu(t));
  };
  const progress = t.kind === 'series' && t.episodeCount > 0 ? t.watchedEpisodes / t.episodeCount : 0;

  return (
    <div className="poster-card group" onContextMenu={onContext}>
      <button
        onClick={() => openTitle(t.id)}
        className="relative block w-full text-left rounded-[10px] transition-[transform,box-shadow] duration-300 ease-[var(--ease-out-expo)] shadow-poster group-hover:shadow-poster-hover group-hover:-translate-y-1 active:scale-[0.98]"
      >
        <Poster src={t.poster} fallback={t.posterAlt} title={t.name} year={t.year} eager={eager} />

        {/* badges */}
        <div className="absolute top-2 left-2 flex gap-1">
          {t.quality === '4K' && (
            <span className="h-[18px] px-1.5 rounded-[5px] bg-black/55 backdrop-blur-md text-white text-[10px] font-bold tracking-wide flex items-center">
              4K
            </span>
          )}
          {t.hdr && (
            <span className="h-[18px] px-1.5 rounded-[5px] bg-black/55 backdrop-blur-md text-white text-[10px] font-bold tracking-wide flex items-center">
              HDR
            </span>
          )}
        </div>
        {t.watched && (
          <div className="absolute top-2 right-2 size-[22px] rounded-full bg-accent text-accent-ink flex items-center justify-center shadow-md">
            <Check className="size-3.5" strokeWidth={3} />
          </div>
        )}
        {!t.watched && t.watchlist && (
          <div className="absolute top-2 right-2 size-[22px] rounded-full bg-black/55 backdrop-blur-md text-white flex items-center justify-center">
            <Bookmark className="size-3" fill="currentColor" />
          </div>
        )}
        {!t.online && (
          <div className="absolute inset-0 rounded-[10px] bg-black/50 flex items-end p-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-white/80">Offline</span>
          </div>
        )}

        {/* hover play */}
        <div className="absolute inset-0 rounded-[10px] bg-gradient-to-t from-black/60 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <div
          role="button"
          onClick={(e) => {
            e.stopPropagation();
            void playTitle(t);
          }}
          className="absolute bottom-2.5 left-2.5 size-9 rounded-full bg-white text-black flex items-center justify-center shadow-lg opacity-0 translate-y-1 scale-90 group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 transition-all duration-300 ease-[var(--ease-out-expo)] hover:scale-110"
          title="Play"
        >
          <Play className="size-4 ml-0.5" fill="currentColor" />
        </div>

        {progress > 0 && progress < 1 && (
          <div className="absolute bottom-0 inset-x-0 h-[3px] bg-black/40 rounded-b-[10px] overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </button>
      {showMeta && (
        <div className="pt-2.5 px-0.5">
          <div className="text-[13px] font-medium text-ink truncate leading-tight">{t.name}</div>
          <div className={clsx('mt-1 text-[12px] text-ink-2 flex items-center gap-1.5 truncate')}>
            <span>{t.kind === 'series' ? (t.yearLabel ?? t.year) : t.year}</span>
            {t.kind === 'series' && t.episodeCount > 0 && (
              <>
                <span className="text-ink-3">·</span>
                <span>
                  {t.episodeCount} ep{t.episodeCount === 1 ? '' : 's'}
                </span>
              </>
            )}
            {t.rating ? (
              <>
                <span className="text-ink-3">·</span>
                <span className="inline-flex items-center gap-0.5">
                  <Star />
                  {t.rating.toFixed(1)}
                </span>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}, sameCard);

export function Star({ className = 'size-[11px] text-accent-strong' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 2.5l2.94 6.06 6.56.92-4.78 4.6 1.17 6.52L12 17.5l-5.89 3.1 1.17-6.52-4.78-4.6 6.56-.92L12 2.5z" />
    </svg>
  );
}
