import { useState } from 'react'
import { setApiKey, validateApiKey } from '@/lib/tmdb'

interface SetupModalProps {
  onComplete: () => void
}

export function SetupModal({ onComplete }: SetupModalProps) {
  const [apiKey, setApiKeyInput] = useState('')
  const [error, setError] = useState('')
  const [isValidating, setIsValidating] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setIsValidating(true)

    const isValid = await validateApiKey(apiKey.trim())

    if (isValid) {
      setApiKey(apiKey.trim())
      onComplete()
    } else {
      setError('Invalid API key. Please check and try again.')
    }

    setIsValidating(false)
  }

  return (
    <div className="h-screen flex items-center justify-center bg-mm-bg p-4">
      <div className="w-full max-w-md bg-mm-surface rounded-xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-mm-primary mb-2">Movie Monkey</h1>
          <p className="text-mm-muted">Welcome! Let's get you set up.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-mm-text mb-2">
              TMDB API Key
            </label>
            <input
              type="text"
              id="apiKey"
              value={apiKey}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Enter your TMDB API key"
              className="w-full px-4 py-3 bg-mm-bg border border-mm-secondary/50 rounded-lg text-mm-text placeholder-mm-muted focus:outline-none focus:border-mm-primary"
              required
            />
            {error && (
              <p className="mt-2 text-sm text-red-400">{error}</p>
            )}
          </div>

          <div className="bg-mm-bg rounded-lg p-4 text-sm text-mm-muted">
            <p className="font-medium text-mm-text mb-2">How to get a TMDB API key:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to <button type="button" onClick={() => window.electronAPI.openExternal('https://www.themoviedb.org/signup')} className="text-mm-primary hover:underline">themoviedb.org</button></li>
              <li>Create a free account</li>
              <li>Go to Settings → API</li>
              <li>Request an API key (choose "Developer")</li>
              <li>Copy the "API Key (v3 auth)"</li>
            </ol>
          </div>

          <button
            type="submit"
            disabled={isValidating || !apiKey.trim()}
            className="w-full py-3 bg-mm-primary text-white font-medium rounded-lg hover:bg-mm-primary/80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isValidating ? 'Validating...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
