import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, X } from 'lucide-react'
import type { Book, Series } from '@shared/types'
import { BookCard } from './BookCard'
import { gradientFromString, progressPercent } from '@/lib/format'

/** 书架上的一项：单本书，或一套系列 */
export type ShelfItem = { kind: 'book'; book: Book } | { kind: 'series'; group: SeriesGroup }

export interface SeriesGroup {
  series: Series
  volumes: Book[]
}

const volCollator = new Intl.Collator('zh', { numeric: true })

/**
 * 把书按已确认的系列归组。最长前缀优先（嵌套系列时书归里层）。
 * 返回的书架项中，系列占一格；系列内各卷按自然序（第2卷在第10卷前）。
 */
export function groupBySeries(books: Book[], series: Series[]): ShelfItem[] {
  if (series.length === 0) return books.map((b) => ({ kind: 'book', book: b }))
  const sorted = [...series].sort((a, b) => b.folder.length - a.folder.length)
  const prefixes = sorted.map((s) => ({ s, prefix: s.folder.toLowerCase().replace(/[\\/]+$/, '') + '\\' }))

  const groups = new Map<number, SeriesGroup>()
  const singles: Book[] = []
  for (const b of books) {
    const low = b.path.toLowerCase()
    const hit = prefixes.find((p) => low.startsWith(p.prefix))
    if (hit) {
      const g = groups.get(hit.s.id)
      if (g) g.volumes.push(b)
      else groups.set(hit.s.id, { series: hit.s, volumes: [b] })
    } else {
      singles.push(b)
    }
  }
  for (const g of groups.values()) g.volumes.sort((a, b) => volCollator.compare(a.title, b.title))

  // 系列的位置按「其最近阅读的一卷」参与整体排序：简单起见插在最前（书架本身还会再排）
  const items: ShelfItem[] = [...groups.values()].map((g) => ({ kind: 'series', group: g }))
  for (const b of singles) items.push({ kind: 'book', book: b })
  return items
}

/** 系列排序辅助键 */
export function seriesSortKeys(g: SeriesGroup): {
  lastReadAt: number
  addedAt: number
  progress: number
  title: string
} {
  return {
    lastReadAt: Math.max(0, ...g.volumes.map((v) => v.lastReadAt ?? 0)),
    addedAt: Math.max(0, ...g.volumes.map((v) => v.addedAt)),
    progress: g.volumes.reduce((a, v) => a + v.progress, 0) / Math.max(1, g.volumes.length),
    title: g.series.name
  }
}

export function SeriesCard({ group, onOpen }: { group: SeriesGroup; onOpen: () => void }) {
  const { series, volumes } = group
  const finished = volumes.filter((v) => v.status === 'finished').length
  const reading = volumes.some((v) => v.status === 'reading')
  const avg = progressPercent(
    volumes.reduce((a, v) => a + v.progress, 0) / Math.max(1, volumes.length)
  )
  const [g1, g2] = gradientFromString(series.name)

  // 封面取第一本有封面的卷
  const coverBook = volumes.find((v) => v.coverPath)
  const cover = coverBook ? `lvimg://cover/${coverBook.id}?v=${coverBook.updatedAt}` : null

  return (
    <div className="group relative">
      <button
        onClick={onOpen}
        title={`${series.name} · ${volumes.length} 册`}
        className="relative block aspect-[3/4] w-full overflow-hidden rounded-xl border border-white/10 text-left shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-white/25 hover:shadow-xl hover:shadow-violet-900/30"
      >
        {/* 叠放效果：底下两张“书脊” */}
        <div className="absolute inset-0 -rotate-2 scale-[0.96] rounded-xl bg-white/5" />
        <div className="absolute inset-0 rotate-1 scale-[0.98] rounded-xl bg-white/10" />
        <div className="absolute inset-0 overflow-hidden rounded-xl">
          {cover ? (
            <img src={cover} alt="" draggable={false} className="h-full w-full object-cover" />
          ) : (
            <div
              className="flex h-full w-full flex-col justify-between p-3"
              style={{ background: `linear-gradient(150deg, ${g1}, ${g2})` }}
            >
              <span />
              <span className="line-clamp-4 text-sm font-semibold leading-snug text-white/90 drop-shadow">
                {series.name}
              </span>
            </div>
          )}
          {/* 底部整体进度 */}
          {avg > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/40">
              <div className="h-full bg-blue-400/90" style={{ width: `${avg}%` }} />
            </div>
          )}
        </div>
        {/* 册数徽标 */}
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg bg-black/60 px-1.5 py-0.5 text-[11px] font-medium text-white ring-1 ring-white/20 backdrop-blur-sm">
          <Layers className="h-3 w-3" />
          {volumes.length} 册
        </div>
      </button>

      <div className="mt-2 px-0.5">
        <h3 className="line-clamp-2 min-h-[2.4rem] text-sm font-medium leading-snug text-slate-100" title={series.name}>
          {series.name}
        </h3>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
          <span className="truncate">套装 · {volumes.length} 册</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 ${reading ? 'bg-violet-500/20 text-violet-200' : 'bg-slate-500/15 text-slate-300'}`}>
            {finished}/{volumes.length} 读完
          </span>
        </div>
        <div className="mt-1 text-[11px] text-slate-500">整体 {avg}%</div>
      </div>
    </div>
  )
}

/** 系列详情弹窗：网格列出各卷（复用 BookCard，读/菜单/详情全都可用） */
export function SeriesModal({ group, onClose }: { group: SeriesGroup; onClose: () => void }) {
  const { series, volumes } = group
  const finished = volumes.filter((v) => v.status === 'finished').length

  const scrollRef = useRef<HTMLDivElement>(null)
  const [, force] = useState(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const total = useMemo(
    () => volumes.reduce((a, v) => a + v.totalReadingSeconds, 0),
    [volumes]
  )
  void force

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-fade-up flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#121219] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/5 px-6 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-100">
              <Layers className="h-4.5 w-4.5 text-violet-400" />
              {series.name}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {volumes.length} 册 · {finished} 册读完
              {total > 0 ? ` · 共读 ${Math.round(total / 60)} 分钟` : ''} ·{' '}
              <span className="text-slate-600">{series.folder}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
            {volumes.map((v) => (
              <BookCard key={v.id} book={v} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
