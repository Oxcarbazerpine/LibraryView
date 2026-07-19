// 系列（多卷套装）：folder 为绝对路径前缀，路径在其下（含嵌套）的书都属于该系列。
// 原则：程序只检测候选、绝不自动归组；用户在设置页确认后才写入 series 表。
import { sep } from 'node:path'
import { getDb } from './db'
import { getSettings } from './settings'
import type { Series, SeriesCandidate } from '../shared/types'

export function listSeries(): Series[] {
  return getDb().prepare('SELECT id, folder, name FROM series ORDER BY name').all() as Series[]
}

export function addSeries(folder: string, name: string): Series[] {
  const f = folder.replace(/[\\/]+$/, '')
  getDb()
    .prepare('INSERT OR IGNORE INTO series (folder, name, created_at) VALUES (?, ?, ?)')
    .run(f, name.trim() || folderBase(f), Date.now())
  return listSeries()
}

export function removeSeries(id: number): Series[] {
  getDb().prepare('DELETE FROM series WHERE id = ?').run(id)
  return listSeries()
}

function folderBase(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

/** 去掉文件名里的卷号（数字/上中下/汉字数字）、空白与括号内容，得到「样式茎」——同套书的各卷通常茎相同。 */
function stem(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[\(（\[【][^\)）\]】]*[\)）\]】]/g, '')
    .replace(/[上中下]([册卷部篇])?/g, '')
    .replace(/[0-9０-９一二三四五六七八九十百]+/g, '')
    .replace(/[\s._\-—~]+/g, '')
    .toLowerCase()
}

/**
 * 文件名同构度：非空茎的种类越少越像一套书。
 * 阈值从 1 起步（2~4 本必须茎完全一致），避免任意两本无关书凑成的主题文件夹误报。
 */
function homogeneous(names: string[]): boolean {
  const stems = new Set(names.map(stem).filter((s) => s.length > 0))
  return stems.size <= Math.max(1, Math.ceil(names.length * 0.25))
}

/** 各卷文件名都以文件夹名开头（如 龙族/龙族1.txt、龙族外传.txt）。 */
function folderPrefixed(folderName: string, names: string[]): boolean {
  const f = folderName.toLowerCase().trim()
  if (f.length < 2) return false
  const n = names.filter((x) => x.toLowerCase().startsWith(f)).length
  return names.length >= 2 && n >= Math.ceil(names.length * 0.66)
}

const SERIESISH_NAME = /全集|套装|系列|部曲|合集|文集|[0-9]+\s*[-~－至]\s*[0-9]+|卷|册|season|vol/i

/** 各卷标题不同但带卷号前缀的套装（如 "1 - Harry Potter and ..."、"03 第三部"）。 */
function numberedVolumes(names: string[]): boolean {
  const n = names.filter((x) => /^\s*[0-9０-９]{1,3}\s*[-–—._·、 ]/.test(x)).length
  return names.length >= 2 && n >= Math.ceil(names.length * 0.66)
}

/**
 * 检测系列候选：
 * - 一级候选：某文件夹直接包含 ≥2 本书，且（文件名同构 或 文件夹名带套装字样）
 * - 嵌套候选：某文件夹的 ≥3 个子文件夹里都有书、且子文件夹名同构（每卷一个文件夹的结构），
 *   此时推荐它们的父文件夹并抑制各子文件夹候选
 * 已确认的系列（含其下所有层级）不再出现在候选里。库根目录本身不作候选。
 */
export function detectSeriesCandidates(): SeriesCandidate[] {
  const db = getDb()
  const paths = (
    db.prepare('SELECT path FROM books WHERE missing = 0').all() as { path: string }[]
  ).map((r) => r.path)

  const roots = getSettings().libraryPaths.map((r) => r.replace(/[\\/]+$/, '').toLowerCase())
  const confirmed = listSeries().map((s) => s.folder.toLowerCase() + sep)

  // 每本书的直接父文件夹
  const byParent = new Map<string, string[]>() // parentDir -> file basenames
  for (const p of paths) {
    const idx = p.lastIndexOf(sep)
    if (idx <= 0) continue
    const parent = p.slice(0, idx)
    const base = p.slice(idx + 1)
    const arr = byParent.get(parent)
    if (arr) arr.push(base)
    else byParent.set(parent, [base])
  }

  const isRoot = (dir: string): boolean => roots.includes(dir.toLowerCase())
  const underConfirmed = (dir: string): boolean => {
    const d = dir.toLowerCase() + sep
    return confirmed.some((c) => d.startsWith(c) || d === c)
  }
  const countBooksUnder = (dir: string): number => {
    const prefix = dir.toLowerCase() + sep
    return paths.filter((p) => p.toLowerCase().startsWith(prefix)).length
  }

  const candidates = new Map<string, SeriesCandidate>()
  const suppressed = new Set<string>()

  // 嵌套候选：按祖父目录聚合「有书的子文件夹」
  const byGrandparent = new Map<string, string[]>() // grandparent -> child folder basenames
  for (const parent of byParent.keys()) {
    const idx = parent.lastIndexOf(sep)
    if (idx <= 0) continue
    const gp = parent.slice(0, idx)
    const childName = parent.slice(idx + 1)
    if (isRoot(gp) || underConfirmed(gp)) continue
    const arr = byGrandparent.get(gp)
    if (arr) arr.push(childName)
    else byGrandparent.set(gp, [childName])
  }
  for (const [gp, children] of byGrandparent) {
    if (children.length >= 3 && homogeneous(children) && !isRoot(gp)) {
      candidates.set(gp, { folder: gp, name: folderBase(gp), bookCount: countBooksUnder(gp) })
      for (const c of children) suppressed.add(gp + sep + c)
    }
  }

  // 一级候选
  for (const [parent, names] of byParent) {
    if (isRoot(parent) || underConfirmed(parent) || suppressed.has(parent)) continue
    if (candidates.has(parent)) continue
    if (names.length < 2) continue
    const base = folderBase(parent)
    if (
      homogeneous(names) ||
      numberedVolumes(names) ||
      folderPrefixed(base, names) ||
      SERIESISH_NAME.test(base)
    ) {
      candidates.set(parent, {
        folder: parent,
        name: folderBase(parent),
        bookCount: countBooksUnder(parent)
      })
    }
  }

  return [...candidates.values()].sort((a, b) => b.bookCount - a.bookCount)
}
