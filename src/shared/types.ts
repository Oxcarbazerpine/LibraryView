/**
 * 主进程 / 预加载 / 渲染层 共享的类型定义。
 * 时间戳统一用毫秒级 epoch（number），便于 JSON 透传与排序。
 */

export type BookFormat = 'pdf' | 'epub' | 'mobi' | 'azw3' | 'djvu' | 'cbz' | 'other'

export type BookStatus = 'unread' | 'reading' | 'finished'

export interface Book {
  id: number
  /** 绝对路径，唯一键 */
  path: string
  title: string
  author: string | null
  format: BookFormat
  /** 总页数；epub 等无固定分页的格式可能为 null */
  pageCount: number | null
  /** 当前页（来自阅读器进度同步或手动设置） */
  currentPage: number
  /** 阅读进度 0..1 */
  progress: number
  /** 缓存封面的绝对路径；无则 null（前端用占位封面） */
  coverPath: string | null
  fileSize: number
  /** 文件修改时间 ms，用于增量扫描 */
  fileMtime: number
  status: BookStatus
  /** 该书累计阅读秒数（由 reading_sessions 聚合冗余存储） */
  totalReadingSeconds: number
  /** 上次阅读时间 ms；从未阅读为 null */
  lastReadAt: number | null
  addedAt: number
  updatedAt: number
  /** 文件当前是否仍存在于磁盘（扫描时维护） */
  missing: boolean
}

export interface ReadingSession {
  id: number
  bookId: number
  startedAt: number
  /** 进行中的会话为 null */
  endedAt: number | null
  durationSeconds: number
  startPage: number | null
  endPage: number | null
}

/** 当前正在计时的阅读会话（同一时刻只允许一个） */
export interface ActiveSession {
  sessionId: number
  bookId: number
  startedAt: number
}

export interface AppSettings {
  /** 数据目录：数据库（libraryview.db）与封面缓存（covers/）所在 */
  dataDir: string
  /** 书库根目录（支持多个） */
  libraryPaths: string[]
  /** 外部阅读器可执行文件路径 */
  readerPath: string | null
  /** SumatraPDF 设置文件路径，用于自动同步进度 */
  sumatraSettingsPath: string | null
  /** 是否启用基于 SumatraPDF 的自动进度同步 */
  autoSyncProgress: boolean
  /** 定时扫描间隔（分钟，0=关闭定时扫描） */
  scanIntervalMinutes: number
  scanOnStartup: boolean
}

export interface DailyReadingStat {
  /** 本地日期 YYYY-MM-DD */
  day: string
  seconds: number
}

export interface StatsSummary {
  totalSeconds: number
  /** 有阅读记录的天数 */
  daysRead: number
  currentStreak: number
  longestStreak: number
  booksReading: number
  booksFinished: number
  booksTotal: number
  /** 今日阅读秒数 */
  todaySeconds: number
  /** 按天的时长序列（已按日期升序填充，含 0 的空白天） */
  daily: DailyReadingStat[]
}

export interface ScanResult {
  added: number
  updated: number
  removed: number
  /** 扫描期间发现的错误（路径 + 原因） */
  errors: { path: string; message: string }[]
  scannedAt: number
}

/** 扫描进度事件（主进程 → 渲染层推送） */
export interface ScanProgress {
  phase: 'walking' | 'indexing' | 'pagecount' | 'covers' | 'done'
  processed: number
  total: number
  currentPath?: string
}

export interface FileFilter {
  name: string
  extensions: string[]
}

/**
 * 暴露给渲染层的 API 契约（window.api）。
 * 预加载实现它、渲染层消费它，二者共享同一签名。
 */
export interface LibraryViewApi {
  // 设置
  getSettings: () => Promise<AppSettings>
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
  pickFolder: () => Promise<string | null>
  pickFile: (filters?: FileFilter[]) => Promise<string | null>

  // 书库
  listBooks: () => Promise<Book[]>
  getBook: (id: number) => Promise<Book | null>
  rescan: () => Promise<ScanResult>
  setStatus: (id: number, status: BookStatus) => Promise<Book | null>
  setProgress: (id: number, currentPage: number) => Promise<Book | null>

  // 阅读会话
  getActiveSession: () => Promise<ActiveSession | null>
  startReading: (bookId: number) => Promise<ActiveSession>
  stopReading: (bookId: number) => Promise<ReadingSession | null>

  // 统计
  getStats: (rangeDays?: number) => Promise<StatsSummary>

  // 封面（按需渲染 PDF 首页并缓存，返回封面文件路径或 null）
  ensureCover: (id: number) => Promise<string | null>
  clearCoverCache: () => Promise<void>

  // 数据目录（数据库 + 封面所在的根目录；更改后会迁移旧数据并重启生效）
  getDataDir: () => Promise<string>
  setDataDir: (dir: string) => Promise<{ changed: boolean; error?: string }>


  // 事件订阅（返回取消订阅函数）
  onBooksChanged: (cb: () => void) => () => void
  onScanProgress: (cb: (p: ScanProgress) => void) => () => void
  onSessionChanged: (cb: (s: ActiveSession | null) => void) => () => void
}
