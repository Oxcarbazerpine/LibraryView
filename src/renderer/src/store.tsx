import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type {
  ActiveSession,
  AppSettings,
  Book,
  BookStatus,
  ScanProgress,
  StatsSummary
} from '@shared/types'

interface LibraryState {
  books: Book[]
  settings: AppSettings | null
  stats: StatsSummary | null
  active: ActiveSession | null
  scan: ScanProgress | null
  loading: boolean
  refreshBooks: () => Promise<void>
  refreshStats: (rangeDays?: number) => Promise<void>
  saveSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  rescan: () => Promise<void>
  startReading: (id: number) => Promise<void>
  stopReading: (id: number) => Promise<void>
  setStatus: (id: number, status: BookStatus) => Promise<void>
  setProgress: (id: number, page: number) => Promise<void>
}

const Ctx = createContext<LibraryState | null>(null)

export function useLibrary(): LibraryState {
  const c = useContext(Ctx)
  if (!c) throw new Error('useLibrary 必须在 LibraryProvider 内使用')
  return c
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [books, setBooks] = useState<Book[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [active, setActive] = useState<ActiveSession | null>(null)
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const statsRange = useRef(30)

  const refreshBooks = useCallback(async () => {
    setBooks(await window.api.listBooks())
  }, [])
  const refreshStats = useCallback(async (rangeDays?: number) => {
    if (rangeDays) statsRange.current = rangeDays
    setStats(await window.api.getStats(statsRange.current))
  }, [])

  // 初次加载
  useEffect(() => {
    let mounted = true
    void (async () => {
      const [b, s, st, a] = await Promise.all([
        window.api.listBooks(),
        window.api.getSettings(),
        window.api.getStats(statsRange.current),
        window.api.getActiveSession()
      ])
      if (!mounted) return
      setBooks(b)
      setSettings(s)
      setStats(st)
      setActive(a)
      setLoading(false)
    })()
    return () => {
      mounted = false
    }
  }, [])

  // 主进程事件订阅
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const offBooks = window.api.onBooksChanged(() => {
      if (debounce.current) clearTimeout(debounce.current)
      debounce.current = setTimeout(() => {
        void refreshBooks()
        void refreshStats()
      }, 400)
    })
    const offScan = window.api.onScanProgress((p) => setScan(p.phase === 'done' ? null : p))
    const offSession = window.api.onSessionChanged((s) => {
      setActive(s)
      void refreshBooks()
    })
    return () => {
      offBooks()
      offScan()
      offSession()
    }
  }, [refreshBooks, refreshStats])

  const saveSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await window.api.updateSettings(patch)
    setSettings(next)
    return next
  }, [])
  const rescan = useCallback(async () => {
    await window.api.rescan()
  }, [])
  const startReading = useCallback(
    async (id: number) => {
      const s = await window.api.startReading(id)
      setActive(s)
      await refreshBooks()
    },
    [refreshBooks]
  )
  const stopReading = useCallback(
    async (id: number) => {
      await window.api.stopReading(id)
      setActive(null)
      await refreshBooks()
      await refreshStats()
    },
    [refreshBooks, refreshStats]
  )
  const setStatus = useCallback(
    async (id: number, status: BookStatus) => {
      await window.api.setStatus(id, status)
      await refreshBooks()
    },
    [refreshBooks]
  )
  const setProgress = useCallback(
    async (id: number, page: number) => {
      await window.api.setProgress(id, page)
      await refreshBooks()
    },
    [refreshBooks]
  )

  return (
    <Ctx.Provider
      value={{
        books,
        settings,
        stats,
        active,
        scan,
        loading,
        refreshBooks,
        refreshStats,
        saveSettings,
        rescan,
        startReading,
        stopReading,
        setStatus,
        setProgress
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
