import { useCallback, useEffect, useRef, useState } from 'react';
import type { TitleSummary } from '../lib/types';
import { api, ApiError, base, token, type TvTitle } from './api';
import { HomeScreen, type Tab } from './Home';
import { focusDefault, installKeys } from './nav';
import { PairScreen } from './Pair';
import { PlayerScreen } from './Player';
import { episodeLabel, playRequestFor, TitleScreen, type PlayRequest } from './Title';
import { Monkey, Spinner } from './ui';

type Screen = { kind: 'home' } | { kind: 'title'; summary: TitleSummary } | { kind: 'player'; req: PlayRequest };

type Phase = 'connecting' | 'unreachable' | 'pair' | 'ready';

/** Where focus was on each screen, so Back returns to the same card. */
const focusMemory = new Map<number, string | undefined>();

export function TvApp() {
  const [phase, setPhase] = useState<Phase>('connecting');
  const [server, setServer] = useState('');
  const [titles, setTitles] = useState<TitleSummary[]>([]);
  const [stack, setStack] = useState<Screen[]>([{ kind: 'home' }]);
  const [tab, setTab] = useState<Tab>('home');
  const [message, setMessage] = useState<string | null>(null);
  /** Bumped after playback, so the title page reloads resume points. */
  const [version, setVersion] = useState(0);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const loadLibrary = useCallback(async () => {
    try {
      const lib = await api.library();
      setTitles(lib.titles);
      setServer(lib.name);
      setPhase('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        token.clear();
        setPhase('pair');
      } else {
        setMessage(e instanceof Error ? e.message : String(e));
        setPhase('unreachable');
      }
    }
  }, []);

  const connect = useCallback(async () => {
    setPhase('connecting');
    try {
      const info = await api.info();
      setServer(info.name);
      if (!info.paired) {
        token.clear();
        setPhase('pair');
        return;
      }
      await loadLibrary();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setPhase('unreachable');
    }
  }, [loadLibrary]);

  useEffect(() => {
    void connect();
  }, [connect]);

  // Keep the library fresh while the TV is open (new downloads, watched state).
  useEffect(() => {
    if (phase !== 'ready') return;
    const iv = window.setInterval(() => {
      if (stackRef.current[stackRef.current.length - 1].kind !== 'player') void loadLibrary();
    }, 60_000);
    return () => window.clearInterval(iv);
  }, [phase, loadLibrary]);

  const push = (s: Screen) => {
    focusMemory.set(stackRef.current.length - 1, (document.activeElement as HTMLElement | null)?.dataset.navId);
    setStack((st) => [...st, s]);
  };
  const back = useCallback(() => {
    const st = stackRef.current;
    if (st.length <= 1) {
      if (tab !== 'home') setTab('home');
      return;
    }
    const leaving = st[st.length - 1];
    setStack(st.slice(0, -1));
    if (leaving.kind === 'player') {
      void loadLibrary();
      setVersion((v) => v + 1);
    }
    const depth = st.length - 2;
    requestAnimationFrame(() => focusDefault(undefined, focusMemory.get(depth)));
  }, [tab, loadLibrary]);

  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => installKeys(() => backRef.current()), []);

  useEffect(() => {
    if (phase === 'ready') requestAnimationFrame(() => focusDefault());
  }, [phase]);

  const openTitle = (t: TitleSummary) => push({ kind: 'title', summary: t });
  const playTitle = async (t: TitleSummary) => {
    try {
      const detail = await api.title(t.id);
      const req = playRequestFor(detail);
      if (req) push({ kind: 'player', req });
      else openTitle(t);
    } catch {
      openTitle(t);
    }
  };

  /** After an episode: the next one in the show, if it's in the library. */
  const nextFor = (req: PlayRequest): (() => void) | undefined => {
    if (!req.episode) return undefined;
    const eps = req.title.seasons
      .filter((s) => s.number > 0)
      .flatMap((s) => s.episodes)
      .filter((e) => e.file);
    const i = eps.findIndex((e) => e.season === req.episode!.season && e.episode === req.episode!.episode);
    const n = i >= 0 ? eps[i + 1] : undefined;
    if (!n?.file) return undefined;
    const title: TvTitle = req.title;
    return () =>
      setStack((st) => [
        ...st.slice(0, -1),
        {
          kind: 'player',
          req: {
            title,
            file: n.file!,
            label: episodeLabel(n),
            start: 0,
            episode: { season: n.season, episode: n.episode },
          },
        },
      ]);
  };

  if (phase === 'connecting') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-10">
        <Monkey className="size-24 rounded-[1.4rem]" />
        <Spinner />
      </div>
    );
  }
  if (phase === 'unreachable') {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-40">
        <Monkey className="size-24 rounded-[1.4rem]" />
        <h1 className="mt-10 font-display text-[3rem] font-bold">Can't reach your computer</h1>
        <p className="mt-5 max-w-[50rem] text-[1.5rem] leading-relaxed text-ink-2">
          Make sure Movie Monkey is open on your computer, <b className="text-ink">Watch on TV</b> is switched on in
          Settings, and both are on the same Wi-Fi.
          {base && <span className="block mt-3 text-ink-3 text-[1.2rem]">Looking for it at {base}</span>}
        </p>
        {message && <p className="mt-3 text-[1.2rem] text-ink-3">{message}</p>}
        <button
          data-nav
          data-nav-default
          autoFocus
          onClick={() => void connect()}
          className="mt-10 h-14 px-10 rounded-full bg-white/12 text-[1.35rem] font-semibold focus:bg-white focus:text-black"
        >
          Try again
        </button>
      </div>
    );
  }
  if (phase === 'pair') return <PairScreen server={server} onPaired={() => void loadLibrary()} />;

  return (
    <>
      {stack.map((s, i) => {
        const top = i === stack.length - 1;
        // Screens underneath stay mounted (keeping their scroll and focus) but hidden.
        return (
          <div key={i} className="absolute inset-0" style={{ display: top ? 'block' : 'none' }}>
            {s.kind === 'home' && (
              <HomeScreen
                titles={titles}
                server={server}
                tab={tab}
                setTab={setTab}
                onOpen={openTitle}
                onPlay={playTitle}
              />
            )}
            {s.kind === 'title' && (
              <TitleScreen
                summary={s.summary}
                version={version}
                onPlay={(req) => push({ kind: 'player', req })}
                onChanged={loadLibrary}
              />
            )}
            {s.kind === 'player' && (
              <PlayerScreen key={s.req.file.id} req={s.req} onExit={back} onNext={nextFor(s.req)} />
            )}
          </div>
        );
      })}
    </>
  );
}
