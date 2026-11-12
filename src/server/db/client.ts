import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator'
import * as schema from './schema'

/**
 * SQLite via Node's built-in `node:sqlite` (no native addon to compile, so
 * `npm install` can't fail on it). Drizzle 0.45 has no first-party node:sqlite
 * driver yet, so we use its official `sqlite-proxy` driver and run the SQL
 * ourselves: ~15 lines, fully typed queries on top.
 */

const DB_PATH = resolve(process.env.DATABASE_PATH ?? 'data/chat.db')
const MIGRATIONS = resolve('drizzle')

function open(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const sqlite = new DatabaseSync(path)
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

  const db = drizzle(
    async (sql, params, method) => {
      const stmt = sqlite.prepare(sql)
      const args = params as SQLInputValue[]
      if (method === 'run') {
        stmt.run(...args)
        return { rows: [] }
      }
      // Drizzle's proxy driver expects rows as arrays of column values.
      stmt.setReturnArrays(true)
      if (method === 'get') {
        const row = stmt.get(...args)
        return { rows: (row ?? undefined) as any }
      }
      return { rows: stmt.all(...args) as any[] }
    },
    { schema },
  )

  return { sqlite, db }
}

type Handle = ReturnType<typeof open> & { ready: Promise<void> }

function init(path: string): Handle {
  const handle = open(path)
  const ready = migrate(
    handle.db,
    async (queries) => {
      handle.sqlite.exec('BEGIN')
      try {
        for (const q of queries) handle.sqlite.exec(q)
        handle.sqlite.exec('COMMIT')
      } catch (err) {
        handle.sqlite.exec('ROLLBACK')
        throw err
      }
    },
    { migrationsFolder: MIGRATIONS },
  )
  return { ...handle, ready }
}

// One connection per process; survive Vite dev-server module reloads.
const g = globalThis as typeof globalThis & { __chatDb?: Handle }

export function getDb(): Handle {
  g.__chatDb ??= recoverInterrupted(init(DB_PATH))
  return g.__chatDb
}

/**
 * Runs once per process, when the database is first opened. Any answer still
 * marked `streaming` belongs to a turn that died with the previous process
 * (crash or restart); mark it so the UI can say so instead of showing a
 * half-written answer as if it were complete.
 */
export function recoverInterrupted(handle: Handle): Handle {
  const ready = handle.ready.then(() => {
    handle.sqlite.exec("UPDATE messages SET status = 'interrupted' WHERE status = 'streaming'")
  })
  return { ...handle, ready }
}

/** Fresh in-memory database, for tests and evals. */
export function createTestDb(): Handle {
  return init(':memory:')
}

export type DB = Handle['db']
export { schema }
