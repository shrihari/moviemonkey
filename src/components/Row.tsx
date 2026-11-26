import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { useRef, useState, useEffect, type MouseEvent, type ReactNode } from 'react';
import { playTitle } from '../lib/actions';
import { img as imgSrc } from '../lib/img';
import { useStore } from '../lib/store';
import type { TitleSummary } from '../lib/types';
import { useContextMenu } from './ContextMenu';
import { FadeImg } from './Poster';
import { PosterCard, titleMenu } from './PosterCard';

export function Row({
  title,
  subtitle,
  onSeeAll,
  children,
}: {
  title: string;
  subtitle?: string;
  onSeeAll?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  };
  useEffect(update, [children]);
  const scroll = (dir: number) =>
    ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: 'smooth' });

  return (
    <section className="group/row relative mt-9 first:mt-6">
      <div className="flex items-end justify-between px-10 mb-1.5">
        <div>
          <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
          {subtitle && <p className="text-[12px] text-ink-2 mt-0.5">{subtitle}</p>}
        </div>
        {onSeeAll && (
          <button onClick={onSeeAll} className="text-[12px] font-medium text-ink-2 hover:text-ink">
            See all
          </button>
        )}
      </div>
      {/* flow-root keeps the scroller's negative margin inside this box, so the edge buttons stay centred */}
      <div className="relative flow-root">
        <div
          ref={ref}
          onScroll={update}
          // A horizontal scroller clips vertically too. pt-3 leaves room for the hover
          // lift and pb-12 for the hover shadow (it reaches ~46px below the card);
          // -mb-8 hands most of that back so the gap to the next row doesn't change.
          className="flex gap-5 overflow-x-auto no-scrollbar px-10 pb-12 -mb-8 pt-3 scroll-px-10 snap-x [overflow-anchor:none]"
        >
          {children}
        </div>
        <EdgeButton side="left" hidden={edges.start} onClick={() => scroll(-1)} />
        <EdgeButton side="right" hidden={edges.end} onClick={() => scroll(1)} />
      </div>
    </section>
  );
}

function EdgeButton({ side, hidden, onClick }: { side: 'left' | 'right'; hidden: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'absolute top-[calc(50%-24px)] -translate-y-1/2 size-9 rounded-full bg-elev shadow-pop flex items-center justify-center text-ink transition-all duration-200',
        side === 'left' ? 'left-3' : 'right-3',
        hidden ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover/row:opacity-100 hover:scale-105',
      )}
      aria-label={side === 'left' ? 'Scroll left' : 'Scroll right'}
    >
      {side === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
    </button>
  );
}

export function PosterRowItem({ t }: { t: TitleSummary }) {
  return (
    <div className="w-[154px] shrink-0 snap-start">
      <PosterCard t={t} />
    </div>
  );
}

/** Landscape card with backdrop + logo, used for "Continue watching" / "Recently added". */
export function BackdropCard({ t, progress, caption }: { t: TitleSummary; progress?: number; caption?: string }) {
  const openTitle = useStore((s) => s.openTitle);
  const showMenu = useContextMenu((s) => s.show);
  const [logoOk, setLogoOk] = useState(true);
  return (
    <div
      className="group w-[300px] shrink-0 snap-start"
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, titleMenu(t));
      }}
    >
      <button
        onClick={() => openTitle(t.id)}
        className="relative isolate block w-full aspect-video rounded-xl overflow-hidden bg-sunken shadow-poster transition-[translate,scale,box-shadow] duration-300 ease-[var(--ease-out-expo)] group-hover:-translate-y-1 group-hover:shadow-poster-hover"
      >
        {/*
          The backdrop and everything drawn over it each keep their own GPU layer
          at all times. Otherwise WebKit gives the zooming backdrop a layer only
          while it animates and paints the title, caption and play button under
          it, so they vanish for the length of the zoom.
        */}
        <FadeImg
          src={t.backdrop}
          fallback={t.poster}
          className="absolute inset-0 size-full object-cover will-change-transform transition-transform duration-700 group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 transform-gpu">
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-3.5 flex items-end gap-3">
            <div className="flex-1 min-w-0 text-left">
              {t.logo && logoOk ? (
                <img
                  src={imgSrc(t.logo)}
                  onError={() => setLogoOk(false)}
                  alt={t.name}
                  className="max-h-[42px] max-w-[180px] object-contain object-left drop-shadow-md"
                  draggable={false}
                />
              ) : (
                <div className="font-serif text-white text-[18px] leading-tight truncate">{t.name}</div>
              )}
              {caption && <div className="mt-1.5 text-[11.5px] font-medium text-white/75 truncate">{caption}</div>}
            </div>
            <div
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                void playTitle(t);
              }}
              className="size-9 shrink-0 rounded-full bg-white text-black flex items-center justify-center opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 hover:scale-110"
            >
              <Play className="size-4 ml-0.5" fill="currentColor" />
            </div>
          </div>
          {progress !== undefined && progress > 0 && (
            <div className="absolute bottom-0 inset-x-0 h-[3px] bg-white/20">
              <div className="h-full bg-accent" style={{ width: `${Math.min(progress, 1) * 100}%` }} />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
        </div>
      </button>
    </div>
  );
}
