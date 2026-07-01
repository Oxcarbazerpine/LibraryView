import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'

// 在独立的 utilityProcess 里跑 pdfjs/canvas，主进程只做消息收发，UI 永不被阻塞。

let child: UtilityProcess | null = null
let seq = 0
const pending = new Map<number, (v: unknown) => void>()

interface QItem {
  msg: Record<string, unknown>
  resolve: (v: unknown) => void
}
const queue: QItem[] = []
let inFlight = 0
const MAX = 3 // 同时在工作进程里处理的任务数（限内存峰值）

function ensureChild(): UtilityProcess {
  if (child) return child
  const c = utilityProcess.fork(join(__dirname, 'pdf-worker.js'))
  c.on('message', (m: { id: number; result: unknown; error?: string }) => {
    if (m.error) console.error('[pdf-pool] 工作进程任务出错:', m.error)
    const cb = pending.get(m.id)
    if (cb) {
      pending.delete(m.id)
      inFlight--
      cb(m.result)
      pump()
    }
  })
  c.on('exit', () => {
    child = null
    for (const cb of pending.values()) cb(null)
    pending.clear()
    inFlight = 0
  })
  child = c
  return c
}

function pump(): void {
  while (inFlight < MAX && queue.length > 0) {
    const item = queue.shift() as QItem
    const id = ++seq
    pending.set(id, item.resolve)
    inFlight++
    ensureChild().postMessage({ ...item.msg, id })
  }
}

function request(msg: Record<string, unknown>, highPriority: boolean): Promise<unknown> {
  return new Promise((resolve) => {
    const item: QItem = { msg, resolve }
    if (highPriority) queue.unshift(item)
    else queue.push(item)
    pump()
  })
}

/** 算 PDF 页数（后台、低优先级）。 */
export function workerPageCount(path: string): Promise<number | null> {
  return request({ type: 'pageCount', path }, false) as Promise<number | null>
}

/** 渲染 PDF 封面到 out（用户可见、高优先级，插队到页数任务前面）。 */
export function workerRenderCover(path: string, out: string): Promise<boolean> {
  return request({ type: 'cover', path, out }, true) as Promise<boolean>
}

/** 抽取 epub/mobi/azw3 内嵌元数据（后台、低优先级）。 */
export function workerEbookMeta(
  path: string,
  format: string
): Promise<{ title?: string; author?: string }> {
  return request({ type: 'ebookMeta', path, format }, false) as Promise<{
    title?: string
    author?: string
  }>
}

/** 抽取 epub/mobi/azw3/cbz 内嵌封面到 out（用户可见、高优先级）。 */
export function workerEbookCover(path: string, format: string, out: string): Promise<boolean> {
  return request({ type: 'ebookCover', path, out, format }, true) as Promise<boolean>
}

export function stopPdfWorker(): void {
  if (child) {
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    child = null
  }
}
