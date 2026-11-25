import clsx from 'clsx';
import { motion, useScroll, useTransform } from 'motion/react';
import {
  ArrowLeft,
  Bookmark,
  Check,
  ExternalLink,
  FolderOpen,
  Heart,
  MoreHorizontal,
  Play,
  RefreshCw,
  Wand2,
  MonitorPlay,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FadeImg, Poster } from '../components/Poster';
import { PosterRowItem, Row } from '../components/Row';
import { Star } from '../components/PosterCard';
import { Badge, Button, Dropdown, IconButton, Spinner } from '../components/ui';
import {
  fixMatch,
  imdbUrl,
  playPath,
  playTarget,
  toggleFavorite,
  toggleWatched,
  toggleWatchlist,
} from '../lib/actions';
import { api } from '../lib/api';
import { bytes, date, hue, runtime } from '../lib/format';
import { img } from '../lib/img';
import { useStore } from '../lib/store';
import type { EpisodeView, MediaFile, SeasonView, TitleDetail, TitleSummary } from '../lib/types';

export function DetailView({ id }: { id: string }) {
  const [detail, setDetail] = useState<TitleDetail | null>(null);
  const version = useStore((s) => s.detailVersion);
  const live = useStore((s) => s.snapshot?.titles.find((t) => t.id === id));
  const closeTitle = useStore((s) => s.closeTitle);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: scrollRef });
  const backdropY = useTransform(scrollY, [0, 600], [0, 180]);
  const backdropOpacity = useTransform(scrollY, [0, 500], [1, 0.35]);
  const headerBg = useTransform(scrollY, [260, 380], [0, 1]);

  useEffect(() => {
    let alive = true;
    api.getTitle(id).then((d) => alive && setDetail(d));
    return () => {
      alive = false;
    };
  }, [id, version]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [id]);

  const t: TitleSummary | undefined = live ?? detail?.summary;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.985, transition: { duration: 0.15 } }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-0 z-30 bg-pane"
    >
      <div ref={scrollRef} className="scroll h-full overflow-y-auto overflow-x-hidden">
        {/* Backdrop */}
        <div className="relative h-[clamp(420px,66vh,660px)] overflow-hidden">
          {t && (
            <motion.div style={{ y: backdropY, opacity: backdropOpacity }} className="absolute inset-0">
              {t.backdrop ? (
                <FadeImg src={t.backdrop} className="absolute inset-0 size-full object-cover object-top" />
              ) : (
                <div
                  className="absolute inset-0 blur-3xl scale-125 opacity-70"
                  style={{
                    background: `radial-gradient(circle at 30% 30%, hsl(${hue(t.name)} 40% 40%), transparent 70%)`,
                  }}
                />
              )}
            </motion.div>
          )}
          {/* Scrims keep the hero a dark, cinematic surface in both themes; the
              fade into the page happens below the text, never under it. */}
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(0_0_0/0.82)_0%,rgb(0_0_0/0.55)_40%,rgb(0_0_0/0.05)_75%)]" />
          <div className="absolute inset-x-0 bottom-0 h-[85%] bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-pane to-transparent" />
          <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/50 to-transparent" />

          {t && (
            <div className="absolute inset-x-0 bottom-0 px-10 pb-16 flex items-end gap-8">
              <div className="hidden xl:block w-[180px] shrink-0 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.7)] rounded-[12px]">
                <Poster
                  src={t.poster}
                  fallback={t.posterAlt}
                  title={t.name}
                  year={t.year}
                  rounded="rounded-[12px]"
                  eager
                />
              </div>
              <div className="flex-1 min-w-0 max-w-[680px]">
                <TitleArt t={t} />
                <MetaLine t={t} detail={detail} />
                {t.overview && (
                  <p className="selectable mt-4 text-[14.5px] leading-relaxed text-white/85 line-clamp-3 max-w-[620px] drop-shadow">
                    {t.overview}
                  </p>
                )}
                <Actions t={t} detail={detail} />
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        {!detail || !t ? (
          <div className="flex justify-center py-20 text-ink-3">
            <Spinner />
          </div>
        ) : (
          <div className="px-10 pb-20">
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-10 mt-2">
              <div className="min-w-0">
                {t.kind === 'series' && detail.seasons.length > 0 && <Episodes t={t} seasons={detail.seasons} />}
                {t.kind === 'movie' && <Files files={detail.files} />}
                {t.cast.length > 0 && <Cast names={t.cast} />}
              </div>
              <InfoCard t={t} d={detail} />
            </div>
          </div>
        )}
        {t && <MoreLikeThis t={t} />}
      </div>

      {/* Floating top bar */}
      <motion.div
        data-tauri-drag-region
        className="absolute inset-x-0 top-0 h-[52px] flex items-center px-4 gap-3 pointer-events-none"
      >
        <motion.div
          style={{ opacity: headerBg }}
          className="absolute inset-0 glass-light border-b border-line pointer-events-none"
        />
        <IconButton tone="glass" label="Back" onClick={closeTitle} className="relative size-8 pointer-events-auto">
          <ArrowLeft className="size-4" />
        </IconButton>
        <motion.div style={{ opacity: headerBg }} className="relative text-[13px] font-semibold text-ink truncate">
          {t?.name}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

function TitleArt({ t }: { t: TitleSummary }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [t.id]);
  if (t.logo && !failed) {
    return (
      <motion.img
        key={t.logo}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        src={img(t.logo)}
        alt={t.name}
        onError={() => setFailed(true)}
        className="max-h-[130px] max-w-[min(480px,100%)] object-contain object-left drop-shadow-[0_6px_30px_rgb(0_0_0/0.55)]"
        draggable={false}
      />
    );
  }
  return <h1 className="font-serif text-white text-[52px] leading-[1.02] tracking-tight drop-shadow-lg">{t.name}</h1>;
}

function MetaLine({ t, detail }: { t: TitleSummary; detail: TitleDetail | null }) {
  const bits: React.ReactNode[] = [];
  if (t.rating)
    bits.push(
      <span key="r" className="inline-flex items-center gap-1">
        <Star className="size-3.5 text-accent" />
        {t.rating.toFixed(1)}
        <span className="text-white/50 text-[11px] font-normal">IMDb</span>
      </span>,
    );
  bits.push(<span key="y">{t.kind === 'series' ? t.yearLabel : t.year}</span>);
  if (t.kind === 'movie' && t.runtime) bits.push(<span key="rt">{runtime(t.runtime)}</span>);
  if (t.kind === 'series')
    bits.push(
      <span key="s">
        {t.seasonCount} season{t.seasonCount === 1 ? '' : 's'} in library
      </span>,
    );
  if (t.genres.length) bits.push(<span key="g">{t.genres.slice(0, 3).join(', ')}</span>);
  const file = detail?.files[0];
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-white/90">
      {bits.map((b, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span className="text-white/35">·</span>}
          {b}
        </span>
      ))}
      <span className="inline-flex gap-1 ml-1">
        {t.quality && <Badge tone="glass">{t.quality}</Badge>}
        {t.hdr && <Badge tone="glass">{file?.hdr === 'Dolby Vision' ? 'Dolby Vision' : 'HDR'}</Badge>}
        {file?.edition && t.kind === 'movie' && <Badge tone="glass">{file.edition}</Badge>}
      </span>
    </div>
  );
}

