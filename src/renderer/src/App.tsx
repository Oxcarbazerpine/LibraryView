import { useState } from 'react'
import { LibraryProvider, useLibrary } from './store'
import { Sidebar, type Page } from './components/Sidebar'
import { DiscoverPage } from './pages/DiscoverPage'
import { ShelfPage } from './pages/ShelfPage'
import { StatsPage } from './pages/StatsPage'
import { SettingsPage } from './pages/SettingsPage'
import { Toaster } from './components/Toaster'
import { BookDetail } from './components/BookDetail'

/** 详情弹窗：从 store 取当前选中的书（books 已实时更新）。 */
function DetailOverlay() {
  const { detailBookId, books, closeDetail } = useLibrary()
  if (detailBookId == null) return null
  const book = books.find((b) => b.id === detailBookId)
  if (!book) return null
  return <BookDetail book={book} onClose={closeDetail} />
}

function Shell() {
  const [page, setPage] = useState<Page>('discover')
  return (
    <div className="flex h-full w-full overflow-hidden bg-[#0a0a0f] text-slate-200">
      <Sidebar page={page} onNavigate={setPage} />
      <main className="relative min-w-0 flex-1 overflow-hidden">
        {/* 环境光 */}
        <div className="pointer-events-none absolute -top-40 right-1/4 h-[28rem] w-[28rem] rounded-full bg-violet-700/10 blur-[130px]" />
        <div className="relative z-10 h-full">
          {page === 'discover' && <DiscoverPage onNavigate={setPage} />}
          {page === 'shelf' && <ShelfPage onNavigate={setPage} />}
          {page === 'stats' && <StatsPage />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>
      <Toaster />
      <DetailOverlay />
    </div>
  )
}

export default function App() {
  return (
    <LibraryProvider>
      <Shell />
    </LibraryProvider>
  )
}
