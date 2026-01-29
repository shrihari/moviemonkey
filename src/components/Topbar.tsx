import { useState } from 'react'
import { ImportModal } from './ImportModal'
import type { SortBy, SortOrder } from '@/types'

interface TopbarProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  sortBy: SortBy
  sortOrder: SortOrder
  onSortChange: (sort: SortBy) => void
  onSortOrderChange: (order: SortOrder) => void
  onImport: () => void
}

export function Topbar({
  searchQuery,
  onSearchChange,
  sortBy,
  sortOrder,
  onSortChange,
  onSortOrderChange,
  onImport
}: TopbarProps) {
  const [showImport, setShowImport] = useState(false)

  return (
    <>
      <header className="h-14 bg-mm-surface border-b border-mm-secondary/30 flex items-center px-4 gap-4 drag-region">
        {/* macOS traffic lights spacer */}
        <div className="w-16" />

        {/* Logo */}
        <h1 className="text-lg font-bold text-mm-primary no-drag">Movie Monkey</h1>

        {/* Search */}
        <div className="flex-1 max-w-md no-drag">
          <input
            type="text"
            placeholder="Search movies..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full px-4 py-2 bg-mm-bg border border-mm-secondary/50 rounded-lg text-mm-text placeholder-mm-muted focus:outline-none focus:border-mm-primary"
          />
        </div>

        {/* Sort Controls */}
        <div className="flex items-center gap-2 no-drag">
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortBy)}
            className="px-3 py-2 bg-mm-bg border border-mm-secondary/50 rounded-lg text-mm-text focus:outline-none focus:border-mm-primary"
          >
            <option value="title">Title</option>
            <option value="release_date">Release Date</option>
            <option value="vote_average">Rating</option>
            <option value="added_at">Date Added</option>
          </select>

          <button
            onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="p-2 bg-mm-bg border border-mm-secondary/50 rounded-lg text-mm-text hover:border-mm-primary"
            title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        {/* Import Button */}
        <button
          onClick={() => setShowImport(true)}
          className="px-4 py-2 bg-mm-primary text-white rounded-lg hover:bg-mm-primary/80 no-drag"
        >
          + Import
        </button>
      </header>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImportComplete={() => {
            setShowImport(false)
            onImport()
          }}
        />
      )}
    </>
  )
}
