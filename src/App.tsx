import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { CommandPalette } from './components/CommandPalette';
import { ContextMenuHost } from './components/ContextMenu';
import { FixMatchDialog } from './components/FixMatchDialog';
import { DropOverlay, Toasts } from './components/Overlays';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Button, Spinner } from './components/ui';
import { api, isTauri } from './lib/api';
import { useStore, type Route } from './lib/store';
import { DetailView } from './views/DetailView';
import { GridView } from './views/GridView';
import { HomeView } from './views/HomeView';
import { Onboarding } from './views/Onboarding';
import { ReviewView } from './views/ReviewView';
import { SettingsView } from './views/SettingsView';

function useBackendEvents() {
  const refresh = useStore((s) => s.refresh);
  const setProgress = useStore((s) => s.setProgress);
  const setDragging = useStore((s) => s.setDragging);
  const addFolders = useStore((s) => s.addFolders);

  useEffect(() => {
    let disposed = false;
    const unsubs: (() => void)[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, 120);
    };
    (async () => {
      await refresh();
      setProgress(await api.getProgress());
      const subs = await Promise.all([
        api.onChanged(scheduleRefresh),
        api.onProgress((p) => setProgress(p)),
        api.onDragDrop((e) => {
          if (e.type === 'enter' || e.type === 'over') setDragging(true);
          else setDragging(false);
          if (e.type === 'drop' && e.paths.length) void addFolders(e.paths);
        }),
      ]);
      if (disposed) subs.forEach((u) => u());
      else unsubs.push(...subs);
    })();
    return () => {
      disposed = true;
      unsubs.forEach((u) => u());
      if (timer) clearTimeout(timer);
    };
  }, [refresh, setProgress, setDragging, addFolders]);
}

function useTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    // The translucent sidebar is drawn by macOS, so the native window must
    // switch appearance too (null = follow the system).
    if (isTauri) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme === 'system' ? null : theme))
        .catch(() => {});
    }
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const typing = (e.target as HTMLElement)?.closest('input, textarea');
      if (mod && (e.key === 'k' || e.key === 'f')) {
        e.preventDefault();
        s.setPalette(!s.paletteOpen);
      } else if (mod && e.key === 'o') {
        e.preventDefault();
        void s.addFolders();
      } else if (mod && e.key === ',') {
        e.preventDefault();
        s.navigate({ name: 'settings' });
      } else if (mod && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const routes: Route[] = [{ name: 'home' }, { name: 'movies' }, { name: 'shows' }, { name: 'watchlist' }];
        s.navigate(routes[+e.key - 1]);
      } else if (e.key === 'Escape' && !typing && !s.paletteOpen && !s.fixTarget && s.openTitleId) {
        s.closeTitle();
      } else if (mod && e.key === '[' && s.openTitleId) {
        s.closeTitle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  useBackendEvents();
  useTheme();
  useShortcuts();

  const snapshot = useStore((s) => s.snapshot);
  const route = useStore((s) => s.route);
  const openTitleId = useStore((s) => s.openTitleId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [route]);

  const empty = snapshot && snapshot.folders.length === 0;
  const titles = snapshot?.titles ?? [];

  return (
    <div className="h-full flex">
      <Sidebar />
      <main className="@container relative flex-1 min-w-0 my-2 mr-2 rounded-[12px] bg-pane shadow-pane overflow-hidden">
        {!snapshot || empty ? (
          // drag strip for the frameless window; the toolbar takes over once there's a library
          <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-[44px] z-20" />
        ) : (
          <Toolbar scrollRef={scrollRef} />
        )}
        {!snapshot ? (
          <div className="h-full flex items-center justify-center text-ink-3">
            <Spinner />
          </div>
        ) : empty ? (
          <Onboarding />
        ) : (
          <div ref={scrollRef} className="scroll h-full overflow-y-auto overflow-x-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={route.name + (route.name === 'genre' ? route.genre : '')}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className={route.name === 'home' ? '' : 'pt-[52px]'}
              >
                {route.name === 'home' ? (
                  titles.length ? (
                    <HomeView titles={titles} />
                  ) : (
                    <IdentifyingPlaceholder />
                  )
                ) : route.name === 'review' ? (
                  <ReviewView files={snapshot.unmatched} />
                ) : route.name === 'settings' ? (
                  <SettingsView />
                ) : (
                  <GridView route={route} titles={titles} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
        <AnimatePresence>{openTitleId && <DetailView key={openTitleId} id={openTitleId} />}</AnimatePresence>
      </main>

      <CommandPalette />
      <FixMatchDialog />
      <ContextMenuHost />
      <DropOverlay />
      <Toasts />
    </div>
  );
}

function IdentifyingPlaceholder() {
  const progress = useStore((s) => s.progress);
  const unmatched = useStore((s) => s.snapshot?.stats.unmatched ?? 0);
  const navigate = useStore((s) => s.navigate);
  const toast = useStore((s) => s.toast);
  if (!progress.active) {
    const offline = progress.deferred > 0;
    return (
      <div className="h-[calc(100vh-16px)] flex flex-col items-center justify-center text-center px-10">
        <div className="font-display text-[20px] font-semibold text-ink">
          {offline ? 'Can’t reach the metadata services' : 'No movies or shows found yet'}
        </div>
        <div className="mt-1.5 text-ink-2 text-[13px] max-w-[420px] leading-relaxed">
          {offline
            ? 'Your files were found, but identifying them needs an internet connection. Movie Monkey retries automatically.'
            : unmatched
              ? `${unmatched} file${unmatched === 1 ? '' : 's'} couldn’t be identified automatically.`
              : 'Add a folder that contains video files, or drop one onto this window.'}
        </div>
        <div className="mt-5 flex gap-2">
          {offline && (
            <Button
              onClick={async () => {
                await api.rescan();
                toast('Retrying…');
              }}
            >
              Retry now
            </Button>
          )}
          {!offline && unmatched > 0 && <Button onClick={() => navigate({ name: 'review' })}>Review files</Button>}
        </div>
      </div>
    );
  }
  return (
    <div className="h-[calc(100vh-16px)] flex flex-col items-center justify-center text-center px-10">
      <Spinner className="size-6 text-ink-3" />
      <div className="mt-4 font-display text-[20px] font-semibold text-ink">Building your library…</div>
      <div className="mt-1 text-ink-2 text-[13px]">
        {progress.phase === 'identifying'
          ? `Identified ${progress.done} of ${progress.total}`
          : 'Looking for movies and shows'}
      </div>
    </div>
  );
}
