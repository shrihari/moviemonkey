import { FolderOpen, FolderPlus, HardDrive, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import monkey from '../assets/monkey.svg';
import tmdbLogo from '../assets/tmdb.svg';
import { Button, IconButton, Segmented } from '../components/ui';
import { api } from '../lib/api';
import { bytes, plural } from '../lib/format';
import { useStore, type Theme } from '../lib/store';

export function SettingsView() {
  const snapshot = useStore((s) => s.snapshot);
  const theme = useStore((s) => s.theme);
  const setPrefs = useStore((s) => s.setPrefs);
  const addFolders = useStore((s) => s.addFolders);
  const toast = useStore((s) => s.toast);
  const [cache, setCache] = useState<number | null>(null);

  useEffect(() => {
    api.cacheSize().then(setCache);
  }, []);

  return (
    <div className="px-10 pb-20 max-w-[760px]">
      <header className="pt-2 pb-6">
        <h1 className="font-display text-[30px] font-semibold tracking-[-0.02em] text-ink">Settings</h1>
      </header>

      <Group
        title="Library folders"
        description="Movie Monkey watches these folders and picks up new files automatically."
      >
        {snapshot?.folders.map((f) => (
          <div key={f.id} className="flex items-center gap-3 px-4 py-3">
            <div className="size-9 rounded-lg bg-sunken flex items-center justify-center text-ink-2">
              <HardDrive className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-ink truncate">{f.name}</div>
              <div className="selectable text-[12px] text-ink-2 truncate">{f.path}</div>
            </div>
            <span className={f.online ? 'text-[12px] text-ink-2' : 'text-[12px] text-danger'}>
              {f.online ? plural(f.fileCount, 'file') : 'Offline'}
            </span>
            <IconButton label="Show in Finder" onClick={() => api.reveal(f.path)}>
              <FolderOpen className="size-4" />
            </IconButton>
            <IconButton
              label="Remove folder"
              onClick={async () => {
                await api.removeFolder(f.id);
                toast(`Removed ${f.name}. Your files were not touched.`);
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
        ))}
        <div className="flex items-center gap-2 px-4 py-3">
          <Button size="sm" onClick={() => addFolders()}>
            <FolderPlus className="size-3.5" /> Add folder…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await api.rescan(true);
              toast('Rescanning library…');
            }}
          >
            <RotateCcw className="size-3.5" /> Rescan now
          </Button>
        </div>
      </Group>

      <Group title="Appearance">
        <Item label="Theme">
          <Segmented<Theme>
            value={theme}
            onChange={(v) => setPrefs({ theme: v })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Item>
      </Group>

      <Group title="Storage">
        <Item label="Artwork cache" hint="Posters and backdrops are cached on disk so your library works offline.">
          <span className="text-[12px] text-ink-2 mr-2">{cache === null ? '…' : bytes(cache)}</span>
          <Button
            size="sm"
            onClick={async () => {
              await api.clearCache();
              setCache(await api.cacheSize());
              toast('Artwork cache cleared');
            }}
          >
            Clear
          </Button>
        </Item>
      </Group>

      <Group title="About">
        <div className="flex items-center gap-4 px-4 py-4">
          <img src={monkey} alt="" className="size-12" />
          <div className="text-[12.5px] text-ink-2 leading-relaxed">
            <div className="text-[14px] font-semibold text-ink">Movie Monkey 2</div>
            No accounts, no setup, no tracking. Your files never leave your disk.
          </div>
        </div>
        <Credit
          name="TMDB"
          logo={tmdbLogo}
          url="https://www.themoviedb.org"
          text="Movie and TV metadata and images. This product uses the TMDB API but is not endorsed or certified by TMDB."
        />
        <Credit
          name="TVMaze"
          url="https://www.tvmaze.com"
          text="Additional TV show data, licensed under CC BY-SA 4.0."
        />
      </Group>
    </div>
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
      {description && <p className="text-[12px] text-ink-2 mt-0.5">{description}</p>}
      <div className="mt-3 rounded-2xl bg-elev shadow-[0_0_0_0.5px_var(--line-strong)] divide-y divide-line overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function Credit({ name, url, text, logo }: { name: string; url: string; text: string; logo?: string }) {
  return (
    <div className="flex items-start gap-4 px-4 py-3.5">
      <div className="flex-1 text-[12.5px] text-ink-2 leading-relaxed">
        <div className="flex items-center gap-1.5 h-5 text-[13px] font-medium text-ink">
          Data from
          {/* TMDB's terms: an approved logo, less prominent than our own. */}
          {logo ? <img src={logo} alt={name} className="h-[11px] w-auto" draggable={false} /> : <span>{name}</span>}
        </div>
        {text}
      </div>
      <Button size="sm" variant="ghost" onClick={() => api.openUrl(url)}>
        {url.replace('https://www.', '')}
      </Button>
    </div>
  );
}

function Item({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="flex-1">
        <div className="text-[13px] text-ink">{label}</div>
        {hint && <div className="text-[12px] text-ink-2 mt-0.5">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
