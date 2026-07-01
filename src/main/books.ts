import { getDb } from './db'
import type { Book, BookFormat, BookStatus } from '../shared/types'

interface BookRow {
  id: number
  path: string
  title: string
  author: string | null
  format: string
  page_count: number | null
  current_page: number
  progress: number
  cover_path: string | null
  file_size: number
  file_mtime: number
  status: string
  total_reading_seconds: number
  last_read_at: number | null
  added_at: number
  updated_at: number
  missing: number
}

function mapBook(r: BookRow): Book {
  return {
    id: r.id,
    path: r.path,
    title: r.title,
    author: r.author,
    format: r.format as BookFormat,
    pageCount: r.page_count,
    currentPage: r.current_page,
    progress: r.progress,
    coverPath: r.cover_path,
    fileSize: r.file_size,
    fileMtime: r.file_mtime,
    status: r.status as BookStatus,
    totalReadingSeconds: r.total_reading_seconds,
    lastReadAt: r.last_read_at,
    addedAt: r.added_at,
    updatedAt: r.updated_at,
    missing: r.missing !== 0
  }
}

const FINISHED_THRESHOLD = 0.995

function computeProgress(currentPage: number, pageCount: number | null): number {
  if (!pageCount || pageCount <= 0) return 0
  const p = currentPage / pageCount
  return Math.min(1, Math.max(0, p))
}

