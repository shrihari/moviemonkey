import { MovieCard } from './MovieCard'
import type { Movie, TVShow } from '@/types'

interface MovieGridProps {
  items: (Movie | TVShow)[]
  onSelect: (item: Movie | TVShow) => void
}

export function MovieGrid({ items, onSelect }: MovieGridProps) {
  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-mm-muted">
        <svg className="w-24 h-24 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
        </svg>
        <p className="text-lg">No movies found</p>
        <p className="text-sm mt-1">Import some movies to get started</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4">
        {items.map(item => (
          <MovieCard
            key={`${'title' in item ? 'movie' : 'tv'}-${item.id}`}
            item={item}
            onClick={() => onSelect(item)}
          />
        ))}
      </div>
    </div>
  )
}
