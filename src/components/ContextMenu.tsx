import { AnimatePresence, motion } from 'motion/react';
import { create } from 'zustand';
import { useEffect } from 'react';
import { MenuList, type MenuItem } from './ui';

interface CtxState {
  menu: { x: number; y: number; items: MenuItem[] } | null;
  show(x: number, y: number, items: MenuItem[]): void;
  hide(): void;
}

export const useContextMenu = create<CtxState>((set) => ({
  menu: null,
  show: (x, y, items) => set({ menu: { x, y, items } }),
  hide: () => set({ menu: null }),
}));

export function ContextMenuHost() {
  const { menu, hide } = useContextMenu();
  useEffect(() => {
    if (!menu) return;
    const close = () => hide();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', close);
    };
  }, [menu, hide]);

  // Keep the menu on screen.
  const x = menu ? Math.min(menu.x, window.innerWidth - 230) : 0;
  const y = menu ? Math.min(menu.y, window.innerHeight - (menu.items.length * 32 + 16)) : 0;

  return (
    <AnimatePresence>
      {menu && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.12 }}
          style={{ left: x, top: y }}
          className="fixed z-[100] origin-top-left"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuList items={menu.items} onClose={hide} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
