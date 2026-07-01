import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { initDb, closeDb } from './db'
import { closeDanglingSessions } from './sessions'
import { registerIpc } from './ipc'
import { startJobs, stopJobs } from './jobs'
import {
  stopPdfWorker,
  workerPageCount,
  workerRenderCover,
  workerEbookMeta,
  workerEbookCover
} from './pdf-pool'
import { getSettings, updateSettings, getDataDir } from './settings'
import { listBooks } from './books'
import { getStats } from './stats'
import { indexLibrary, backfillPageCounts, backfillMetadata } from './scanner'
import { syncFromSumatra } from './sumatra'
import { registerLvimgScheme, handleLvimg } from './protocol'

registerLvimgScheme()

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1120,
    minHeight: 720,
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

  // 开发期截图：渲染完成后（可选先导航到某页）截屏并退出
  if (process.env.LV_SHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      const delay = Number(process.env.LV_SHOT_DELAY) || 4500
      const nav = process.env.LV_SHOT_NAV
      setTimeout(() => {
        void (async () => {
          try {
            if (nav) {
              await mainWindow.webContents.executeJavaScript(
                `document.querySelector('[data-nav="${nav}"]')?.click()`
              )
              await new Promise((r) => setTimeout(r, 900))
            }
            const js = process.env.LV_SHOT_JS
            if (js) {
              await mainWindow.webContents.executeJavaScript(js)
              await new Promise((r) => setTimeout(r, 500))
            }
            const img = await mainWindow.webContents.capturePage()
            writeFileSync(process.env.LV_SHOT as string, img.toPNG())
          } catch (e) {
            console.error('[shot] 截图失败:', e)
          } finally {
            app.exit(0)
          }
        })()
      }, delay)
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

  // 工作进程自检：在 utilityProcess 里算一本 PDF 的页数 + 渲染封面
  if (process.env.LV_WORKERTEST) {
    const out = process.env.LV_SMOKE_OUT
    try {
      const pdf = listBooks().find((b) => b.format === 'pdf' && !b.missing)
      if (!pdf) throw new Error('库中没有 PDF')
      const t0 = Date.now()
      const pages = await workerPageCount(pdf.path)
      const ok = await workerRenderCover(pdf.path, join(getDataDir(), 'covers', 'worktest.png'))
      const report = `WORKER ok | pages ${pages} | cover ${ok} | ${Date.now() - t0}ms`
      if (out) writeFileSync(out, report + '\n')
      console.log(report)
    } catch (e) {
      if (out) writeFileSync(out, 'WORKER ERROR: ' + (e as Error).message + '\n')
    }
    stopPdfWorker()
    closeDb()
    app.exit(0)
    return
  }

  // 电子书元数据/封面自检：对库中每种电子书格式各取一本，抽取书名/作者与内嵌封面
  if (process.env.LV_EBOOK) {
    const out = process.env.LV_SMOKE_OUT
    try {
      const all = listBooks()
      const formats = ['epub', 'mobi', 'azw3', 'cbz'] as const
      const lines: string[] = []
      for (const fmt of formats) {
        const b = all.find((x) => x.format === fmt && !x.missing)
        if (!b) {
          lines.push(`${fmt}: （库中无）`)
          continue
        }
        const meta = await workerEbookMeta(b.path, b.format)
        const coverOut = join(getDataDir(), 'covers', `ebooktest_${fmt}.png`)
        const ok = await workerEbookCover(b.path, b.format, coverOut)
        lines.push(
          `${fmt}: cover=${ok} title=「${(meta.title ?? '').slice(0, 36)}」author=${meta.author ?? '-'}`
        )
      }
      const report = 'EBOOK\n' + lines.join('\n')
      if (out) writeFileSync(out, report + '\n')
      console.log(report)
    } catch (e) {
      if (out) writeFileSync(out, 'EBOOK ERROR: ' + (e as Error).message + '\n')
    }
    stopPdfWorker()
    closeDb()
    app.exit(0)
    return
  }

  // 诊断：事件循环延迟探针（LV_DIAG=1 时打印主线程被阻塞的时刻与时长）
  if (process.env.LV_DIAG) {
    let last = Date.now()
    setInterval(() => {
      const now = Date.now()
      const lag = now - last - 200
      last = now
      if (lag > 80) console.log(`[diag] loop lag ${lag}ms @ ${new Date().toISOString().slice(11, 23)}`)
    }, 200)
    console.log('[diag] normal startup begin @', new Date().toISOString().slice(11, 23))
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
    stopPdfWorker()
    closeDb()
    app.quit()
  }
})
