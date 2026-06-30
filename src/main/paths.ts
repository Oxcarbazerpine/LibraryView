import { copyFile, mkdir, rename, unlink, readdir, access } from 'node:fs/promises'
import { join } from 'node:path'

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
