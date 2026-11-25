import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, FolderDown } from 'lucide-react';
import { useStore } from '../lib/store';

export function DropOverlay() {
  const dragging = useStore((s) => s.dragging);
  return (
    <AnimatePresence>
      {dragging && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[90] p-3 pointer-events-none"
        >
          <div className="absolute inset-0 bg-pane/70 backdrop-blur-md" />
          <motion.div
            initial={{ scale: 0.98 }}
            animate={{ scale: 1 }}
            className="relative h-full rounded-[20px] border-2 border-dashed border-accent-strong/70 bg-accent/[0.07] flex flex-col items-center justify-center"
          >
            <motion.div
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="size-20 rounded-[22px] bg-accent text-accent-ink flex items-center justify-center shadow-[0_20px_50px_-12px_rgb(255_190_40/0.7)]"
            >
              <FolderDown className="size-9" strokeWidth={1.8} />
            </motion.div>
            <div className="mt-6 font-display text-[24px] font-semibold tracking-[-0.02em] text-ink">
              Drop to add to your library
            </div>
            <div className="mt-1.5 text-[14px] text-ink-2">
              Folders of movies and TV shows, nested as deep as you like.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="fixed bottom-5 right-5 z-[95] flex flex-col items-end gap-2 pointer-events-none">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className={clsx(
              'flex items-center gap-2.5 max-w-[380px] pl-3 pr-4 py-2.5 rounded-xl text-[13px] shadow-pop',
              'bg-[#1c1b1a] text-white dark:bg-[#2a2927]',
            )}
          >
            {t.tone === 'success' && <CheckCircle2 className="size-4 text-accent shrink-0" />}
            {t.tone === 'error' && <AlertCircle className="size-4 text-[#ff8a8a] shrink-0" />}
            <span className="leading-snug">{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
