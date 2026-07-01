import { mkdir, access, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { getBook, setCover, clearAllCovers } from './books'
import { getDataDir } from './settings'
import { workerRenderCover, workerEbookCover } from './pdf-pool'

// 能抽取内嵌封面的电子书格式（PDF 走首页渲染，单独处理）
const EBOOK_COVER_FORMATS = new Set(['epub', 'mobi', 'azw3', 'cbz'])

/** 封面缓存目录：始终在数据目录下（<dataDir>/covers）。 */
export function coversDirectory(): string {
  return join(getDataDir(), 'covers')
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// 同书去重：同一本书的并发请求复用同一个 Promise。
const inflight = new Map<number, Promise<string | null>>()

/** 确保某书有封面缓存：已有则返回；PDF 则在独立工作进程里渲染首页；其它格式返回 null。 */
export async function ensureCover(bookId: number): Promise<string | null> {
  const running = inflight.get(bookId)
  if (running) return running

  const task = (async (): Promise<string | null> => {
    const book = getBook(bookId)
    if (!book) return null
    const dir = coversDirectory()
    const out = join(dir, `${bookId}.png`)

    if (await exists(out)) {
      if (book.coverPath !== out) setCover(bookId, out)
      return out
    }
    if (book.missing) return null

    let ok = false
    if (book.format === 'pdf') {
      await mkdir(dir, { recursive: true })
      ok = await workerRenderCover(book.path, out) // 渲染首页；在 utilityProcess 中，不占主线程
    } else if (EBOOK_COVER_FORMATS.has(book.format)) {
      await mkdir(dir, { recursive: true })
      ok = await workerEbookCover(book.path, book.format, out) // 抽取内嵌封面
    } else {
      return null // djvu / other 暂无封面
    }

    if (ok) {
      setCover(bookId, out)
      return out
    }
    return null
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
