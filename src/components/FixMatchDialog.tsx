import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Search, Wand2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { img } from '../lib/img';
import { useStore } from '../lib/store';
import type { Candidate, TitleKind } from '../lib/types';
import { IconButton, Segmented, Spinner } from './ui';

export function FixMatchDialog() {
  const target = useStore((s) => s.fixTarget);
  const setFixTarget = useStore((s) => s.setFixTarget);
  const toast = useStore((s) => s.toast);
  const openTitle = useStore((s) => s.openTitle);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'any' | TitleKind>('any');
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    if (target) {
      setQuery(target.query);
      setKind(target.kind ?? 'any');
      setResults(null);
    }
  }, [target]);

  useEffect(() => {
    if (!target || !query.trim()) return;
    const id = ++reqId.current;
    setLoading(true);
    const h = setTimeout(async () => {
      try {
        const r = await api.searchTitles(query, kind === 'any' ? null : kind);
        if (id === reqId.current) setResults(r);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 280);
    return () => clearTimeout(h);
  }, [query, kind, target]);

  const close = () => setFixTarget(null);

  const choose = async (c: Candidate) => {
    if (!target) return;
    setAssigning(c.id);
    try {
      await api.assignMatch(target.paths, c.id, c.kind);
      toast(`Matched to ${c.title}${c.year ? ` (${c.year})` : ''}`, 'success');
      close();
      openTitle(c.id);
    } catch (e) {
      toast(`Couldn't match: ${e}`, 'error');
    } finally {
      setAssigning(null);
    }
  };

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          className="fixed inset-0 z-[85] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/30 dark:bg-black/55" onClick={close} />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-[640px] max-w-[calc(100vw-48px)] max-h-[78vh] flex flex-col rounded-2xl bg-elev shadow-pop overflow-hidden"
            onKeyDown={(e) => e.key === 'Escape' && close()}
          >
            <div className="flex items-start gap-3 px-5 pt-5">
              <div className="size-9 rounded-xl bg-accent/25 text-accent-strong flex items-center justify-center shrink-0">
                <Wand2 className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[15px] font-semibold text-ink">Identify title</h2>
                <p className="text-[12px] text-ink-2 truncate font-mono mt-0.5">{target.label}</p>
              </div>
              <IconButton label="Close" onClick={close}>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="flex items-center gap-3 px-5 pt-4 pb-3">
              <div className="flex-1 flex items-center gap-2 h-9 px-3 rounded-xl bg-sunken shadow-[inset_0_0_0_0.5px_var(--line-strong)]">
                <Search className="size-4 text-ink-3" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search IMDb, Cinemeta…"
                  className="flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-ink-3 outline-none"
                />
                {loading && <Spinner className="size-3.5 text-ink-3" />}
              </div>
              <Segmented<'any' | TitleKind>
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'any', label: 'All' },
                  { value: 'movie', label: 'Movies' },
                  { value: 'series', label: 'Shows' },
                ]}
              />
            </div>
            <div className="flex-1 overflow-y-auto scroll px-2.5 pb-3">
              {results?.length === 0 && !loading && (
                <p className="py-12 text-center text-[13px] text-ink-2">
                  No matches. Try a different spelling or the original title.
                </p>
              )}
              {results?.map((c) => (
                <button
                  key={c.id}
                  disabled={!!assigning}
                  onClick={() => choose(c)}
                  className={clsx(
                    'w-full flex items-center gap-3.5 px-2.5 py-2 rounded-xl text-left hover:bg-hover transition-colors',
                    assigning === c.id && 'bg-hover',
                  )}
                >
                  <div className="w-10 aspect-[2/3] rounded-md overflow-hidden bg-sunken shrink-0 ring-1 ring-inset ring-line">
                    {c.poster && <img src={img(c.poster)} alt="" className="size-full object-cover" loading="lazy" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-ink truncate">
                      {c.title} <span className="text-ink-2 font-normal">{c.yearLabel ?? c.year}</span>
                    </div>
                    <div className="text-[12px] text-ink-2 truncate">
                      {c.kind === 'series' ? 'TV Show' : 'Movie'}
                      {c.subtitle && <> · {c.subtitle}</>}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-ink-3">{c.id}</span>
                  {assigning === c.id && <Spinner className="text-ink-2" />}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
