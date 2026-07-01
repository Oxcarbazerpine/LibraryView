import { readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { getSettings } from './settings'
import {
  getScanIndex,
  upsertScannedBook,
  markMissingExcept,
  listPdfsWithoutPageCount,
  setPageCount,
  listBooksNeedingMeta,
  applyEbookMeta
} from './books'
import { workerPageCount, workerEbookMeta } from './pdf-pool'
import { broadcast } from './events'
import type { BookFormat, ScanResult, ScanProgress } from '../shared/types'

const EXT_FORMAT: Record<string, BookFormat> = {
  '.pdf': 'pdf',
  '.epub': 'epub',
  '.mobi': 'mobi',
  '.azw3': 'azw3',
  '.djvu': 'djvu',
  '.cbz': 'cbz'
}

const SKIP_DIRS = new Set(['$RECYCLE.BIN', 'System Volume Information', 'node_modules'])

function titleFromFilename(file: string): string {
  const t = basename(file, extname(file)).replace(/_+/g, ' ').trim()
  return t || basename(file)
}

// ---------- 目录遍历 ----------

async function walk(dir: string, out: string[], errors: ScanResult['errors']): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (e) {
    errors.push({ path: dir, message: (e as Error).message })
    return
  }
  for (const ent of entries) {
    const full = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name.startsWith('.') || SKIP_DIRS.has(ent.name)) continue
      await walk(full, out, errors)
    } else if (ent.isFile() && extname(ent.name).toLowerCase() in EXT_FORMAT) {
      out.push(full)
    }
  }
}

// ---------- 第一段：快速遍历 + 入库（不算页数，秒级，书架立即可浏览） ----------

export async function indexLibrary(
  paths: string[],
  onProgress?: (p: ScanProgress) => void
): Promise<ScanResult> {
  const errors: ScanResult['errors'] = []
  const files: string[] = []

  onProgress?.({ phase: 'walking', processed: 0, total: 0 })
  for (const root of paths) {
    if (root && root.trim()) await walk(root, files, errors)
  }

  let added = 0
  let updated = 0
  const seen: string[] = []
  const total = files.length
  let processed = 0

  // 一次性读入现有索引，扫描时只做内存比对，避免逐文件同步查库（6279 次 → 1 次）
  const index = getScanIndex()

  for (const file of files) {
    try {
      const st = await stat(file)
      const mtime = Math.round(st.mtimeMs)
      seen.push(file)

      const existing = index.get(file)
      const unchanged =
        !!existing && existing.missing === 0 && existing.fileSize === st.size && existing.fileMtime === mtime
      if (!unchanged) {
        const format = EXT_FORMAT[extname(file).toLowerCase()] ?? 'other'
        const res = upsertScannedBook({
          path: file,
          title: titleFromFilename(file),
          author: null,
          format,
          pageCount: null, // 页数交给后台补算
          fileSize: st.size,
          fileMtime: mtime
        })
        if (res === 'added') added++
        else if (res === 'updated') updated++
      }
    } catch (e) {
      errors.push({ path: file, message: (e as Error).message })
    }
    processed++
    // 每处理一批就让出事件循环，避免长时间占用主线程导致 UI 卡顿
    if (processed % 200 === 0 || processed === total) {
      onProgress?.({ phase: 'indexing', processed, total, currentPath: file })
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  const removed = markMissingExcept(seen)
  return { added, updated, removed, errors, scannedAt: Date.now() }
}

// ---------- 第二段：后台限流补算 PDF 页数 ----------

let backfilling = false

export async function backfillPageCounts(
  onProgress?: (p: ScanProgress) => void,
  limit?: number
): Promise<void> {
  if (backfilling) return
  backfilling = true
  try {
    let pending = listPdfsWithoutPageCount()
    if (limit && limit > 0) pending = pending.slice(0, limit)
    const total = pending.length
    if (total === 0) {
      onProgress?.({ phase: 'done', processed: 0, total: 0 })
      return
    }

    let processed = 0
    // 页数计算在独立 utilityProcess 中进行（并发由 pdf-pool 限制），主进程只更新数据库与进度
    await Promise.all(
      pending.map(async (item) => {
        const count = await workerPageCount(item.path)
        setPageCount(item.id, count ?? 0) // 0 = 已尝试但失败/未知，避免每次重扫
        processed++
        if (onProgress && (processed % 20 === 0 || processed === total)) {
          onProgress({ phase: 'pagecount', processed, total, currentPath: item.path })
        }
        if (processed % 1000 === 0) broadcast('books:changed')
      })
    )
    onProgress?.({ phase: 'done', processed, total })
    broadcast('books:changed')
  } finally {
    backfilling = false
  }
}

// ---------- 第二段之二：后台抽取 epub/mobi/azw3/cbz 内嵌元数据（书名/作者） ----------

let metaFilling = false

export async function backfillMetadata(
  onProgress?: (p: ScanProgress) => void,
  limit?: number
): Promise<void> {
  if (metaFilling) return
  metaFilling = true
  try {
    let pending = listBooksNeedingMeta()
    if (limit && limit > 0) pending = pending.slice(0, limit)
    const total = pending.length
    if (total === 0) return

    let processed = 0
    await Promise.all(
      pending.map(async (item) => {
        const meta = await workerEbookMeta(item.path, item.format)
        applyEbookMeta(item.id, meta.title, meta.author)
        processed++
        if (onProgress && (processed % 30 === 0 || processed === total)) {
          onProgress({ phase: 'metadata', processed, total, currentPath: item.path })
        }
        if (processed % 400 === 0) broadcast('books:changed')
      })
    )
    broadcast('books:changed')
  } finally {
    metaFilling = false
  }
}

// ---------- 编排：先入库，再后台补页数 ----------

let scanning = false

export async function runScan(): Promise<ScanResult> {
  if (scanning) {
    return { added: 0, updated: 0, removed: 0, errors: [], scannedAt: Date.now() }
  }
  scanning = true
  try {
    const t0 = Date.now()
    const result = await indexLibrary(getSettings().libraryPaths, (p) => broadcast('scan:progress', p))
    if (process.env.LV_DIAG)
      console.log(`[diag] indexLibrary ${Date.now() - t0}ms +${result.added}/~${result.updated}/-${result.removed}`)
    broadcast('books:changed')
    if (process.env.LV_DIAG) console.log('[diag] backfill start')
    // 后台补充：先抽取电子书内嵌元数据（改善书名/作者/封面），再补算 PDF 页数。
    // 均不阻塞本次返回。
    void backfillMetadata((p) => broadcast('scan:progress', p))
      .then(() => backfillPageCounts((p) => broadcast('scan:progress', p)))
      .then(() => {
        if (process.env.LV_DIAG) console.log(`[diag] backfill done ${Date.now() - t0}ms`)
      })
    return result
  } finally {
    scanning = false
  }
}
