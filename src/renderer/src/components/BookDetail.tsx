import { useEffect, useState } from 'react'
import { X, Play, Square, FolderOpen, Check, Clock } from 'lucide-react'
import type { Book, BookStatus, ReadingSession } from '@shared/types'
import { useLibrary } from '@/store'
import {
  formatRelativeTime,
  formatDuration,
  formatFileSize,
  progressPercent,
  formatLabel,
  gradientFromString
} from '@/lib/format'

const STATUS_OPTIONS: { id: BookStatus; label: string }[] = [
  { id: 'unread', label: '未读' },
  { id: 'reading', label: '在读' },
  { id: 'finished', label: '读完' }
]

function fullDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function BookDetail({ book, onClose }: { book: Book; onClose: () => void }) {
  const { active, startReading, stopReading, setStatus, setProgress } = useLibrary()
  const isReading = active?.bookId === book.id
  const [sessions, setSessions] = useState<ReadingSession[]>([])
  const [pageInput, setPageInput] = useState(String(book.currentPage || 0))
  const [g1, g2] = gradientFromString(book.title)
  const pct = progressPercent(book.progress)

  useEffect(() => {
    let ok = true
    void window.api.listSessions(book.id).then((s) => ok && setSessions(s))
    return () => {
      ok = false
    }
  }, [book.id, book.totalReadingSeconds])

  useEffect(() => setPageInput(String(book.currentPage || 0)), [book.currentPage])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const cover = book.coverPath ? `lvimg://cover/${book.id}?v=${book.updatedAt}` : null
  const savePage = (): void => {
    const n = Number(pageInput)
    if (Number.isFinite(n) && n >= 0) void setProgress(book.id, Math.round(n))
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-fade-up flex max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[#14141d] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 封面 */}
        <div className="hidden w-56 shrink-0 bg-black/30 p-5 sm:block">
          <div className="aspect-[3/4] w-full overflow-hidden rounded-xl border border-white/10 shadow-lg">
            {cover ? (
              <img src={cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div
                className="flex h-full w-full items-end p-3"
                style={{ background: `linear-gradient(150deg, ${g1}, ${g2})` }}
              >
                <span className="line-clamp-4 text-sm font-semibold text-white/90">{book.title}</span>
              </div>
            )}
          </div>
          <button
            onClick={() => void window.api.revealInFolder(book.path)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2 text-xs text-slate-300 transition-colors hover:bg-white/10"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            在文件浏览器中打开
          </button>
        </div>

        {/* 详情 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-white/5 px-6 py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-snug text-slate-100" title={book.title}>
                {book.title}
              </h2>
              <p className="mt-0.5 truncate text-sm text-slate-400">
                {book.author || '未知作者'} · {formatLabel(book.format)}
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {/* 操作行 */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void (isReading ? stopReading(book.id) : startReading(book.id))}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  isReading
                    ? 'bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                    : 'bg-violet-500/90 text-white hover:bg-violet-500'
                }`}
              >
                {isReading ? <Square className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                {isReading ? '结束阅读' : '开始阅读'}
              </button>
              <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
                {STATUS_OPTIONS.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => void setStatus(book.id, o.id)}
                    className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                      book.status === o.id
                        ? 'bg-violet-500/25 text-violet-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {book.status === o.id && <Check className="h-3 w-3" />}
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 进度 */}
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
                <span>阅读进度</span>
                <span>
                  {book.pageCount ? `${book.currentPage} / ${book.pageCount} 页 · ` : ''}
                  {pct}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${book.status === 'finished' ? 'bg-emerald-400' : 'bg-blue-400'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {book.pageCount ? (
                <div className="mt-2.5 flex items-center gap-2">
                  <span className="text-xs text-slate-500">手动设置当前页</span>
                  <input
                    type="number"
                    min={0}
                    max={book.pageCount}
                    value={pageInput}
                    onChange={(e) => setPageInput(e.target.value)}
                    className="h-8 w-24 rounded-lg border border-white/10 bg-white/5 px-2.5 text-sm text-slate-200 focus:border-violet-500/50 focus:outline-none"
                  />
                  <button
                    onClick={savePage}
                    className="h-8 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-slate-200 hover:bg-white/10"
                  >
                    保存
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-xs text-slate-600">该格式无固定页数，进度依赖阅读器同步。</p>
              )}
            </div>

            {/* 元信息 */}
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Meta label="累计阅读" value={formatDuration(book.totalReadingSeconds)} />
              <Meta label="上次阅读" value={formatRelativeTime(book.lastReadAt)} />
              <Meta label="文件大小" value={formatFileSize(book.fileSize)} />
              <Meta label="阅读次数" value={`${sessions.length} 次`} />
            </div>

            {/* 阅读历史 */}
            <div className="mt-6">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <Clock className="h-3.5 w-3.5" />
                阅读历史
              </h3>
              {sessions.length === 0 ? (
                <p className="text-xs text-slate-600">还没有阅读记录。</p>
              ) : (
                <ul className="space-y-1">
                  {sessions.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-xs"
                    >
                      <span className="text-slate-400">{fullDate(s.startedAt)}</span>
                      <span className="flex items-center gap-3">
                        {s.startPage != null && s.endPage != null && s.endPage !== s.startPage && (
                          <span className="text-slate-600">
                            P{s.startPage}→{s.endPage}
                          </span>
                        )}
                        <span className="text-slate-300">{formatDuration(s.durationSeconds)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="truncate border-t border-white/5 px-6 py-2 text-[11px] text-slate-600" title={book.path}>
            {book.path}
          </p>
        </div>
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-slate-200">{value}</div>
    </div>
  )
}
