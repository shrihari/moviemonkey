// Movie types
export interface Movie {
  id: number
  tmdb_id: number
  imdb_id: string | null
  title: string
  original_title: string | null
  overview: string | null
  release_date: string | null
  runtime: number | null
  vote_average: number | null
  vote_count: number | null
  popularity: number | null
  poster_path: string | null
  backdrop_path: string | null
  genres: string | null // JSON string of genre names
  type: 'movie'
  file_path: string | null
  file_size: number | null
  added_at: string
  watched: number
  rating: number | null
}

export interface TVShow {
  id: number
  tmdb_id: number
  imdb_id: string | null
  name: string
  original_name: string | null
  overview: string | null
  first_air_date: string | null
  vote_average: number | null
  vote_count: number | null
  popularity: number | null
  poster_path: string | null
  backdrop_path: string | null
  genres: string | null
  number_of_seasons: number | null
  number_of_episodes: number | null
  added_at: string
}

export interface Episode {
  id: number
  tv_show_id: number
  tmdb_id: number | null
  season_number: number
  episode_number: number
  name: string | null
  overview: string | null
  air_date: string | null
  runtime: number | null
  still_path: string | null
  file_path: string | null
  file_size: number | null
  watched: number
}

export interface WatchFolder {
  id: number
  path: string
  added_at: string
}

// TMDB API types
export interface TMDBMovie {
  id: number
  imdb_id?: string
  title: string
  original_title: string
  overview: string
  release_date: string
  runtime: number
  vote_average: number
  vote_count: number
  popularity: number
  poster_path: string | null
  backdrop_path: string | null
  genres: { id: number; name: string }[]
}

export interface TMDBTVShow {
  id: number
  name: string
  original_name: string
  overview: string
  first_air_date: string
  vote_average: number
  vote_count: number
  popularity: number
  poster_path: string | null
  backdrop_path: string | null
  genres: { id: number; name: string }[]
  number_of_seasons: number
  number_of_episodes: number
}

export interface TMDBSearchResult {
  id: number
  media_type: 'movie' | 'tv'
  title?: string
  name?: string
  poster_path: string | null
  release_date?: string
  first_air_date?: string
  vote_average: number
  overview: string
}

// App state types
export type ViewMode = 'grid' | 'list'
export type SortBy = 'title' | 'release_date' | 'vote_average' | 'added_at'
export type SortOrder = 'asc' | 'desc'
export type MediaType = 'movies' | 'tv' | 'all'
