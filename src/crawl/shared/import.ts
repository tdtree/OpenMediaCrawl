import { mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Comment, Item, User } from '../../core/schemas.js'
import { CRAWL_PLATFORMS } from '../config.js'
import type { ContentStore } from './types.js'

/**
 * 把旧的「按用户落盘」数据导入共享库。
 *
 * 约定和 records.ts 一致：带 `item_id` 且没有 `kind` 的是评论，带 `kind` 的是作品，
 * 剩下的（有 handle / followers）当博主。默认只统计不写入；--apply 才落库，--prune-legacy 才搬走原文件。
 * 幂等：重复跑不会多出数据，引用只更新 last_at。
 */

export interface ImportOptions {
  apply?: boolean
  pruneLegacy?: boolean
  users?: string[]
  platforms?: string[]
}

export interface ImportReport {
  users: number
  files: number
  items: number
  comments: number
  creators: number
  refs: number
  skipped: number
  pruned: string[]
  applied: boolean
}

interface Batch {
  items: Map<string, { platform: string; item: Item; at: number; user: string; source: string }>
  comments: Map<string, Comment[]>
  creators: Map<string, { platform: string; creator: User; at: number }>
  skipped: number
  files: number
}

const itemKey = (platform: string, id: string): string => `${platform}\u0000${id}`

function isComment(value: Record<string, unknown>): boolean {
  return typeof value.item_id === 'string' && value.kind === undefined
}

function isItem(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string' && typeof value.kind === 'string'
}

function isCreator(value: Record<string, unknown>): boolean {
  const stats = value.stats as { followers?: unknown } | undefined
  return typeof value.id === 'string' && (typeof value.handle === 'string' || stats?.followers !== undefined)
}

async function collectJsonLines(file: string, platform: string, user: string, batch: Batch): Promise<void> {
  const text = await readFile(file, 'utf8').catch(() => '')
  const at = (await stat(file).catch(() => null))?.mtimeMs ?? Date.now()
  const trimmed = text.trim()
  const rows: unknown[] = trimmed.startsWith('[')
    ? (() => { try { return JSON.parse(trimmed) as unknown[] } catch { return [] } })()
    : trimmed.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line) as unknown] } catch { return [] }
    })
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const value = raw as Record<string, unknown>
    if (isComment(value)) {
      const comment = value as unknown as Comment
      const key = itemKey(platform, String(comment.item_id))
      const list = batch.comments.get(key) ?? []
      if (!list.some((one) => String(one.id) === String(comment.id))) list.push(comment)
      batch.comments.set(key, list)
    } else if (isItem(value)) {
      const item = value as unknown as Item
      batch.items.set(itemKey(platform, String(item.id)), { platform, item, at, user, source: file })
    } else if (isCreator(value)) {
      const creator = value as unknown as User
      batch.creators.set(itemKey(platform, String(creator.id)), { platform, creator, at })
    } else {
      batch.skipped += 1
    }
  }
}

async function collectSqlite(file: string, platform: string, user: string, batch: Batch): Promise<void> {
  const db = new DatabaseSync(file, { readOnly: true })
  const at = (await stat(file).catch(() => null))?.mtimeMs ?? Date.now()
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    const names = new Set(tables.map((row) => row.name))
    if (names.has('items')) {
      for (const row of db.prepare('SELECT id, data FROM items').all() as Array<{ id: string; data: string }>) {
        const item = JSON.parse(row.data) as Item
        batch.items.set(itemKey(platform, String(item.id)), { platform, item, at, user, source: file })
      }
    }
    if (names.has('comments')) {
      for (const row of db.prepare('SELECT id, data FROM comments').all() as Array<{ id: string; data: string }>) {
        const comment = JSON.parse(row.data) as Comment
        const key = itemKey(platform, String(comment.item_id))
        const list = batch.comments.get(key) ?? []
        if (!list.some((one) => String(one.id) === String(comment.id))) list.push(comment)
        batch.comments.set(key, list)
      }
    }
    if (names.has('creators')) {
      for (const row of db.prepare('SELECT id, data FROM creators').all() as Array<{ id: string; data: string }>) {
        const creator = JSON.parse(row.data) as User
        batch.creators.set(itemKey(platform, String(creator.id)), { platform, creator, at })
      }
    }
  } finally { db.close() }
}

function platformOf(name: string, wanted?: string[]): string | null {
  if (!CRAWL_PLATFORMS.includes(name as never)) return null
  if (wanted && wanted.length && !wanted.includes(name)) return null
  return name
}

export async function importLegacy(root: string, store: ContentStore, options: ImportOptions = {}): Promise<ImportReport> {
  const apply = options.apply === true
  const report: ImportReport = { users: 0, files: 0, items: 0, comments: 0, creators: 0, refs: 0, skipped: 0, pruned: [], applied: apply }
  const userDirs = await readdir(join(root, 'users'), { withFileTypes: true }).catch(() => [])
  for (const entry of userDirs) {
    if (!entry.isDirectory()) continue
    const user = entry.name
    if (options.users && options.users.length && !options.users.includes(user)) continue
    report.users += 1
    const userRoot = join(root, 'users', user)
    const batch: Batch = { items: new Map(), comments: new Map(), creators: new Map(), skipped: 0, files: 0 }
    const imported: string[] = []
    for (const platformDir of await readdir(userRoot, { withFileTypes: true }).catch(() => [])) {
      if (!platformDir.isDirectory() || platformDir.name.startsWith('.')) continue
      const platform = platformOf(platformDir.name, options.platforms)
      if (!platform) continue
      const dir = join(userRoot, platformDir.name)
      for (const name of await readdir(dir).catch(() => [] as string[])) {
        const file = join(dir, name)
        if (/\.jsonl$|\.json$/i.test(name)) await collectJsonLines(file, platform, user, batch)
        else if (/\.sqlite$/i.test(name)) await collectSqlite(file, platform, user, batch)
        else continue
        batch.files += 1
        imported.push(file)
      }
    }
    report.files += batch.files
    report.skipped += batch.skipped

    // 先把作品写进去：评论和引用都挂在作品 id 上。
    for (const { platform, item, at, user: owner, source } of batch.items.values()) {
      if (!apply) { report.items += 1; continue }
      store.putItem(platform, item, { body: 'full', fetchedAt: at, user: owner })
      // 旧数据没有「谁查了什么词」：jobId 记来源文件，keyword 留空。
      store.addRef(owner, platform, String(item.id), { jobId: `import:${source}`, at })
      report.items += 1
      report.refs += 1
    }
    for (const { platform, creator, at } of batch.creators.values()) {
      if (apply) store.putCreator(platform, creator, at)
      report.creators += 1
    }
    for (const [key, list] of batch.comments) {
      const [platform, itemId] = key.split('\u0000')
      if (!platform || !itemId) continue
      if (apply) {
        // limit=0 + complete=false：导入的评论不声称「全量」，需要更多评论的任务仍会去抓。
        store.putComments(platform, itemId, list, { limit: 0, complete: false })
      }
      report.comments += list.length
    }

    if (apply && options.pruneLegacy && imported.length) {
      const legacyDir = join(userRoot, '.legacy')
      for (const file of imported) {
        // 保留 <平台>/<文件名> 结构，别让同名日期文件互相覆盖。
        const target = join(legacyDir, relative(userRoot, file))
        try {
          await mkdir(dirname(target), { recursive: true })
          await rename(file, target)
          report.pruned.push(file)
        } catch { /* 搬不动就留着，不影响导入结果 */ }
      }
    }
  }
  return report
}
