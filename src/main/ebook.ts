// 电子书内嵌元数据 / 封面抽取（不依赖 canvas，纯解析）：
//   - EPUB / CBZ：zip，用 fflate 选择性解压需要的条目
//   - MOBI / AZW3：Palm 数据库(PDB) + MOBI 头 + EXTH 记录，按需 partial-read
// 返回原始图片字节（jpeg/png/gif），由调用方（工作进程）用 canvas 解码/缩放/落盘。
import { open, readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import type { BookFormat } from '../shared/types'

export interface EbookMeta {
  title?: string
  author?: string
}

const naturalCmp = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function clean(s: string | undefined): string | undefined {
  if (!s) return undefined
  const t = decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
  return t.length ? t : undefined
}

function isImageBytes(b: Uint8Array): boolean {
  if (b.length < 4) return false
  // JPEG FFD8, PNG 89504E47, GIF 4749, WEBP RIFF....WEBP, BMP 424D
  if (b[0] === 0xff && b[1] === 0xd8) return true
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true
  if (b[0] === 0x42 && b[1] === 0x4d) return true
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return true
  return false
}

// ---------------- EPUB ----------------

function normalizeZipPath(baseDir: string, href: string): string {
  const rel = decodeURIComponent(href.split('#')[0].split('?')[0])
  const parts = (baseDir ? baseDir.split('/') : []).concat(rel.split('/'))
  const out: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

function findOpfPath(zip: Record<string, Uint8Array>): string | null {
  const container = zip['META-INF/container.xml']
  if (container) {
    const xml = Buffer.from(container).toString('utf8')
    const m = xml.match(/full-path=["']([^"']+)["']/i)
    if (m) return m[1]
  }
  const opf = Object.keys(zip).find((n) => n.toLowerCase().endsWith('.opf'))
  return opf ?? null
}

interface OpfInfo {
  meta: EbookMeta
  coverHref?: string
}

function parseOpf(xml: string): OpfInfo {
  const title = clean((xml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) ||
    xml.match(/<title[^>]*>([\s\S]*?)<\/title>/i))?.[1])
  const author = clean((xml.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i) ||
    xml.match(/<creator[^>]*>([\s\S]*?)<\/creator>/i))?.[1])

  // 解析 manifest 里的所有 <item>
  const items = [...xml.matchAll(/<item\b[^>]*>/gi)].map((m) => {
    const tag = m[0]
    const attr = (name: string): string | undefined =>
      tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1]
    return {
      id: attr('id'),
      href: attr('href'),
      type: attr('media-type'),
      props: attr('properties')
    }
  })

  let coverHref: string | undefined
  // 1) EPUB3：properties 含 cover-image
  coverHref = items.find((i) => i.props?.includes('cover-image') && i.href)?.href
  // 2) <meta name="cover" content="ID"> → 对应 item
  if (!coverHref) {
    const coverId =
      xml.match(/<meta[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
      xml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']cover["']/i)?.[1]
    if (coverId) coverHref = items.find((i) => i.id === coverId && i.href)?.href
  }
  // 3) 退化：id/href 里带 "cover" 的图片，或第一张图片
  if (!coverHref) {
    const imgs = items.filter((i) => i.href && i.type?.startsWith('image/'))
    coverHref =
      imgs.find((i) => /cover/i.test(i.id ?? '') || /cover/i.test(i.href ?? ''))?.href ??
      imgs[0]?.href
  }

  return { meta: { title, author }, coverHref }
}

async function epubMeta(path: string): Promise<EbookMeta> {
  const buf = await readFile(path)
  const zip = unzipSync(buf, {
    filter: (f) => f.name === 'META-INF/container.xml' || f.name.toLowerCase().endsWith('.opf')
  })
  const opfPath = findOpfPath(zip)
  if (!opfPath || !zip[opfPath]) return {}
  return parseOpf(Buffer.from(zip[opfPath]).toString('utf8')).meta
}

async function epubCover(path: string): Promise<Buffer | null> {
  const buf = await readFile(path)
  const zip = unzipSync(buf, {
    filter: (f) => f.name === 'META-INF/container.xml' || f.name.toLowerCase().endsWith('.opf')
  })
  const opfPath = findOpfPath(zip)
  if (!opfPath || !zip[opfPath]) return null
  const { coverHref } = parseOpf(Buffer.from(zip[opfPath]).toString('utf8'))
  if (!coverHref) return null
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''
  const coverPath = normalizeZipPath(baseDir, coverHref)
  const one = unzipSync(buf, { filter: (f) => f.name === coverPath })
  const bytes = one[coverPath]
  return bytes && isImageBytes(bytes) ? Buffer.from(bytes) : null
}

// ---------------- CBZ（漫画/图集，封面 = 首张图片） ----------------

async function cbzCover(path: string): Promise<Buffer | null> {
  const buf = await readFile(path)
  const names: string[] = []
  // 先只枚举条目名（filter 返回 false 不解压），再单独解压选中的首图
  unzipSync(buf, {
    filter: (f) => {
      names.push(f.name)
      return false
    }
  })
  const first = names
    .filter((n) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(n))
    .sort(naturalCmp.compare)[0]
  if (!first) return null
  const one = unzipSync(buf, { filter: (f) => f.name === first })
  const bytes = one[first]
  return bytes && isImageBytes(bytes) ? Buffer.from(bytes) : null
}

// ---------------- MOBI / AZW3（PDB + MOBI 头 + EXTH） ----------------

interface MobiParsed {
  meta: EbookMeta
  offsets: number[]
  firstImageIndex: number
  coverOffset: number | null
  thumbOffset: number | null
}

