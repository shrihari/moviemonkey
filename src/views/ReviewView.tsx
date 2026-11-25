import { EyeOff, FileVideo, RotateCcw, Wand2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from '../components/ui';
import { api } from '../lib/api';
import { bytes } from '../lib/format';
import { useStore } from '../lib/store';
import type { UnmatchedFile } from '../lib/types';

export function ReviewView({ files }: { files: UnmatchedFile[] }) {
  const setFixTarget = useStore((s) => s.setFixTarget);
  const toast = useStore((s) => s.toast);

  return (
    <div className="px-10 pb-20">
      <header className="pt-2 pb-6 flex items-end gap-4">
        <div className="flex-1">
          <h1 className="font-display text-[30px] font-semibold tracking-[-0.02em] text-ink">Needs review</h1>
          <p className="text-[13px] text-ink-2 mt-1 max-w-[560px]">
            Movie Monkey couldn’t confidently identify these files. Pick the right title, or ignore files that aren’t
            movies or shows (home videos, clips…).
          </p>
        </div>
        {files.length > 0 && (
          <Button
            onClick={async () => {
              await api.rescan(true);
              toast('Retrying identification…');
            }}
          >
            <RotateCcw className="size-3.5" /> Retry all
          </Button>
        )}
      </header>

      {files.length === 0 ? (
        <div className="py-24 text-center text-ink-2">Everything is identified. Nice.</div>
      ) : (
        <div className="rounded-2xl bg-elev shadow-[0_0_0_0.5px_var(--line-strong)] divide-y divide-line overflow-hidden">
          <AnimatePresence initial={false}>
            {files.map((f) => (
              <motion.div
                key={f.path}
                layout
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-4 px-5 py-3.5"
              >
                <div className="size-10 rounded-xl bg-sunken flex items-center justify-center text-ink-3 shrink-0">
                  <FileVideo className="size-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="selectable text-[13px] font-medium text-ink truncate" title={f.path}>
                    {f.fileName}
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-2 truncate">
                    Looks like “{f.guessTitle}
                    {f.guessYear ? ` (${f.guessYear})` : ''}”{f.season != null && ` · S${f.season}E${f.episode}`} ·{' '}
                    {bytes(f.size)} · <span className="text-ink-3">{f.folder}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await api.ignoreFiles([f.path]);
                    toast('File ignored');
                  }}
                >
                  <EyeOff className="size-3.5" /> Ignore
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    setFixTarget({
                      paths: [f.path],
                      query: f.guessTitle,
                      kind: f.guessKind,
                      label: f.fileName,
                    })
                  }
                >
                  <Wand2 className="size-3.5" /> Identify…
                </Button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
