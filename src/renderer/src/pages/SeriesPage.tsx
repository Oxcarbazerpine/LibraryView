import { useMemo, useState } from 'react'
import { Layers, Plus, Search, X, BookOpen } from 'lucide-react'
import type { SeriesCandidate } from '@shared/types'
import { useLibrary } from '@/store'

export function SeriesPage() {
  const { books, series, refreshSeries, refreshBooks } = useLibrary()
  const [candidates, setCandidates] = useState<SeriesCandidate[] | null>(null)
  const [detecting, setDetecting] = useState(false)

  // 每个已确认系列的册数（按路径前缀统计，与书架归组同口径）
  const counts = useMemo(() => {
    const m = new Map<number, number>()
    const prefixes = series.map((s) => ({
      id: s.id,
      prefix: s.folder.toLowerCase().replace(/[\\/]+$/, '') + '\\'
    }))
    for (const b of books) {
      if (b.missing) continue
      const low = b.path.toLowerCase()
      for (const p of prefixes) {
        if (low.startsWith(p.prefix)) {
          m.set(p.id, (m.get(p.id) ?? 0) + 1)
          break
        }
      }
    }
    return m
  }, [books, series])

  const detect = async (): Promise<void> => {
    setDetecting(true)
    try {
      setCandidates(await window.api.seriesCandidates())
    } finally {
      setDetecting(false)
    }
  }
  const confirm = async (c: SeriesCandidate): Promise<void> => {
    await window.api.addSeries(c.folder, c.name)
    setCandidates((prev) => prev?.filter((x) => x.folder !== c.folder) ?? null)
    await refreshSeries()
    await refreshBooks()
  }
  const unconfirm = async (id: number): Promise<void> => {
    await window.api.removeSeries(id)
    await refreshSeries()
    await refreshBooks()
  }
  const addManually = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (!dir) return
    const name = dir.split(/[\\/]/).filter(Boolean).pop() ?? dir
    await window.api.addSeries(dir, name)
    await refreshSeries()
    await refreshBooks()
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-100">
          <Layers className="h-5 w-5 text-violet-400" />
          系列
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          把多卷套装归成书架上的一张卡。确认后，该文件夹（含子层级）下的书都算这一套；程序只推荐、不自动归组，归错随时取消。
        </p>

        {/* 已确认 */}
        <section className="mt-7 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
            <BookOpen className="h-4 w-4 text-violet-400" />
            已归组（{series.length}）
          </h2>
          {series.length === 0 ? (
            <p className="text-sm text-slate-500">还没有归组的套装。用下面的「检测套装候选」开始。</p>
          ) : (
            <ul className="space-y-2">
              {series.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5"
                >
                  <Layers className="h-4 w-4 shrink-0 text-violet-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">
                      {s.name}
                      <span className="ml-2 text-xs text-slate-500">{counts.get(s.id) ?? 0} 册</span>
                    </div>
                    <div className="truncate text-[11px] text-slate-500" title={s.folder}>
                      {s.folder}
                    </div>
                  </div>
                  <button
                    onClick={() => void unconfirm(s.id)}
                    className="shrink-0 rounded p-1.5 text-slate-500 hover:bg-white/10 hover:text-rose-400"
                    title="取消归组（不影响文件与阅读记录）"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 候选 */}
        <section className="mt-6 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-slate-300">
              <Search className="h-4 w-4 text-violet-400" />
              套装候选
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void detect()}
                disabled={detecting}
                className="flex items-center gap-1.5 rounded-lg bg-violet-500/90 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
                {detecting ? '检测中…' : candidates ? '重新检测' : '检测套装候选'}
              </button>
              <button
                onClick={() => void addManually()}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
              >
                <Plus className="h-4 w-4" />
                手动选择文件夹
              </button>
            </div>
          </div>

          {candidates === null ? (
            <p className="text-sm text-slate-500">
              点「检测套装候选」，程序会按 文件名同构 / 卷号前缀 / 套装字样 等信号找出像套装的文件夹，由你决定归不归。
            </p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-slate-500">没有发现新的套装候选。</p>
          ) : (
            <ul className="space-y-2">
              {candidates.map((c) => (
                <li
                  key={c.folder}
                  className="flex items-center gap-3 rounded-lg border border-dashed border-white/15 bg-white/[0.02] px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-slate-200">
                      {c.name}
                      <span className="ml-2 text-xs text-slate-500">{c.bookCount} 册</span>
                    </div>
                    <div className="truncate text-[11px] text-slate-600" title={c.folder}>
                      {c.folder}
                    </div>
                  </div>
                  <button
                    onClick={() => void confirm(c)}
                    className="shrink-0 rounded-lg bg-violet-500/20 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/35"
                  >
                    归为一套
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
