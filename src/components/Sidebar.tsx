import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bookmark,
  ChevronRight,
  Clapperboard,
  Eye,
  FolderPlus,
  Heart,
  Home,
  Search,
  Settings,
  Sparkles,
  Tv,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import monkey from '../assets/monkey.svg';
import { topGenres, useStore, type Route } from '../lib/store';
import { Kbd, Spinner } from './ui';

function sameRoute(a: Route, b: Route) {
  return a.name === b.name && (a.name !== 'genre' || (b.name === 'genre' && a.genre === b.genre));
}

function NavItem({
  icon: Icon,
  label,
  count,
  route,
  dot,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  count?: number;
  route: Route;
  dot?: boolean;
}) {
  const current = useStore((s) => s.route);
  const detailOpen = useStore((s) => !!s.openTitleId);
  const navigate = useStore((s) => s.navigate);
  const active = sameRoute(current, route);
  return (
    <button
      onClick={() => navigate(route)}
      className={clsx(
        'group w-full flex items-center gap-2.5 h-[30px] px-2.5 rounded-[8px] text-[13px] transition-colors',
        active ? (detailOpen ? 'bg-hover text-ink' : 'bg-active text-ink font-medium') : 'text-ink/80 hover:bg-hover',
      )}
    >
      {Icon ? (
        <Icon className={clsx('size-[16px] shrink-0', active ? 'text-ink' : 'text-ink-2')} strokeWidth={1.9} />
      ) : (
        <span className="size-[16px] shrink-0" />
      )}
      <span className="flex-1 truncate text-left">{label}</span>
      {dot && <span className="size-1.5 rounded-full bg-accent-strong" />}
      {count !== undefined && count > 0 && (
        <span className="text-[11.5px] text-ink-3 tabular-nums">{count.toLocaleString()}</span>
      )}
    </button>
  );
}