function decodeText(b: Uint8Array, encoding: number): string {
  try {
    return Buffer.from(b).toString(encoding === 1252 ? 'latin1' : 'utf8')
  } catch {
    return Buffer.from(b).toString('utf8')
  }
}

async function parseMobi(path: string, needImages: boolean): Promise<MobiParsed | null> {
  const fh = await open(path, 'r')
  try {
    const head = Buffer.alloc(78)
    await fh.read(head, 0, 78, 0)
    const numRecords = head.readUInt16BE(76)
    if (numRecords < 1 || numRecords > 100000) return null

    const table = Buffer.alloc(numRecords * 8)
    await fh.read(table, 0, table.length, 78)
    const offsets: number[] = []
    for (let i = 0; i < numRecords; i++) offsets.push(table.readUInt32BE(i * 8))

    const rec0Start = offsets[0]
    const rec0End = offsets[1] ?? rec0Start + 1024
    const rec0 = Buffer.alloc(Math.max(0, rec0End - rec0Start))
    await fh.read(rec0, 0, rec0.length, rec0Start)

    // MOBI 头从 record0 的第 16 字节开始（前 16 是 PalmDOC 头）
    const M = 16
    if (rec0.toString('ascii', M, M + 4) !== 'MOBI') return null
    const mobiHeaderLen = rec0.readUInt32BE(M + 0x04)
    const encoding = rec0.readUInt32BE(M + 0x0c)
    const fullNameOffset = rec0.readUInt32BE(M + 0x44)
    const fullNameLength = rec0.readUInt32BE(M + 0x48)
    const firstImageIndex = rec0.readUInt32BE(M + 0x5c)
    const exthFlags = rec0.readUInt32BE(M + 0x70)

    let exthTitle: string | undefined
    let author: string | undefined
    let coverOffset: number | null = null
    let thumbOffset: number | null = null

    if (exthFlags & 0x40) {
      const exthStart = M + mobiHeaderLen
      if (rec0.toString('ascii', exthStart, exthStart + 4) === 'EXTH') {
        const recCount = rec0.readUInt32BE(exthStart + 8)
        let p = exthStart + 12
        for (let k = 0; k < recCount && p + 8 <= rec0.length; k++) {
          const type = rec0.readUInt32BE(p)
          const len = rec0.readUInt32BE(p + 4)
          if (len < 8 || p + len > rec0.length) break
          const data = rec0.subarray(p + 8, p + len)
          if (type === 100 && !author) author = decodeText(data, encoding)
          else if (type === 503) exthTitle = decodeText(data, encoding)
          else if (type === 201 && data.length >= 4) coverOffset = data.readUInt32BE(0)
          else if (type === 202 && data.length >= 4) thumbOffset = data.readUInt32BE(0)
          p += len
        }
      }
    }

    let fullName: string | undefined
    if (fullNameLength > 0 && fullNameOffset + fullNameLength <= rec0.length) {
      fullName = decodeText(rec0.subarray(fullNameOffset, fullNameOffset + fullNameLength), encoding)
    }

    const parsed: MobiParsed = {
      meta: { title: clean(exthTitle) ?? clean(fullName), author: clean(author) },
      offsets,
      firstImageIndex,
      coverOffset: coverOffset === 0xffffffff ? null : coverOffset,
      thumbOffset: thumbOffset === 0xffffffff ? null : thumbOffset
    }

    if (!needImages) return parsed
    return parsed
  } finally {
    await fh.close()
  }
}

async function mobiCover(path: string): Promise<Buffer | null> {
  const parsed = await parseMobi(path, true)
  if (!parsed) return null
  const { offsets, firstImageIndex } = parsed
  if (!firstImageIndex || firstImageIndex >= offsets.length || firstImageIndex === 0xffffffff) {
    return null
  }
  const fh = await open(path, 'r')
  try {
    const tryRec = async (imgIdx: number): Promise<Buffer | null> => {
      if (imgIdx < 0 || imgIdx >= offsets.length) return null
      const start = offsets[imgIdx]
      const end = offsets[imgIdx + 1] ?? start
      const len = end - start
      if (len <= 0 || len > 40 * 1024 * 1024) return null
      const b = Buffer.alloc(len)
      await fh.read(b, 0, len, start)
      return isImageBytes(b) ? b : null
    }
    // 优先用 EXTH 指定的封面记录，其次缩略图
    for (const off of [parsed.coverOffset, parsed.thumbOffset]) {
      if (off !== null) {
        const b = await tryRec(firstImageIndex + off)
        if (b) return b
      }
    }
    // 再退化：从第一张图片记录起找到首个能识别的图片
    for (let i = firstImageIndex; i < offsets.length && i < firstImageIndex + 8; i++) {
      const b = await tryRec(i)
      if (b) return b
    }
    return null
  } finally {
    await fh.close()
  }
}

// ---------------- 对外统一入口 ----------------

/** 抽取内嵌元数据（书名/作者）。无则返回 {}。 */
export async function readEbookMeta(path: string, format: BookFormat): Promise<EbookMeta> {
  try {
    if (format === 'epub') return await epubMeta(path)
    if (format === 'mobi' || format === 'azw3') return (await parseMobi(path, false))?.meta ?? {}
  } catch {
    /* 解析失败按无元数据处理 */
  }
  return {}
}

/** 抽取内嵌封面原始图片字节（jpeg/png/gif…）。无则返回 null。 */
export async function readEbookCover(path: string, format: BookFormat): Promise<Buffer | null> {
  try {
    if (format === 'epub') return await epubCover(path)
    if (format === 'cbz') return await cbzCover(path)
    if (format === 'mobi' || format === 'azw3') return await mobiCover(path)
  } catch {
    /* ignore */
  }
  return null
}
