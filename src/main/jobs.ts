import { getSettings } from './settings'
import { runScan } from './scanner'
import { startSumatraWatch, stopSumatraWatch } from './sumatra'

let intervalTimer: ReturnType<typeof setInterval> | null = null

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

/**
 * 应用启动：定时扫描器 + SumatraPDF 进度监听 + 按需的启动扫描。
 * 不再对书库目录做实时监听——大目录（数千文件）的初始监听扫描会长时间占用主线程、卡住 UI。
 * 改由「启动扫描 + 定时扫描 + 手动重新扫描」覆盖更新需求。
 */
export async function startJobs(): Promise<void> {
  const s = getSettings()
  setupInterval(s.scanIntervalMinutes)
  await startSumatraWatch()
  if (s.scanOnStartup) void runScan()
}

/** 设置变化后重建定时器与 Sumatra 监听。 */
export async function reconfigureJobs(): Promise<void> {
  const s = getSettings()
  setupInterval(s.scanIntervalMinutes)
  await startSumatraWatch()
}

export async function stopJobs(): Promise<void> {
  await stopSumatraWatch()
  if (intervalTimer) {
    clearInterval(intervalTimer)
    intervalTimer = null
  }
}
