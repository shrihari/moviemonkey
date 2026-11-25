import clsx from 'clsx';
import { useState } from 'react';
import { img } from '../lib/img';
import { hue } from '../lib/format';

/**
 * Poster image with a graceful, typographic placeholder while loading or when
 * no artwork exists.
 */
export function Poster({
  src,
  fallback,
  title,
  year,
  className,
  rounded = 'rounded-[10px]',
  eager,
}: {
  src: string | null | undefined;
  fallback?: string | null;
  title: string;
  year?: number | null;
  className?: string;
  rounded?: string;
  eager?: boolean;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>(src || fallback ? 'loading' : 'error');
  const h = hue(title);
  return (
    <div className={clsx('relative aspect-[2/3] overflow-hidden bg-sunken', rounded, className)}>
      {state !== 'ok' && (
        <div
          className="absolute inset-0 flex flex-col justify-end p-3"
          style={{
            background: `linear-gradient(160deg, hsl(${h} 30% 34%), hsl(${(h + 40) % 360} 35% 16%))`,
          }}
        >
          {state === 'loading' && <div className="absolute inset-0 shimmer opacity-30" />}
          <div className="relative font-serif text-white/90 text-[15px] leading-tight line-clamp-3">{title}</div>
          {year && <div className="relative text-white/50 text-[11px] mt-1">{year}</div>}
        </div>
      )}
      {(src || fallback) && state !== 'error' && (
        <img
          src={img(src, fallback)}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          className={clsx(
            'absolute inset-0 size-full object-cover transition-opacity duration-500',
            state === 'ok' ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      <div className={clsx('pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/10 dark:ring-white/10', rounded)} />
    </div>
  );
}

/** Fades in an image when it finishes loading; renders nothing on error. */
export function FadeImg({ src, fallback, className, alt = '' }: { src: string | null | undefined; fallback?: string | null; className?: string; alt?: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  if (!src && !fallback) return null;
  if (state === 'error') return null;
  return (
    <img
      src={img(src, fallback)}
      alt={alt}
      draggable={false}
      decoding="async"
      onLoad={() => setState('ok')}
      onError={() => setState('error')}
      className={clsx('transition-opacity duration-700', state === 'ok' ? 'opacity-100' : 'opacity-0', className)}
    />
  );
}
