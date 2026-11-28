import { useEffect, type ReactNode } from 'react';
import tmdb from '../assets/tmdb.svg';
import { DEMO } from './api';
import { demoCredits } from './demo';
import { focusDefault } from './nav';
import { Monkey } from './ui';

/** About Movie Monkey: what the TV app does with your data, and credits. LG asks for the privacy policy in the app. */
export function AboutScreen({ server, onBack }: { server: string; onBack: () => void }) {
  useEffect(() => focusDefault(), []);
  return (
    <div data-scroll-y className="h-full overflow-y-auto no-scrollbar fade-in">
      <div className="px-24 pt-20 pb-24 max-w-[86rem]">
        <div className="flex items-center gap-6">
          <Monkey className="size-20" />
          <div>
            <h1 className="font-display text-[3rem] font-bold leading-tight">Movie Monkey</h1>
            <p className="text-[1.3rem] text-ink-2">
              {DEMO
                ? 'Sample films: get Movie Monkey for your computer at getmoviemonkey.com'
                : `Connected to ${server}`}
            </p>
          </div>
        </div>

        <Section title="Privacy">
          {DEMO ? (
            <>
              <p>
                Nothing is collected about you. There are no accounts, no ads and no tracking. These sample films stream
                from the Internet Archive (archive.org) and their artwork comes from TMDB. Where you stopped and what
                you've watched are kept on this TV only.
              </p>
              <p>
                With Movie Monkey on your computer, the TV app talks only to that computer, over your home network. To
                find it, the app checks the addresses on your network for Movie Monkey.
              </p>
            </>
          ) : (
            <>
              <p>
                Nothing is collected about you. There are no accounts, no ads and no tracking. The TV app talks only to
                Movie Monkey on your computer, over your home network. To find it, the app checks the addresses on your
                network for Movie Monkey.
              </p>
              <p>
                Your library, what you watch and where you stopped stay on your computer. Your computer gets film and
                show details and artwork from TMDB and TVMaze.
              </p>
            </>
          )}
          <p className="text-ink-3">Full privacy policy: getmoviemonkey.com/privacy · Questions: gfxindia@gmail.com</p>
        </Section>

        <Section title="Credits">
          <div className="flex items-center gap-6">
            <img src={tmdb} alt="TMDB" className="h-6 shrink-0" />
            <p>
              Film and show details and artwork from TMDB. This product uses the TMDB API but is not endorsed or
              certified by TMDB.
            </p>
          </div>
          {DEMO && demoCredits().map((c) => <p key={c}>{c}</p>)}
        </Section>

        <button
          data-nav
          data-nav-default
          onClick={onBack}
          className="mt-12 h-14 px-8 rounded-full bg-white/12 text-[1.35rem] font-semibold focus:bg-white focus:text-black"
        >
          Back
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-[1.6rem] font-semibold">{title}</h2>
      <div className="mt-4 flex flex-col gap-3 text-[1.3rem] leading-[1.55] text-ink-2">{children}</div>
    </section>
  );
}
