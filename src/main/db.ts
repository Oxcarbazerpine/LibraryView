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

function migrate(d: Database.Database): void {
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
