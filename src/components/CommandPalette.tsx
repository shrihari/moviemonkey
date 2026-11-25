import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bookmark,
  Clapperboard,
  FolderPlus,
  Heart,
  Home,
  Monitor,
  Moon,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Tv,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { img } from '../lib/img';
import { useStore, type Route } from '../lib/store';
import { Kbd } from './ui';

const EMPTY: never[] = [];

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const initial = useStore((s) => s.paletteQuery);
  const setPalette = useStore((s) => s.setPalette);
  const titles = useStore((s) => s.snapshot?.titles ?? EMPTY);
  const navigate = useStore((s) => s.navigate);
  const openTitle = useStore((s) => s.openTitle);
  const addFolders = useStore((s) => s.addFolders);
  const setPrefs = useStore((s) => s.setPrefs);
  const toast = useStore((s) => s.toast);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setQuery(initial);
  }, [open, initial]);

  const close = () => setPalette(false);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  const go = (r: Route) => run(() => navigate(r));

  const sorted = useMemo(() => [...titles].sort((a, b) => b.addedAt - a.addedAt), [titles]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          <div className="absolute inset-0 bg-black/25 dark:bg-black/50" onClick={close} />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-[620px] max-w-[calc(100vw-48px)] rounded-2xl bg-elev shadow-pop overflow-hidden"
          >
            <Command
              loop
              onKeyDown={(e) => e.key === 'Escape' && close()}
              filter={(value, search, keywords) => {
                const hay = `${value} ${(keywords ?? []).join(' ')}`.toLowerCase();
                return search
                  .toLowerCase()
                  .split(/\s+/)
                  .every((w) => hay.includes(w))
                  ? 1
                  : 0;
              }}
            >
              <div className="flex items-center gap-3 px-4 h-[52px] border-b border-line">
                <Search className="size-[18px] text-ink-3" />
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search titles, actors, directors, genres…"
                  className="flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-3 outline-none"
                />
                <Kbd>esc</Kbd>
              </div>
              <Command.List className="max-h-[min(460px,60vh)] overflow-y-auto scroll p-1.5 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-ink-3">
                <Command.Empty className="py-12 text-center text-[13px] text-ink-2">No results for “{query}”.</Command.Empty>

                <Command.Group heading={query ? 'Titles' : 'Recently added'}>
                  {(query ? sorted : sorted.slice(0, 6)).map((t) => (
                    <Command.Item
                      key={t.id}
                      value={`${t.name} ${t.id}`}
                      keywords={[String(t.year ?? ''), ...t.cast, ...t.directors, ...t.genres, t.kind === 'series' ? 'tv show series' : 'movie film']}
                      onSelect={run(() => openTitle(t.id))}
                      className="flex items-center gap-3 px-2.5 py-1.5 rounded-xl data-[selected=true]:bg-hover"
                    >
                      <div className="w-8 aspect-[2/3] rounded-[5px] overflow-hidden bg-sunken shrink-0">
                        {t.poster && <img src={img(t.poster, t.posterAlt)} alt="" className="size-full object-cover" loading="lazy" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-medium text-ink truncate">{t.name}</div>
                        <div className="text-[12px] text-ink-2 truncate">
                          {t.kind === 'series' ? 'TV Show' : 'Movie'} · {t.year}
                          {query && t.cast.some((c) => c.toLowerCase().includes(query.toLowerCase())) && (
                            <> · {t.cast.find((c) => c.toLowerCase().includes(query.toLowerCase()))}</>
                          )}
                          {query && t.directors.some((c) => c.toLowerCase().includes(query.toLowerCase())) && (
                            <> · dir. {t.directors.find((c) => c.toLowerCase().includes(query.toLowerCase()))}</>
                          )}
                        </div>
                      </div>
                      {t.watched && <span className="text-[11px] text-ink-3">Watched</span>}
                    </Command.Item>
                  ))}
                </Command.Group>

                <Command.Group heading="Go to">
                  <Item icon={<Home />} label="Home" onSelect={go({ name: 'home' })} shortcut="⌘1" />
                  <Item icon={<Clapperboard />} label="Movies" onSelect={go({ name: 'movies' })} shortcut="⌘2" />
                  <Item icon={<Tv />} label="TV Shows" onSelect={go({ name: 'shows' })} shortcut="⌘3" />
                  <Item icon={<Bookmark />} label="Watchlist" onSelect={go({ name: 'watchlist' })} shortcut="⌘4" />
                  <Item icon={<Heart />} label="Favorites" onSelect={go({ name: 'favorites' })} />
                  <Item icon={<Sparkles />} label="Needs review" onSelect={go({ name: 'review' })} />
                  <Item icon={<Settings />} label="Settings" onSelect={go({ name: 'settings' })} shortcut="⌘," />
                </Command.Group>

                <Command.Group heading="Actions">
                  <Item icon={<FolderPlus />} label="Add folder…" onSelect={run(() => addFolders())} shortcut="⌘O" />
                  <Item
                    icon={<RotateCcw />}
                    label="Rescan library"
                    onSelect={run(async () => {
                      await api.rescan(true);
                      toast('Rescanning library…');
                    })}
                  />
                  <Item icon={<Sun />} label="Use light theme" onSelect={run(() => setPrefs({ theme: 'light' }))} />
                  <Item icon={<Moon />} label="Use dark theme" onSelect={run(() => setPrefs({ theme: 'dark' }))} />
                  <Item icon={<Monitor />} label="Match system theme" onSelect={run(() => setPrefs({ theme: 'system' }))} />
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Item({ icon, label, onSelect, shortcut }: { icon: ReactNode; label: string; onSelect: () => void; shortcut?: string }) {
  return (
    <Command.Item
      value={label}
      onSelect={onSelect}
      className="flex items-center gap-3 h-9 px-2.5 rounded-xl text-[13.5px] text-ink data-[selected=true]:bg-hover"
    >
      <span className="size-8 flex items-center justify-center text-ink-2 [&>svg]:size-4">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[11.5px] text-ink-3">{shortcut}</span>}
    </Command.Item>
  );
}
