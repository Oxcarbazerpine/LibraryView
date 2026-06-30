import { mkdir, readFile, writeFile, access, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { getBook, setCover, clearAllCovers } from './books'
import { getDataDir } from './settings'

/** 封面缓存目录：始终在数据目录下（<dataDir>/covers）。 */
export function coversDirectory(): string {
  return join(getDataDir(), 'covers')
}

let pdfjsP: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null
function getPdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  if (!pdfjsP) pdfjsP = import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjsP
}

let canvasP: Promise<typeof import('@napi-rs/canvas')> | null = null
function getCanvas(): Promise<typeof import('@napi-rs/canvas')> {
  if (!canvasP) {
    canvasP = import('@napi-rs/canvas').then((m) => {
      const g = globalThis as Record<string, unknown>
      for (const k of ['DOMMatrix', 'Path2D', 'ImageData']) {
        if (!g[k] && (m as Record<string, unknown>)[k]) g[k] = (m as Record<string, unknown>)[k]
      }
      return m
    })
  }
  return canvasP
}

// 渲染结果近乎全白则视为“空白封面”（如失败的扫描页），回退到占位图
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

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function renderPdfCover(pdfPath: string, outPath: string): Promise<boolean> {
  try {
    const pdfjs = await getPdfjs()
    const canvasMod = await getCanvas()
    const data = new Uint8Array(await readFile(pdfPath))
    const doc = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0
    }).promise
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(2, 360 / base.width)
    const viewport = page.getViewport({ scale })
    const canvas = canvasMod.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    const blank = isBlank(ctx, canvas.width, canvas.height)
    try {
      await doc.destroy()
    } catch {
      /* ignore */
    }
    if (blank) return false
    await writeFile(outPath, canvas.toBuffer('image/png'))
    return true
  } catch (e) {
    console.error('[cover] 渲染失败:', pdfPath, (e as Error).message)
    return false
  }
}

// 并发限制（避免一次渲染太多导致内存/CPU 峰值）+ 同书去重
const inflight = new Map<number, Promise<string | null>>()
let active = 0
const waiters: (() => void)[] = []
function acquire(): Promise<void> {
  return new Promise((res) => {
    if (active < 3) {
      active++
      res()
    } else {
      waiters.push(() => {
        active++
        res()
      })
    }
  })
}
function release(): void {
  active--
  const next = waiters.shift()
  if (next) next()
}

/** 确保某书有封面缓存：已有则返回；PDF 则渲染首页缓存；其它格式返回 null。 */
export async function ensureCover(bookId: number): Promise<string | null> {
  const running = inflight.get(bookId)
  if (running) return running

  const task = (async (): Promise<string | null> => {
    const book = getBook(bookId)
    if (!book) return null
    const out = join(coversDirectory(), `${bookId}.png`)

    // 只认当前缓存目录里的文件（改目录后会自动重渲染到新目录）
    if (await exists(out)) {
      if (book.coverPath !== out) setCover(bookId, out)
      return out
    }
    if (book.format !== 'pdf' || book.missing) return null

    await acquire()
    try {
      await mkdir(coversDirectory(), { recursive: true })
      const ok = await renderPdfCover(book.path, out)
      if (ok) {
        setCover(bookId, out)
        return out
      }
      return null
    } finally {
      release()
    }
  })().finally(() => inflight.delete(bookId))

  inflight.set(bookId, task)
  return task
}

/** 清空封面缓存：删除缓存目录下所有 png 并重置数据库中的封面指针。 */
export async function clearCoverCache(): Promise<void> {
  const dir = coversDirectory()
  try {
    const files = await readdir(dir)
    await Promise.all(
      files
        .filter((f) => f.toLowerCase().endsWith('.png'))
        .map((f) => unlink(join(dir, f)).catch(() => {}))
    )
  } catch {
    /* 目录可能不存在 */
  }
  clearAllCovers()
}
