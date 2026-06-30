import { readFile } from 'node:fs/promises'
import type { FSWatcher } from 'chokidar'
import { getSettings } from './settings'
import { applyProgressByPath } from './books'
import { broadcast } from './events'

let watcher: FSWatcher | null = null
let debounce: ReturnType<typeof setTimeout> | null = null

/**
 * 解析 SumatraPDF 设置文件的 FileStates 段，返回 路径 → 上次阅读页(PageNo)。
 * 文件为缩进式自定义格式；用括号深度跟踪以正确跳过嵌套数组（如 Favorites []），
 * 且不会被文件路径里本身含有的 [ ] 干扰（它们出现在 `=` 右侧，不会单独成行）。
 */
export function parseFileStates(content: string): Map<string, number> {
  const result = new Map<string, number>()
  const lines = content.split(/\r?\n/)
  let started = false
  let depth = 0
  let curPath: string | null = null
  let curPage: number | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!started) {
      if (line === 'FileStates [') {
        started = true
        depth = 1
      }
      continue
    }
    if (line === ']') {
      depth--
      if (depth === 1) {
        // 一个文件状态块结束
        if (curPath && curPage !== null) result.set(curPath, curPage)
        curPath = null
        curPage = null
      } else if (depth <= 0) {
        break // FileStates 段结束
      }
      continue
    }
    if (line.endsWith('[')) {
      depth++
      continue
    }
    if (depth === 2) {
      const eq = line.indexOf('=')
      if (eq > 0) {
        const key = line.slice(0, eq).trim()
        const val = line.slice(eq + 1).trim()
        if (key === 'FilePath') curPath = val
        else if (key === 'PageNo') {
          const n = parseInt(val, 10)
          if (Number.isFinite(n)) curPage = n
        }
      }
    }
  }
  return result
}

/** 读取一次 SumatraPDF 设置并把进度回写到匹配的书籍。返回更新的本数。 */
export async function syncFromSumatra(): Promise<number> {
  const { sumatraSettingsPath, autoSyncProgress } = getSettings()
  if (!autoSyncProgress || !sumatraSettingsPath) return 0
  let content: string
  try {
    content = await readFile(sumatraSettingsPath, 'utf8')
  } catch {
    return 0
  }
  const states = parseFileStates(content)
  let updated = 0
  for (const [path, page] of states) {
    if (page > 0 && applyProgressByPath(path, page, true)) updated++
  }
  if (updated > 0) broadcast('books:changed')
  return updated
}

export async function startSumatraWatch(): Promise<void> {
  await stopSumatraWatch()
  const { sumatraSettingsPath, autoSyncProgress } = getSettings()
  if (!autoSyncProgress || !sumatraSettingsPath) return

  void syncFromSumatra() // 启动时先同步一次

  try {
    const { watch } = await import('chokidar')
    watcher = watch(sumatraSettingsPath, { ignoreInitial: true })
    watcher.on('change', () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => void syncFromSumatra(), 800)
    })
    watcher.on('error', (e: unknown) => console.error('[sumatra] 监听错误:', e))
  } catch (e) {
    console.error('[sumatra] 启动监听失败:', e)
  }
}

export async function stopSumatraWatch(): Promise<void> {
  if (watcher) {
    try {
      await watcher.close()
    } catch {
      /* ignore */
    }
    watcher = null
  }
  if (debounce) {
    clearTimeout(debounce)
    debounce = null
  }
}
