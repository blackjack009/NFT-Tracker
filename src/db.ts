import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'

export interface JobRow {
  id: number
  chain_id: number
  token: string
  token_id: string
  minter: string
  price_wei: string
  status: 'pending' | 'executing' | 'bridging' | 'minting' | 'done' | 'failed' | 'skipped' | 'expired'
  mode: string
  context: string
  result: string
  created_at: number
  updated_at: number
}

export interface WalletEntry {
  address: string
  label: string
  chains: string[]
}

class Store {
  private db: Database.Database

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.db = new Database(join(dir, 'bot.db'))
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS seen_mints (
        chain_id INTEGER NOT NULL,
        tx_hash TEXT NOT NULL,
        token TEXT NOT NULL,
        token_id TEXT NOT NULL,
        minter TEXT NOT NULL,
        ts INTEGER NOT NULL,
        PRIMARY KEY (chain_id, tx_hash, token, token_id)
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chain_id INTEGER NOT NULL,
        token TEXT NOT NULL,
        token_id TEXT NOT NULL,
        minter TEXT NOT NULL,
        price_wei TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        mode TEXT NOT NULL DEFAULT '',
        context TEXT NOT NULL DEFAULT '{}',
        result TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
    try {
      this.db.exec(`ALTER TABLE jobs ADD COLUMN spend_wei TEXT NOT NULL DEFAULT ''`)
    } catch {
      // column already exists
    }
  }

  recentJobs(limit: number): JobRow[] {
    return this.db
      .prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT ?')
      .all(limit) as JobRow[]
  }

  /** Total spend 24 jam terakhir (job done), dihitung BigInt di JS biar presisi. */
  dailySpendWei(): bigint {
    const rows = this.db
      .prepare(`SELECT spend_wei FROM jobs WHERE status='done' AND updated_at > ?`)
      .all(Date.now() - 24 * 3600 * 1000) as Array<{ spend_wei: string }>
    let sum = 0n
    for (const r of rows) {
      if (r.spend_wei && /^\d+$/.test(r.spend_wei)) sum += BigInt(r.spend_wei)
    }
    return sum
  }

  markSpend(id: number, spendWei: bigint): void {
    this.db
      .prepare('UPDATE jobs SET spend_wei=? WHERE id=?')
      .run(spendWei.toString(), id)
  }

  isSeen(chainId: number, txHash: string, token: string, tokenId: string): boolean {
    return !!this.db
      .prepare('SELECT 1 FROM seen_mints WHERE chain_id=? AND tx_hash=? AND token=? AND token_id=?')
      .get(chainId, txHash.toLowerCase(), token.toLowerCase(), tokenId)
  }

  seeMint(chainId: number, txHash: string, token: string, tokenId: string, minter: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO seen_mints (chain_id, tx_hash, token, token_id, minter, ts) VALUES (?,?,?,?,?,?)')
      .run(chainId, txHash.toLowerCase(), token.toLowerCase(), tokenId, minter.toLowerCase(), Date.now())
  }

  countRecentMints(chainId: number, token: string, windowMs: number): number {
    const row = this.db
      .prepare('SELECT COUNT(DISTINCT tx_hash) AS n FROM seen_mints WHERE chain_id=? AND token=? AND ts>?')
      .get(chainId, token.toLowerCase(), Date.now() - windowMs) as { n: number }
    return row?.n ?? 0
  }

  /** [minter, jumlah mint] untuk satu koleksi dalam window — buat list cluster di alert. */
  recentMinters(chainId: number, token: string, windowMs: number): Array<[string, number]> {
    const rows = this.db
      .prepare(
        'SELECT minter, COUNT(DISTINCT tx_hash) AS n FROM seen_mints WHERE chain_id=? AND token=? AND ts>? GROUP BY minter ORDER BY n DESC LIMIT 8',
      )
      .all(chainId, token.toLowerCase(), Date.now() - windowMs) as Array<{ minter: string; n: number }>
    return rows.map((r) => [r.minter, r.n] as [string, number])
  }

  createJob(input: {
    chainId: number
    token: string
    tokenId: string
    minter: string
    priceWei: string
    mode: string
    context: string
  }): number {
    const now = Date.now()
    const res = this.db
      .prepare(`INSERT INTO jobs (chain_id, token, token_id, minter, price_wei, status, mode, context, created_at, updated_at)
                VALUES (?,?,?,?,?,'pending',?,?,?,?)`)
      .run(input.chainId, input.token.toLowerCase(), input.tokenId, input.minter.toLowerCase(), input.priceWei, input.mode, input.context, now, now)
    return Number(res.lastInsertRowid)
  }

  getJob(id: number): JobRow | undefined {
    return this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRow | undefined
  }

  updateJob(id: number, status: JobRow['status'], result?: string, mode?: string): void {
    const job = this.getJob(id)
    if (!job) return
    this.db
      .prepare('UPDATE jobs SET status=?, result=?, mode=?, updated_at=? WHERE id=?')
      .run(status, result ?? job.result, mode ?? job.mode, Date.now(), id)
  }

  getSetting(key: string, def: string): string {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
    return row?.value ?? def
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, value)
  }
}

export const db = new Store(config.dataDir)
