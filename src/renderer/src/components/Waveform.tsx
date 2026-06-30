interface WaveformProps {
  bars?: number
  className?: string
  /** 是否在动画（false 时静止，用于非活动状态预览） */
  playing?: boolean
}

/** 音乐播放器式的内容波纹（阅读中指示）。颜色继承 currentColor。 */
export function Waveform({ bars = 5, className = '', playing = true }: WaveformProps) {
  return (
    <div className={`flex items-end gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="wave-bar block w-[3px] flex-1 rounded-full bg-current"
          style={{
            height: '100%',
            animationDelay: `${(i % bars) * 0.13}s`,
            animationDuration: `${0.7 + (i % 3) * 0.2}s`,
            animationPlayState: playing ? 'running' : 'paused',
            transform: playing ? undefined : 'scaleY(0.4)'
          }}
        />
      ))}
    </div>
  )
}
