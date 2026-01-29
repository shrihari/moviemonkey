# Movie Monkey v2

A clean and simple, open source movie manager for your local movie collection.

![Movie Monkey](https://img.shields.io/badge/version-2.0.0-blue)
![Electron](https://img.shields.io/badge/electron-33-brightgreen)
![React](https://img.shields.io/badge/react-18-blue)
![TypeScript](https://img.shields.io/badge/typescript-5-blue)

## Features

- **Import & Organize**: Scan folders for video files and automatically fetch metadata
- **TMDB Integration**: Get movie posters, backdrops, ratings, and details
- **Search & Filter**: Find movies by title, filter by genre
- **Sort**: By title, release date, rating, or date added
- **Watch Status**: Track what you've watched
- **Open Files**: Play movies directly or show in Finder/Explorer

## Tech Stack

- **Electron 33** - Desktop app framework
- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Fast build tool
- **Tailwind CSS** - Styling
- **SQLite (better-sqlite3)** - Local database
- **TMDB API** - Movie metadata

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- A TMDB API key (free at [themoviedb.org](https://www.themoviedb.org/settings/api))

### Installation

```bash
# Clone the repo
git clone https://github.com/shrihari/moviemonkey.git
cd moviemonkey

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Building

```bash
# Build for production
npm run build
```

Installers will be created in the `release` folder.

## Configuration

On first launch, you'll be prompted to enter your TMDB API key. This is stored locally in your app settings.

## Project Structure

```
moviemonkey/
├── electron/           # Electron main process
│   ├── main.ts        # Main process entry
│   └── preload.ts     # Secure bridge to renderer
├── src/
│   ├── components/    # React components
│   ├── lib/           # Utilities (database, TMDB API)
│   ├── types/         # TypeScript types
│   ├── App.tsx        # Main app component
│   └── main.tsx       # React entry point
├── index.html
├── vite.config.ts
└── package.json
```

## License

CC0-1.0 - Do whatever you want with it!

## Credits

- Movie data from [TMDB](https://www.themoviedb.org/)
- Built with [Electron](https://www.electronjs.org/) and [React](https://react.dev/)
