import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Clock, CalendarDays, Flame, BookOpenCheck } from 'lucide-react'
import type { DailyReadingStat, TopBook } from '@shared/types'
import { useLibrary } from '@/store'
import { formatDuration } from '@/lib/format'

const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
  { days: 365, label: '近一年' }
]

type Gran = 'day' | 'week' | 'month'

interface Bucket {
  label: string
  seconds: number
}

function fmtLocal(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function aggregate(daily: DailyReadingStat[], gran: Gran): Bucket[] {
  if (gran === 'day') {
    return daily.map((d) => {
      const [, mm, dd] = d.day.split('-')
      return { label: `${Number(mm)}/${Number(dd)}`, seconds: d.seconds }
    })
  }
  const map = new Map<string, number>()
  const order: string[] = []
  for (const d of daily) {
    const date = new Date(d.day + 'T00:00:00')
    let key: string
    let label: string
    if (gran === 'week') {
      const sunday = new Date(date)
      sunday.setDate(date.getDate() - date.getDay())
      key = fmtLocal(sunday)
      label = `${sunday.getMonth() + 1}/${sunday.getDate()}`
    } else {
      key = `${date.getFullYear()}-${date.getMonth() + 1}`
      label = `${date.getMonth() + 1}月`
    }
    if (!map.has(key)) {
      map.set(key, 0)
      order.push(key)
    }
    map.set(key, map.get(key)! + d.seconds)
  }
  const labels = new Map<string, string>()
  for (const d of daily) {
    const date = new Date(d.day + 'T00:00:00')
    if (gran === 'week') {
      const sunday = new Date(date)
      sunday.setDate(date.getDate() - date.getDay())
      labels.set(fmtLocal(sunday), `${sunday.getMonth() + 1}/${sunday.getDate()}`)
    } else {
      labels.set(`${date.getFullYear()}-${date.getMonth() + 1}`, `${date.getMonth() + 1}月`)
    }
  }
  return order.map((k) => ({ label: labels.get(k) ?? '', seconds: map.get(k) ?? 0 }))
}

export function StatsPage() {
  const { stats, refreshStats } = useLibrary()
  const [range, setRange] = useState(30)
  const [gran, setGran] = useState<Gran>('day')

  useEffect(() => {
    void refreshStats(range)
  }, [range, refreshStats])

  // 范围较大时自动用更粗的粒度，避免柱子过密
  useEffect(() => {
    setGran(range >= 365 ? 'month' : range >= 90 ? 'week' : 'day')
  }, [range])

  const buckets = useMemo(() => (stats ? aggregate(stats.daily, gran) : []), [stats, gran])
  const rangeSeconds = useMemo(() => stats?.daily.reduce((a, b) => a + b.seconds, 0) ?? 0, [stats])

  if (!stats) return null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <h1 className="text-xl font-semibold text-slate-100">阅读统计</h1>
        <p className="mt-1 text-sm text-slate-500">你的阅读时长与习惯一览。</p>

        {/* 概览卡片 */}
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard icon={<Clock className="h-5 w-5" />} label="今日阅读" value={formatDuration(stats.todaySeconds)} accent="violet" />
          <StatCard icon={<CalendarDays className="h-5 w-5" />} label="累计时长" value={formatDuration(stats.totalSeconds)} sub={`${stats.daysRead} 天有记录`} accent="sky" />
          <StatCard icon={<Flame className="h-5 w-5" />} label="连续阅读" value={`${stats.currentStreak} 天`} sub={`最长 ${stats.longestStreak} 天`} accent="amber" />
          <StatCard icon={<BookOpenCheck className="h-5 w-5" />} label="在读 / 读完" value={`${stats.booksReading} / ${stats.booksFinished}`} sub={`共 ${stats.booksTotal} 本`} accent="emerald" />
        </div>

        {/* 每日/周/月时长 */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-slate-300">阅读时长</h2>
              <p className="mt-0.5 text-xs text-slate-500">本区间共 {formatDuration(rangeSeconds)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Segmented
                options={[
                  { id: 'day', label: '日' },
                  { id: 'week', label: '周' },
                  { id: 'month', label: '月' }
                ]}
                value={gran}
                onChange={(v) => setGran(v as Gran)}
              />
              <Segmented
                options={RANGES.map((r) => ({ id: String(r.days), label: r.label }))}
                value={String(range)}
                onChange={(v) => setRange(Number(v))}
              />
            </div>
          </div>
          <BarChart buckets={buckets} />
        </div>

        {/* 热力图 */}
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="mb-4 text-sm font-medium text-slate-300">阅读日历（近一年）</h2>
          <Heatmap calendar={stats.calendar} />
        </div>

        {/* 阅读时长排行 */}
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <h2 className="mb-4 text-sm font-medium text-slate-300">阅读时长排行</h2>
          <TopBooks books={stats.topBooks} />
        </div>
      </div>
    </div>
  )
}

const ACCENTS: Record<string, string> = {
  violet: 'text-violet-300 bg-violet-500/10',
  sky: 'text-sky-300 bg-sky-500/10',
  amber: 'text-amber-300 bg-amber-500/10',
  emerald: 'text-emerald-300 bg-emerald-500/10'
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent
}: {
  icon: ReactNode
  label: string
  value: string
  sub?: string
  accent: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className={`inline-flex rounded-lg p-2 ${ACCENTS[accent]}`}>{icon}</div>
      <div className="mt-3 text-2xl font-semibold text-slate-100">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-600">{sub}</div>}
    </div>
  )
}

function Segmented({
  options,
  value,
  onChange
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
            value === o.id ? 'bg-violet-500/25 text-violet-100' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function BarChart({ buckets }: { buckets: Bucket[] }) {
  const max = useMemo(() => Math.max(60, ...buckets.map((d) => d.seconds)), [buckets])
  const step = buckets.length > 30 ? 7 : buckets.length > 14 ? 3 : 1

  return (
    <div className="flex h-52 items-end gap-[3px]">
      {buckets.map((d, i) => {
        const h = Math.max(2, Math.round((d.seconds / max) * 100))
        const showLabel = i % step === 0 || i === buckets.length - 1
        return (
          <div key={i} className="group relative flex h-full flex-1 flex-col items-center justify-end">
            <div className="pointer-events-none absolute bottom-full mb-2 hidden whitespace-nowrap rounded-md border border-white/10 bg-[#1b1b27] px-2 py-1 text-[11px] text-slate-200 shadow-lg group-hover:block">
              {d.label} · {d.seconds > 0 ? formatDuration(d.seconds) : '未阅读'}
            </div>
            <div
              className={`w-full rounded-t-sm transition-all ${
                d.seconds > 0
                  ? 'bg-gradient-to-t from-violet-600/70 to-violet-400 group-hover:from-violet-500 group-hover:to-fuchsia-400'
                  : 'bg-white/5'
              }`}
              style={{ height: `${h}%` }}
            />
            <div className="mt-1.5 h-3 overflow-hidden text-[9px] leading-none text-slate-600">
              {showLabel ? d.label : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// 热力图色阶（按分钟）
function heatClass(seconds: number): string {
  const m = seconds / 60
  if (m <= 0) return 'bg-white/[0.04]'
  if (m < 15) return 'bg-violet-500/25'
  if (m < 45) return 'bg-violet-500/45'
  if (m < 120) return 'bg-violet-500/70'
  return 'bg-violet-400'
}

function Heatmap({ calendar }: { calendar: DailyReadingStat[] }) {
  // 以周为列、星期为行（周日在上）。首日之前用占位补齐。
  const { columns, monthMarks } = useMemo(() => {
    const first = calendar.length ? new Date(calendar[0].day + 'T00:00:00') : new Date()
    const lead = first.getDay() // 0=周日
    const cells: (DailyReadingStat | null)[] = [...Array(lead).fill(null), ...calendar]
    const cols: (DailyReadingStat | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7))
    // 月份标注：某列第一格进入新月份时标记
    const marks: { col: number; label: string }[] = []
    let lastMonth = -1
    cols.forEach((col, ci) => {
      const firstReal = col.find((c) => c)
      if (!firstReal) return
      const mo = new Date(firstReal.day + 'T00:00:00').getMonth()
      if (mo !== lastMonth) {
        marks.push({ col: ci, label: `${mo + 1}月` })
        lastMonth = mo
      }
    })
    return { columns: cols, monthMarks: marks }
  }, [calendar])

  return (
    <div className="overflow-x-auto pb-1">
      <div className="inline-block min-w-full">
        {/* 月份标签 */}
        <div className="mb-1 flex gap-[3px] pl-6 text-[9px] text-slate-600">
          {columns.map((_, ci) => {
            const mark = monthMarks.find((m) => m.col === ci)
            return (
              <div key={ci} className="w-[11px] shrink-0">
                {mark ? mark.label : ''}
              </div>
            )
          })}
        </div>
        <div className="flex gap-[3px]">
          {/* 星期标签 */}
          <div className="flex w-6 shrink-0 flex-col gap-[3px] pr-1 text-[9px] leading-[11px] text-slate-600">
            {['日', '', '二', '', '四', '', '六'].map((d, i) => (
              <div key={i} className="h-[11px]">
                {d}
              </div>
            ))}
          </div>
          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              {Array.from({ length: 7 }).map((_, ri) => {
                const cell = col[ri]
                if (!cell) return <div key={ri} className="h-[11px] w-[11px]" />
                return (
                  <div
                    key={ri}
                    title={`${cell.day} · ${cell.seconds > 0 ? formatDuration(cell.seconds) : '未阅读'}`}
                    className={`h-[11px] w-[11px] rounded-[2px] ${heatClass(cell.seconds)}`}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TopBooks({ books }: { books: TopBook[] }) {
  if (books.length === 0) return <p className="text-xs text-slate-600">还没有阅读时长记录。</p>
  const max = Math.max(...books.map((b) => b.seconds), 1)
  return (
    <ul className="space-y-2.5">
      {books.map((b) => (
        <li key={b.id} className="flex items-center gap-3">
          <span className="w-1/2 truncate text-sm text-slate-300" title={b.title}>
            {b.title}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400"
              style={{ width: `${Math.round((b.seconds / max) * 100)}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-xs text-slate-400">
            {formatDuration(b.seconds)}
          </span>
        </li>
      ))}
    </ul>
  )
}
