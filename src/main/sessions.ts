import { shell } from 'electron'
import { spawn } from 'node:child_process'
import { getDb } from './db'
import { getSettings } from './settings'
import { getBook } from './books'
import type { ActiveSession, ReadingSession } from '../shared/types'

interface SessionRow {
  id: number
  book_id: number
  started_at: number
  ended_at: number | null
  duration_seconds: number
  start_page: number | null
  end_page: number | null
}

export function getActiveSession(): ActiveSession | null {
  const r = getDb()
    .prepare(
      'SELECT id, book_id, started_at FROM reading_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
    )
    .get() as { id: number; book_id: number; started_at: number } | undefined
  return r ? { sessionId: r.id, bookId: r.book_id, startedAt: r.started_at } : null
}

/** 应用重启时收尾悬挂会话：无法得知真实结束时间，按 0 时长收尾，避免污染统计。 */
export function closeDanglingSessions(): number {
  return getDb()
    .prepare(
      'UPDATE reading_sessions SET ended_at = started_at, duration_seconds = 0 WHERE ended_at IS NULL'
    )
    .run().changes
}

function launchReader(filePath: string): void {
  const { readerPath } = getSettings()
  try {
    if (readerPath) {
      const child = spawn(readerPath, [filePath], { detached: true, stdio: 'ignore' })
      child.on('error', (e) => console.error('[session] 启动阅读器失败:', e))
      child.unref()
    } else {
      void shell.openPath(filePath)
    }
  } catch (e) {
    console.error('[session] 启动阅读器异常:', e)
  }
}

export function startReading(bookId: number, launch = true): ActiveSession {
  const book = getBook(bookId)
  if (!book) throw new Error('书籍不存在')

  // 同一时刻只允许一个进行中的会话：先收尾已有的
  const active = getActiveSession()
  if (active) stopReading(active.bookId)

  const now = Date.now()
  const info = getDb()
    .prepare('INSERT INTO reading_sessions (book_id, started_at, start_page) VALUES (?, ?, ?)')
    .run(bookId, now, book.currentPage || null)

  getDb()
    .prepare(
      "UPDATE books SET status = CASE WHEN status = 'finished' THEN status ELSE 'reading' END, updated_at = ? WHERE id = ?"
    )
    .run(now, bookId)

  if (launch) launchReader(book.path)

  return { sessionId: Number(info.lastInsertRowid), bookId, startedAt: now }
}

export function stopReading(bookId: number): ReadingSession | null {
  const db = getDb()
  const r = db
    .prepare(
      'SELECT * FROM reading_sessions WHERE book_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
    )
    .get(bookId) as SessionRow | undefined
  if (!r) return null

  const now = Date.now()
  const duration = Math.max(0, Math.round((now - r.started_at) / 1000))
  const book = getBook(bookId)
  const endPage = book?.currentPage ?? null

  db.prepare(
    'UPDATE reading_sessions SET ended_at = ?, duration_seconds = ?, end_page = ? WHERE id = ?'
  ).run(now, duration, endPage, r.id)

  db.prepare(
    'UPDATE books SET total_reading_seconds = total_reading_seconds + ?, last_read_at = ?, updated_at = ? WHERE id = ?'
  ).run(duration, now, now, bookId)

  return {
    id: r.id,
    bookId,
    startedAt: r.started_at,
    endedAt: now,
    durationSeconds: duration,
    startPage: r.start_page,
    endPage
  }
}
