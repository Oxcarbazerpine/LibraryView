import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search, RotateCw, FolderOpen, BookMarked } from 'lucide-react'
import type { Book, BookStatus } from '@shared/types'
import { useLibrary } from '@/store'
import { BookCard } from '@/components/BookCard'
import type { Page } from '@/components/Sidebar'

type SortKey = 'recent' | 'title' | 'added' | 'progress'
type Filter = 'all' | BookStatus

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'reading', label: '在读' },
  { id: 'unread', label: '未读' },
  { id: 'finished', label: '读完' }
]

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'recent', label: '最近阅读' },
  { id: 'added', label: '最近添加' },
  { id: 'title', label: '标题' },
  { id: 'progress', label: '阅读进度' }
]

const PAGE_SIZE = 60

function sortBooks(books: Book[], key: SortKey): Book[] {
  const arr = [...books]
  switch (key) {
    case 'title':
      return arr.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    case 'added':
      return arr.sort((a, b) => b.addedAt - a.addedAt)
    case 'progress':
      return arr.sort((a, b) => b.progress - a.progress)
    case 'recent':
    default:
      return arr.sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || a.title.localeCompare(b.title, 'zh'))
  }
}

const SCAN_LABEL: Record<string, string> = {
  walking: '正在遍历文件夹…',
  indexing: '建立索引',
  pagecount: '读取页数',
  covers: '生成封面'
}

export function ShelfPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { books, loading, scan, settings, rescan } = useLibrary()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const sentinel = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = books.filter((b) => !b.missing)
    if (filter !== 'all') list = list.filter((b) => b.status === filter)
    if (q) list = list.filter((b) => b.title.toLowerCase().includes(q) || (b.author ?? '').toLowerCase().includes(q))
    return sortBooks(list, sort)
  }, [books, query, filter, sort])

  // 筛选变化时重置可见数量
  useEffect(() => {
    setVisible(PAGE_SIZE)
  }, [query, filter, sort])

  // 无限滚动
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setVisible((v) => Math.min(v + PAGE_SIZE, filtered.length))
      },
      { rootMargin: '600px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [filtered.length])

  const noLibrary = !loading && settings && settings.libraryPaths.length === 0
  const shown = filtered.slice(0, visible)

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/5 px-7 py-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索书名、作者…"
            className="h-9 w-64 rounded-lg border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-violet-500/50 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                filter === f.id ? 'bg-violet-500/25 text-violet-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-300 focus:border-violet-500/50 focus:outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id} className="bg-[#14141d]">
              {s.label}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-slate-500">{filtered.length} 本</span>
          <button
            onClick={() => void rescan()}
            disabled={!!scan}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            <RotateCw className={`h-3.5 w-3.5 ${scan ? 'animate-spin' : ''}`} />
            {scan ? '扫描中' : '重新扫描'}
          </button>
        </div>
      </header>

      {/* 扫描进度条 */}
      {scan && (
        <div className="flex items-center gap-3 border-b border-white/5 bg-violet-500/5 px-7 py-2 text-xs text-violet-200">
          <span>{SCAN_LABEL[scan.phase] ?? '处理中'}</span>
          {scan.total > 0 && (
            <>
              <div className="h-1 w-48 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-violet-400 transition-[width]"
                  style={{ width: `${Math.round((scan.processed / scan.total) * 100)}%` }}
                />
              </div>
              <span className="text-slate-400">
                {scan.processed}/{scan.total}
              </span>
            </>
          )}
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto px-7 py-6">
        {loading ? (
          <SkeletonGrid />
        ) : noLibrary ? (
          <EmptyState
            icon={<FolderOpen className="h-10 w-10" />}
            title="还没有配置书库目录"
            desc="去设置里添加你存放电子书的文件夹，然后扫描建立索引。"
            action={
              <button
                onClick={() => onNavigate('settings')}
                className="rounded-lg bg-violet-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
              >
                前往设置
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<BookMarked className="h-10 w-10" />}
            title={query || filter !== 'all' ? '没有匹配的书籍' : '书库为空'}
            desc={query || filter !== 'all' ? '试试更换搜索词或筛选条件。' : '点击右上角「重新扫描」来建立索引。'}
          />
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
              {shown.map((b) => (
                <BookCard key={b.id} book={b} />
              ))}
            </div>
            <div ref={sentinel} className="h-10" />
          </>
        )}
      </div>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
      {Array.from({ length: 18 }).map((_, i) => (
        <div key={i}>
          <div className="shimmer aspect-[3/4] w-full rounded-xl bg-white/5" />
          <div className="mt-2 h-3 w-3/4 rounded bg-white/5" />
          <div className="mt-1.5 h-2.5 w-1/2 rounded bg-white/5" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  icon,
  title,
  desc,
  action
}: {
  icon: ReactNode
  title: string
  desc: string
  action?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="text-slate-600">{icon}</div>
      <h2 className="text-lg font-medium text-slate-200">{title}</h2>
      <p className="max-w-sm text-sm text-slate-500">{desc}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
