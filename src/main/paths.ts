import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { copyFile, mkdir, rename, unlink, readdir, access } from 'node:fs/promises'
import { join } from 'node:path'

// 引导指针：存放“数据目录”的位置。必须独立于数据库（它决定了数据库在哪），
// 因此放在“默认 userData”里（始终可用、且卸载后仍保留），只存一个路径字符串。
let originalUserData = ''
let effectiveDataDir = ''

function bootstrapPath(): string {
  return join(originalUserData, 'config.json')
}

function readPointer(): string | null {
  try {
    const p = bootstrapPath()
    if (!existsSync(p)) return null
    const cfg = JSON.parse(readFileSync(p, 'utf-8')) as { dataDir?: string }
    return cfg.dataDir && cfg.dataDir.trim() ? cfg.dataDir : null
  } catch {
    return null
  }
}

/** 启动早期调用：读取引导指针，把 userData（含 DB/封面/Electron 缓存）重定向到自定义数据目录。 */
export function applyDataDir(): void {
  originalUserData = app.getPath('userData')
  const dir = readPointer()
  if (dir) {
    try {
      mkdirSync(dir, { recursive: true })
      app.setPath('userData', dir)
    } catch (e) {
      console.error('[paths] 重定向数据目录失败，回退默认:', e)
    }
  }
  effectiveDataDir = app.getPath('userData')
  console.log('[paths] 数据目录 =', effectiveDataDir)
}

export function getDataDir(): string {
  return effectiveDataDir || app.getPath('userData')
}

/** 写引导指针（始终写到默认 userData，而非重定向后的目录）。null=恢复默认。 */
export function writeDataDirPointer(dir: string | null): void {
  mkdirSync(originalUserData, { recursive: true })
  writeFileSync(bootstrapPath(), JSON.stringify({ dataDir: dir }, null, 2))
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

async function moveOne(src: string, dst: string): Promise<void> {
  if (!(await exists(src))) return
  try {
    await rename(src, dst) // 同卷直接重命名
  } catch {
    await copyFile(src, dst) // 跨卷回退
    await unlink(src)
  }
}

/** 把数据库三件套 + 封面目录从 oldDir 迁移到 newDir（跨卷安全）。 */
export async function migrateDataDir(
  oldDir: string,
  newDir: string
): Promise<{ db: boolean; covers: number }> {
  await mkdir(newDir, { recursive: true })

  let db = false
  for (const name of ['libraryview.db', 'libraryview.db-wal', 'libraryview.db-shm']) {
    const src = join(oldDir, name)
    if (await exists(src)) {
      await moveOne(src, join(newDir, name))
      if (name === 'libraryview.db') db = true
    }
  }

  let covers = 0
  const oldCovers = join(oldDir, 'covers')
  if (await exists(oldCovers)) {
    const newCovers = join(newDir, 'covers')
    await mkdir(newCovers, { recursive: true })
    for (const f of await readdir(oldCovers)) {
      await moveOne(join(oldCovers, f), join(newCovers, f))
      covers++
    }
  }

  return { db, covers }
}
