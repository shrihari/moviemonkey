import { useMemo } from 'react';
import { Hero } from '../components/Hero';
import { BackdropCard, PosterRowItem, Row } from '../components/Row';
import { relative } from '../lib/format';
import { topGenres, useStore } from '../lib/store';
import type { TitleSummary } from '../lib/types';

export function HomeView({ titles }: { titles: TitleSummary[] }) {
  const navigate = useStore((s) => s.navigate);

  const rows = useMemo(() => {
    const byAdded = [...titles].sort((a, b) => b.addedAt - a.addedAt);
    const continueWatching = titles
      .filter(
        (t) =>
          (t.kind === 'series' && t.watchedEpisodes > 0 && t.watchedEpisodes < t.episodeCount) ||
          (t.lastPlayedAt && !t.watched),
      )
      .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0));
    const unwatchedGems = titles
      .filter((t) => t.kind === 'movie' && !t.watched && (t.rating ?? 0) >= 7.8)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    const shows = titles.filter((t) => t.kind === 'series').sort((a, b) => b.addedAt - a.addedAt);
    const watchlist = titles.filter((t) => t.watchlist);
    const genres = topGenres(titles, 3).filter((g) => g.count >= 3);
    return { byAdded, continueWatching, unwatchedGems, shows, watchlist, genres };
  }, [titles]);

  return (
    <div className="pb-16">
      <Hero titles={titles} />

      {rows.continueWatching.length > 0 && (
        <Row title="Continue watching">
          {rows.continueWatching.slice(0, 12).map((t) => (
            <BackdropCard
              key={t.id}
              t={t}
              progress={t.kind === 'series' ? t.watchedEpisodes / Math.max(t.episodeCount, 1) : 0.05}
              caption={
                t.kind === 'series'
                  ? `${t.watchedEpisodes} of ${t.episodeCount} episodes watched`
                  : `Played ${relative(t.lastPlayedAt)}`
              }
            />
          ))}
        </Row>
      )}

      <Row title="Recently added" onSeeAll={() => navigate({ name: 'movies' })}>
        {rows.byAdded.slice(0, 14).map((t) => (
          <BackdropCard
            key={t.id}
            t={t}
            caption={[t.kind === 'series' ? `${t.episodeCount} episodes` : t.year, t.quality, t.genres[0]]
              .filter(Boolean)
              .join(' · ')}
          />
        ))}
      </Row>

      {rows.unwatchedGems.length > 0 && (
        <Row
          title="Unwatched gems"
          subtitle="Highly rated movies you haven’t seen yet"
          onSeeAll={() => navigate({ name: 'unwatched' })}
        >
          {rows.unwatchedGems.slice(0, 20).map((t) => (
            <PosterRowItem key={t.id} t={t} />
          ))}
        </Row>
      )}

      {rows.watchlist.length > 0 && (
        <Row title="Your watchlist" onSeeAll={() => navigate({ name: 'watchlist' })}>
          {rows.watchlist.map((t) => (
            <PosterRowItem key={t.id} t={t} />
          ))}
        </Row>
      )}

      {rows.shows.length > 0 && (
        <Row title="TV Shows" onSeeAll={() => navigate({ name: 'shows' })}>
          {rows.shows.slice(0, 20).map((t) => (
            <PosterRowItem key={t.id} t={t} />
          ))}
        </Row>
      )}

      {rows.genres.map((g) => (
        <Row key={g.genre} title={g.genre} onSeeAll={() => navigate({ name: 'genre', genre: g.genre })}>
          {titles
            .filter((t) => t.genres.includes(g.genre))
            .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
            .slice(0, 20)
            .map((t) => (
              <PosterRowItem key={t.id} t={t} />
            ))}
        </Row>
      ))}
    </div>
  );
}