export function listBooks(): Book[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM books
       ORDER BY (last_read_at IS NULL), last_read_at DESC, title COLLATE NOCASE ASC`
    )
    .all() as BookRow[]
  return rows.map(mapBook)
}

export function getBook(id: number): Book | null {
  const r = getDb().prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow | undefined
  return r ? mapBook(r) : null
}

export function getBookByPath(path: string): Book | null {
  const r = getDb().prepare('SELECT * FROM books WHERE path = ?').get(path) as BookRow | undefined
  return r ? mapBook(r) : null
}

export interface ScannedBook {
  path: string
  title: string
  author: string | null
  format: BookFormat
  pageCount: number | null
  fileSize: number
  fileMtime: number
}

/** 扫描时写入/更新一本书。返回是新增还是更新（无变化也算 updated 但不写库）。 */
export function upsertScannedBook(b: ScannedBook): 'added' | 'updated' | 'unchanged' {
  const db = getDb()
  const now = Date.now()
  const existing = db.prepare('SELECT * FROM books WHERE path = ?').get(b.path) as BookRow | undefined

  if (!existing) {
    db.prepare(
      `INSERT INTO books (path, title, author, format, page_count, file_size, file_mtime, added_at, updated_at, missing)
       VALUES (@path, @title, @author, @format, @pageCount, @fileSize, @fileMtime, @now, @now, 0)`
    ).run({ ...b, now })
    return 'added'
  }

  // 文件未变（大小+修改时间一致）且未标记缺失 → 跳过
  const unchanged =
    existing.file_size === b.fileSize &&
    existing.file_mtime === b.fileMtime &&
    existing.missing === 0 &&
    existing.page_count === b.pageCount
  if (unchanged) return 'unchanged'

  // 更新文件元信息，但保留阅读进度等用户数据；进度按新页数重算
  const newProgress = computeProgress(existing.current_page, b.pageCount)
  db.prepare(
    `UPDATE books SET
       title = @title, author = @author, format = @format, page_count = @pageCount,
       file_size = @fileSize, file_mtime = @fileMtime, progress = @progress,
       missing = 0, updated_at = @now
     WHERE id = @id`
  ).run({
    title: b.title,
    author: b.author,
    format: b.format,
    pageCount: b.pageCount,
    fileSize: b.fileSize,
    fileMtime: b.fileMtime,
    progress: newProgress,
    now,
    id: existing.id
  })
  return 'updated'
}

export function setCover(id: number, coverPath: string | null): void {
  getDb()
    .prepare('UPDATE books SET cover_path = ?, updated_at = ? WHERE id = ?')
    .run(coverPath, Date.now(), id)
}

export function listBooksMissingCover(): Book[] {
  const rows = getDb()
    .prepare('SELECT * FROM books WHERE cover_path IS NULL AND missing = 0')
    .all() as BookRow[]
  return rows.map(mapBook)
}

/** 标记本次扫描未出现的书为缺失（文件被删/移走）。返回标记数量。 */
export function markMissingExcept(seenPaths: string[]): number {
  const db = getDb()
  const now = Date.now()
  if (seenPaths.length === 0) {
    return db.prepare('UPDATE books SET missing = 1, updated_at = ? WHERE missing = 0').run(now)
      .changes
  }
  // 用临时表做 NOT IN，避免超长 SQL
  const tx = db.transaction((paths: string[]) => {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS _seen (path TEXT PRIMARY KEY)')
    db.exec('DELETE FROM _seen')
    const ins = db.prepare('INSERT OR IGNORE INTO _seen (path) VALUES (?)')
    for (const p of paths) ins.run(p)
    const res = db
      .prepare(
        'UPDATE books SET missing = 1, updated_at = ? WHERE missing = 0 AND path NOT IN (SELECT path FROM _seen)'
      )
      .run(now)
    return res.changes
  })
  return tx(seenPaths)
}

/** 进度同步（来自 SumatraPDF）：按路径更新当前页/进度/上次阅读时间。 */
export function applyProgressByPath(path: string, currentPage: number, touchLastRead: boolean): boolean {
  const db = getDb()
  const r = db.prepare('SELECT * FROM books WHERE path = ? COLLATE NOCASE').get(path) as
    | BookRow
    | undefined
  if (!r) return false
  if (currentPage === r.current_page) return false
  const progress = computeProgress(currentPage, r.page_count)
  const now = Date.now()
  const status =
    progress >= FINISHED_THRESHOLD ? 'finished' : currentPage > 0 ? 'reading' : r.status
  db.prepare(
    `UPDATE books SET current_page = ?, progress = ?, status = ?,
       last_read_at = COALESCE(?, last_read_at), updated_at = ?
     WHERE id = ?`
  ).run(currentPage, progress, status, touchLastRead ? now : null, now, r.id)
  return true
}

/** 手动设置进度（用户在书架上拖动/输入页码）。 */
export function setManualProgress(id: number, currentPage: number): Book | null {
  const db = getDb()
  const r = db.prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow | undefined
  if (!r) return null
  const cp = Math.max(0, Math.round(currentPage))
  const progress = computeProgress(cp, r.page_count)
  const status = progress >= FINISHED_THRESHOLD ? 'finished' : cp > 0 ? 'reading' : 'unread'
  db.prepare('UPDATE books SET current_page = ?, progress = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(cp, progress, status, Date.now(), id)
  return getBook(id)
}

export function setStatus(id: number, status: BookStatus): Book | null {
  getDb().prepare('UPDATE books SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id)
  return getBook(id)
}

export interface ScanIndexEntry {
  fileSize: number
  fileMtime: number
  missing: number
}

/** 一次性取出全部书籍的扫描比对字段（path → 大小/修改时间/缺失），避免扫描时逐文件查库。 */
export function getScanIndex(): Map<string, ScanIndexEntry> {
  const rows = getDb()
    .prepare('SELECT path, file_size, file_mtime, missing FROM books')
    .all() as { path: string; file_size: number; file_mtime: number; missing: number }[]
  const m = new Map<string, ScanIndexEntry>()
  for (const r of rows) {
    m.set(r.path, { fileSize: r.file_size, fileMtime: r.file_mtime, missing: r.missing })
  }
  return m
}

/** 后台补算页数：待处理的 PDF（页数仍为空、文件存在）。 */
export function listPdfsWithoutPageCount(): { id: number; path: string }[] {
  return getDb()
    .prepare("SELECT id, path FROM books WHERE format = 'pdf' AND page_count IS NULL AND missing = 0")
    .all() as { id: number; path: string }[]
}

/** 清空所有书的封面指针（切换封面目录或清缓存时用）。 */
export function clearAllCovers(): void {
  getDb()
    .prepare('UPDATE books SET cover_path = NULL, updated_at = ? WHERE cover_path IS NOT NULL')
    .run(Date.now())
}

/** 写入算得的页数并按当前页重算进度（0 表示尝试过但失败/未知）。 */
export function setPageCount(id: number, pageCount: number): void {
  const db = getDb()
  const r = db.prepare('SELECT current_page FROM books WHERE id = ?').get(id) as
    | { current_page: number }
    | undefined
  if (!r) return
  const progress = computeProgress(r.current_page, pageCount > 0 ? pageCount : null)
  db.prepare('UPDATE books SET page_count = ?, progress = ?, updated_at = ? WHERE id = ?').run(
    pageCount,
    progress,
    Date.now(),
    id
  )
}
