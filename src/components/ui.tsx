import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'glass' | 'white' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap transition-[background,transform,box-shadow,opacity] duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none select-none',
        size === 'sm' && 'h-7 px-2.5 text-[12px] rounded-lg',
        size === 'md' && 'h-8 px-3.5 text-[13px] rounded-[10px]',
        size === 'lg' && 'h-11 px-5 text-[14px] rounded-xl',
        variant === 'primary' &&
          'bg-accent text-accent-ink hover:brightness-105 shadow-[0_1px_0_rgb(255_255_255/0.4)_inset,0_1px_2px_rgb(0_0_0/0.2)]',
        variant === 'secondary' &&
          'bg-elev text-ink shadow-[0_0_0_0.5px_var(--line-strong),0_1px_2px_rgb(0_0_0/0.06)] hover:bg-sunken',
        variant === 'ghost' && 'text-ink-2 hover:text-ink hover:bg-hover',
        variant === 'glass' && 'glass text-white hover:bg-white/20',
        variant === 'white' && 'bg-white text-black hover:bg-white/90 shadow-[0_2px_10px_rgb(0_0_0/0.25)]',
        variant === 'danger' && 'text-danger hover:bg-danger/10',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  tone = 'default',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; tone?: 'default' | 'glass' }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={clsx(
        'inline-flex items-center justify-center rounded-[9px] transition-[background-color,color,scale] duration-150 active:scale-[0.94]',
        tone === 'default' && 'size-8 text-ink-2 hover:text-ink hover:bg-hover',
        tone === 'default' && active && 'text-ink bg-active',
        tone === 'glass' && 'size-10 rounded-full glass text-white hover:bg-white/20',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={clsx('relative inline-flex rounded-[10px] bg-active p-0.5', size === 'sm' ? 'h-7' : 'h-8')}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'relative z-10 px-3 text-[12px] font-medium rounded-[8px] transition-colors',
            value === o.value ? 'text-ink' : 'text-ink-2 hover:text-ink',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${options.map((x) => x.value).join('')}`}
              className="absolute inset-0 -z-10 rounded-[8px] bg-elev shadow-[0_0_0_0.5px_var(--line-strong),0_1px_3px_rgb(0_0_0/0.12)]"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({
  children,
  tone = 'default',
  className,
}: {
  children: ReactNode;
  tone?: 'default' | 'accent' | 'glass' | 'outline';
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[5px] text-[10px] font-semibold tracking-wide uppercase leading-none',
        tone === 'default' && 'bg-active text-ink-2',
        tone === 'accent' && 'bg-accent text-accent-ink',
        tone === 'glass' && 'bg-black/55 text-white backdrop-blur-md',
        tone === 'outline' && 'ring-1 ring-inset ring-current/30 text-current',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={clsx('size-4', className)} style={{ animation: 'spin 0.9s linear infinite' }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-[5px] bg-active text-ink-2 text-[10.5px] font-sans font-medium">
      {children}
    </kbd>
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  checked?: boolean;
  danger?: boolean;
  separator?: boolean;
  hint?: string;
}

export function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <div className="min-w-[200px] p-1 rounded-xl bg-elev shadow-pop text-[13px]">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-1 h-px bg-line mx-2" />
        ) : (
          <button
            key={i}
            onClick={() => {
              onClose();
              it.onSelect?.();
            }}
            className={clsx(
              'w-full flex items-center gap-2.5 h-8 px-2.5 rounded-lg text-left hover:bg-hover',
              it.danger ? 'text-danger' : 'text-ink',
            )}
          >
            <span className="size-4 flex items-center justify-center text-ink-2 [&>svg]:size-4">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.hint && <span className="text-ink-3 text-[11px]">{it.hint}</span>}
            {it.checked && <Check className="size-3.5 text-ink" />}
          </button>
        ),
      )}
    </div>
  );
}

/** A button that opens a small dropdown menu. */
export function Dropdown({
  trigger,
  items,
  align = 'left',
  side = 'bottom',
}: {
  trigger: (open: boolean) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right' | 'center';
  side?: 'top' | 'bottom';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-flex">
      <div onClick={() => setOpen((o) => !o)}>{trigger(open)}</div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: side === 'top' ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={clsx(
              'absolute z-50',
              side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-2',
              align === 'left' && 'left-0 origin-top-left',
              align === 'right' && 'right-0 origin-top-right',
              align === 'center' && 'left-1/2 -translate-x-1/2',
            )}
          >
            <MenuList items={items} onClose={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SelectButton({ label, open }: { label: ReactNode; open?: boolean }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-lg text-[12px] font-medium text-ink-2 hover:text-ink hover:bg-hover',
        open && 'bg-hover text-ink',
      )}
    >
      {label}
      <ChevronDown className="size-3.5 opacity-60" />
    </span>
  );
}
