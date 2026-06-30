import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { initDb, closeDb } from './db'
import { closeDanglingSessions } from './sessions'
import { registerIpc } from './ipc'
import { startJobs, stopJobs } from './jobs'
import { getSettings, updateSettings } from './settings'
import { listBooks } from './books'
import { getStats } from './stats'
import { indexLibrary, backfillPageCounts } from './scanner'
import { syncFromSumatra } from './sumatra'
import { coversDirectory, moveCoverCache } from './covers'
import { registerLvimgScheme, handleLvimg } from './protocol'

registerLvimgScheme()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0b12',
    title: 'LibraryView',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 开发期截图：渲染完成后截屏并退出
  if (process.env.LV_SHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void mainWindow.webContents
          .capturePage()
          .then((img) => writeFileSync(process.env.LV_SHOT as string, img.toPNG()))
          .catch((e) => console.error('[shot] 截图失败:', e))
          .finally(() => app.exit(0))
      }, Number(process.env.LV_SHOT_DELAY) || 4500)
    })
  }
}

app.whenReady().then(async () => {
  initDb()

  // 无头冒烟测试：跑一遍真实查询后立即退出
  if (process.env.LV_SMOKE === '1') {
    const out = process.env.LV_SMOKE_OUT
    let code = 0
    try {
      const s = getSettings()
      const list = listBooks()
      const stats = getStats(7)
      if (out)
        writeFileSync(
          out,
          `smoke ok; electron ${process.versions.electron}; books ${list.length}; ` +
            `total ${stats.totalSeconds}s; reader ${s.readerPath ?? 'none'}; ` +
            `sumatra ${s.sumatraSettingsPath ?? 'none'}\n`
        )
    } catch (e) {
      code = 1
      if (out) writeFileSync(out, `SMOKE ERROR: ${(e as Error).message}\n`)
    }
    app.exit(code)
    return
  }

  // 无头扫描测试：扫描 LV_SCAN 指定目录（配合 LV_DB_PATH 用临时库）
  if (process.env.LV_SCAN) {
    const out = process.env.LV_SMOKE_OUT
    try {
      updateSettings({ libraryPaths: [process.env.LV_SCAN] })
      const t0 = Date.now()
      const idx = await indexLibrary([process.env.LV_SCAN])
      const tIndex = Date.now() - t0
      await backfillPageCounts(undefined, 60)
      const synced = await syncFromSumatra()
      const all = listBooks()
      const withPages = all.filter((b) => b.pageCount && b.pageCount > 0).length
      const report =
        `SCAN ok | indexed +${idx.added}/~${idx.updated}/-${idx.removed} in ${tIndex}ms | ` +
        `total ${all.length} | withPages ${withPages} | synced ${synced}` +
        (idx.errors.length ? ` | errors ${idx.errors.length}` : '')
      if (out) writeFileSync(out, report + '\n')
      console.log(report)
    } catch (e) {
      if (out) writeFileSync(out, 'SCAN ERROR: ' + (e as Error).message + '\n')
    }
    closeDb()
    app.exit(0)
    return
  }

  // 无头进度同步测试：用真实 SumatraPDF 设置同步到 LV_DB_PATH 指定的库
  if (process.env.LV_SUMATRA) {
    const out = process.env.LV_SMOKE_OUT
    try {
      const n = await syncFromSumatra()
      const withProgress = listBooks().filter((b) => b.currentPage > 0)
      const lines = withProgress
        .slice(0, 12)
        .map((b) => `  ${b.currentPage}p ${Math.round(b.progress * 100)}% · ${b.title.slice(0, 28)}`)
      const report = `SUMATRA updated ${n}; books with progress ${withProgress.length}\n${lines.join('\n')}`
      if (out) writeFileSync(out, report + '\n')
      console.log(report)
    } catch (e) {
      if (out) writeFileSync(out, 'SUMATRA ERROR: ' + (e as Error).message + '\n')
    }
    app.exit(0)
    return
  }

  // 管理钩子：把封面缓存目录设为 LV_SET_COVERDIR 并把已有封面搬过去
  if (process.env.LV_SET_COVERDIR) {
    const out = process.env.LV_SMOKE_OUT
    try {
      const target = process.env.LV_SET_COVERDIR
      const oldDir = coversDirectory()
      updateSettings({ coverCacheDir: target })
      const newDir = coversDirectory()
      const moved = await moveCoverCache(oldDir, newDir)
      const report = `COVERDIR set to ${newDir}; moved ${moved} from ${oldDir}`
      if (out) writeFileSync(out, report + '\n')
      console.log(report)
    } catch (e) {
      if (out) writeFileSync(out, 'COVERDIR ERROR: ' + (e as Error).message + '\n')
    }
    closeDb()
    app.exit(0)
    return
  }

  closeDanglingSessions()
  if (process.env.LV_SEED_LIB && getSettings().libraryPaths.length === 0) {
    updateSettings({ libraryPaths: [process.env.LV_SEED_LIB] })
  }
  registerIpc()
  handleLvimg()
  createWindow()
  if (!process.env.LV_SHOT) void startJobs()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void stopJobs()
    closeDb()
    app.quit()
  }
})
