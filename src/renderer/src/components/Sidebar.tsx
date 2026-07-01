import { LibraryBig, BarChart3, Settings2, Square, type LucideIcon } from 'lucide-react'
import { useLibrary } from '@/store'
import { Waveform } from './Waveform'

export type Page = 'shelf' | 'stats' | 'settings'

const NAV: { id: Page; label: string; icon: LucideIcon }[] = [
  { id: 'shelf', label: '书架墙', icon: LibraryBig },
  { id: 'stats', label: '统计', icon: BarChart3 },
  { id: 'settings', label: '设置', icon: Settings2 }
]

export function Sidebar({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  const { active, books, stopReading } = useLibrary()
  const activeBook = active ? books.find((b) => b.id === active.bookId) : null

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-white/5 bg-[#0c0c14]">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex h-7 w-6 items-center justify-center text-violet-400">
          <Waveform bars={4} className="h-5 w-6" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-slate-100">LibraryView</span>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-nav={id}
            onClick={() => onNavigate(id)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
              page === id
                ? 'bg-violet-500/15 text-violet-200'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            <Icon className="h-[18px] w-[18px]" />
            {label}
          </button>
        ))}
      </nav>

      <div className="flex-1" />

      {activeBook && (
        <div className="m-3 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3">
          <div className="flex items-center gap-2 text-violet-300">
            <Waveform bars={4} className="h-4 w-5" />
            <span className="text-[11px] font-medium tracking-wide">正在阅读</span>
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-slate-200">{activeBook.title}</p>
          <button
            onClick={() => void stopReading(activeBook.id)}
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-500/20 py-1.5 text-xs text-violet-100 transition-colors hover:bg-violet-500/30"
          >
            <Square className="h-3 w-3 fill-current" />
            结束阅读
          </button>
        </div>
      )}
    </aside>
  )
}
