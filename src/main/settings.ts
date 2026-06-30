import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from './db'
import type { AppSettings } from '../shared/types'

const KEY = 'app'

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
    libraryPaths: [],
    readerPath: detectSumatraExe(),
    sumatraSettingsPath: detectSumatraSettings(),
    autoSyncProgress: true,
    scanIntervalMinutes: 30,
    scanOnStartup: true,
    coverCacheDir: null
  }
}

export function getSettings(): AppSettings {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as
    | { value: string }
    | undefined
  const base = defaults()
  if (!row) return base
  try {
    return { ...base, ...(JSON.parse(row.value) as Partial<AppSettings>) }
  } catch {
    return base
  }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...getSettings(), ...patch }
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(KEY, JSON.stringify(next))
  return next
}
