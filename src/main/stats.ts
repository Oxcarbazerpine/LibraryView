import { getDb } from './db'
import type { StatsSummary, DailyReadingStat } from '../shared/types'

function fmtLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function nextDay(ds: string): string {
  const d = new Date(ds + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return fmtLocal(d)
}

function allDailySums(): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT date(started_at/1000,'unixepoch','localtime') AS day,
              CAST(SUM(duration_seconds) AS INTEGER) AS seconds
       FROM reading_sessions
       WHERE ended_at IS NOT NULL AND duration_seconds > 0
       GROUP BY day`
    )
    .all() as { day: string; seconds: number }[]
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.day, r.seconds)
  return m
}

function computeStreaks(days: Set<string>): { current: number; longest: number } {
  const sorted = [...days].sort()
  let longest = 0
  let run = 0
  let prev: string | null = null
  for (const ds of sorted) {
    run = prev !== null && nextDay(prev) === ds ? run + 1 : 1
    if (run > longest) longest = run
    prev = ds
  }

  let current = 0
  let cursor = fmtLocal(new Date())
  if (!days.has(cursor)) {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    cursor = fmtLocal(d)
    if (!days.has(cursor)) return { current: 0, longest }
  }
  while (days.has(cursor)) {
    current += 1
    const d = new Date(cursor + 'T00:00:00')
    d.setDate(d.getDate() - 1)
    cursor = fmtLocal(d)
  }
  return { current, longest }
}

export function getStats(rangeDays = 30): StatsSummary {
  const db = getDb()
  const sums = allDailySums()
  const daysWithReading = new Set(sums.keys())
  const { current, longest } = computeStreaks(daysWithReading)

  const daily: DailyReadingStat[] = []
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (rangeDays - 1))
  for (let i = 0; i < rangeDays; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = fmtLocal(d)
    daily.push({ day: key, seconds: sums.get(key) ?? 0 })
  }

  const totalSeconds = [...sums.values()].reduce((a, b) => a + b, 0)
  const todaySeconds = sums.get(fmtLocal(new Date())) ?? 0

  const counts = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'reading'  THEN 1 ELSE 0 END) AS reading,
         SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished
       FROM books WHERE missing = 0`
    )
    .get() as { total: number; reading: number | null; finished: number | null }

  return {
    totalSeconds,
    daysRead: daysWithReading.size,
    currentStreak: current,
    longestStreak: longest,
    booksReading: counts.reading ?? 0,
    booksFinished: counts.finished ?? 0,
    booksTotal: counts.total ?? 0,
    todaySeconds,
    daily
  }
}
