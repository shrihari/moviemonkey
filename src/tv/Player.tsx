import clsx from 'clsx';
import { AudioLines, Captions, FastForward, Pause, Play, Rewind, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, base, mediaUrl, type PlayPlan, type SubOption } from './api';
import { basicCaps, detectCaps, type Caps } from './caps';
import { focusDefault, focusEl, onKeys } from './nav';
import type { PlayRequest } from './Title';
import { Spinner } from './ui';

type HlsLike = {
  destroy(): void;
  loadSource(u: string): void;
  attachMedia(v: HTMLVideoElement): void;
  levels?: { details?: { totalduration: number } }[];
};

interface Cue {
  start: number;
  end: number;
  text: string;
}

function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  const time = (t: string) => {
    const [main, frac = '0'] = t.trim().split('.');
    const p = main.split(':').map(Number);
    const secs = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
    return secs + Number(`0.${frac}`);
  };
  for (const block of vtt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, rest] = lines[i].split('-->');
    const b = rest.trim().split(/\s+/)[0];
    const text = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (text) cues.push({ start: time(a), end: time(b), text });
  }
  return cues;
}

export function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * TVs and Safari have solid HLS players of their own (with hardware HEVC and
 * HDR). Desktop Chrome has started claiming HLS support too, but its player
 * trips over streams that are still being prepared, so elsewhere hls.js does it.
 */
function useNativeHls(): boolean {
  if (!detectCaps().nativeHls) return false;
  const ua = navigator.userAgent;
  const tv = /Web0S|webOS|Tizen|SMART-TV|SmartTV/i.test(ua);
  const safari = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);
  return tv || safari || !('MediaSource' in window);
}

const SEEK_SMALL = 10;
const SEEK_BIG = 30;
const HIDE_AFTER = 4000;

/** Remember subtitle choices across episodes. */
let preferredSubLanguage: string | null | undefined;