function Section({ title, children, collapsible }: { title: string; children: ReactNode; collapsible?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-5">
      <button
        onClick={() => collapsible && setOpen((o) => !o)}
        className="group flex items-center gap-1 px-2.5 mb-1 text-[11px] font-semibold text-ink-3 tracking-wide"
      >
        {title}
        {collapsible && (
          <ChevronRight
            className={clsx('size-3 transition-transform opacity-0 group-hover:opacity-100', open && 'rotate-90')}
          />
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden space-y-px"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Sidebar() {
  const snapshot = useStore((s) => s.snapshot);
  const setPalette = useStore((s) => s.setPalette);
  const navigate = useStore((s) => s.navigate);
  const addFolders = useStore((s) => s.addFolders);
  const titles = snapshot?.titles ?? [];
  const genres = useMemo(() => topGenres(titles, 10), [titles]);
  const counts = useMemo(
    () => ({
      movies: titles.filter((t) => t.kind === 'movie').length,
      shows: titles.filter((t) => t.kind === 'series').length,
      unwatched: titles.filter((t) => !t.watched).length,
      watchlist: titles.filter((t) => t.watchlist).length,
      favorites: titles.filter((t) => t.favorite).length,
    }),
    [titles],
  );
  const unmatched = snapshot?.stats.unmatched ?? 0;
  const hasLibrary = (snapshot?.folders.length ?? 0) > 0;

  return (
    <aside className="w-[232px] shrink-0 h-full flex flex-col bg-sidebar">
      {/* window drag area + brand */}
      <div data-tauri-drag-region className="h-[52px] shrink-0 flex items-center justify-end px-3">
        <img src={monkey} alt="" className="size-[22px] pointer-events-none opacity-90" data-tauri-drag-region />
      </div>

      <div className="px-2.5">
        <button
          onClick={() => setPalette(true)}
          className="w-full flex items-center gap-2.5 h-[30px] px-2.5 rounded-[8px] text-[13px] text-ink-2 hover:bg-hover hover:text-ink transition-colors"
        >
          <Search className="size-[16px]" strokeWidth={1.9} />
          <span className="flex-1 text-left">Search</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto no-scrollbar px-2.5 pt-2 pb-4">
        <div className="space-y-px">
          <NavItem icon={Home} label="Home" route={{ name: 'home' }} />
          <NavItem icon={Clapperboard} label="Movies" count={counts.movies} route={{ name: 'movies' }} />
          <NavItem icon={Tv} label="TV Shows" count={counts.shows} route={{ name: 'shows' }} />
        </div>

        {hasLibrary && (
          <Section title="Collections">
            <NavItem icon={Eye} label="Unwatched" count={counts.unwatched} route={{ name: 'unwatched' }} />
            <NavItem icon={Bookmark} label="Watchlist" count={counts.watchlist} route={{ name: 'watchlist' }} />
            <NavItem icon={Heart} label="Favorites" count={counts.favorites} route={{ name: 'favorites' }} />
            {unmatched > 0 && (
              <NavItem icon={Sparkles} label="Needs review" count={unmatched} dot route={{ name: 'review' }} />
            )}
          </Section>
        )}

        {genres.length > 0 && (
          <Section title="Genres" collapsible>
            {genres.map((g) => (
              <NavItem key={g.genre} label={g.genre} count={g.count} route={{ name: 'genre', genre: g.genre }} />
            ))}
          </Section>
        )}
      </nav>

      <ProgressCard />

      <div className="shrink-0 px-2.5 pb-3 pt-1 flex items-center gap-1">
        <button
          onClick={() => addFolders()}
          className="flex-1 flex items-center gap-2.5 h-[30px] px-2.5 rounded-[8px] text-[13px] text-ink-2 hover:bg-hover hover:text-ink transition-colors"
        >
          <FolderPlus className="size-[16px]" strokeWidth={1.9} />
          Add folder…
        </button>
        <button
          onClick={() => navigate({ name: 'settings' })}
          title="Settings"
          className="size-[30px] flex items-center justify-center rounded-[8px] text-ink-2 hover:bg-hover hover:text-ink"
        >
          <Settings className="size-[16px]" strokeWidth={1.9} />
        </button>
      </div>
    </aside>
  );
}

function ProgressCard() {
  const progress = useStore((s) => s.progress);
  const [lastDone, setLastDone] = useState<{ matched: number; failed: number; deferred: number } | null>(null);
  const [wasActive, setWasActive] = useState(false);

  useEffect(() => {
    if (progress.active) {
      setWasActive(true);
      setLastDone(null);
    } else if (wasActive) {
      setWasActive(false);
      if (progress.matched + progress.failed + progress.deferred > 0) {
        setLastDone({ matched: progress.matched, failed: progress.failed, deferred: progress.deferred });
        // Offline results stay visible until the automatic retry succeeds.
        if (!progress.deferred) {
          const t = setTimeout(() => setLastDone(null), 5000);
          return () => clearTimeout(t);
        }
      }
    }
  }, [progress.active, progress.matched, progress.failed, progress.deferred, wasActive]);

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const show = progress.active || lastDone;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: 8, height: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="shrink-0 px-2.5 overflow-hidden"
        >
          <div className="mb-2 p-3 rounded-xl bg-elev/80 shadow-[0_0_0_0.5px_var(--line-strong),0_2px_8px_rgb(0_0_0/0.06)]">
            {progress.active ? (
              <>
                <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                  <Spinner className="size-3.5 text-ink-2" />
                  {progress.phase === 'scanning' ? 'Scanning folders…' : 'Identifying titles…'}
                  {progress.phase === 'identifying' && (
                    <span className="ml-auto text-ink-3 tabular-nums font-normal">
                      {progress.done}/{progress.total}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 text-[11.5px] text-ink-2 truncate">
                  {progress.current?.split('/').pop() ?? ' '}
                </div>
                <div className="mt-2 h-1 rounded-full bg-active overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-accent-strong"
                    animate={{ width: progress.phase === 'scanning' ? '12%' : `${Math.max(pct, 4)}%` }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </div>
              </>
            ) : lastDone?.deferred ? (
              <div className="text-[12px]">
                <div className="flex items-center gap-1.5 font-medium text-ink">
                  <WifiOff className="size-3.5 text-ink-2" />
                  Can’t reach metadata services
                </div>
                <div className="text-ink-2 mt-0.5 leading-snug">
                  {lastDone.deferred} title{lastDone.deferred === 1 ? '' : 's'} waiting. Retrying automatically.
                </div>
              </div>
            ) : lastDone ? (
              <div className="text-[12px]">
                <div className="font-medium text-ink">Library up to date</div>
                <div className="text-ink-2 mt-0.5">
                  {lastDone.matched} identified{lastDone.failed ? ` · ${lastDone.failed} need review` : ''}
                </div>
              </div>
            ) : null}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
