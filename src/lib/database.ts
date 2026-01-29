import type { Movie, TVShow, Episode, WatchFolder } from '@/types'

// Helper to run database queries
async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await window.electronAPI.dbQuery(sql, params)
  return result as T[]
}

async function run(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid: number }> {
  const result = await window.electronAPI.dbQuery(sql, params)
  return result as { changes: number; lastInsertRowid: number }
}

// Movies
export async function getAllMovies(): Promise<Movie[]> {
  return query<Movie>('SELECT * FROM movies ORDER BY title ASC')
}

export async function getMovieById(id: number): Promise<Movie | null> {
  const results = await query<Movie>('SELECT * FROM movies WHERE id = ?', [id])
  return results[0] || null
}

export async function getMovieByTmdbId(tmdbId: number): Promise<Movie | null> {
  const results = await query<Movie>('SELECT * FROM movies WHERE tmdb_id = ?', [tmdbId])
  return results[0] || null
}

export async function addMovie(movie: Omit<Movie, 'id' | 'added_at'>): Promise<number> {
  const result = await run(
    `INSERT INTO movies (tmdb_id, imdb_id, title, original_title, overview, release_date, runtime,
     vote_average, vote_count, popularity, poster_path, backdrop_path, genres, type, file_path, file_size, watched, rating)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      movie.tmdb_id, movie.imdb_id, movie.title, movie.original_title, movie.overview,
      movie.release_date, movie.runtime, movie.vote_average, movie.vote_count, movie.popularity,
      movie.poster_path, movie.backdrop_path, movie.genres, movie.type, movie.file_path,
      movie.file_size, movie.watched, movie.rating
    ]
  )
  return result.lastInsertRowid
}

export async function updateMovie(id: number, updates: Partial<Movie>): Promise<void> {
  const fields = Object.keys(updates).filter(k => k !== 'id')
  const values = fields.map(k => updates[k as keyof Movie])
  const setClause = fields.map(f => `${f} = ?`).join(', ')

  await run(`UPDATE movies SET ${setClause} WHERE id = ?`, [...values, id])
}

export async function deleteMovie(id: number): Promise<void> {
  await run('DELETE FROM movies WHERE id = ?', [id])
}

export async function searchMovies(searchTerm: string): Promise<Movie[]> {
  return query<Movie>(
    'SELECT * FROM movies WHERE title LIKE ? ORDER BY title ASC',
    [`%${searchTerm}%`]
  )
}

// TV Shows
export async function getAllTVShows(): Promise<TVShow[]> {
  return query<TVShow>('SELECT * FROM tv_shows ORDER BY name ASC')
}

export async function getTVShowById(id: number): Promise<TVShow | null> {
  const results = await query<TVShow>('SELECT * FROM tv_shows WHERE id = ?', [id])
  return results[0] || null
}

export async function getTVShowByTmdbId(tmdbId: number): Promise<TVShow | null> {
  const results = await query<TVShow>('SELECT * FROM tv_shows WHERE tmdb_id = ?', [tmdbId])
  return results[0] || null
}

export async function addTVShow(show: Omit<TVShow, 'id' | 'added_at'>): Promise<number> {
  const result = await run(
    `INSERT INTO tv_shows (tmdb_id, imdb_id, name, original_name, overview, first_air_date,
     vote_average, vote_count, popularity, poster_path, backdrop_path, genres, number_of_seasons, number_of_episodes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      show.tmdb_id, show.imdb_id, show.name, show.original_name, show.overview,
      show.first_air_date, show.vote_average, show.vote_count, show.popularity,
      show.poster_path, show.backdrop_path, show.genres, show.number_of_seasons, show.number_of_episodes
    ]
  )
  return result.lastInsertRowid
}

export async function deleteTVShow(id: number): Promise<void> {
  await run('DELETE FROM episodes WHERE tv_show_id = ?', [id])
  await run('DELETE FROM tv_shows WHERE id = ?', [id])
}

// Episodes
export async function getEpisodesByShowId(tvShowId: number): Promise<Episode[]> {
  return query<Episode>(
    'SELECT * FROM episodes WHERE tv_show_id = ? ORDER BY season_number, episode_number',
    [tvShowId]
  )
}

export async function addEpisode(episode: Omit<Episode, 'id'>): Promise<number> {
  const result = await run(
    `INSERT INTO episodes (tv_show_id, tmdb_id, season_number, episode_number, name, overview,
     air_date, runtime, still_path, file_path, file_size, watched)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      episode.tv_show_id, episode.tmdb_id, episode.season_number, episode.episode_number,
      episode.name, episode.overview, episode.air_date, episode.runtime, episode.still_path,
      episode.file_path, episode.file_size, episode.watched
    ]
  )
  return result.lastInsertRowid
}

export async function updateEpisode(id: number, updates: Partial<Episode>): Promise<void> {
  const fields = Object.keys(updates).filter(k => k !== 'id')
  const values = fields.map(k => updates[k as keyof Episode])
  const setClause = fields.map(f => `${f} = ?`).join(', ')

  await run(`UPDATE episodes SET ${setClause} WHERE id = ?`, [...values, id])
}

// Watch Folders
export async function getAllWatchFolders(): Promise<WatchFolder[]> {
  return query<WatchFolder>('SELECT * FROM watch_folders ORDER BY path ASC')
}

export async function addWatchFolder(path: string): Promise<number> {
  const result = await run(
    'INSERT OR IGNORE INTO watch_folders (path) VALUES (?)',
    [path]
  )
  return result.lastInsertRowid
}

export async function deleteWatchFolder(id: number): Promise<void> {
  await run('DELETE FROM watch_folders WHERE id = ?', [id])
}

// Stats
export async function getLibraryStats(): Promise<{
  movieCount: number
  tvShowCount: number
  episodeCount: number
  watchedMovies: number
  watchedEpisodes: number
}> {
  const movieCount = await query<{ count: number }>('SELECT COUNT(*) as count FROM movies')
  const tvShowCount = await query<{ count: number }>('SELECT COUNT(*) as count FROM tv_shows')
  const episodeCount = await query<{ count: number }>('SELECT COUNT(*) as count FROM episodes')
  const watchedMovies = await query<{ count: number }>('SELECT COUNT(*) as count FROM movies WHERE watched = 1')
  const watchedEpisodes = await query<{ count: number }>('SELECT COUNT(*) as count FROM episodes WHERE watched = 1')

  return {
    movieCount: movieCount[0]?.count || 0,
    tvShowCount: tvShowCount[0]?.count || 0,
    episodeCount: episodeCount[0]?.count || 0,
    watchedMovies: watchedMovies[0]?.count || 0,
    watchedEpisodes: watchedEpisodes[0]?.count || 0
  }
}
