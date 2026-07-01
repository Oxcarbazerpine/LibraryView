import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings } from '../shared/types'

/** 设置文件所在目录：打包后 = 安装目录（exe 同级）；开发时 = 项目根。 */
function configDir(): string {
  return app.isPackaged ? dirname(app.getPath('exe')) : process.cwd()
}
function configFile(): string {
  return join(configDir(), 'config.json')
}

function detectSumatraExe(): string | null {
  const candidates = [
    join(process.env.LOCALAPPDATA ?? '', 'SumatraPDF', 'SumatraPDF.exe'),
    join(process.env.PROGRAMFILES ?? '', 'SumatraPDF', 'SumatraPDF.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? '', 'SumatraPDF', 'SumatraPDF.exe')
  ]
  return candidates.find((p) => p.length > 0 && existsSync(p)) ?? null
}

function detectSumatraSettings(): string | null {
  const p = join(process.env.LOCALAPPDATA ?? '', 'SumatraPDF', 'SumatraPDF-settings.txt')
  return existsSync(p) ? p : null
}

function defaults(): AppSettings {
  return {
    // 数据目录默认 = userData；用户可在设置里改到任意位置（如 D:\ProgramData\LibraryView）
    dataDir: app.getPath('userData'),
    libraryPaths: [],
    readerPath: detectSumatraExe(),
    sumatraSettingsPath: detectSumatraSettings(),
    autoSyncProgress: true,
    scanIntervalMinutes: 0, // 默认关闭定时扫描（启动扫描 + 手动扫描已够用）
    scanOnStartup: true
  }
}

let cache: AppSettings | null = null

export function getSettings(): AppSettings {
  if (cache) return cache
  const base = defaults()
  try {
    const f = configFile()
    if (existsSync(f)) {
      const raw = JSON.parse(readFileSync(f, 'utf-8')) as Partial<AppSettings>
      cache = { ...base, ...raw }
      return cache
    }
  } catch (e) {
    console.error('[settings] 读取配置失败，使用默认:', e)
  }
  cache = base
  return cache
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...getSettings(), ...patch }
  try {
    mkdirSync(configDir(), { recursive: true })
    writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf-8')
  } catch (e) {
    console.error('[settings] 写入配置失败:', e)
  }
  cache = next
  return next
}

/** 数据目录（数据库 + 封面所在）。 */
export function getDataDir(): string {
  const d = getSettings().dataDir
  return d && d.trim() ? d : app.getPath('userData')
}

/** 设置文件的完整路径（用于 UI 展示/调试）。 */
export function getConfigFilePath(): string {
  return configFile()
}
