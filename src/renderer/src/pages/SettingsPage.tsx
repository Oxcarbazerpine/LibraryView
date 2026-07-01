import { useState, useEffect, type ReactNode } from 'react'
import { FolderOpen, Plus, X, RotateCw, FileText, FolderTree, Database } from 'lucide-react'
import { useLibrary } from '@/store'

export function SettingsPage() {
  const { settings, saveSettings, rescan, scan } = useLibrary()
  const [adding, setAdding] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [dataDir, setDataDirState] = useState<string | null>(null)
  const [migrating, setMigrating] = useState(false)

  useEffect(() => {
    void window.api.getDataDir().then(setDataDirState)
  }, [])

  if (!settings) return null
  const s = settings

  const addFolder = async (): Promise<void> => {
    setAdding(true)
    try {
      const dir = await window.api.pickFolder()
      if (dir && !s.libraryPaths.includes(dir)) {
        await saveSettings({ libraryPaths: [...s.libraryPaths, dir] })
      }
    } finally {
      setAdding(false)
    }
  }
  const removeFolder = (p: string): void => {
    void saveSettings({ libraryPaths: s.libraryPaths.filter((x) => x !== p) })
  }
  const pickReader = async (): Promise<void> => {
    const f = await window.api.pickFile([{ name: '可执行文件', extensions: ['exe'] }])
    if (f) await saveSettings({ readerPath: f })
  }
  const pickSumatra = async (): Promise<void> => {
    const f = await window.api.pickFile([{ name: '设置文件', extensions: ['txt'] }])
    if (f) await saveSettings({ sumatraSettingsPath: f })
  }
  const changeDataDir = async (): Promise<void> => {
    const dir = await window.api.pickFolder()
    if (!dir || dir === dataDir) return
    if (!window.confirm(`将把数据库与封面迁移到：\n${dir}\n并重启应用以生效。确定吗？`)) return
    setMigrating(true)
    const res = await window.api.setDataDir(dir)
    if (!res.changed) {
      setMigrating(false)
      if (res.error) window.alert('更改失败：' + res.error)
    }
    // 成功后应用会自动重启（打包版）或退出（开发模式需手动再启动）
  }
  const clearCovers = async (): Promise<void> => {
    setClearing(true)
    try {
      await window.api.clearCoverCache()
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <h1 className="text-xl font-semibold text-slate-100">设置</h1>
        <p className="mt-1 text-sm text-slate-500">配置书库目录、阅读器与扫描方式。改动即时保存。</p>

        {/* 书库目录 */}
        <Section title="书库目录" icon={<FolderTree className="h-4 w-4" />}>
          {s.libraryPaths.length === 0 ? (
            <p className="text-sm text-slate-500">尚未添加任何文件夹。</p>
          ) : (
            <ul className="space-y-2">
              {s.libraryPaths.map((p) => (
                <li
                  key={p}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-violet-400" />
                  <span className="flex-1 truncate text-sm text-slate-300" title={p}>
                    {p}
                  </span>
                  <button
                    onClick={() => removeFolder(p)}
                    className="rounded p-1 text-slate-500 hover:bg-white/10 hover:text-rose-400"
                    title="移除"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => void addFolder()}
              disabled={adding}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              添加文件夹
            </button>
            <button
              onClick={() => void rescan()}
              disabled={!!scan || s.libraryPaths.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-violet-500/90 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              <RotateCw className={`h-4 w-4 ${scan ? 'animate-spin' : ''}`} />
              {scan ? '扫描中…' : '立即扫描'}
            </button>
          </div>
        </Section>

        {/* 阅读器 */}
        <Section title="阅读器" icon={<FileText className="h-4 w-4" />}>
          <FilePathField
            label="外部阅读器"
            hint="点击书籍时用它打开文件。推荐 SumatraPDF（支持自动同步进度）。"
            value={s.readerPath}
            placeholder="使用系统默认程序"
            onPick={pickReader}
            onClear={() => void saveSettings({ readerPath: null })}
          />
          <FilePathField
            label="SumatraPDF 设置文件"
            hint="用于自动读取阅读进度（FileStates / PageNo）。"
            value={s.sumatraSettingsPath}
            placeholder="未设置"
            onPick={pickSumatra}
            onClear={() => void saveSettings({ sumatraSettingsPath: null })}
          />
          <Toggle
            label="自动同步阅读进度"
            desc="监听 SumatraPDF 设置文件，自动更新当前页与进度。"
            checked={s.autoSyncProgress}
            onChange={(v) => void saveSettings({ autoSyncProgress: v })}
          />
        </Section>

        {/* 扫描 */}
        <Section title="扫描" icon={<RotateCw className="h-4 w-4" />}>
          <Toggle
            label="启动时扫描"
            desc="每次打开应用时自动扫描一次。"
            checked={s.scanOnStartup}
            onChange={(v) => void saveSettings({ scanOnStartup: v })}
          />
          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-sm text-slate-200">定时扫描</div>
              <div className="text-xs text-slate-500">每隔一段时间自动扫描以更新书库。</div>
            </div>
            <select
              value={s.scanIntervalMinutes}
              onChange={(e) => void saveSettings({ scanIntervalMinutes: Number(e.target.value) })}
              className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-300 focus:border-violet-500/50 focus:outline-none"
            >
              <option value={0} className="bg-[#14141d]">关闭</option>
              <option value={1440} className="bg-[#14141d]">每天</option>
              <option value={4320} className="bg-[#14141d]">每 3 天</option>
              <option value={10080} className="bg-[#14141d]">每周</option>
              <option value={20160} className="bg-[#14141d]">每 2 周</option>
              <option value={43200} className="bg-[#14141d]">每月</option>
            </select>
          </div>
        </Section>

        {/* 数据目录 */}
        <Section title="数据目录" icon={<Database className="h-4 w-4" />}>
          <div className="py-2">
            <div className="text-sm text-slate-200">数据库与封面缓存的位置</div>
            <div className="mt-1.5 flex items-center gap-2">
              <div
                className="flex-1 truncate rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-400"
                title={dataDir ?? ''}
              >
                {dataDir || <span className="text-slate-600">加载中…</span>}
              </div>
              <button
                onClick={() => void changeDataDir()}
                disabled={migrating}
                className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                {migrating ? '迁移中…' : '更改目录'}
              </button>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              数据库（<code className="text-slate-400">libraryview.db</code>）与封面缓存（
              <code className="text-slate-400">covers/</code>）始终一起放在这里。更改时会把旧数据迁移过去，然后重启应用生效。
            </p>
          </div>
          <div className="flex items-center justify-between border-t border-white/5 py-2 pt-3">
            <div className="pr-4">
              <div className="text-sm text-slate-200">清空封面缓存</div>
              <div className="text-xs text-slate-500">删除所有已缓存封面；之后浏览会重新生成。</div>
            </div>
            <button
              onClick={() => void clearCovers()}
              disabled={clearing}
              className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              {clearing ? '清理中…' : '清空并重建'}
            </button>
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-7 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
        <span className="text-violet-400">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function FilePathField({
  label,
  hint,
  value,
  placeholder,
  onPick,
  onClear
}: {
  label: string
  hint: string
  value: string | null
  placeholder: string
  onPick: () => void
  onClear: () => void
}) {
  return (
    <div className="py-2">
      <div className="text-sm text-slate-200">{label}</div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 truncate rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-400" title={value ?? ''}>
          {value || <span className="text-slate-600">{placeholder}</span>}
        </div>
        <button
          onClick={onPick}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
        >
          选择
        </button>
        {value && (
          <button
            onClick={onClear}
            className="rounded-lg p-2 text-slate-500 hover:bg-white/10 hover:text-rose-400"
            title="清除"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
    </div>
  )
}

function Toggle({
  label,
  desc,
  checked,
  onChange
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="pr-4">
        <div className="text-sm text-slate-200">{label}</div>
        <div className="text-xs text-slate-500">{desc}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-violet-500' : 'bg-white/15'}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </button>
    </div>
  )
}
