import { shell } from 'electron'
import { spawn } from 'node:child_process'
import { getDb } from './db'
import { getSettings } from './settings'
import { getBook } from './books'
import { broadcast } from './events'
import type { ActiveSession, Book, ReadingSession } from '../shared/types'

interface SessionRow {
  id: number
  book_id: number
  started_at: number
  ended_at: number | null
  duration_seconds: number
  start_page: number | null
  end_page: number | null
}

function mapSession(r: SessionRow): ReadingSession {
  return {
    id: r.id,
    bookId: r.book_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSeconds: r.duration_seconds,
    startPage: r.start_page,
    endPage: r.end_page
  }
}

/**
 * 进行中会话的内存跟踪。用于「基于翻页活动的空闲自动结束 / 再次翻页自动恢复」：
 * - hadActivity 仅在收到 SumatraPDF 翻页信号后为真，据此判断是否可安全地自动结束
 *   （非 Sumatra 阅读器/无同步的书永远收不到信号 → 不会被自动结束，仍靠手动）。
 */
interface Tracker {
  sessionId: number
  bookId: number
  startedAt: number
  lastActivityAt: number
  hadActivity: boolean
}
let tracker: Tracker | null = null

export function getActiveSession(): ActiveSession | null {
  const r = getDb()
    .prepare(
      'SELECT id, book_id, started_at FROM reading_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
    )
    .get() as { id: number; book_id: number; started_at: number } | undefined
  if (!r) return null
  const tracked = tracker?.sessionId === r.id ? tracker.hadActivity : false
  return { sessionId: r.id, bookId: r.book_id, startedAt: r.started_at, tracked }
}

/** 应用重启时收尾悬挂会话：无法得知真实结束时间，按 0 时长收尾，避免污染统计。 */
export function closeDanglingSessions(): number {
  tracker = null
  return getDb()
    .prepare(
      'UPDATE reading_sessions SET ended_at = started_at, duration_seconds = 0 WHERE ended_at IS NULL'
    )
    .run().changes
}

/** 某书的阅读历史（最近在前）。 */
export function listSessions(bookId: number, limit = 50): ReadingSession[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM reading_sessions WHERE book_id = ? AND ended_at IS NOT NULL ORDER BY started_at DESC LIMIT ?'
    )
    .all(bookId, limit) as SessionRow[]
  return rows.map(mapSession)
}

function launchReader(book: Book): void {
  const s = getSettings()
  const reader = s.readerByFormat?.[book.format] || s.readerPath
  try {
    if (reader) {
      const child = spawn(reader, [book.path], { detached: true, stdio: 'ignore' })
      child.on('error', (e) => {
        console.error('[session] 启动阅读器失败:', e)
        broadcast('notify', {
          level: 'error',
          message: `无法打开《${book.title}》：所选阅读器启动失败。可在设置里为 ${book.format.toUpperCase()} 指定其它阅读器。`
        })
      })
      child.unref()
    } else {
      void shell.openPath(book.path).then((err) => {
        if (err) broadcast('notify', { level: 'error', message: `无法打开《${book.title}》：${err}` })
      })
    }
  } catch (e) {
    console.error('[session] 启动阅读器异常:', e)
    broadcast('notify', { level: 'error', message: `无法打开《${book.title}》。` })
  }
}

interface StartOpts {
  /** 是否用外部阅读器打开文件（手动点击=true；由翻页活动自动开始=false） */
  launch?: boolean
  /** 是否由翻页活动触发（此时视为已有活动信号，可参与空闲自动结束） */
  auto?: boolean
}

export function startReading(bookId: number, opts: StartOpts = {}): ActiveSession {
  const { launch = true, auto = false } = opts
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

  const sessionId = Number(info.lastInsertRowid)
  tracker = { sessionId, bookId, startedAt: now, lastActivityAt: now, hadActivity: auto }

  if (launch) launchReader(book)

  const session: ActiveSession = { sessionId, bookId, startedAt: now, tracked: auto }
  broadcast('session:changed', session)
  broadcast('books:changed')
  return session
}

/** 结束会话。endAt 用于空闲自动结束时把时长只计到最后一次翻页。 */
export function stopReading(bookId: number, endAt?: number): ReadingSession | null {
  const db = getDb()
  const r = db
    .prepare(
      'SELECT * FROM reading_sessions WHERE book_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
    )
    .get(bookId) as SessionRow | undefined
  if (!r) return null

  const end = endAt ?? Date.now()
  const duration = Math.max(0, Math.round((end - r.started_at) / 1000))
  const book = getBook(bookId)
  const endPage = book?.currentPage ?? null

  db.prepare(
    'UPDATE reading_sessions SET ended_at = ?, duration_seconds = ?, end_page = ? WHERE id = ?'
  ).run(end, duration, endPage, r.id)

  db.prepare(
    'UPDATE books SET total_reading_seconds = total_reading_seconds + ?, last_read_at = ?, updated_at = ? WHERE id = ?'
  ).run(duration, end, Date.now(), bookId)

  if (tracker?.sessionId === r.id) tracker = null

  broadcast('session:changed', null)
  broadcast('books:changed')
  return mapSession({ ...r, ended_at: end, duration_seconds: duration, end_page: endPage })
}

/**
 * 收到某书的翻页活动（来自 SumatraPDF 实时同步）：
 * - 正是当前在读的书 → 刷新活动时间（保活）
 * - 在读的是另一本 → 用户在阅读器里换了书：结束旧会话、自动开始新会话
 * - 当前没有进行中的会话 → 自动开始（恢复阅读状态），不重复拉起阅读器
 */
export function noteReadingActivity(bookId: number): void {
  const now = Date.now()
  if (tracker) {
    if (tracker.bookId === bookId) {
      tracker.lastActivityAt = now
      if (!tracker.hadActivity) {
        tracker.hadActivity = true
        // 让 UI 知道此会话现在可被空闲自动结束（tracked 变为 true）
        broadcast('session:changed', {
          sessionId: tracker.sessionId,
          bookId,
          startedAt: tracker.startedAt,
          tracked: true
        })
      }
      return
    }
    // 换书：结束旧的（计到它最后一次活动），再开新的
    stopReading(tracker.bookId, tracker.lastActivityAt)
  }
  startReading(bookId, { launch: false, auto: true })
}

/** 定时检查：有活动信号的会话若空闲超过阈值，则自动结束（时长只计到最后一次翻页）。 */
export function checkIdleSession(): void {
  if (!tracker || !tracker.hadActivity) return
  const timeoutMs = getSettings().idleTimeoutMinutes * 60 * 1000
  if (timeoutMs <= 0) return
  if (Date.now() - tracker.lastActivityAt > timeoutMs) {
    const book = getBook(tracker.bookId)
    stopReading(tracker.bookId, tracker.lastActivityAt)
    if (book) {
      broadcast('notify', {
        level: 'info',
        message: `《${book.title}》空闲超时，已自动结束计时（再次翻页会自动继续）。`
      })
    }
  }
}
