import { useEffect, useRef, useState } from 'react'
import { Play, Check } from 'lucide-react'
import type { Book } from '@shared/types'
import { useLibrary } from '@/store'
import { Waveform } from './Waveform'
import { ProgressBar } from './ProgressBar'
import { formatRelativeTime, progressPercent, gradientFromString, formatLabel } from '@/lib/format'

function buildCoverUrl(id: number, v: number): string {
  return `lvimg://cover/${id}?v=${v}`
}

const STATUS_BADGE: Record<Book['status'], { label: string; cls: string }> = {
  unread: { label: '未读', cls: 'bg-slate-500/15 text-slate-300' },
  reading: { label: '在读', cls: 'bg-violet-500/20 text-violet-200' },
  finished: { label: '读完', cls: 'bg-emerald-500/15 text-emerald-300' }
}

const STATUS_OPTIONS: { id: Book['status']; label: string }[] = [
  { id: 'unread', label: '未读' },
  { id: 'reading', label: '在读' },
  { id: 'finished', label: '读完' }
]

export function BookCard({ book }: { book: Book }) {
  const { active, startReading, stopReading, setStatus } = useLibrary()
  const isReading = active?.bookId === book.id
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [cover, setCover] = useState<string | null>(
    book.coverPath ? buildCoverUrl(book.id, book.updatedAt) : null
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const requested = useRef(false)
  const [g1, g2] = gradientFromString(book.title)
  const pct = progressPercent(book.progress)
  const badge = STATUS_BADGE[book.status]

  // 进入视口时为 PDF 按需生成封面
  useEffect(() => {
    if (cover || requested.current || book.format !== 'pdf' || book.missing) return
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !requested.current) {
          requested.current = true
          io.disconnect()
          void window.api.ensureCover(book.id).then((p) => {
            if (p) setCover(buildCoverUrl(book.id, Date.now()))
          })
        }
      },
      { rootMargin: '250px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [book.id, book.format, book.missing, cover])

  const onToggle = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      if (isReading) await stopReading(book.id)
      else await startReading(book.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="group animate-fade-up"
      ref={rootRef}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <button
        onClick={onToggle}
        disabled={busy}
        title={isReading ? '点击结束阅读' : '点击开始阅读'}
        className={`relative block aspect-[3/4] w-full overflow-hidden rounded-xl border text-left shadow-lg transition-all duration-300 ${
          isReading
            ? 'border-violet-500/60 ring-2 ring-violet-500/40'
            : 'border-white/10 hover:-translate-y-1 hover:border-white/25 hover:shadow-xl hover:shadow-violet-900/30'
        }`}
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
            onError={() => setCover(null)}
          />
        ) : (
          <div
            className="flex h-full w-full flex-col justify-between p-3"
            style={{ background: `linear-gradient(150deg, ${g1}, ${g2})` }}
          >
            <span className="self-end rounded bg-black/25 px-1.5 py-0.5 text-[10px] font-medium text-white/75">
              {formatLabel(book.format)}
            </span>
            <span className="line-clamp-4 text-sm font-semibold leading-snug text-white/90 drop-shadow">
              {book.title}
            </span>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/25 to-transparent" />

        {book.missing && (
          <div className="absolute left-2 top-2 rounded bg-rose-500/85 px-1.5 py-0.5 text-[10px] font-medium text-white">
            文件缺失
          </div>
        )}

        {pct > 0 && (
          <div className="absolute inset-x-0 bottom-0">
            <ProgressBar value={book.progress} finished={book.status === 'finished'} className="rounded-none" />
          </div>
        )}

        <div
          className={`absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[1px] transition-opacity duration-300 ${
            isReading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {isReading ? (
            <div className="flex flex-col items-center gap-2 text-violet-300">
              <Waveform bars={5} className="h-9 w-10" />
              <span className="text-[11px] font-medium">阅读中 · 点击结束</span>
            </div>
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/30">
              <Play className="h-5 w-5 translate-x-[1px] fill-white text-white" />
            </div>
          )}
        </div>
      </button>

      <div className="mt-2 px-0.5">
        <h3
          className="line-clamp-2 min-h-[2.4rem] text-sm font-medium leading-snug text-slate-100"
          title={book.title}
        >
          {book.title}
        </h3>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-400">
          <span className="truncate">{book.author || formatLabel(book.format)}</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 ${badge.cls}`}>{badge.label}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
          <span className="truncate">
            {book.pageCount
              ? `${book.currentPage}/${book.pageCount} 页 · ${pct}%`
              : pct > 0
                ? `${pct}%`
                : '未开始'}
          </span>
          <span className="shrink-0">{formatRelativeTime(book.lastReadAt)}</span>
        </div>
      </div>

      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            className="fixed z-50 min-w-[136px] rounded-lg border border-white/10 bg-[#1a1a24] p-1 shadow-xl"
            style={{
              top: Math.min(menu.y, window.innerHeight - 150),
              left: Math.min(menu.x, window.innerWidth - 150)
            }}
          >
            <div className="px-2 py-1 text-[11px] text-slate-500">标记为</div>
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  void setStatus(book.id, o.id)
                  setMenu(null)
                }}
                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-white/10 ${
                  book.status === o.id ? 'text-violet-300' : 'text-slate-200'
                }`}
              >
                {o.label}
                {book.status === o.id && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
