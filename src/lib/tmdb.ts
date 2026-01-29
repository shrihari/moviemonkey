import type { TMDBMovie, TMDBTVShow, TMDBSearchResult } from '@/types'

const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

// API key should be stored in settings, this is a fallback
let apiKey: string | null = null

export async function initTMDB(): Promise<boolean> {
  apiKey = await window.electronAPI.getSetting('tmdb_api_key')
  return apiKey !== null
}

export function setApiKey(key: string) {
  apiKey = key
  window.electronAPI.setSetting('tmdb_api_key', key)
}

export function getApiKey(): string | null {
  return apiKey
}

async function fetchTMDB<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  if (!apiKey) {
    throw new Error('TMDB API key not configured')
  }

  const url = new URL(`${TMDB_BASE_URL}${endpoint}`)
  url.searchParams.set('api_key', apiKey)
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  const response = await fetch(url.toString())

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid TMDB API key')
    }
    throw new Error(`TMDB API error: ${response.status}`)
  }

  return response.json()
}

// Image URLs
export function getPosterUrl(path: string | null, size: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w500'): string | null {
  if (!path) return null
  return `${TMDB_IMAGE_BASE}/${size}${path}`
}

export function getBackdropUrl(path: string | null, size: 'w300' | 'w780' | 'w1280' | 'original' = 'w1280'): string | null {
  if (!path) return null
  return `${TMDB_IMAGE_BASE}/${size}${path}`
}

// Search
export async function searchMulti(query: string): Promise<TMDBSearchResult[]> {
  const data = await fetchTMDB<{ results: TMDBSearchResult[] }>('/search/multi', {
    query,
    include_adult: 'false'
  })
  return data.results.filter(r => r.media_type === 'movie' || r.media_type === 'tv')
}

export async function searchMovies(query: string): Promise<TMDBSearchResult[]> {
  const data = await fetchTMDB<{ results: TMDBSearchResult[] }>('/search/movie', {
    query,
    include_adult: 'false'
  })
  return data.results.map(r => ({ ...r, media_type: 'movie' as const }))
}

export async function searchTV(query: string): Promise<TMDBSearchResult[]> {
  const data = await fetchTMDB<{ results: TMDBSearchResult[] }>('/search/tv', {
    query,
    include_adult: 'false'
  })
  return data.results.map(r => ({ ...r, media_type: 'tv' as const }))
}

// Get details
export async function getMovieDetails(id: number): Promise<TMDBMovie> {
  return fetchTMDB<TMDBMovie>(`/movie/${id}`)
}

export async function getTVDetails(id: number): Promise<TMDBTVShow> {
  return fetchTMDB<TMDBTVShow>(`/tv/${id}`)
}

export async function getMovieByIMDB(imdbId: string): Promise<TMDBMovie | null> {
  const data = await fetchTMDB<{ movie_results: TMDBMovie[] }>(`/find/${imdbId}`, {
    external_source: 'imdb_id'
  })
  return data.movie_results[0] || null
}

// TV Episodes
export interface TMDBEpisode {
  id: number
  name: string
  overview: string
  air_date: string
  episode_number: number
  season_number: number
  runtime: number
  still_path: string | null
}

export interface TMDBSeason {
  episodes: TMDBEpisode[]
}

export async function getTVSeason(tvId: number, seasonNumber: number): Promise<TMDBSeason> {
  return fetchTMDB<TMDBSeason>(`/tv/${tvId}/season/${seasonNumber}`)
}

// Validate API key
export async function validateApiKey(key: string): Promise<boolean> {
  try {
    const url = `${TMDB_BASE_URL}/configuration?api_key=${key}`
    const response = await fetch(url)
    return response.ok
  } catch {
    return false
  }
}
