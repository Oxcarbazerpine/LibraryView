import { contextBridge, ipcRenderer } from 'electron'
import type { LibraryViewApi } from '../shared/types'

function subscribe(channel: string, cb: (payload: unknown) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: unknown): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: LibraryViewApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFile: (filters) => ipcRenderer.invoke('dialog:pickFile', filters),

  listBooks: () => ipcRenderer.invoke('library:list'),
  getBook: (id) => ipcRenderer.invoke('library:get', id),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  setStatus: (id, status) => ipcRenderer.invoke('library:setStatus', id, status),
  setProgress: (id, currentPage) => ipcRenderer.invoke('library:setProgress', id, currentPage),

  getActiveSession: () => ipcRenderer.invoke('session:active'),
  startReading: (bookId) => ipcRenderer.invoke('session:start', bookId),
  stopReading: (bookId) => ipcRenderer.invoke('session:stop', bookId),

  getStats: (rangeDays) => ipcRenderer.invoke('stats:get', rangeDays),

  ensureCover: (id) => ipcRenderer.invoke('cover:ensure', id),
  clearCoverCache: () => ipcRenderer.invoke('cover:clearCache'),

  getDataDir: () => ipcRenderer.invoke('data:getDir'),
  setDataDir: (dir) => ipcRenderer.invoke('data:setDir', dir),

  onBooksChanged: (cb) => subscribe('books:changed', () => cb()),
  onScanProgress: (cb) => subscribe('scan:progress', (p) => cb(p as never)),
  onSessionChanged: (cb) => subscribe('session:changed', (s) => cb(s as never))
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (fallback when context isolation is disabled)
  window.api = api
}
