import { useMemo, useState, type ReactNode } from 'react'
import { Sparkles, Shuffle, Compass } from 'lucide-react'
import type { Book } from '@shared/types'
import { useLibrary } from '@/store'
import { BookCard } from '@/components/BookCard'
import type { Page } from '@/components/Sidebar'

// 带种子的洗牌：同一 seed 结果稳定，换一批时换 seed 才重排。
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice()
  let s = (seed || 1) >>> 0
  const rnd = (): number => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0
    return s / 0xffffffff
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

const PICK_COUNT = 30

export function DiscoverPage({ onNavigate }: { onNavigate: (p: Page) => void }) {
  const { books, loading } = useLibrary()
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9) + 1)

  const avail = useMemo(() => books.filter((b) => !b.missing), [books])
  const reading = useMemo(() => avail.filter((b) => b.status === 'reading').slice(0, 12), [avail])

  // 当前书对象索引（每次渲染都新鲜 → 状态改动立即反映）
  const byId = useMemo(() => new Map(avail.map((b) => [b.id, b])), [avail])
  // 只缓存随机「顺序」（id 列表），仅 seed / 书量变化时重排，避免进度刷新时乱跳
  const pickIds = useMemo(
    () =>
      seededShuffle(avail, seed)
        .slice(0, PICK_COUNT)
        .map((b) => b.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [avail.length, seed]
  )
  const picks = pickIds.map((id) => byId.get(id)).filter((b): b is Book => !!b)

  const shuffle = (): void => setSeed(Math.floor(Math.random() * 1e9) + 1)

  if (loading) return null

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-100">
              <Compass className="h-5 w-5 text-violet-400" />
              发现
            </h1>
            <p className="mt-1 text-sm text-slate-500">每次进来都不一样，翻翻那些被遗忘的书。</p>
          </div>
          <button
            onClick={shuffle}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-slate-200 transition-colors hover:bg-white/10"
          >
            <Shuffle className="h-4 w-4" />
            换一批
          </button>
        </header>

        {avail.length === 0 ? (
          <div className="flex h-[50vh] flex-col items-center justify-center gap-3 text-center text-slate-500">
            <Compass className="h-10 w-10 text-slate-600" />
            <p className="text-sm">书库还是空的，先去设置里添加目录并扫描。</p>
          </div>
        ) : (
          <div className="space-y-9">
            {reading.length > 0 && (
              <Section
                title="继续阅读"
                action={
                  <button
                    onClick={() => onNavigate('shelf')}
                    className="text-xs text-slate-400 transition-colors hover:text-slate-200"
                  >
                    去书架 →
                  </button>
                }
              >
                <Grid books={reading} />
              </Section>
            )}

            <Section
              title="随手翻翻"
              icon={<Sparkles className="h-4 w-4 text-violet-400" />}
              action={
                <button
                  onClick={shuffle}
                  className="flex items-center gap-1 text-xs text-slate-400 transition-colors hover:text-slate-200"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  换一批
                </button>
              }
            >
              <Grid books={picks} />
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  icon,
  action,
  children
}: {
  title: string
  icon?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-3 flex items-end justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-slate-300">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Grid({ books }: { books: Book[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
      {books.map((b) => (
        <BookCard key={b.id} book={b} />
      ))}
    </div>
  )
}
