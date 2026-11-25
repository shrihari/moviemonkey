import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Bookmark,
  Clapperboard,
  Heart,
  Image as ImageIcon,
  Tv,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PosterCard } from '../components/PosterCard';
import { Dropdown, IconButton, Segmented, SelectButton } from '../components/ui';
import { applyFilterSort, routeTitle, titlesFor, useStore, type Filter, type Route, type SortKey } from '../lib/store';
import type { TitleSummary } from '../lib/types';
import { bytes, plural } from '../lib/format';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'added', label: 'Date added' },
  { value: 'title', label: 'Title' },
  { value: 'year', label: 'Release year' },
  { value: 'rating', label: 'Rating' },
  { value: 'runtime', label: 'Runtime' },
  { value: 'size', label: 'File size' },
];

export function GridView({ route, titles }: { route: Route; titles: TitleSummary[] }) {
  const posterSize = useStore((s) => s.posterSize);
  const sort = useStore((s) => s.sort);
  const sortDesc = useStore((s) => s.sortDesc);
  const filter = useStore((s) => s.filter);
  const base = useMemo(() => titlesFor(route, titles), [route, titles]);
  const shown = useMemo(() => applyFilterSort(base, filter, sort, sortDesc), [base, filter, sort, sortDesc]);
  const size = base.reduce((a, t) => a + t.totalSize, 0);
  const limit = useProgressive(shown.length, route);

  return (
    <div className="relative min-h-full">
      <header className="px-10 pt-2 pb-6">
        <h1 className="font-display text-[30px] font-semibold tracking-[-0.02em] text-ink">{routeTitle(route)}</h1>
        <p className="text-[13px] text-ink-2 mt-1">
          {plural(base.length, 'title')}
          {size > 0 && <> · {bytes(size)}</>}
          {filter !== 'all' && (
            <>
              {' '}
              · showing {shown.length} {filter}
            </>
          )}
        </p>
      </header>

      {shown.length === 0 ? (
        <EmptyCollection route={route} filtered={base.length > 0} />
      ) : (
        <div
          className="grid gap-x-6 gap-y-8 px-10 pb-16"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${posterSize}px, 1fr))` }}
        >
          {shown.slice(0, limit).map((t, i) => (
            <div key={t.id} className="card-in" style={{ '--i': Math.min(i, 24) } as React.CSSProperties}>
              <PosterCard t={t} eager={i < 18} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Filter, sort and poster size for grid views. Lives in the top toolbar. */
export function GridControls() {
  const posterSize = useStore((s) => s.posterSize);
  const sort = useStore((s) => s.sort);
  const sortDesc = useStore((s) => s.sortDesc);
  const filter = useStore((s) => s.filter);
  const setPrefs = useStore((s) => s.setPrefs);
  return (
    <div className="flex items-center gap-1">
      <Segmented<Filter>
        size="sm"
        value={filter}
        onChange={(v) => setPrefs({ filter: v })}
        options={[
          { value: 'all', label: 'All' },
          { value: 'unwatched', label: 'Unwatched' },
          { value: 'watched', label: 'Watched' },
        ]}
      />
      <div className="w-px h-4 bg-line-strong mx-1.5" />
      <Dropdown
        align="right"
        trigger={(open) => <SelectButton open={open} label={SORTS.find((s) => s.value === sort)?.label} />}
        items={SORTS.map((s) => ({
          label: s.label,
          checked: s.value === sort,
          onSelect: () => setPrefs({ sort: s.value, sortDesc: s.value === 'title' ? false : true }),
        }))}
      />
      <IconButton
        label={sortDesc ? 'Descending' : 'Ascending'}
        onClick={() => setPrefs({ sortDesc: !sortDesc })}
        className="size-7"
      >
        {sortDesc ? <ArrowDownWideNarrow className="size-4" /> : <ArrowUpNarrowWide className="size-4" />}
      </IconButton>
      {/* the slider gives way first when the window is narrow */}
      <div className="hidden @[900px]:flex items-center gap-1.5">
        <div className="w-px h-4 bg-line-strong mx-1.5" />
        <ImageIcon className="size-3 text-ink-3" />
        <input
          type="range"
          className="slider w-20"
          min={120}
          max={260}
          value={posterSize}
          onChange={(e) => setPrefs({ posterSize: +e.target.value })}
          aria-label="Poster size"
        />
        <ImageIcon className="size-4 text-ink-3" />
      </div>
    </div>
  );
}

/**
 * Render the first screenful immediately and the rest in chunks on later
 * frames, so switching to a 2,000-title view feels instant.
 */
function useProgressive(total: number, resetKey: unknown): number {
  const FIRST = 60;
  const STEP = 240;
  const [limit, setLimit] = useState(FIRST);
  useEffect(() => setLimit(FIRST), [resetKey]);
  useEffect(() => {
    if (limit >= total) return;
    const id = requestAnimationFrame(() => setLimit((l) => l + STEP));
    return () => cancelAnimationFrame(id);
  }, [limit, total]);
  return limit;
}

function EmptyCollection({ route, filtered }: { route: Route; filtered: boolean }) {
  const setPrefs = useStore((s) => s.setPrefs);
  const Icon =
    route.name === 'watchlist'
      ? Bookmark
      : route.name === 'favorites'
        ? Heart
        : route.name === 'shows'
          ? Tv
          : Clapperboard;
  const text = filtered
    ? 'Nothing matches this filter.'
    : route.name === 'watchlist'
      ? 'Bookmark anything you want to get to next. It will show up here.'
      : route.name === 'favorites'
        ? 'Heart the titles you love and they will collect here.'
        : 'Nothing here yet.';
  return (
    <div className="flex flex-col items-center justify-center text-center py-28 px-10">
      <div className="size-14 rounded-2xl bg-sunken flex items-center justify-center text-ink-3 mb-4">
        <Icon className="size-6" />
      </div>
      <p className="text-ink-2 max-w-xs">{text}</p>
      {filtered && (
        <button
          onClick={() => setPrefs({ filter: 'all' })}
          className="mt-3 text-[13px] font-medium text-ink underline underline-offset-4 decoration-line-strong"
        >
          Show all
        </button>
      )}
    </div>
  );
}