function Actions({ t, detail }: { t: TitleSummary; detail: TitleDetail | null }) {
  const target = detail ? playTarget(detail) : null;
  const [refreshing, setRefreshing] = useState(false);
  const toast = useStore((s) => s.toast);
  return (
    <div className="mt-6 flex items-center gap-2.5">
      <Button variant="white" size="lg" disabled={!target} onClick={() => target && playPath(target.path, t.name)}>
        <Play className="size-4" fill="currentColor" />
        {target?.label ?? 'Play'}
      </Button>
      {detail?.trailer && (
        <Button
          variant="glass"
          size="lg"
          onClick={() => api.openUrl(`https://www.youtube.com/watch?v=${detail.trailer}`)}
        >
          <MonitorPlay className="size-4" />
          Trailer
        </Button>
      )}
      <IconButton
        tone="glass"
        label={t.watched ? 'Mark as unwatched' : 'Mark as watched'}
        onClick={() => toggleWatched(t)}
        className={clsx('size-11', t.watched && '!bg-accent !text-accent-ink !border-transparent')}
      >
        <Check className="size-[18px]" strokeWidth={2.5} />
      </IconButton>
      <IconButton
        tone="glass"
        label={t.watchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
        onClick={() => toggleWatchlist(t)}
        className="size-11"
      >
        <Bookmark className="size-4" fill={t.watchlist ? 'currentColor' : 'none'} />
      </IconButton>
      <IconButton
        tone="glass"
        label={t.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
        onClick={() => toggleFavorite(t)}
        className={clsx('size-11', t.favorite && '!text-[#ff6b81]')}
      >
        <Heart className="size-4" fill={t.favorite ? 'currentColor' : 'none'} />
      </IconButton>
      <Dropdown
        align="left"
        trigger={() => (
          <IconButton tone="glass" label="More" className="size-11">
            {refreshing ? <Spinner className="text-white" /> : <MoreHorizontal className="size-4" />}
          </IconButton>
        )}
        items={[
          {
            label: 'Show in Finder',
            icon: <FolderOpen />,
            onSelect: () => detail?.files[0] && api.reveal(detail.files[0].path),
          },
          { label: 'Open on IMDb', icon: <ExternalLink />, onSelect: () => api.openUrl(imdbUrl(t.id)) },
          { separator: true, label: '' },
          {
            label: 'Refresh metadata',
            icon: <RefreshCw />,
            onSelect: async () => {
              setRefreshing(true);
              try {
                await api.refreshTitle(t.id);
                toast('Metadata refreshed', 'success');
              } catch (e) {
                toast(`Refresh failed: ${e}`, 'error');
              } finally {
                setRefreshing(false);
              }
            },
          },
          { label: 'Fix match…', icon: <Wand2 />, onSelect: () => fixMatch(t) },
        ]}
      />
    </div>
  );
}

// ------------------------------------------------------------------ episodes

function Episodes({ t, seasons }: { t: TitleSummary; seasons: SeasonView[] }) {
  const defaultSeason = useMemo(() => {
    const withFiles = seasons.filter((s) => s.available > 0 && s.number !== 0);
    const unfinished = withFiles.find((s) => s.episodes.some((e) => e.file && !e.watched));
    return (unfinished ?? withFiles[0] ?? seasons[0]).number;
  }, [seasons]);
  const [season, setSeason] = useState(defaultSeason);
  const [onlyLocal, setOnlyLocal] = useState(true);
  useEffect(() => setSeason(defaultSeason), [t.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = seasons.find((s) => s.number === season) ?? seasons[0];
  const episodes = onlyLocal ? current.episodes.filter((e) => e.file) : current.episodes;

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink">Episodes</h2>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <input
            type="checkbox"
            checked={!onlyLocal}
            onChange={(e) => setOnlyLocal(!e.target.checked)}
            className="accent-[var(--accent-strong)]"
          />
          Show missing episodes
        </label>
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 mb-3">
        {seasons.map((s) => (
          <button
            key={s.number}
            onClick={() => setSeason(s.number)}
            className={clsx(
              'shrink-0 h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-colors',
              s.number === current.number ? 'bg-ink text-pane' : 'bg-active text-ink-2 hover:text-ink',
              s.available === 0 && s.number !== current.number && 'opacity-45',
            )}
          >
            {s.number === 0 ? 'Specials' : `Season ${s.number}`}
            {s.available > 0 && <span className="ml-1.5 opacity-60 tabular-nums">{s.available}</span>}
          </button>
        ))}
      </div>
      <div className="divide-y divide-line">
        {episodes.length === 0 && (
          <p className="py-10 text-center text-ink-2">No episodes from this season in your library.</p>
        )}
        {episodes.map((e) => (
          <EpisodeRow key={`${e.season}-${e.episode}`} t={t} e={e} />
        ))}
      </div>
    </section>
  );
}

function EpisodeRow({ t, e }: { t: TitleSummary; e: EpisodeView }) {
  const update = useStore((s) => s.updateTitleState);
  const has = !!e.file;
  return (
    <div className={clsx('group flex gap-4 py-3.5', !has && 'opacity-45')}>
      <button
        disabled={!has}
        onClick={() => e.file && playPath(e.file.path, `${t.name} · ${e.name}`)}
        className="relative w-[176px] shrink-0 aspect-video rounded-lg overflow-hidden bg-sunken"
      >
        {e.thumbnail ? (
          <FadeImg src={e.thumbnail} className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center font-serif text-ink-3 text-[22px]">
            {e.episode}
          </div>
        )}
        {has && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/35 transition-colors">
            <div className="size-9 rounded-full bg-white text-black flex items-center justify-center opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200">
              <Play className="size-4 ml-0.5" fill="currentColor" />
            </div>
          </div>
        )}
        {e.watched && <div className="absolute bottom-0 inset-x-0 h-[3px] bg-accent" />}
        <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-black/10 dark:ring-white/10" />
      </button>
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-semibold text-ink-3 tabular-nums">{e.episode}</span>
          <span className="text-[14px] font-semibold text-ink truncate">{e.name}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-2">
          {date(e.released) && <span>{date(e.released)}</span>}
          {e.rating ? (
            <span className="inline-flex items-center gap-0.5">
              <Star />
              {e.rating.toFixed(1)}
            </span>
          ) : null}
          {e.file?.quality && <Badge>{e.file.quality}</Badge>}
          {!has && <span className="text-ink-3">Not in library</span>}
        </div>
        {e.overview && (
          <p className="selectable mt-1.5 text-[12.5px] leading-relaxed text-ink-2 line-clamp-2">{e.overview}</p>
        )}
      </div>
      {has && (
        <div className="shrink-0 flex items-start pt-0.5">
          <IconButton
            label={e.watched ? 'Mark as unwatched' : 'Mark as watched'}
            onClick={() => update(`${t.id}:${e.season}:${e.episode}`, { watched: !e.watched })}
            className={clsx(e.watched ? '!text-accent-strong' : 'opacity-0 group-hover:opacity-100')}
          >
            <Check className="size-4" strokeWidth={2.5} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- the rest

function Files({ files }: { files: MediaFile[] }) {
  if (!files.length) return null;
  return (
    <section className="mb-10">
      <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink mb-3">
        {files.length === 1 ? 'File' : 'Files'}
      </h2>
      <div className="rounded-xl bg-elev shadow-[0_0_0_0.5px_var(--line-strong)] divide-y divide-line overflow-hidden">
        {files.map((f) => (
          <div key={f.path} className="group flex items-center gap-4 px-4 py-3">
            <div className="flex-1 min-w-0">
              <div className="selectable font-mono text-[12px] text-ink truncate" title={f.path}>
                {f.fileName}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {[f.quality, f.source, f.codec, f.hdr, f.audio, f.edition].filter(Boolean).map((x) => (
                  <Badge key={x}>{x}</Badge>
                ))}
                <span className="text-[11.5px] text-ink-2 ml-1">{bytes(f.size)}</span>
                {!f.online && <span className="text-[11.5px] text-danger ml-1">Drive not connected</span>}
              </div>
            </div>
            <IconButton label="Show in Finder" onClick={() => api.reveal(f.path)}>
              <FolderOpen className="size-4" />
            </IconButton>
            <Button size="sm" onClick={() => playPath(f.path)}>
              <Play className="size-3" fill="currentColor" /> Play
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function Cast({ names }: { names: string[] }) {
  const setPalette = useStore((s) => s.setPalette);
  return (
    <section className="mt-10">
      <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em] text-ink mb-4">Cast</h2>
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        {names.slice(0, 12).map((n) => (
          <button
            key={n}
            onClick={() => setPalette(true, n)}
            className="flex items-center gap-2.5 group"
            title={`Find more with ${n}`}
          >
            <div
              className="size-10 rounded-full flex items-center justify-center text-[13px] font-semibold text-white/90 shadow-inner"
              style={{
                background: `linear-gradient(140deg, hsl(${hue(n)} 35% 55%), hsl(${(hue(n) + 50) % 360} 40% 35%))`,
              }}
            >
              {n
                .split(' ')
                .map((p) => p[0])
                .slice(0, 2)
                .join('')}
            </div>
            <span className="text-[13px] text-ink group-hover:underline underline-offset-4 decoration-line-strong">
              {n}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function InfoCard({ t, d }: { t: TitleSummary; d: TitleDetail }) {
  const update = useStore((s) => s.updateTitleState);
  const rows: [string, React.ReactNode][] = [];
  if (t.directors.length) rows.push([t.directors.length > 1 ? 'Directors' : 'Director', t.directors.join(', ')]);
  if (d.writers.length) rows.push(['Writers', d.writers.slice(0, 3).join(', ')]);
  if (d.released) rows.push(['Released', date(d.released)]);
  if (t.runtime) rows.push([t.kind === 'series' ? 'Episode length' : 'Runtime', runtime(t.runtime)]);
  if (t.genres.length) rows.push(['Genres', t.genres.join(', ')]);
  if (d.country) rows.push(['Country', d.country]);
  if (d.status && t.kind === 'series') rows.push(['Status', d.status]);
  if (d.awards) rows.push(['Awards', d.awards]);
  rows.push(['In library', `${t.fileCount} file${t.fileCount === 1 ? '' : 's'} · ${bytes(t.totalSize)}`]);

  return (
    <aside className="lg:pt-1">
      <div className="rounded-2xl bg-elev shadow-[0_0_0_0.5px_var(--line-strong),0_2px_8px_rgb(0_0_0/0.04)] p-5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3 mb-2">Your rating</div>
        <StarRating value={t.userRating ?? 0} onChange={(v) => update(t.id, { rating: v })} />
        <dl className="mt-5 space-y-3.5">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{k}</dt>
              <dd className="selectable mt-0.5 text-[13px] text-ink leading-snug">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="mt-3 px-1 text-[11px] text-ink-3">
        Metadata from {d.source === 'tvmaze' ? 'TVMaze' : d.source === 'imdb' ? 'IMDb' : 'Cinemeta / IMDb'}
      </p>
    </aside>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n === value ? 0 : n)}
          aria-label={`${n} stars`}
          className="transition-transform hover:scale-110"
        >
          <Star className={clsx('size-[22px]', n <= shown ? 'text-accent-strong' : 'text-active')} />
        </button>
      ))}
    </div>
  );
}

function MoreLikeThis({ t }: { t: TitleSummary }) {
  const titles = useStore((s) => s.snapshot?.titles);
  const similar = useMemo(() => {
    if (!titles) return [];
    return titles
      .filter((x) => x.id !== t.id)
      .map((x) => ({
        x,
        s: x.genres.filter((g) => t.genres.includes(g)).length + (x.kind === t.kind ? 0.5 : 0) + (x.rating ?? 0) / 20,
      }))
      .filter((r) => r.s >= 1.5)
      .sort((a, b) => b.s - a.s)
      .slice(0, 16)
      .map((r) => r.x);
  }, [titles, t]);
  if (similar.length < 3) return null;
  return (
    <div className="-mx-0 pb-12">
      <Row title="More like this in your library">
        {similar.map((x) => (
          <PosterRowItem key={x.id} t={x} />
        ))}
      </Row>
    </div>
  );
}
