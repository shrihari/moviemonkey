import { useState, useEffect } from 'react'
import { getBackdropUrl, getPosterUrl } from '@/lib/tmdb'
import { deleteMovie, deleteTVShow, updateMovie } from '@/lib/database'
import type { Movie, TVShow } from '@/types'

interface MovieDetailsProps {
  item: Movie | TVShow
  onClose: () => void
  onUpdate: () => void
}

export function MovieDetails({ item, onClose, onUpdate }: MovieDetailsProps) {
  const [backdropSrc, setBackdropSrc] = useState<string | null>(null)
  const [posterSrc, setPosterSrc] = useState<string | null>(null)

  const isMovie = 'title' in item
  const title = isMovie ? item.title : item.name
  const releaseDate = isMovie ? item.release_date : item.first_air_date
  const year = releaseDate?.split('-')[0]
  const rating = item.vote_average?.toFixed(1)
  const genres = item.genres ? (JSON.parse(item.genres) as string[]) : []

  useEffect(() => {
    async function loadImages() {
      const paths = await window.electronAPI.getPaths()

      if (item.backdrop_path) {
        const localBackdrop = `${paths.backdrops}/${item.backdrop_path.replace('/', '')}`
        const stats = await window.electronAPI.getFileStats(localBackdrop)
        setBackdropSrc(stats ? `file://${localBackdrop}` : getBackdropUrl(item.backdrop_path))
      }

      if (item.poster_path) {
        const localPoster = `${paths.posters}/${item.poster_path.replace('/', '')}`
        const stats = await window.electronAPI.getFileStats(localPoster)
        setPosterSrc(stats ? `file://${localPoster}` : getPosterUrl(item.poster_path))
      }
    }
    loadImages()
  }, [item])

  async function handlePlay() {
    if (isMovie && item.file_path) {
      await window.electronAPI.openPath(item.file_path)
    }
  }

  async function handleShowInFolder() {
    if (isMovie && item.file_path) {
      await window.electronAPI.showInFolder(item.file_path)
    }
  }

  async function handleOpenIMDB() {
    const imdbId = item.imdb_id
    if (imdbId) {
      await window.electronAPI.openExternal(`https://www.imdb.com/title/${imdbId}`)
    }
  }

  async function handleOpenTMDB() {
    const type = isMovie ? 'movie' : 'tv'
    await window.electronAPI.openExternal(`https://www.themoviedb.org/${type}/${item.tmdb_id}`)
  }

  async function handleDelete() {
    if (confirm(`Are you sure you want to remove "${title}" from your library?`)) {
      if (isMovie) {
        await deleteMovie(item.id)
      } else {
        await deleteTVShow(item.id)
      }
      onUpdate()
      onClose()
    }
  }

  async function handleToggleWatched() {
    if (isMovie) {
      await updateMovie(item.id, { watched: item.watched ? 0 : 1 })
      onUpdate()
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Backdrop */}
      <div className="relative h-96">
        {backdropSrc ? (
          <img
            src={backdropSrc}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-mm-secondary" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-mm-bg via-mm-bg/50 to-transparent" />

        {/* Back Button */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 p-2 bg-black/50 rounded-full text-white hover:bg-black/70"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="relative -mt-32 px-8 pb-8">
        <div className="flex gap-8">
          {/* Poster */}
          <div className="flex-shrink-0">
            {posterSrc ? (
              <img
                src={posterSrc}
                alt={title}
                className="w-48 rounded-lg shadow-2xl"
              />
            ) : (
              <div className="w-48 aspect-[2/3] bg-mm-secondary rounded-lg" />
            )}

            {/* Action Buttons */}
            <div className="mt-4 space-y-2">
              {isMovie && item.file_path && (
                <>
                  <button
                    onClick={handlePlay}
                    className="w-full py-2 bg-mm-primary text-white rounded-lg hover:bg-mm-primary/80"
                  >
                    ▶ Play
                  </button>
                  <button
                    onClick={handleShowInFolder}
                    className="w-full py-2 bg-mm-secondary text-white rounded-lg hover:bg-mm-secondary/80"
                  >
                    Show in Folder
                  </button>
                </>
              )}
              <button
                onClick={handleToggleWatched}
                className={`w-full py-2 rounded-lg ${
                  isMovie && item.watched
                    ? 'bg-green-600 text-white'
                    : 'bg-mm-secondary text-white hover:bg-mm-secondary/80'
                }`}
              >
                {isMovie && item.watched ? '✓ Watched' : 'Mark as Watched'}
              </button>
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h1 className="text-4xl font-bold text-white">{title}</h1>

            <div className="flex items-center gap-4 mt-2 text-mm-muted">
              {year && <span>{year}</span>}
              {isMovie && item.runtime && <span>{item.runtime} min</span>}
              {!isMovie && item.number_of_seasons && (
                <span>{item.number_of_seasons} season{item.number_of_seasons > 1 ? 's' : ''}</span>
              )}
              {rating && rating !== '0.0' && (
                <span className="text-yellow-400">★ {rating}</span>
              )}
            </div>

            {/* Genres */}
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-4">
                {genres.map(genre => (
                  <span
                    key={genre}
                    className="px-3 py-1 bg-mm-secondary/50 text-mm-text text-sm rounded-full"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            )}

            {/* Overview */}
            {item.overview && (
              <p className="mt-6 text-mm-text leading-relaxed">{item.overview}</p>
            )}

            {/* External Links */}
            <div className="flex gap-3 mt-6">
              {item.imdb_id && (
                <button
                  onClick={handleOpenIMDB}
                  className="px-4 py-2 bg-[#f5c518] text-black font-bold rounded hover:bg-[#f5c518]/80"
                >
                  IMDb
                </button>
              )}
              <button
                onClick={handleOpenTMDB}
                className="px-4 py-2 bg-[#01d277] text-white font-bold rounded hover:bg-[#01d277]/80"
              >
                TMDB
              </button>
            </div>

            {/* File Info */}
            {isMovie && item.file_path && (
              <div className="mt-6 p-4 bg-mm-secondary/30 rounded-lg">
                <p className="text-sm text-mm-muted truncate" title={item.file_path}>
                  📁 {item.file_path}
                </p>
                {item.file_size && (
                  <p className="text-sm text-mm-muted mt-1">
                    Size: {(item.file_size / 1024 / 1024 / 1024).toFixed(2)} GB
                  </p>
                )}
              </div>
            )}

            {/* Delete Button */}
            <button
              onClick={handleDelete}
              className="mt-6 px-4 py-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded"
            >
              Remove from Library
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
