import clsx from 'clsx';
import { useState, type ReactNode } from 'react';
import type { TitleSummary } from '../lib/types';
import { hue } from '../lib/format';
import icon from '../assets/app-icon.png';
import { img } from './api';

/** A big, remote-friendly button. Focused: white with dark text. */
export function Button({
  children,
  onClick,
  icon,
  primary,
  navId,
  autoDefault,
  className,
}: {
  children?: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
  primary?: boolean;
  navId?: string;
  autoDefault?: boolean;
  className?: string;
}) {
  return (
    <button
      data-nav
      data-nav-id={navId}
      data-nav-default={autoDefault ? '' : undefined}
      onClick={onClick}
      className={clsx(
        'flex shrink-0 items-center gap-3 h-14 rounded-full whitespace-nowrap font-semibold text-[1.35rem] transition-[transform,background-color,color] duration-200',
        children ? 'px-8' : 'w-14 justify-center',
        primary ? 'bg-white/90 text-black' : 'bg-white/12 text-ink',
        'focus:bg-white focus:text-black focus:scale-[1.06]',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function Img({ src, className, alt = '' }: { src: string | undefined; className?: string; alt?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className={clsx(className, 'transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
    />
  );
}

function Placeholder({ t }: { t: TitleSummary }) {
  const h = hue(t.name);
  return (
    <div
      className="absolute inset-0 flex items-end p-4"
      style={{ background: `linear-gradient(160deg, hsl(${h} 30% 24%), hsl(${(h + 40) % 360} 25% 12%))` }}
    >
      <span className="font-display text-[1.3rem] font-semibold leading-tight text-white/85">{t.name}</span>
    </div>
  );
}

/** Poster card for rows and grids. */
export function PosterCard({
  t,
  onOpen,
  navId,
  fluid,
}: {
  t: TitleSummary;
  onOpen: () => void;
  navId: string;
  /** Fill a grid cell instead of the fixed row width. */
  fluid?: boolean;
}) {
  return (
    <button
      data-nav
      data-nav-id={navId}
      onClick={onOpen}
      className={clsx(
        'group relative shrink-0 aspect-[2/3] rounded-xl overflow-hidden bg-card',
        fluid ? 'w-full' : 'w-[13rem]',
        'transition-transform duration-300 ease-[var(--ease-out-expo)] focus:scale-[1.08] focus:z-10',
      )}
    >
      <Placeholder t={t} />
      <Img src={img(t.poster, t.posterAlt, 'w342')} className="absolute inset-0 size-full object-cover" />
      {t.watched && (
        <span className="absolute top-2.5 right-2.5 size-7 rounded-full bg-black/70 text-accent flex items-center justify-center text-[1rem] font-bold">
          ✓
        </span>
      )}
      <span className="pointer-events-none absolute inset-0 rounded-xl ring-inset ring-white/0 group-focus:ring-[0.25rem] group-focus:ring-white transition-[box-shadow]" />
    </button>
  );
}

/** Landscape card: backdrop with the title's logo, for "Continue watching". */
export function BackdropCard({
  t,
  onOpen,
  navId,
  caption,
}: {
  t: TitleSummary;
  onOpen: () => void;
  navId: string;
  caption?: string | null;
}) {
  const [logoOk, setLogoOk] = useState(true);
  return (
    <button
      data-nav
      data-nav-id={navId}
      onClick={onOpen}
      className="group relative shrink-0 w-[26rem] aspect-video rounded-xl overflow-hidden bg-card text-left transition-transform duration-300 ease-[var(--ease-out-expo)] focus:scale-[1.06] focus:z-10"
    >
      <Placeholder t={t} />
      <Img src={img(t.backdrop, t.poster)} className="absolute inset-0 size-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5">
        {t.logo && logoOk ? (
          <img
            src={img(t.logo)}
            onError={() => setLogoOk(false)}
            alt={t.name}
            className="max-h-[4rem] max-w-[16rem] object-contain object-left drop-shadow"
            draggable={false}
          />
        ) : (
          <div className="font-display text-[1.6rem] font-semibold leading-tight text-white">{t.name}</div>
        )}
        {caption && <div className="mt-2 text-[1.05rem] font-medium text-white/75">{caption}</div>}
      </div>
      <span className="pointer-events-none absolute inset-0 rounded-xl ring-inset group-focus:ring-[0.25rem] group-focus:ring-white" />
    </button>
  );
}

/** A titled, horizontally scrolling row of cards. */
export function Row({ title, children, first }: { title: string; children: ReactNode; first?: boolean }) {
  return (
    <section data-nav-row={first ? 'top' : ''} className="mt-10 first:mt-0">
      <h2 className="px-24 mb-4 font-display text-[1.7rem] font-semibold text-ink">{title}</h2>
      <div
        data-nav-group
        data-scroll-x
        className="flex gap-6 overflow-x-auto no-scrollbar px-24 py-5 -my-5 scroll-px-24"
      >
        {children}
      </div>
    </section>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={clsx('size-12 rounded-full border-[0.3rem] border-white/20 border-t-white spin', className)}
      aria-label="Loading"
    />
  );
}

export function Monkey({ className }: { className?: string }) {
  return <img src={icon} alt="" className={className} draggable={false} />;
}
