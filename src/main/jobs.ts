import { powerMonitor } from 'electron'
import { getSettings } from './settings'
import { runScan } from './scanner'
import { startSumatraWatch, stopSumatraWatch } from './sumatra'
import { checkIdleSession, stopActiveOnSuspend } from './sessions'

let intervalTimer: ReturnType<typeof setInterval> | null = null
let idleTimer: ReturnType<typeof setInterval> | null = null
let suspendHooked = false

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
  // 每 30 秒检查一次进行中的阅读会话是否空闲超时（翻页空闲 + 整机键鼠空闲双信号）
  if (!idleTimer) idleTimer = setInterval(() => checkIdleSession(), 30 * 1000)
  // 系统休眠时立即结束进行中的会话（只注册一次）
  if (!suspendHooked) {
    suspendHooked = true
    powerMonitor.on('suspend', () => stopActiveOnSuspend())
  }
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
  if (idleTimer) {
    clearInterval(idleTimer)
    idleTimer = null
  }
}
