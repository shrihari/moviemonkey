// Mirrors src-tauri/src/engine/models.rs (serde camelCase).

export type TitleKind = 'movie' | 'series';

export interface TitleSummary {
  id: string;
  kind: TitleKind;
  name: string;
  year: number | null;
  yearLabel: string | null;
  poster: string | null;
  posterAlt: string | null;
  backdrop: string | null;
  logo: string | null;
  overview: string | null;
  rating: number | null;
  runtime: number | null;
  genres: string[];
  directors: string[];
  cast: string[];
  addedAt: number;
  updatedAt: number;
  fileCount: number;
  totalSize: number;
  episodeCount: number;
  watchedEpisodes: number;
  seasonCount: number;
  quality: string | null;
  hdr: boolean;
  online: boolean;
  watched: boolean;
  favorite: boolean;
  watchlist: boolean;
  userRating: number | null;
  lastPlayedAt: number | null;
}

export interface MediaFile {
  path: string;
  fileName: string;
  size: number;
  addedAt: number;
  season: number | null;
  episode: number | null;
  episodeEnd: number | null;
  quality: string | null;
  source: string | null;
  codec: string | null;
  hdr: string | null;
  audio: string | null;
  edition: string | null;
  status: string;
  online: boolean;
}

export interface EpisodeView {
  season: number;
  episode: number;
  name: string;
  overview: string | null;
  thumbnail: string | null;
  released: string | null;
  rating: number | null;
  file: MediaFile | null;
  watched: boolean;
  lastPlayedAt: number | null;
}

export interface SeasonView {
  number: number;
  episodes: EpisodeView[];
  available: number;
}

export interface TitleDetail {
  summary: TitleSummary;
  writers: string[];
  country: string | null;
  awards: string | null;
  released: string | null;
  status: string | null;
  trailer: string | null;
  files: MediaFile[];
  seasons: SeasonView[];
  source: string;
}

export interface UnmatchedFile {
  path: string;
  fileName: string;
  folder: string;
  size: number;
  addedAt: number;
  guessTitle: string;
  guessYear: number | null;
  guessKind: TitleKind;
  season: number | null;
  episode: number | null;
}

export interface FolderInfo {
  id: number;
  path: string;
  name: string;
  online: boolean;
  fileCount: number;
  addedAt: number;
}

export interface LibraryStats {
  movies: number;
  shows: number;
  episodes: number;
  unmatched: number;
  totalSize: number;
}

export interface LibrarySnapshot {
  titles: TitleSummary[];
  unmatched: UnmatchedFile[];
  folders: FolderInfo[];
  stats: LibraryStats;
}

export interface Progress {
  active: boolean;
  phase: 'idle' | 'scanning' | 'identifying';
  done: number;
  total: number;
  current: string | null;
  found: number;
  matched: number;
  failed: number;
}

export interface Candidate {
  id: string;
  kind: TitleKind;
  title: string;
  year: number | null;
  yearLabel: string | null;
  poster: string | null;
  subtitle: string | null;
  rank: number | null;
  source: string;
}

export interface StatePatch {
  watched?: boolean;
  favorite?: boolean;
  watchlist?: boolean;
  rating?: number;
}
