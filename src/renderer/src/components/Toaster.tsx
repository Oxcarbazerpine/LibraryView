import { useEffect } from 'react'
import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react'
import { useLibrary, type Toast } from '@/store'

const STYLE: Record<Toast['level'], { icon: typeof Info; cls: string }> = {
  success: { icon: CheckCircle2, cls: 'border-emerald-500/30 text-emerald-200' },
  info: { icon: Info, cls: 'border-sky-500/30 text-sky-200' },
  error: { icon: AlertTriangle, cls: 'border-rose-500/40 text-rose-200' }
}

function ToastCard({ toast }: { toast: Toast }) {
  const { dismissToast } = useLibrary()
  const { icon: Icon, cls } = STYLE[toast.level]

  useEffect(() => {
    const t = setTimeout(() => dismissToast(toast.id), toast.level === 'error' ? 8000 : 5000)
    return () => clearTimeout(t)
  }, [toast.id, toast.level, dismissToast])

  return (
    <div
      className={`animate-fade-up pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-[#14141d]/95 px-3.5 py-3 shadow-xl backdrop-blur ${cls}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1 text-[13px] leading-snug text-slate-200">{toast.message}</p>
      <button
        onClick={() => dismissToast(toast.id)}
        className="shrink-0 rounded p-0.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-300"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function Toaster() {
  const { toasts } = useLibrary()
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed right-5 top-5 z-[100] flex w-80 max-w-[calc(100vw-2.5rem)] flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  )
}
