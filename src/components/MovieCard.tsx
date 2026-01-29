import { useState, useEffect } from 'react'
import { getPosterUrl } from '@/lib/tmdb'
import type { Movie, TVShow } from '@/types'

interface MovieCardProps {
  item: Movie | TVShow
  onClick: () => void
}

export function MovieCard({ item, onClick }: MovieCardProps) {
  const [posterSrc, setPosterSrc] = useState<string | null>(null)

  const title = 'title' in item ? item.title : item.name
  const year = 'release_date' in item
    ? item.release_date?.split('-')[0]
    : item.first_air_date?.split('-')[0]
  const rating = item.vote_average?.toFixed(1)

  useEffect(() => {
    async function loadPoster() {
      if (item.poster_path) {
        // Check if we have a local copy
        const paths = await window.electronAPI.getPaths()
        const localPath = `${paths.posters}/${item.poster_path.replace('/', '')}`
        const stats = await window.electronAPI.getFileStats(localPath)

        if (stats) {
          setPosterSrc(`file://${localPath}`)
        } else {
          // Use TMDB URL directly
          setPosterSrc(getPosterUrl(item.poster_path, 'w342'))
        }
      }
    }
    loadPoster()
  }, [item.poster_path])

  return (
    <button
      onClick={onClick}
      className="group relative aspect-[2/3] rounded-lg overflow-hidden bg-mm-secondary/50 focus:outline-none focus:ring-2 focus:ring-mm-primary"
    >
      {posterSrc ? (
        <img
          src={posterSrc}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-mm-muted">
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      )}

      {/* Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <p className="text-white font-medium text-sm line-clamp-2">{title}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-mm-muted">
            {year && <span>{year}</span>}
            {rating && rating !== '0.0' && (
              <>
                <span>•</span>
                <span className="text-yellow-400">★ {rating}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Type Badge */}
      {'name' in item && (
        <div className="absolute top-2 left-2 px-2 py-0.5 bg-mm-primary text-white text-xs rounded">
          TV
        </div>
      )}
    </button>
  )
}
