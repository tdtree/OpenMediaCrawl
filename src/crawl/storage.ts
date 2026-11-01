import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { SaveFormat } from './types.js'

export interface StoredRecord {
  platform: string
  kind: 'item' | 'comment' | 'creator'
  id: string
  data: unknown
}

export interface StorageWriter {
  write(record: StoredRecord): Promise<void>
  close(): Promise<void>
  files(): string[]
}

const datePart = () => new Date().toISOString().slice(0, 10)

function csvEscape(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** RFC 4180 parser: quoted fields may contain commas, quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const CSV_COLUMNS = ['platform', 'kind', 'id', 'title', 'text', 'author', 'created_at', 'likes', 'comments', 'collects', 'shares', 'url', 'data'] as const

/** Human-readable columns for Excel, plus the full record as JSON in `data`. */
function csvRow(record: StoredRecord): string[] {
  const d = (record.data ?? {}) as Record<string, any>
  const stats = (d.stats ?? {}) as Record<string, unknown>
  const author = d.author?.name ?? d.name ?? ''
  const str = (v: unknown) => (v == null ? '' : String(v))
  return [record.platform, record.kind, record.id, str(d.title), str(d.text ?? d.bio), str(author), str(d.created_at), str(stats.likes), str(stats.comments ?? stats.replies), str(stats.collects), str(stats.shares), str(d.url), JSON.stringify(record.data)]
}

class FileStorage implements StorageWriter {
  private readonly paths = new Map<string, string>()
  constructor(private readonly format: Exclude<SaveFormat, 'sqlite'>, private readonly root: string, private readonly platform: string, private readonly type: string) {}

  private pathFor(kind: StoredRecord['kind']): string {
    const current = this.paths.get(kind)
    if (current) return current
    const extension = this.format
    const path = join(this.root, this.platform, `${this.type}_${kind}_${datePart()}.${extension}`)
    this.paths.set(kind, path)
    return path
  }

  async write(record: StoredRecord): Promise<void> {
    const path = this.pathFor(record.kind)
    await mkdir(dirname(path), { recursive: true })
    if (this.format === 'jsonl') {
      await appendFile(path, `${JSON.stringify(record.data)}\n`, 'utf8')
      return
    }
    if (this.format === 'csv') {
      try { await readFile(path) } catch { await writeFile(path, `\ufeff${CSV_COLUMNS.join(',')}\r\n`, 'utf8') }
      await appendFile(path, csvRow(record).map(csvEscape).join(',') + '\r\n', 'utf8')
      return
    }
    let values: unknown[] = []
    try {
      const raw = await readFile(path, 'utf8')
      values = JSON.parse(raw) as unknown[]
      if (!Array.isArray(values)) values = []
    } catch {}
    const index = values.findIndex((v) => typeof v === 'object' && v !== null && (v as { id?: string }).id === record.id)
    if (index >= 0) values[index] = record.data
    else values.push(record.data)
    await writeFile(path, JSON.stringify(values, null, 2) + '\n', 'utf8')
  }

  async close(): Promise<void> {}
  files(): string[] { return [...this.paths.values()] }
}

class SqliteStorage implements StorageWriter {
  private readonly paths: string[]
  private readonly db: any
  constructor(private readonly root: string, private readonly platform: string, private readonly type: string) {
    const require = createRequire(import.meta.url)
    const sqlite = require('node:sqlite') as { DatabaseSync: new (path: string) => any }
    const path = join(root, platform, `${type}_${datePart()}.sqlite`)
    this.paths = [path]
    this.db = new sqlite.DatabaseSync(path)
    this.db.exec('CREATE TABLE IF NOT EXISTS items (platform TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(platform,id)); CREATE TABLE IF NOT EXISTS comments (platform TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(platform,id)); CREATE TABLE IF NOT EXISTS creators (platform TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(platform,id));')
  }
  async write(record: StoredRecord): Promise<void> {
    const table = record.kind === 'creator' ? 'creators' : `${record.kind}s`
    this.db.prepare(`INSERT INTO ${table}(platform,id,data) VALUES(?,?,?) ON CONFLICT(platform,id) DO UPDATE SET data=excluded.data`).run(record.platform, record.id, JSON.stringify(record.data))
  }
  async close(): Promise<void> { this.db.close() }
  files(): string[] { return this.paths }
}

export async function createStorage(format: SaveFormat, out: string, platform: string, type: string): Promise<StorageWriter> {
  await mkdir(join(out, platform), { recursive: true })
  if (format === 'sqlite') return new SqliteStorage(out, platform, type)
  return new FileStorage(format, out, platform, type)
}

export async function readStoredRecords(path: string): Promise<StoredRecord[]> {
  const raw = await readFile(path, 'utf8')
  if (path.endsWith('.jsonl')) return raw.split(/\r?\n/).filter(Boolean).map((line) => ({ platform: '', kind: 'item', id: String((JSON.parse(line) as { id?: string }).id ?? ''), data: JSON.parse(line) }))
  if (path.endsWith('.csv')) {
    const [header = [], ...rows] = parseCsv(raw.replace(/^\ufeff/, ''))
    const col = (name: string) => header.indexOf(name)
    return rows.map((r) => ({ platform: r[col('platform')] ?? '', kind: (r[col('kind')] ?? 'item') as StoredRecord['kind'], id: r[col('id')] ?? '', data: JSON.parse(r[col('data')] ?? 'null') as unknown }))
  }
  const data = JSON.parse(raw) as unknown[]
  return data.map((value) => ({ platform: '', kind: 'item', id: String((value as { id?: string }).id ?? ''), data: value }))
}
