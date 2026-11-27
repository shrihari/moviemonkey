import { Delete } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError, deviceName, token } from './api';
import { digitOf, focusDefault, onKeys } from './nav';
import { Monkey, Spinner } from './ui';

/** First visit from a TV: enter the code shown in Movie Monkey's Settings. */
export function PairScreen({ server, onPaired }: { server: string; onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (c: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.pair(c, deviceName());
      token.set(res.token);
      onPaired();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy) return;
    setError(null);
    const next = d === '⌫' ? code.slice(0, -1) : (code + d).slice(0, 4);
    setCode(next);
    if (d !== '⌫' && next.length === 4) void submit(next);
  };

  // The remote's number keys type straight in.
  useEffect(
    () =>
      onKeys((key, e) => {
        if (key === 'digit') {
          press(digitOf(e) ?? '');
          return true;
        }
        if (key === 'back' && code) {
          press('⌫');
          return true;
        }
        return false;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [code, busy],
  );
  useEffect(() => focusDefault(), []);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  return (
    <div className="h-full flex items-center justify-center gap-32 px-24 fade-in">
      <div className="max-w-[40rem]">
        <Monkey className="size-24" />
        <h1 className="mt-10 font-display text-[3.4rem] font-bold leading-[1.05] tracking-[-0.02em]">
          Connect to {server || 'Movie Monkey'}
        </h1>
        <p className="mt-6 text-[1.5rem] leading-relaxed text-ink-2">
          On your computer, open Movie Monkey, go to <b className="text-ink">Settings › Watch on TV</b> and choose{' '}
          <b className="text-ink">Pair a TV</b>. Then enter the 4-digit code here.
        </p>
        <div className="mt-10 flex gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-20 h-24 rounded-2xl bg-card flex items-center justify-center font-display text-[3rem] font-semibold"
            >
              {code[i] ?? ''}
            </div>
          ))}
          {busy && <Spinner className="ml-6 self-center" />}
        </div>
        <p className="mt-6 h-8 text-[1.3rem] text-[#ff8a80]">{error}</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {keys.map((k, i) =>
          k ? (
            <button
              key={i}
              data-nav
              data-nav-default={k === '1' ? '' : undefined}
              onClick={() => press(k)}
              className="size-24 rounded-2xl bg-card text-[2.2rem] font-semibold transition-[transform,background-color,color] duration-150 focus:bg-white focus:text-black focus:scale-110"
            >
              {k === '⌫' ? <Delete className="size-10 mx-auto" aria-label="Delete" /> : k}
            </button>
          ) : (
            <span key={i} />
          ),
        )}
      </div>
    </div>
  );
}
