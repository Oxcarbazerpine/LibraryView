import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { getDataDir } from './settings'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export function initDb(): Database.Database {
  const dbPath = process.env.LV_DB_PATH || join(getDataDir(), 'libraryview.db')
  mkdirSync(dirname(dbPath), { recursive: true })
  const instance = new Database(dbPath)
  instance.pragma('journal_mode = WAL')
  instance.pragma('foreign_keys = ON')
  migrate(instance)
  db = instance
  const { v } = instance.prepare('SELECT sqlite_version() AS v').get() as { v: string }
  console.log(`[db] sqlite v${v} @ ${dbPath}`)
  return instance
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * 基线 schema（v0）——已冻结，请勿再改。
 * 任何后续变更都通过下面的 MIGRATIONS 增量步骤进行（ALTER/新表/新索引），
 * 这样已存在的用户库和全新库都能一致地演进到最新版本。
 */
function baseline(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      path                  TEXT NOT NULL UNIQUE,
      title                 TEXT NOT NULL,
      author                TEXT,
      format                TEXT NOT NULL,
      page_count            INTEGER,
      current_page          INTEGER NOT NULL DEFAULT 0,
      progress              REAL NOT NULL DEFAULT 0,
      cover_path            TEXT,
      file_size             INTEGER NOT NULL DEFAULT 0,
      file_mtime            INTEGER NOT NULL DEFAULT 0,
      status                TEXT NOT NULL DEFAULT 'unread',
      total_reading_seconds INTEGER NOT NULL DEFAULT 0,
      last_read_at          INTEGER,
      added_at              INTEGER NOT NULL,
      updated_at            INTEGER NOT NULL,
      missing               INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_books_status     ON books(status);
    CREATE INDEX IF NOT EXISTS idx_books_last_read  ON books(last_read_at);

    CREATE TABLE IF NOT EXISTS reading_sessions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id          INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      started_at       INTEGER NOT NULL,
      ended_at         INTEGER,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      start_page       INTEGER,
      end_page         INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_book    ON reading_sessions(book_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_started ON reading_sessions(started_at);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

/**
 * 增量迁移步骤。索引 i 表示「从版本 i 升到 i+1」要执行的操作。
 * 每一步都在事务中执行并原子地推进 user_version。新增列一律用 ADD COLUMN。
 */
const MIGRATIONS: ((d: Database.Database) => void)[] = [
  // v0 -> v1：记录 epub/mobi/azw3 等的内嵌元数据是否已抽取过，避免每次扫描重复解析。
  (d) => {
    d.exec('ALTER TABLE books ADD COLUMN meta_extracted INTEGER NOT NULL DEFAULT 0')
  },
  // v1 -> v2：记录会话开始前书的状态。用于「试读」：开读前是未读、读了不到
  // 试读阈值就结束 → 自动回退为未读（落库以便应用重启后收尾悬挂会话时也能回退）。
  (d) => {
    d.exec('ALTER TABLE reading_sessions ADD COLUMN prev_status TEXT')
  }
]

function migrate(d: Database.Database): void {
  baseline(d)
  let v = d.pragma('user_version', { simple: true }) as number
  for (; v < MIGRATIONS.length; v++) {
    const step = MIGRATIONS[v]
    const tx = d.transaction(() => {
      step(d)
      d.pragma(`user_version = ${v + 1}`)
    })
    tx()
    console.log(`[db] 迁移至 v${v + 1}`)
  }
}
