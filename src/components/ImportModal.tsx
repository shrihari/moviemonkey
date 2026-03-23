import { useState } from 'react'
import { searchMovies, searchTV, getMovieDetails, getTVDetails, getPosterUrl, getBackdropUrl } from '@/lib/tmdb'
import { addMovie, addTVShow, getMovieByTmdbId, getTVShowByTmdbId } from '@/lib/database'
import type { TMDBSearchResult } from '@/types'

interface ImportModalProps {
  onClose: () => void
  onImportComplete: () => void
}

type ImportStep = 'select' | 'scanning' | 'matching' | 'done'

interface FileToMatch {
  path: string
  filename: string
  size: number
  searchQuery: string
  results: TMDBSearchResult[]
  selectedResult: TMDBSearchResult | null
  status: 'pending' | 'searching' | 'matched' | 'skipped' | 'imported'
}

export function ImportModal({ onClose, onImportComplete }: ImportModalProps) {
  const [step, setStep] = useState<ImportStep>('select')
  const [files, setFiles] = useState<FileToMatch[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [importProgress, setImportProgress] = useState(0)

  async function handleSelectFolder() {
    const result = await window.electronAPI.showOpenDialog({
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) return

    setStep('scanning')
    const dirPath = result.filePaths[0]
    const videoPaths = await window.electronAPI.scanDirectory(dirPath)

    if (videoPaths.length === 0) {
      alert('No video files found in the selected folder.')
      setStep('select')
      return
    }

    // Prepare files for matching
    const filesToMatch: FileToMatch[] = await Promise.all(
      videoPaths.map(async (path) => {
        const filename = path.split('/').pop() || path
        const stats = await window.electronAPI.getFileStats(path)
        const searchQuery = cleanFilename(filename)

        return {
          path,
          filename,
          size: stats?.size || 0,
          searchQuery,
          results: [],
          selectedResult: null,
          status: 'pending' as const
        }
      })
    )

    setFiles(filesToMatch)
    setStep('matching')

    // Search for all files
    for (let i = 0; i < filesToMatch.length; i++) {
      searchForFile(i, filesToMatch)
    }
  }

  function cleanFilename(filename: string): string {
    // Remove extension
    let name = filename.replace(/\.[^/.]+$/, '')

    // Replace dots and underscores with spaces first
    name = name.replace(/[._]/g, ' ')

    // For TV shows: extract just the show name (everything before S##E##)
    const tvMatch = name.match(/^(.+?)\s*S\d{1,2}E\d{1,2}/i)
    if (tvMatch) {
      name = tvMatch[1]
    } else {
      // Remove common patterns for movies
      name = name
        .replace(/[\[\(]?\d{4}[\]\)]?/, '') // Year
        .replace(/S\d{1,2}\s*E\d{1,2}/gi, '') // S##E## patterns
        .replace(/\b(720p|1080p|2160p|4k|uhd|hdr|bluray|brrip|dvdrip|webrip|web-dl|hdtv|nf|amzn|dsnp|hmax)\b/gi, '')
        .replace(/\b(x264|x265|hevc|h264|h265|avc|aac|ac3|dts|mp3|atmos|ddp?\d?\.?\d?)\b/gi, '')
        .replace(/\b(yify|yts|rarbg|sparks|geckos|fgt|tbd|flux|ntb|ctrlhd|evo)\b/gi, '')
        .replace(/\b(chapter|part)\s*(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/gi, '')
    }

    // Clean up
    name = name
      .replace(/[-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return name
  }

  async function searchForFile(index: number, fileList: FileToMatch[]) {
    const file = fileList[index]
    if (!file) return

    setFiles(prev => prev.map((f, i) =>
      i === index ? { ...f, status: 'searching' } : f
    ))

    try {
      // Search both movies and TV
      const [movieResults, tvResults] = await Promise.all([
        searchMovies(file.searchQuery),
        searchTV(file.searchQuery)
      ])

      const allResults = [...movieResults, ...tvResults]
        .sort((a, b) => b.vote_average - a.vote_average)
        .slice(0, 10)

      setFiles(prev => prev.map((f, i) =>
        i === index ? {
          ...f,
          results: allResults,
          selectedResult: allResults[0] || null,
          status: allResults.length > 0 ? 'matched' : 'pending'
        } : f
      ))
    } catch (error) {
      console.error('Search error:', error)
      setFiles(prev => prev.map((f, i) =>
        i === index ? { ...f, status: 'pending' } : f
      ))
    }
  }

  async function handleSearch(index: number, query: string) {
    setFiles(prev => prev.map((f, i) =>
      i === index ? { ...f, searchQuery: query } : f
    ))

    if (query.length >= 2) {
      await searchForFile(index, files.map((f, i) =>
        i === index ? { ...f, searchQuery: query } : f
      ))
    }
  }

  function handleSelectResult(index: number, result: TMDBSearchResult | null) {
    setFiles(prev => prev.map((f, i) =>
      i === index ? { ...f, selectedResult: result, status: result ? 'matched' : 'skipped' } : f
    ))
  }

  async function handleImportAll() {
    setStep('done')
    const toImport = files.filter(f => f.selectedResult)

    for (let i = 0; i < toImport.length; i++) {
      const file = toImport[i]
      setImportProgress(Math.round(((i + 1) / toImport.length) * 100))

      try {
        const result = file.selectedResult!

        if (result.media_type === 'movie') {
          // Check if already exists
          const existing = await getMovieByTmdbId(result.id)
          if (existing) continue

          const details = await getMovieDetails(result.id)

          // Download poster and backdrop
          const paths = await window.electronAPI.getPaths()
          if (details.poster_path) {
            await window.electronAPI.downloadImage(
              getPosterUrl(details.poster_path, 'w500')!,
              `${paths.posters}/${details.poster_path.replace('/', '')}`
            )
          }
          if (details.backdrop_path) {
            await window.electronAPI.downloadImage(
              getBackdropUrl(details.backdrop_path, 'w1280')!,
              `${paths.backdrops}/${details.backdrop_path.replace('/', '')}`
            )
          }

          await addMovie({
            tmdb_id: details.id,
            imdb_id: details.imdb_id || null,
            title: details.title,
            original_title: details.original_title,
            overview: details.overview,
            release_date: details.release_date,
            runtime: details.runtime,
            vote_average: details.vote_average,
            vote_count: details.vote_count,
            popularity: details.popularity,
            poster_path: details.poster_path,
            backdrop_path: details.backdrop_path,
            genres: JSON.stringify(details.genres.map(g => g.name)),
            type: 'movie',
            file_path: file.path,
            file_size: file.size,
            watched: 0,
            rating: null
          })
        } else {
          // TV Show
          const existing = await getTVShowByTmdbId(result.id)
          if (existing) continue

          const details = await getTVDetails(result.id)

          // Download images
          const paths = await window.electronAPI.getPaths()
          if (details.poster_path) {
            await window.electronAPI.downloadImage(
              getPosterUrl(details.poster_path, 'w500')!,
              `${paths.posters}/${details.poster_path.replace('/', '')}`
            )
          }
          if (details.backdrop_path) {
            await window.electronAPI.downloadImage(
              getBackdropUrl(details.backdrop_path, 'w1280')!,
              `${paths.backdrops}/${details.backdrop_path.replace('/', '')}`
            )
          }

          await addTVShow({
            tmdb_id: details.id,
            imdb_id: null,
            name: details.name,
            original_name: details.original_name,
            overview: details.overview,
            first_air_date: details.first_air_date,
            vote_average: details.vote_average,
            vote_count: details.vote_count,
            popularity: details.popularity,
            poster_path: details.poster_path,
            backdrop_path: details.backdrop_path,
            genres: JSON.stringify(details.genres.map(g => g.name)),
            number_of_seasons: details.number_of_seasons,
            number_of_episodes: details.number_of_episodes
          })
        }
      } catch (error) {
        console.error('Import error:', error)
      }
    }

    onImportComplete()
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] bg-mm-surface rounded-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-mm-secondary/30">
          <h2 className="text-xl font-bold text-mm-text">Import Movies</h2>
          <button onClick={onClose} className="text-mm-muted hover:text-mm-text">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === 'select' && (
            <div className="h-64 flex flex-col items-center justify-center">
              <p className="text-mm-muted mb-4">Select a folder containing your movies or TV shows</p>
              <button
                onClick={handleSelectFolder}
                className="px-6 py-3 bg-mm-primary text-white rounded-lg hover:bg-mm-primary/80"
              >
                Choose Folder
              </button>
            </div>
          )}

          {step === 'scanning' && (
            <div className="h-64 flex flex-col items-center justify-center">
              <div className="animate-spin w-8 h-8 border-2 border-mm-primary border-t-transparent rounded-full mb-4" />
              <p className="text-mm-muted">Scanning for video files...</p>
            </div>
          )}

          {step === 'matching' && (
            <div className="space-y-4">
              {files.map((file, index) => (
                <div key={file.path} className="bg-mm-bg rounded-lg p-4">
                  <div className="flex items-start gap-4">
                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-mm-text font-medium truncate" title={file.filename}>
                        {file.filename}
                      </p>
                      <input
                        type="text"
                        value={file.searchQuery}
                        onChange={(e) => handleSearch(index, e.target.value)}
                        className="mt-2 w-full px-3 py-2 bg-mm-surface border border-mm-secondary/50 rounded text-sm text-mm-text focus:outline-none focus:border-mm-primary"
                        placeholder="Search..."
                      />
                    </div>

                    {/* Match Results */}
                    <div className="w-64">
                      {file.status === 'searching' ? (
                        <div className="text-sm text-mm-muted">Searching...</div>
                      ) : file.results.length > 0 ? (
                        <select
                          value={file.selectedResult?.id || ''}
                          onChange={(e) => {
                            const result = file.results.find(r => r.id === Number(e.target.value))
                            handleSelectResult(index, result || null)
                          }}
                          className="w-full px-3 py-2 bg-mm-surface border border-mm-secondary/50 rounded text-sm text-mm-text focus:outline-none focus:border-mm-primary"
                        >
                          <option value="">Skip this file</option>
                          {file.results.map(r => (
                            <option key={r.id} value={r.id}>
                              {r.title || r.name} ({(r.release_date || r.first_air_date)?.split('-')[0]})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="text-sm text-mm-muted">No matches found</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 'done' && (
            <div className="h-64 flex flex-col items-center justify-center">
              <div className="w-full max-w-xs mb-4">
                <div className="h-2 bg-mm-bg rounded-full overflow-hidden">
                  <div
                    className="h-full bg-mm-primary transition-all duration-300"
                    style={{ width: `${importProgress}%` }}
                  />
                </div>
              </div>
              <p className="text-mm-muted">Importing... {importProgress}%</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'matching' && (
          <div className="flex items-center justify-between p-4 border-t border-mm-secondary/30">
            <p className="text-sm text-mm-muted">
              {files.filter(f => f.selectedResult).length} of {files.length} files matched
            </p>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-mm-muted hover:text-mm-text"
              >
                Cancel
              </button>
              <button
                onClick={handleImportAll}
                disabled={files.filter(f => f.selectedResult).length === 0}
                className="px-4 py-2 bg-mm-primary text-white rounded-lg hover:bg-mm-primary/80 disabled:opacity-50"
              >
                Import Selected
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
