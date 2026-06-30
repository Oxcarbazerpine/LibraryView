interface ProgressBarProps {
  value: number // 0..1
  className?: string
  /** 已读完时用绿色 */
  finished?: boolean
}

export function ProgressBar({ value, className = '', finished = false }: ProgressBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-white/10 ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${
          finished
            ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
            : 'bg-gradient-to-r from-violet-500 to-pink-500'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
