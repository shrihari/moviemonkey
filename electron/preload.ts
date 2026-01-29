import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Paths
  getPaths: () => ipcRenderer.invoke('get-paths'),

  // Database
  dbQuery: (sql: string, params?: unknown[]) =>
    ipcRenderer.invoke('db-query', sql, params),

  // File dialogs
  showOpenDialog: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('show-open-dialog', options),

  // File operations
  openPath: (filePath: string) =>
    ipcRenderer.invoke('open-path', filePath),

  showInFolder: (filePath: string) =>
    ipcRenderer.invoke('show-in-folder', filePath),

  openExternal: (url: string) =>
    ipcRenderer.invoke('open-external', url),

  // Image download
  downloadImage: (url: string, destPath: string) =>
    ipcRenderer.invoke('download-image', url, destPath),

  // Directory scanning
  scanDirectory: (dirPath: string) =>
    ipcRenderer.invoke('scan-directory', dirPath),

  // File stats
  getFileStats: (filePath: string) =>
    ipcRenderer.invoke('get-file-stats', filePath),

  // Settings
  getSetting: (key: string) =>
    ipcRenderer.invoke('get-setting', key),

  setSetting: (key: string, value: string) =>
    ipcRenderer.invoke('set-setting', key, value),
})

// Type definitions for the exposed API
export interface ElectronAPI {
  getPaths: () => Promise<{ userData: string; posters: string; backdrops: string }>
  dbQuery: (sql: string, params?: unknown[]) => Promise<unknown>
  showOpenDialog: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>
  openPath: (filePath: string) => Promise<string>
  showInFolder: (filePath: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  downloadImage: (url: string, destPath: string) => Promise<{ success: boolean; path?: string; error?: string }>
  scanDirectory: (dirPath: string) => Promise<string[]>
  getFileStats: (filePath: string) => Promise<{ size: number; mtime: string } | null>
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<void>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
