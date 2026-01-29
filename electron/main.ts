import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'

// Database instance
let db: Database.Database | null = null

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null

// Paths
const userDataPath = app.getPath('userData')
const dbPath = path.join(userDataPath, 'moviemonkey.db')
const postersPath = path.join(userDataPath, 'posters')
const backdropsPath = path.join(userDataPath, 'backdrops')

function initializeDatabase() {
  // Ensure directories exist
  fs.mkdirSync(postersPath, { recursive: true })
  fs.mkdirSync(backdropsPath, { recursive: true })

  // Initialize SQLite database
  db = new Database(dbPath)

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      imdb_id TEXT,
      title TEXT NOT NULL,
      original_title TEXT,
      overview TEXT,
      release_date TEXT,
      runtime INTEGER,
      vote_average REAL,
      vote_count INTEGER,
      popularity REAL,
      poster_path TEXT,
      backdrop_path TEXT,
      genres TEXT,
      type TEXT DEFAULT 'movie',
      file_path TEXT,
      file_size INTEGER,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP,
      watched INTEGER DEFAULT 0,
      rating INTEGER
    );

    CREATE TABLE IF NOT EXISTS tv_shows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tmdb_id INTEGER UNIQUE,
      imdb_id TEXT,
      name TEXT NOT NULL,
      original_name TEXT,
      overview TEXT,
      first_air_date TEXT,
      vote_average REAL,
      vote_count INTEGER,
      popularity REAL,
      poster_path TEXT,
      backdrop_path TEXT,
      genres TEXT,
      number_of_seasons INTEGER,
      number_of_episodes INTEGER,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tv_show_id INTEGER,
      tmdb_id INTEGER,
      season_number INTEGER,
      episode_number INTEGER,
      name TEXT,
      overview TEXT,
      air_date TEXT,
      runtime INTEGER,
      still_path TEXT,
      file_path TEXT,
      file_size INTEGER,
      watched INTEGER DEFAULT 0,
      FOREIGN KEY (tv_show_id) REFERENCES tv_shows(id)
    );

    CREATE TABLE IF NOT EXISTS watch_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
    CREATE INDEX IF NOT EXISTS idx_movies_tmdb ON movies(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_tv_shows_name ON tv_shows(name);
    CREATE INDEX IF NOT EXISTS idx_episodes_show ON episodes(tv_show_id);
  `)

  return db
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // Required for better-sqlite3
    }
  })

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// IPC Handlers
function setupIpcHandlers() {
  // Get app paths
  ipcMain.handle('get-paths', () => ({
    userData: userDataPath,
    posters: postersPath,
    backdrops: backdropsPath
  }))

  // Database operations
  ipcMain.handle('db-query', (_event, sql: string, params: unknown[] = []) => {
    if (!db) return null
    try {
      const stmt = db.prepare(sql)
      if (sql.trim().toUpperCase().startsWith('SELECT')) {
        return stmt.all(...params)
      } else {
        return stmt.run(...params)
      }
    } catch (error) {
      console.error('Database error:', error)
      throw error
    }
  })

  // File dialog
  ipcMain.handle('show-open-dialog', async (_event, options) => {
    if (!mainWindow) return { canceled: true, filePaths: [] }
    return dialog.showOpenDialog(mainWindow, options)
  })

  // Open file in default app
  ipcMain.handle('open-path', (_event, filePath: string) => {
    return shell.openPath(filePath)
  })

  // Show file in folder
  ipcMain.handle('show-in-folder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // Open external URL
  ipcMain.handle('open-external', (_event, url: string) => {
    return shell.openExternal(url)
  })

  // Download image
  ipcMain.handle('download-image', async (_event, url: string, destPath: string) => {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      fs.writeFileSync(destPath, buffer)
      return { success: true, path: destPath }
    } catch (error) {
      console.error('Download error:', error)
      return { success: false, error: String(error) }
    }
  })

  // Get files in directory
  ipcMain.handle('scan-directory', async (_event, dirPath: string) => {
    const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v']
    const results: string[] = []

    async function scanDir(dir: string) {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await scanDir(fullPath)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (videoExtensions.includes(ext)) {
            results.push(fullPath)
          }
        }
      }
    }

    await scanDir(dirPath)
    return results
  })

  // Get file stats
  ipcMain.handle('get-file-stats', async (_event, filePath: string) => {
    try {
      const stats = await fs.promises.stat(filePath)
      return { size: stats.size, mtime: stats.mtime.toISOString() }
    } catch {
      return null
    }
  })

  // Settings
  ipcMain.handle('get-setting', (_event, key: string) => {
    if (!db) return null
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  })

  ipcMain.handle('set-setting', (_event, key: string, value: string) => {
    if (!db) return
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  })
}

// App lifecycle
app.whenReady().then(() => {
  initializeDatabase()
  setupIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // Check for updates (only in production)
  if (!process.env.VITE_DEV_SERVER_URL) {
    autoUpdater.checkForUpdatesAndNotify()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('quit', () => {
  if (db) {
    db.close()
  }
})
