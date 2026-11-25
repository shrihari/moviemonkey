import clsx from 'clsx';
import { Search } from 'lucide-react';
import { useEffect, useState, type RefObject } from 'react';
import { routeTitle, useStore } from '../lib/store';
import { GridControls } from '../views/GridView';

const NO_GRID = new Set(['home', 'review', 'settings']);

/**
 * Top bar of the main pane: window drag area, the current view's controls and
 * search. Transparent at the top of a view; once content scrolls under it, it
 * picks up a frosted background and the view's title, like a native toolbar.
 */
export function Toolbar({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const route = useStore((s) => s.route);
  const setPalette = useStore((s) => s.setPalette);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 4);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef]);

  const overHero = route.name === 'home' && !scrolled;
  const grid = !NO_GRID.has(route.name);

  return (
    <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-20 h-[52px] flex items-center gap-3 pl-6 pr-3">
      <div
        className={clsx(
          'absolute inset-0 glass-light border-b border-line pointer-events-none transition-opacity duration-200',
          scrolled ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        className={clsx(
          'relative flex-1 min-w-0 truncate text-[13px] font-semibold text-ink pointer-events-none transition-opacity duration-200',
          scrolled && route.name !== 'home' ? 'opacity-100' : 'opacity-0',
        )}
      >
        {routeTitle(route)}
      </div>
      {grid && (
        <div className="relative">
          <GridControls />
        </div>
      )}
      <button
        onClick={() => setPalette(true)}
        className={clsx(
          'relative shrink-0 flex items-center gap-2 h-8 w-[190px] pl-2.5 pr-1.5 rounded-[9px] text-[13px] transition-colors',
          overHero
            ? 'glass text-white/75 hover:text-white hover:bg-white/20'
            : 'bg-hover text-ink-3 hover:bg-active hover:text-ink-2',
        )}
      >
        <Search className="size-[15px] shrink-0" strokeWidth={2} />
        <span className="flex-1 text-left">Search</span>
        <kbd
          className={clsx(
            'h-[18px] px-1.5 rounded-[5px] text-[10.5px] font-sans font-medium flex items-center',
            overHero ? 'bg-white/15 text-white/80' : 'bg-active text-ink-2',
          )}
        >
          ⌘K
        </kbd>
      </button>
    </div>
  );
}
