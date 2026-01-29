import { useState, useEffect } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { MovieGrid } from '@/components/MovieGrid'
import { MovieDetails } from '@/components/MovieDetails'
import { Topbar } from '@/components/Topbar'
import { SetupModal } from '@/components/SetupModal'
import { initTMDB, getApiKey } from '@/lib/tmdb'
import { getAllMovies, getAllTVShows } from '@/lib/database'
import type { Movie, TVShow, MediaType, SortBy, SortOrder } from '@/types'

export default function App() {
  const [isLoading, setIsLoading] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [movies, setMovies] = useState<Movie[]>([])
  const [tvShows, setTVShows] = useState<TVShow[]>([])
  const [selectedItem, setSelectedItem] = useState<Movie | TVShow | null>(null)
  const [mediaType, setMediaType] = useState<MediaType>('movies')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('title')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      const hasApiKey = await initTMDB()
      if (!hasApiKey || !getApiKey()) {
        setNeedsSetup(true)
        setIsLoading(false)
        return
      }
      await loadLibrary()
      setIsLoading(false)
    }
    init()
  }, [])

  async function loadLibrary() {
    const [moviesData, tvShowsData] = await Promise.all([
      getAllMovies(),
      getAllTVShows()
    ])
    setMovies(moviesData)
    setTVShows(tvShowsData)
  }

  function handleSetupComplete() {
    setNeedsSetup(false)
    loadLibrary()
  }

  // Filter and sort items
  const items = mediaType === 'movies' ? movies : mediaType === 'tv' ? tvShows : [...movies, ...tvShows]

  const filteredItems = items.filter(item => {
    const title = 'title' in item ? item.title : item.name
    const matchesSearch = title.toLowerCase().includes(searchQuery.toLowerCase())
    const genres = item.genres ? JSON.parse(item.genres) as string[] : []
    const matchesGenre = !selectedGenre || genres.includes(selectedGenre)
    return matchesSearch && matchesGenre
  })

  const sortedItems = [...filteredItems].sort((a, b) => {
    let aVal: string | number | null = null
    let bVal: string | number | null = null

    switch (sortBy) {
      case 'title':
        aVal = 'title' in a ? a.title : a.name
        bVal = 'title' in b ? b.title : b.name
        break
      case 'release_date':
        aVal = 'release_date' in a ? a.release_date : a.first_air_date
        bVal = 'release_date' in b ? b.release_date : b.first_air_date
        break
      case 'vote_average':
        aVal = a.vote_average
        bVal = b.vote_average
        break
      case 'added_at':
        aVal = a.added_at
        bVal = b.added_at
        break
    }

    if (aVal === null) return 1
    if (bVal === null) return -1

    const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
    return sortOrder === 'asc' ? comparison : -comparison
  })

  // Get unique genres
  const allGenres = new Set<string>()
  items.forEach(item => {
    if (item.genres) {
      const genres = JSON.parse(item.genres) as string[]
      genres.forEach(g => allGenres.add(g))
    }
  })

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-mm-bg">
        <div className="text-mm-text text-xl">Loading...</div>
      </div>
    )
  }

  if (needsSetup) {
    return <SetupModal onComplete={handleSetupComplete} />
  }

  return (
    <div className="h-screen flex flex-col bg-mm-bg overflow-hidden">
      <Topbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={setSortBy}
        onSortOrderChange={setSortOrder}
        onImport={loadLibrary}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          mediaType={mediaType}
          onMediaTypeChange={setMediaType}
          genres={Array.from(allGenres).sort()}
          selectedGenre={selectedGenre}
          onGenreChange={setSelectedGenre}
          movieCount={movies.length}
          tvShowCount={tvShows.length}
        />

        <main className="flex-1 overflow-hidden">
          {selectedItem ? (
            <MovieDetails
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              onUpdate={loadLibrary}
            />
          ) : (
            <MovieGrid
              items={sortedItems}
              onSelect={setSelectedItem}
            />
          )}
        </main>
      </div>
    </div>
  )
}
