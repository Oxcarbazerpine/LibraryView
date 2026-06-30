import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Clock, CalendarDays, Flame, BookOpenCheck } from 'lucide-react'
import { useLibrary } from '@/store'
import { formatDuration, formatDurationShort } from '@/lib/format'

const RANGES = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' }
]

export function StatsPage() {
  const { stats, refreshStats } = useLibrary()
  const [range, setRange] = useState(30)

  useEffect(() => {
    void refreshStats(range)
  }, [range, refreshStats])

  if (!stats) return null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-8">
        <h1 className="text-xl font-semibold text-slate-100">阅读统计</h1>
        <p className="mt-1 text-sm text-slate-500">你的阅读时长与习惯一览。</p>

        {/* 概览卡片 */}
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard icon={<Clock className="h-5 w-5" />} label="今日阅读" value={formatDuration(stats.todaySeconds)} accent="violet" />
          <StatCard icon={<CalendarDays className="h-5 w-5" />} label="累计时长" value={formatDuration(stats.totalSeconds)} accent="sky" />
          <StatCard icon={<Flame className="h-5 w-5" />} label="连续阅读" value={`${stats.currentStreak} 天`} sub={`最长 ${stats.longestStreak} 天`} accent="amber" />
          <StatCard icon={<BookOpenCheck className="h-5 w-5" />} label="在读 / 读完" value={`${stats.booksReading} / ${stats.booksFinished}`} sub={`共 ${stats.booksTotal} 本`} accent="emerald" />
        </div>

        {/* 每日时长柱状图 */}
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-300">每日阅读时长</h2>
            <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  onClick={() => setRange(r.days)}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                    range === r.days ? 'bg-violet-500/25 text-violet-100' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <BarChart daily={stats.daily} />
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

function BarChart({ daily }: { daily: { day: string; seconds: number }[] }) {
  const max = useMemo(() => Math.max(60, ...daily.map((d) => d.seconds)), [daily])
  const totalLabels = daily.length
  const step = totalLabels > 30 ? 7 : totalLabels > 14 ? 3 : 1

  return (
    <div className="flex h-52 items-end gap-[3px]">
      {daily.map((d, i) => {
        const h = Math.max(2, Math.round((d.seconds / max) * 100))
        const [, mm, dd] = d.day.split('-')
        const showLabel = i % step === 0 || i === daily.length - 1
        return (
          <div key={d.day} className="group relative flex h-full flex-1 flex-col items-center justify-end">
            {/* tooltip */}
            <div className="pointer-events-none absolute bottom-full mb-2 hidden whitespace-nowrap rounded-md border border-white/10 bg-[#1b1b27] px-2 py-1 text-[11px] text-slate-200 shadow-lg group-hover:block">
              {d.day} · {d.seconds > 0 ? formatDuration(d.seconds) : '未阅读'}
            </div>
            <div
              className={`w-full rounded-t-sm transition-all ${
                d.seconds > 0
                  ? 'bg-gradient-to-t from-violet-600/70 to-violet-400 group-hover:from-violet-500 group-hover:to-fuchsia-400'
                  : 'bg-white/5'
              }`}
              style={{ height: `${h}%` }}
            />
            <div className="mt-1.5 h-3 text-[9px] leading-none text-slate-600">
              {showLabel ? `${Number(mm)}/${Number(dd)}` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}
