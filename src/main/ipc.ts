import { ipcMain, dialog } from 'electron'
import { getSettings, updateSettings } from './settings'
import * as books from './books'
import * as sessions from './sessions'
import { getStats } from './stats'
import { runScan } from './scanner'
import { ensureCover, clearCoverCache, coversDirectory, moveCoverCache } from './covers'
import { reconfigureJobs } from './jobs'
import { broadcast } from './events'
import type { AppSettings, BookStatus } from '../shared/types'

export function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', async (_e, patch: Partial<AppSettings>) => {
    // 切换封面目录前先记下旧目录，更新后把已缓存封面搬过去
    const movingCovers = 'coverCacheDir' in patch
    const oldCoverDir = movingCovers ? coversDirectory() : null
    const next = updateSettings(patch)
    // 库目录 / 扫描间隔 / 进度同步相关变化时重建监听与定时器
    if (
      'libraryPaths' in patch ||
      'scanIntervalMinutes' in patch ||
      'autoSyncProgress' in patch ||
      'sumatraSettingsPath' in patch
    ) {
      void reconfigureJobs()
    }
    // 切换封面目录：把已有封面移到新目录（保留，无需重新渲染）
    if (movingCovers && oldCoverDir) {
      const moved = await moveCoverCache(oldCoverDir, coversDirectory())
      if (moved > 0) broadcast('books:changed')
    }
    return next
  })

  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('dialog:pickFile', async (_e, filters?: Electron.FileFilter[]) => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: filters ?? [] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('library:list', () => books.listBooks())
  ipcMain.handle('library:get', (_e, id: number) => books.getBook(id))
  ipcMain.handle('library:rescan', () => runScan())
  ipcMain.handle('library:setStatus', (_e, id: number, status: BookStatus) => {
    const b = books.setStatus(id, status)
    broadcast('books:changed')
    return b
  })
  ipcMain.handle('library:setProgress', (_e, id: number, page: number) => {
    const b = books.setManualProgress(id, page)
    broadcast('books:changed')
    return b
  })

  ipcMain.handle('session:active', () => sessions.getActiveSession())
  ipcMain.handle('session:start', (_e, bookId: number) => {
    const s = sessions.startReading(bookId)
    broadcast('session:changed', s)
    broadcast('books:changed')
    return s
  })
  ipcMain.handle('session:stop', (_e, bookId: number) => {
    const s = sessions.stopReading(bookId)
    broadcast('session:changed', null)
    broadcast('books:changed')
    return s
  })

  ipcMain.handle('stats:get', (_e, rangeDays?: number) => getStats(rangeDays ?? 30))

  ipcMain.handle('cover:ensure', (_e, id: number) => ensureCover(id))
  ipcMain.handle('cover:clearCache', async () => {
    await clearCoverCache()
    broadcast('books:changed')
  })
}
