import { ipcMain, dialog, app, shell } from 'electron'
import { resolve } from 'node:path'
import { getSettings, updateSettings, getDataDir } from './settings'
import * as books from './books'
import * as sessions from './sessions'
import { getStats } from './stats'
import { runScan } from './scanner'
import { ensureCover, clearCoverCache } from './covers'
import { reconfigureJobs, stopJobs } from './jobs'
import { closeDb } from './db'
import { migrateDataDir } from './paths'
import { broadcast } from './events'
import type { AppSettings, BookStatus } from '../shared/types'

export function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:update', (_e, patch: Partial<AppSettings>) => {
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

  ipcMain.handle('shell:reveal', (_e, p: string) => {
    if (p) shell.showItemInFolder(p)
  })

  ipcMain.handle('cover:ensure', (_e, id: number) => ensureCover(id))
  ipcMain.handle('cover:clearCache', async () => {
    await clearCoverCache()
    broadcast('books:changed')
  })

  // 数据目录：获取 + 更改（迁移数据库与封面，然后重启生效）
  ipcMain.handle('data:getDir', () => getDataDir())
  ipcMain.handle('data:setDir', async (_e, newDir: string) => {
    const oldDir = getDataDir()
    if (!newDir || !newDir.trim()) return { changed: false, error: '路径为空' }
    if (resolve(newDir) === resolve(oldDir)) return { changed: false }
    try {
      await stopJobs()
      closeDb()
      await migrateDataDir(oldDir, newDir)
      updateSettings({ dataDir: newDir })
    } catch (e) {
      return { changed: false, error: (e as Error).message }
    }
    // 重启使新目录生效（打包后无缝重启；开发模式仅退出，需手动再启动）
    if (app.isPackaged) app.relaunch()
    setTimeout(() => app.exit(0), 250)
    return { changed: true }
  })
}
