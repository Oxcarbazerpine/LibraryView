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
  Notify,
  ScanProgress,
  StatsSummary
} from '@shared/types'

export interface Toast extends Notify {
  id: number
}

interface LibraryState {
  books: Book[]
  settings: AppSettings | null
  stats: StatsSummary | null
  active: ActiveSession | null
  scan: ScanProgress | null
  loading: boolean
  toasts: Toast[]
  detailBookId: number | null
  refreshBooks: () => Promise<void>
  refreshStats: (rangeDays?: number) => Promise<void>
  saveSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  rescan: () => Promise<void>
  startReading: (id: number) => Promise<void>
  stopReading: (id: number) => Promise<void>
  setStatus: (id: number, status: BookStatus) => Promise<void>
  setProgress: (id: number, page: number) => Promise<void>
  openDetail: (id: number) => void
  closeDetail: () => void
  dismissToast: (id: number) => void
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
  const [toasts, setToasts] = useState<Toast[]>([])
  const [detailBookId, setDetailBookId] = useState<number | null>(null)
  const statsRange = useRef(30)
  const toastSeq = useRef(0)

  const refreshBooks = useCallback(async () => {
    setBooks(await window.api.listBooks())
  }, [])
  const refreshStats = useCallback(async (rangeDays?: number) => {
    if (rangeDays) statsRange.current = rangeDays
    setStats(await window.api.getStats(statsRange.current))
  }, [])

  // 初次加载：只等书籍/设置/会话，尽快让首屏可交互；统计延后（进入统计页时再取）
  useEffect(() => {
    let mounted = true
    void (async () => {
      const [b, s, a] = await Promise.all([
        window.api.listBooks(),
        window.api.getSettings(),
        window.api.getActiveSession()
      ])
      if (!mounted) return
      setBooks(b)
      setSettings(s)
      setActive(a)
      setLoading(false)
    })()
    return () => {
      mounted = false
    }
  }, [])

  const pushToast = useCallback((n: Notify) => {
    const id = ++toastSeq.current
    setToasts((prev) => [...prev, { ...n, id }].slice(-4))
  }, [])
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // 主进程事件订阅
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const offBooks = window.api.onBooksChanged(() => {
      if (debounce.current) clearTimeout(debounce.current)
      debounce.current = setTimeout(() => {
        void refreshBooks()
        if (stats) void refreshStats()
      }, 400)
    })
    const offScan = window.api.onScanProgress((p) => setScan(p.phase === 'done' ? null : p))
    const offSession = window.api.onSessionChanged((s) => {
      setActive(s)
      void refreshBooks()
    })
    const offNotify = window.api.onNotify((n) => pushToast(n))
    return () => {
      offBooks()
      offScan()
      offSession()
      offNotify()
    }
  }, [refreshBooks, refreshStats, pushToast, stats])

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
      if (stats) await refreshStats()
    },
    [refreshBooks, refreshStats, stats]
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
  const openDetail = useCallback((id: number) => setDetailBookId(id), [])
  const closeDetail = useCallback(() => setDetailBookId(null), [])

  return (
    <Ctx.Provider
      value={{
        books,
        settings,
        stats,
        active,
        scan,
        loading,
        toasts,
        detailBookId,
        refreshBooks,
        refreshStats,
        saveSettings,
        rescan,
        startReading,
        stopReading,
        setStatus,
        setProgress,
        openDetail,
        closeDetail,
        dismissToast
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