export function PlayerScreen({
  req,
  onExit,
  onNext,
}: {
  req: PlayRequest;
  onExit: () => void;
  /** Play the next episode, if there is one. */
  onNext?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const hls = useRef<HlsLike | null>(null);
  const plan = useRef<PlayPlan | null>(null);
  const attempt = useRef(0);
  /** Bumped on every (re)start, so events from a stream being replaced are ignored. */
  const generation = useRef(0);
  const audioRef = useRef<number | null>(null);
  const [planState, setPlan] = useState<PlayPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(req.start);
  const [controls, setControls] = useState(true);
  const [menu, setMenu] = useState<'subs' | 'audio' | null>(null);
  const [sub, setSub] = useState<SubOption | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [cueText, setCueText] = useState('');
  const [ended, setEnded] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const restartTimer = useRef<number | undefined>(undefined);
  /** Where a jump past the prepared part is headed, while it waits to restart. */
  const pendingSeek = useRef<number | null>(null);
  const lastSaved = useRef(0);

  const duration = planState?.duration ?? (video.current?.duration || 0);
  const abs = () => pendingSeek.current ?? (plan.current?.offset ?? 0) + (video.current?.currentTime ?? 0);

  const save = useCallback(() => {
    const p = plan.current;
    if (!p || p.mode === 'unsupported') return;
    const pos = abs();
    if (pos < 1) return;
    lastSaved.current = Date.now();
    void api.progress(req.file.id, pos, p.duration).catch(() => {});
  }, [req.file.id]);

  const teardown = () => {
    hls.current?.destroy();
    hls.current = null;
    const v = video.current;
    if (v) {
      v.removeAttribute('src');
      v.load();
    }
    if (plan.current?.session) void api.stop(plan.current.session);
  };

  /** Ask Movie Monkey how to play from `start` seconds, then start playing. */
  const start = useCallback(
    async (startAt: number, caps: Caps = detectCaps(), forceHls = false) => {
      const gen = ++generation.current;
      setLoading(true);
      setError(null);
      teardown();
      let p: PlayPlan;
      try {
        p = await api.play(req.file.id, { caps, audio: audioRef.current, start: startAt, forceHls });
      } catch (e) {
        if (gen !== generation.current) return;
        setLoading(false);
        setError(e instanceof ApiError ? e.message : String(e));
        return;
      }
      if (gen !== generation.current) {
        if (p.session) void api.stop(p.session);
        return;
      }
      plan.current = p;
      setPlan(p);
      if (p.mode === 'unsupported' || !p.url) {
        setLoading(false);
        setError(p.error ?? "This file can't be played on this TV.");
        return;
      }
      const v = video.current!;
      // Subtitles: keep the chosen language across restarts and episodes.
      const want =
        preferredSubLanguage === undefined
          ? (p.subtitles.find((s) => s.forced) ?? null)
          : (p.subtitles.find((s) => s.language === preferredSubLanguage && !s.forced) ??
            p.subtitles.find((s) => s.language === preferredSubLanguage) ??
            null);
      void chooseSub(want, p);
      const seekTo = p.mode === 'direct' ? startAt : 0;
      const onMeta = () => {
        if (seekTo > 1) v.currentTime = seekTo;
        else if (p.mode === 'hls' && v.currentTime > 1) v.currentTime = 0;
        void v.play().catch(() => setPaused(true));
      };
      v.addEventListener('loadedmetadata', onMeta, { once: true });
      if (p.mode === 'direct') {
        v.src = mediaUrl(p.url);
      } else if (useNativeHls()) {
        v.src = base + p.url;
      } else {
        const { default: Hls } = await import('hls.js');
        if (gen !== generation.current) return;
        // A stream still being prepared looks like live TV to hls.js, which
        // would jump ahead to the newest chunk. Start at the beginning and stay.
        const h = new Hls({
          startPosition: 0,
          maxBufferLength: 30,
          maxMaxBufferLength: 90,
          backBufferLength: 60,
          liveSyncDurationCount: 1e9,
          liveMaxLatencyDurationCount: Infinity,
        });
        h.on(Hls.Events.ERROR, (_e, data) => {
          console.warn('hls', data.type, data.details, data.fatal, data.reason ?? '', data.error?.message ?? '');
          if (data.fatal && gen === generation.current) fail(`hls: ${data.details}`);
        });
        h.loadSource(base + p.url);
        h.attachMedia(v);
        hls.current = h;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [req.file.id],
  );

  /** The TV said it could play this but couldn't: repackage, then convert everything. */
  const fail = (why: string) => {
    const p = plan.current;
    const at = abs();
    console.warn('playback failed', why, p?.mode);
    attempt.current += 1;
    if (attempt.current === 1 && p?.mode === 'direct') void start(at, detectCaps(), true);
    else if (attempt.current <= 2) void start(at, basicCaps(), true);
    else {
      setLoading(false);
      setError("This file won't play on this TV.");
    }
  };

  const chooseSub = async (s: SubOption | null, p: PlayPlan | null = plan.current) => {
    setSub(s);
    setCues([]);
    setCueText('');
    if (!s || !p) return;
    try {
      const res = await fetch(mediaUrl(s.url));
      if (res.ok) setCues(parseVtt(await res.text()));
    } catch {
      /* no subtitles, then */
    }
  };

  useEffect(() => {
    void start(req.start);
    const iv = window.setInterval(() => {
      if (video.current && !video.current.paused && Date.now() - lastSaved.current > 10_000) save();
    }, 2000);
    return () => {
      window.clearInterval(iv);
      save();
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.file.id]);

  // ------------------------------------------------------------ controls

  const poke = useCallback(() => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!video.current?.paused && !menuRef.current) setControls(false);
    }, HIDE_AFTER);
  }, []);
  const menuRef = useRef(menu);
  menuRef.current = menu;

  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play();
    else {
      v.pause();
      save();
    }
    poke();
  };

  const seekTo = (target: number) => {
    const p = plan.current;
    const v = video.current;
    if (!p || !v) return;
    const end = duration || Infinity;
    target = Math.max(0, Math.min(target, end - 2));
    setNow(target);
    if (p.mode === 'direct') {
      v.currentTime = target;
      return;
    }
    // Within what's been prepared: seek. Further: start preparing from there,
    // once the remote has stopped clicking.
    const rel = target - p.offset;
    window.clearTimeout(restartTimer.current);
    if (rel >= 0 && rel < preparedEnd() - 1) {
      pendingSeek.current = null;
      v.currentTime = rel;
    } else {
      pendingSeek.current = target;
      restartTimer.current = window.setTimeout(() => {
        pendingSeek.current = null;
        void start(target);
      }, 700);
    }
  };
  /** How much of the repackaged stream exists so far, in the video's clock. */
  const preparedEnd = () => {
    const v = video.current;
    if (!v) return 0;
    let end = v.seekable.length ? v.seekable.end(v.seekable.length - 1) : 0;
    if (v.buffered.length) end = Math.max(end, v.buffered.end(v.buffered.length - 1));
    const total = hls.current?.levels?.[0]?.details?.totalduration;
    return Math.max(end, total ?? 0);
  };
  const seekBy = (d: number) => {
    seekTo(abs() + d);
    poke();
  };

  useEffect(
    () =>
      onKeys((key) => {
        if (menu) {
          if (key === 'back') {
            setMenu(null);
            return true;
          }
          return false;
        }
        const active = document.activeElement as HTMLElement | null;
        if (!controls) {
          if (key === 'left' || key === 'right' || key === 'rw' || key === 'ff') {
            const big = key === 'rw' || key === 'ff';
            seekBy((key === 'left' || key === 'rw' ? -1 : 1) * (big ? SEEK_BIG : SEEK_SMALL));
            // The bar is now showing with the position focused: more presses keep seeking.
            requestAnimationFrame(() => focusDefault());
            return true;
          }
          if (key === 'enter' || key === 'playpause') return (togglePlay(), true);
          if (key === 'up' || key === 'down') {
            poke();
            requestAnimationFrame(() => focusDefault());
            return true;
          }
          if (key === 'back') return false;
        }
        poke();
        if (key === 'play') return (void video.current?.play(), true);
        if (key === 'pause') return (video.current?.pause(), save(), true);
        if (key === 'playpause') return (togglePlay(), true);
        if (key === 'ff' || key === 'rw') return (seekBy(key === 'ff' ? SEEK_BIG : -SEEK_BIG), true);
        if (active?.dataset.navId === 'scrub' && (key === 'left' || key === 'right')) {
          seekBy(key === 'left' ? -SEEK_SMALL : SEEK_SMALL);
          return true;
        }
        if (key === 'back' && controls && !video.current?.paused) {
          setControls(false);
          return true;
        }
        return false;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controls, menu, duration],
  );

  useEffect(() => {
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [poke]);

  useEffect(() => {
    if (controls && !menu) requestAnimationFrame(() => focusDefault());
  }, [controls, menu]);

  const onTime = () => {
    if (pendingSeek.current !== null) return;
    const t = abs();
    setNow(t);
    if (cues.length) {
      const rel = video.current?.currentTime ?? 0;
      const c = cues.find((c) => rel >= c.start && rel <= c.end);
      setCueText(c?.text ?? '');
    }
  };

  const p = planState;
  const pct = duration ? Math.min(1, now / duration) : 0;
  const hasAudioChoice = (p?.audio.length ?? 0) > 1;

  return (
    <div className="fixed inset-0 bg-black" onMouseMove={poke}>
      <video
        ref={video}
        crossOrigin="anonymous"
        playsInline
        className="absolute inset-0 size-full"
        onTimeUpdate={onTime}
        onPlaying={() => {
          setLoading(false);
          setPaused(false);
        }}
        onPause={() => {
          setPaused(true);
          setControls(true);
        }}
        onPlay={() => setPaused(false)}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onError={() => {
          const v = video.current;
          // Clearing the source while switching streams also raises an error.
          if (!v?.getAttribute('src')) return;
          fail(`video error ${v.error?.code} ${v.error?.message ?? ''}`);
        }}
        onEnded={() => {
          setEnded(true);
          save();
          if (onNext) onNext();
          else onExit();
        }}
      />

      {cueText && (
        <div className="absolute inset-x-0 bottom-[9%] flex justify-center px-24 pointer-events-none">
          <div
            className="text-center text-[2.4rem] font-semibold leading-[1.25] text-white whitespace-pre-line"
            style={{ textShadow: '0 0 0.2rem #000, 0 0 0.4rem #000, 0.1rem 0.1rem 0.2rem #000' }}
          >
            {cueText}
          </div>
        </div>
      )}

      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Spinner className="size-16" />
        </div>
      )}

      {error && (
        <div
          data-nav-scope
          className="absolute inset-0 flex flex-col items-center justify-center text-center px-40 bg-black/80"
        >
          <h2 className="font-display text-[2.6rem] font-bold">Can't play this here</h2>
          <p className="mt-4 max-w-[52rem] text-[1.4rem] leading-relaxed text-ink-2">{error}</p>
          <button
            data-nav
            data-nav-default
            onClick={onExit}
            className="mt-10 h-14 px-10 rounded-full bg-white/12 text-[1.35rem] font-semibold focus:bg-white focus:text-black"
          >
            Back
          </button>
        </div>
      )}

      <div
        className={clsx(
          'absolute inset-0 transition-opacity duration-300',
          controls && !error && !ended ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      >
        <div className="absolute inset-x-0 top-0 h-[14rem] bg-gradient-to-b from-black/70 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[22rem] bg-gradient-to-t from-black/85 to-transparent" />
        <div className="absolute top-12 left-24 right-24">
          <div className="font-display text-[2rem] font-bold">{req.title.summary.name}</div>
          {req.label && <div className="mt-1 text-[1.3rem] text-ink-2">{req.label}</div>}
        </div>
        {controls && !error && (
          <div className="absolute left-24 right-24 bottom-14">
            <button
              data-nav
              data-nav-id="scrub"
              data-nav-default
              className="group block w-full py-4 -my-4"
              onClick={togglePlay}
              aria-label="Position"
            >
              <div className="relative h-[0.45rem] group-focus:h-[0.7rem] rounded-full bg-white/25 transition-[height] duration-150">
                <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct * 100}%` }} />
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 size-[1.4rem] rounded-full bg-white opacity-0 group-focus:opacity-100 transition-opacity"
                  style={{ left: `${pct * 100}%` }}
                />
              </div>
            </button>
            <div className="mt-4 flex items-center text-[1.2rem] font-medium tabular-nums text-ink-2">
              <span>{fmtTime(now)}</span>
              {p?.note && <span className="ml-6 text-ink-3">{p.note}</span>}
              <span className="ml-auto">-{fmtTime(Math.max(0, duration - now))}</span>
            </div>
            <div className="mt-6 flex items-center gap-4">
              <CtlButton id="playpause" label={paused ? 'Play' : 'Pause'} onClick={togglePlay}>
                {paused ? (
                  <Play className="size-7" fill="currentColor" />
                ) : (
                  <Pause className="size-7" fill="currentColor" />
                )}
              </CtlButton>
              <CtlButton id="back10" label={`Back ${SEEK_SMALL} seconds`} onClick={() => seekBy(-SEEK_SMALL)}>
                <Rewind className="size-7" />
              </CtlButton>
              <CtlButton id="fwd30" label={`Forward ${SEEK_BIG} seconds`} onClick={() => seekBy(SEEK_BIG)}>
                <FastForward className="size-7" />
              </CtlButton>
              <div className="ml-auto flex gap-4">
                {(p?.subtitles.length ?? 0) > 0 && (
                  <CtlButton id="subs" label="Subtitles" active={!!sub} onClick={() => setMenu('subs')}>
                    <Captions className="size-7" />
                  </CtlButton>
                )}
                {hasAudioChoice && (
                  <CtlButton id="audio" label="Audio" onClick={() => setMenu('audio')}>
                    <AudioLines className="size-7" />
                  </CtlButton>
                )}
                {onNext && (
                  <CtlButton id="next" label="Next episode" onClick={onNext}>
                    <SkipForward className="size-7" fill="currentColor" />
                  </CtlButton>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {menu && p && (
        <Menu
          title={menu === 'subs' ? 'Subtitles' : 'Audio'}
          options={
            menu === 'subs'
              ? [
                  { key: 'off', label: 'Off', selected: !sub },
                  ...p.subtitles.map((s) => ({ key: s.id, label: s.label, selected: sub?.id === s.id })),
                ]
              : p.audio.map((a) => ({ key: String(a.index), label: a.label, selected: a.selected }))
          }
          onPick={(key) => {
            setMenu(null);
            if (menu === 'subs') {
              const s = p.subtitles.find((x) => x.id === key) ?? null;
              preferredSubLanguage = s?.language ?? null;
              void chooseSub(s);
            } else {
              const idx = Number(key);
              if (p.audio.find((a) => a.index === idx)?.selected) return;
              audioRef.current = idx;
              void start(abs());
            }
          }}
        />
      )}
    </div>
  );
}

function CtlButton({
  id,
  label,
  onClick,
  children,
  isDefault,
  active,
}: {
  id: string;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  isDefault?: boolean;
  active?: boolean;
}) {
  return (
    <button
      data-nav
      data-nav-id={id}
      data-nav-default={isDefault ? '' : undefined}
      onClick={onClick}
      aria-label={label}
      className={clsx(
        'group relative size-16 rounded-full flex items-center justify-center transition-[transform,background-color,color] duration-150',
        active ? 'bg-white/25 text-ink' : 'bg-white/12 text-ink',
        'focus:bg-white focus:text-black focus:scale-110',
      )}
    >
      {children}
      <span className="pointer-events-none absolute top-full mt-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black/80 px-3 py-1.5 text-[1rem] font-medium text-white opacity-0 group-focus:opacity-100 transition-opacity">
        {label}
      </span>
    </button>
  );
}

function Menu({
  title,
  options,
  onPick,
}: {
  title: string;
  options: { key: string; label: string; selected: boolean }[];
  onPick: (key: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sel = root.current?.querySelector<HTMLElement>('[data-selected]');
    if (sel) focusEl(sel);
    else focusDefault(root.current ?? undefined);
  }, []);
  return (
    <div className="absolute inset-0 bg-black/40">
      <div
        ref={root}
        data-nav-scope
        className="absolute right-0 inset-y-0 w-[34rem] bg-[#161514] px-10 pt-16 overflow-y-auto no-scrollbar fade-in"
      >
        <h3 className="font-display text-[1.9rem] font-bold mb-6">{title}</h3>
        {options.map((o) => (
          <button
            key={o.key}
            data-nav
            data-selected={o.selected ? '' : undefined}
            onClick={() => onPick(o.key)}
            className="w-full flex items-center gap-4 h-16 px-6 rounded-xl text-left text-[1.35rem] font-medium text-ink-2 focus:bg-white focus:text-black"
          >
            <span className="w-6 text-accent">{o.selected ? '✓' : ''}</span>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
