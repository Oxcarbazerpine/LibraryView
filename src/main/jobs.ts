import type { FSWatcher } from 'chokidar'
import { getSettings } from './settings'
import { runScan } from './scanner'
import { startSumatraWatch, stopSumatraWatch } from './sumatra'

let watcher: FSWatcher | null = null
let intervalTimer: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function debounceScan(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void runScan()
  }, 4000)
}

async function teardownWatcher(): Promise<void> {
  if (watcher) {
    try {
      await watcher.close()
    } catch {
      /* ignore */
    }
    watcher = null
  }
}

async function setupWatcher(paths: string[]): Promise<void> {
  await teardownWatcher()
  const valid = paths.filter((p) => p && p.trim())
  if (valid.length === 0) return
  try {
    const { watch } = await import('chokidar')
    watcher = watch(valid, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
      ignored: (p: string) =>
        /[\\/](\$RECYCLE\.BIN|System Volume Information|node_modules)[\\/]/i.test(p)
    })
    watcher
      .on('add', debounceScan)
      .on('unlink', debounceScan)
      .on('change', debounceScan)
      .on('error', (e: unknown) => console.error('[watch] 监听错误:', e))
  } catch (e) {
    console.error('[watch] 启动文件监听失败:', e)
  }
}

function setupInterval(minutes: number): void {
  if (intervalTimer) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
  if (minutes > 0) {
    intervalTimer = setInterval(
      () => {
        void runScan()
      },
      minutes * 60 * 1000
    )
  }
}

/** 应用启动：建立监听、定时器，并按需做一次启动扫描。 */
export async function startJobs(): Promise<void> {
  const s = getSettings()
  await setupWatcher(s.libraryPaths)
  setupInterval(s.scanIntervalMinutes)
  await startSumatraWatch()
  if (s.scanOnStartup) void runScan()
}

/** 设置变化后重建监听与定时器。 */
export async function reconfigureJobs(): Promise<void> {
  const s = getSettings()
  await setupWatcher(s.libraryPaths)
  setupInterval(s.scanIntervalMinutes)
  await startSumatraWatch()
}

export async function stopJobs(): Promise<void> {
  await teardownWatcher()
  await stopSumatraWatch()
  if (intervalTimer) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}
