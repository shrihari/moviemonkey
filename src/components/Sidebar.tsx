import type { MediaType } from '@/types'

interface SidebarProps {
  mediaType: MediaType
  onMediaTypeChange: (type: MediaType) => void
  genres: string[]
  selectedGenre: string | null
  onGenreChange: (genre: string | null) => void
  movieCount: number
  tvShowCount: number
}

export function Sidebar({
  mediaType,
  onMediaTypeChange,
  genres,
  selectedGenre,
  onGenreChange,
  movieCount,
  tvShowCount
}: SidebarProps) {
  return (
    <aside className="w-56 bg-mm-surface border-r border-mm-secondary/30 flex flex-col overflow-hidden">
      {/* Media Type Selector */}
      <div className="p-4 border-b border-mm-secondary/30">
        <h2 className="text-sm font-semibold text-mm-muted uppercase tracking-wider mb-3">Library</h2>
        <nav className="space-y-1">
          <button
            onClick={() => onMediaTypeChange('movies')}
            className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between ${
              mediaType === 'movies' ? 'bg-mm-primary text-white' : 'text-mm-text hover:bg-mm-secondary/50'
            }`}
          >
            <span>Movies</span>
            <span className="text-sm opacity-70">{movieCount}</span>
          </button>
          <button
            onClick={() => onMediaTypeChange('tv')}
            className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between ${
              mediaType === 'tv' ? 'bg-mm-primary text-white' : 'text-mm-text hover:bg-mm-secondary/50'
            }`}
          >
            <span>TV Shows</span>
            <span className="text-sm opacity-70">{tvShowCount}</span>
          </button>
        </nav>
      </div>

      {/* Genre Filter */}
      <div className="flex-1 overflow-y-auto p-4">
        <h2 className="text-sm font-semibold text-mm-muted uppercase tracking-wider mb-3">Genres</h2>
        <nav className="space-y-1">
          <button
            onClick={() => onGenreChange(null)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
              selectedGenre === null ? 'bg-mm-secondary text-white' : 'text-mm-text hover:bg-mm-secondary/50'
            }`}
          >
            All Genres
          </button>
          {genres.map(genre => (
            <button
              key={genre}
              onClick={() => onGenreChange(genre)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                selectedGenre === genre ? 'bg-mm-secondary text-white' : 'text-mm-text hover:bg-mm-secondary/50'
              }`}
            >
              {genre}
            </button>
          ))}
        </nav>
      </div>
    </aside>
  )
}
