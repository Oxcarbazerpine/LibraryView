import { useState } from 'react'
import { LibraryProvider } from './store'
import { Sidebar, type Page } from './components/Sidebar'
import { ShelfPage } from './pages/ShelfPage'
import { StatsPage } from './pages/StatsPage'
import { SettingsPage } from './pages/SettingsPage'

export default function App() {
  const [page, setPage] = useState<Page>('shelf')

  return (
    <LibraryProvider>
      <div className="flex h-full w-full overflow-hidden bg-[#0a0a0f] text-slate-200">
        <Sidebar page={page} onNavigate={setPage} />
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {/* 环境光 */}
          <div className="pointer-events-none absolute -top-40 right-1/4 h-[28rem] w-[28rem] rounded-full bg-violet-700/10 blur-[130px]" />
          <div className="relative z-10 h-full">
            {page === 'shelf' && <ShelfPage onNavigate={setPage} />}
            {page === 'stats' && <StatsPage />}
            {page === 'settings' && <SettingsPage />}
          </div>
        </main>
      </div>
    </LibraryProvider>
  )
}
