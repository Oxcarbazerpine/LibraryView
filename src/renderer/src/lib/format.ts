/** 相对时间（中文）：刚刚 / X 分钟前 / X 小时前 / 昨天 / X 天前 / 日期 */
export function formatRelativeTime(ts: number | null): string {
  if (!ts) return '从未阅读'
  const diff = Date.now() - ts
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 2 * day) return '昨天'
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  const d = new Date(ts)
  const now = new Date()
  const y = d.getFullYear()
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return y === now.getFullYear() ? md : `${y}年${md}`
}

/** 时长（秒 → 中文 "X 小时 Y 分钟" / "Y 分钟" / "X 秒"） */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0 分钟'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
  if (m > 0) return `${m} 分钟`
  return `${seconds} 秒`
}

/** 紧凑时长（用于柱状图标签等）：1.5h / 45m / 30s */
export function formatDurationShort(seconds: number): string {
  if (seconds <= 0) return '0'
  const h = seconds / 3600
  if (h >= 1) return `${h.toFixed(h >= 10 ? 0 : 1)}h`
  const m = Math.round(seconds / 60)
  if (m >= 1) return `${m}m`
  return `${seconds}s`
}

export function progressPercent(p: number): number {
  return Math.round(Math.min(1, Math.max(0, p)) * 100)
}

/** 文件大小（字节 → KB/MB/GB） */
export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** 由字符串稳定地派生一对柔和的渐变色（用于无封面占位）。 */
export function gradientFromString(s: string): [string, string] {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const h1 = h % 360
  const h2 = (h1 + 40 + ((h >> 8) % 60)) % 360
  return [`hsl(${h1} 45% 32%)`, `hsl(${h2} 50% 22%)`]
}

/**
 * 从文件路径推导「分类」= 书库根目录下的第一层子文件夹名。
 * 直接放在根目录下的书归为「未分类」。纯前端推导，不落库。
 */
export function categoryOf(path: string, roots: string[]): string {
  const pathSlash = path.replace(/\\/g, '/')
  const lower = pathSlash.toLowerCase()
  for (const r of roots) {
    const rSlash = r.replace(/\\/g, '/').replace(/\/+$/, '')
    if (rSlash && lower.startsWith(rSlash.toLowerCase() + '/')) {
      const rel = pathSlash.slice(rSlash.length + 1)
      const segs = rel.split('/')
      return segs.length > 1 ? segs[0] : '未分类'
    }
  }
  return '未分类'
}

const FORMAT_LABEL: Record<string, string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  mobi: 'MOBI',
  azw3: 'AZW3',
  djvu: 'DjVu',
  cbz: 'CBZ',
  txt: 'TXT',
  other: '其他'
}
export function formatLabel(fmt: string): string {
  return FORMAT_LABEL[fmt] ?? fmt.toUpperCase()
}
