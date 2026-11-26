import { motion } from 'motion/react';
import { FolderOpen, HardDrive, KeyRound, Sparkles } from 'lucide-react';
import monkey from '../assets/monkey.svg';
import { Button, Kbd } from '../components/ui';
import { useStore } from '../lib/store';

export function Onboarding() {
  const addFolders = useStore((s) => s.addFolders);
  return (
    <div className="relative h-full flex items-center justify-center overflow-hidden">
      {/* soft glow */}
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 size-[720px] rounded-full bg-[radial-gradient(closest-side,rgb(255_203_61/0.22),transparent)]" />
      <div className="absolute -bottom-60 -right-40 size-[600px] rounded-full bg-[radial-gradient(closest-side,rgb(255_140_60/0.10),transparent)]" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative max-w-[520px] text-center px-8"
      >
        <img
          src={monkey}
          alt=""
          className="size-24 mx-auto drop-shadow-xl"
          style={{ animation: 'float 6s ease-in-out infinite' }}
        />
        <h1 className="mt-8 font-display text-[34px] leading-[1.1] font-semibold tracking-[-0.025em] text-ink">
          Your movies,
          <br />
          beautifully organized.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
          Drop a folder of movies or TV shows anywhere in this window. Movie Monkey finds the posters, artwork, cast and
          episode guides for you.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button variant="primary" size="lg" onClick={() => addFolders()}>
            <FolderOpen className="size-4" />
            Choose a folder…
          </Button>
        </div>
        <p className="mt-3 text-[12px] text-ink-3">
          or press <Kbd>⌘</Kbd> <Kbd>O</Kbd>
        </p>

        <div className="mt-12 grid grid-cols-3 gap-3 text-left">
          <Feature
            icon={<Sparkles className="size-4" />}
            title="Automatic"
            text="Messy file names in, clean library out."
          />
          <Feature icon={<KeyRound className="size-4" />} title="No setup" text="No accounts or API keys to set up." />
          <Feature
            icon={<HardDrive className="size-4" />}
            title="Local-first"
            text="Your files never leave your disk."
          />
        </div>
      </motion.div>
    </div>
  );
}

function Feature({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="p-3.5 rounded-xl bg-elev/70 shadow-[0_0_0_0.5px_var(--line)]">
      <div className="size-7 rounded-lg bg-accent/25 text-accent-strong flex items-center justify-center">{icon}</div>
      <div className="mt-2.5 text-[12.5px] font-semibold text-ink">{title}</div>
      <div className="mt-0.5 text-[12px] text-ink-2 leading-snug">{text}</div>
    </div>
  );
}
