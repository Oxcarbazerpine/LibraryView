// 在 Electron utilityProcess 中运行：所有 pdfjs / canvas 的 CPU 密集工作都在这里，
// 与主进程事件循环隔离，绝不阻塞窗口消息泵（UI）。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readEbookMeta, readEbookCover } from './ebook'
import type { BookFormat } from '../shared/types'

let canvasP: Promise<typeof import('@napi-rs/canvas')> | null = null
function getCanvas(): Promise<typeof import('@napi-rs/canvas')> {
  if (!canvasP) canvasP = import('@napi-rs/canvas')
  return canvasP
}

// pdfjs 解析（即便只取页数）也需要 DOMMatrix/Path2D/ImageData 等 DOM 全局，
// 用 @napi-rs/canvas 注入。必须在任何 pdfjs 调用前完成。
let globalsP: Promise<void> | null = null
function ensureDomGlobals(): Promise<void> {
  if (!globalsP) {
    globalsP = getCanvas().then((m) => {
      const g = globalThis as Record<string, unknown>
      for (const k of ['DOMMatrix', 'Path2D', 'ImageData']) {
        if (!g[k] && (m as Record<string, unknown>)[k]) g[k] = (m as Record<string, unknown>)[k]
      }
    })
  }
  return globalsP
}

let pdfjsP: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null
function getPdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  if (!pdfjsP) {
    pdfjsP = ensureDomGlobals().then(async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      // utilityProcess 里需要显式指定 worker 文件（否则报 workerSrc 未指定）
      try {
        const workerEntry = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerEntry).href
      } catch {
        /* 退回 pdfjs 默认 */
      }
      return pdfjs
    })
  }
  return pdfjsP
}

async function pageCount(path: string): Promise<number | null> {
  const pdfjs = await getPdfjs()
  const data = new Uint8Array(await readFile(path))
  const task = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false })
  const doc = await task.promise
  const n: number = doc.numPages
  try {
    await task.destroy()
  } catch {
    /* ignore */
  }
  return Number.isFinite(n) && n > 0 ? n : null
}

function isBlank(
  ctx: { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } },
  w: number,
  h: number
): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, w, h)
    let total = 0
    let nonWhite = 0
    for (let i = 0; i < data.length; i += 4 * 16) {
      total++
      if (data[i] < 244 || data[i + 1] < 244 || data[i + 2] < 244) nonWhite++
    }
    return total > 0 && nonWhite / total < 0.02
  } catch {
    return false
  }
}

async function renderCover(path: string, out: string): Promise<boolean> {
  const pdfjs = await getPdfjs()
  const canvasMod = await getCanvas()

  // pdfjs 在 utilityProcess 里会误判为浏览器环境而用依赖 document 的工厂；显式提供 Node 版本。
  class NodeCanvasFactory {
    create(width: number, height: number): { canvas: unknown; context: unknown } {
      const canvas = canvasMod.createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)))
      return { canvas, context: canvas.getContext('2d') }
    }
    reset(cc: { canvas: { width: number; height: number } }, width: number, height: number): void {
      cc.canvas.width = Math.max(1, Math.ceil(width))
      cc.canvas.height = Math.max(1, Math.ceil(height))
    }
    destroy(cc: { canvas: { width: number; height: number } }): void {
      cc.canvas.width = 0
      cc.canvas.height = 0
    }
  }
  class NoopFilterFactory {
    addFilter(): string {
      return 'none'
    }
    addHCMFilter(): string {
      return 'none'
    }
    addHighlightHCMFilter(): string {
      return 'none'
    }
    addAlphaFilter(): string {
      return 'none'
    }
    addLuminosityFilter(): string {
      return 'none'
    }
    addKnockoutFilter(): string {
      return 'none'
    }
    destroy(): void {}
  }

  const data = new Uint8Array(await readFile(path))
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
    CanvasFactory: NodeCanvasFactory,
    FilterFactory: NoopFilterFactory
  }).promise
  const page = await doc.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2, 360 / base.width)
  const viewport = page.getViewport({ scale })
  const canvas = canvasMod.createCanvas(
    Math.max(1, Math.ceil(viewport.width)),
    Math.max(1, Math.ceil(viewport.height))
  )
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx, viewport }).promise
  const blank = isBlank(ctx as unknown as Parameters<typeof isBlank>[0], canvas.width, canvas.height)
  try {
    await doc.destroy()
  } catch {
    /* ignore */
  }
  if (blank) return false
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, canvas.toBuffer('image/png'))
  return true
}

// 把原始封面图片字节解码 + 缩放后落盘为 PNG（epub/mobi/azw3/cbz 复用）。
async function renderImageCover(bytes: Uint8Array, out: string): Promise<boolean> {
  const canvasMod = await getCanvas()
  const img = await canvasMod.loadImage(Buffer.from(bytes))
  const targetW = 360
  const scale = Math.min(1, targetW / (img.width || targetW))
  const w = Math.max(1, Math.round((img.width || targetW) * scale))
  const h = Math.max(1, Math.round((img.height || targetW) * scale))
  const canvas = canvasMod.createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, canvas.toBuffer('image/png'))
  return true
}

async function ebookCover(path: string, format: BookFormat, out: string): Promise<boolean> {
  const bytes = await readEbookCover(path, format)
  if (!bytes || bytes.length === 0) return false
  try {
    return await renderImageCover(bytes, out)
  } catch {
    return false // 解码失败（少见的图片格式等）
  }
}

interface Job {
  id: number
  type: 'pageCount' | 'cover' | 'ebookMeta' | 'ebookCover'
  path: string
  out?: string
  format?: BookFormat
}

interface ParentPortLike {
  on(event: 'message', listener: (e: { data: Job }) => void): void
  postMessage(message: unknown): void
}
const parentPort = (process as unknown as { parentPort: ParentPortLike }).parentPort

async function dispatch(job: Job): Promise<unknown> {
  switch (job.type) {
    case 'pageCount':
      return pageCount(job.path)
    case 'cover':
      return renderCover(job.path, job.out ?? '')
    case 'ebookMeta':
      return readEbookMeta(job.path, job.format ?? 'other')
    case 'ebookCover':
      return ebookCover(job.path, job.format ?? 'other', job.out ?? '')
    default:
      return null
  }
}

parentPort.on('message', (e: { data: Job }) => {
  const job = e.data
  void (async () => {
    try {
      parentPort.postMessage({ id: job.id, result: await dispatch(job) })
    } catch (err) {
      const fail = job.type === 'ebookMeta' ? {} : job.type === 'pageCount' ? null : false
      parentPort.postMessage({
        id: job.id,
        result: fail,
        error: String((err as { stack?: string })?.stack ?? err)
      })
    }
  })()
})
