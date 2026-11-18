import { createHash } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { Comment, Item, Media, User } from '../../core/schemas.js'
import { sha256Hex } from '../../core/hash.js'
import { DB_FILE, openDatabase } from './db.js'
import type {
  BlobRef, CommentsState, ContentStore, FetchLogEntry, GcPlan, ItemBody, MediaRow,
  PutItemOptions, RefRow, RefKeywordRow, SharedItem, StoreUsage, CommentRecord,
} from './types.js'

const itemRow = (raw: Record<string, unknown>): SharedItem => ({
  platform: String(raw.platform),
  id: String(raw.id),
  data: JSON.parse(String(raw.data)) as Item,
  body: (raw.body === 'full' ? 'full' : 'summary') as ItemBody,
  fetchedAt: Number(raw.fetched_at),
  seenAt: Number(raw.seen_at),
  sourceUser: raw.source_user == null ? null : String(raw.source_user),
  sourceAccount: raw.source_account == null ? null : String(raw.source_account),
})

const commentRow = (raw: Record<string, unknown>): Comment => JSON.parse(String(raw.data)) as Comment

const mediaRow = (raw: Record<string, unknown>): MediaRow => ({
  seq: Number(raw.seq),
  kind: String(raw.kind) as Media['type'],
  url: raw.url == null ? null : String(raw.url),
  sha256: raw.sha256 == null ? null : String(raw.sha256),
  bytes: raw.bytes == null ? null : Number(raw.bytes),
  mime: raw.mime == null ? null : String(raw.mime),
})

const refRow = (raw: Record<string, unknown>): RefRow => ({
  platform: String(raw.platform),
  itemId: String(raw.item_id),
  user: String(raw.user),
  firstAt: Number(raw.first_at),
  lastAt: Number(raw.last_at),
  jobId: raw.job_id == null ? null : String(raw.job_id),
  keyword: raw.keyword == null ? null : String(raw.keyword),
  account: raw.account == null ? null : String(raw.account),
})

/** 只保留小写字母数字的扩展名，避免把奇怪的文件名带进 blob 路径。 */
function safeExt(value: string | null | undefined): string | null {
  const ext = String(value ?? '').replace(/^\./, '').toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : null
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/**
 * 共享内容库。
 *
 * 所有写操作都包在事务里（批量导入 900 条评论时，逐条提交会慢一个数量级）。
 * 内容写入会推进 meta.version，UI 的 loadIndex 用它做缓存失效。
 */
class Store implements ContentStore {
  readonly dbPath: string
  private readonly db: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()

  constructor(readonly dir: string) {
    this.dbPath = join(dir, DB_FILE)
    this.db = openDatabase(dir)
    // 顺手清掉 180 天前的请求日志：它只用于统计「省了多少请求」。
    this.db.prepare('DELETE FROM fetch_log WHERE at < ?').run(Date.now() - 180 * 24 * 3600 * 1000)
  }


  private statement(sql: string): StatementSync {
    const cached = this.statements.get(sql)
    if (cached) return cached
    const prepared = this.db.prepare(sql)
    this.statements.set(sql, prepared)
    return prepared
  }

  private bump(): void {
    this.statement("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'version'").run()
  }

  private tx<T>(work: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  version(): number {
    const row = this.statement("SELECT value FROM meta WHERE key = 'version'").get() as Record<string, unknown> | undefined
    return row ? Number(row.value) : 0
  }

  close(): void {
    this.statements.clear()
    this.db.close()
  }

  // ------------------------------------------------------------------ 作品

  getItem(platform: string, id: string): SharedItem | null {
    const row = this.statement('SELECT * FROM items WHERE platform = ? AND id = ?').get(platform, id) as Record<string, unknown> | undefined
    return row ? itemRow(row) : null
  }

  listItems(platform: string, ids: string[]): SharedItem[] {
    if (!ids.length) return []
    const out: SharedItem[] = []
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400)
      const placeholders = chunk.map(() => '?').join(',')
      const rows = this.statement(`SELECT * FROM items WHERE platform = ? AND id IN (${placeholders})`).all(platform, ...chunk) as Array<Record<string, unknown>>
      out.push(...rows.map(itemRow))
    }
    return out
  }

  putItem(platform: string, data: Item, options: PutItemOptions): void {
    const text = JSON.stringify(data)
    const at = options.fetchedAt ?? Date.now()
    this.statement(`
      INSERT INTO items(platform, id, data, body, hash, fetched_at, seen_at, source_user, source_account)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, id) DO UPDATE SET
        data = excluded.data,
        body = excluded.body,
        hash = excluded.hash,
        fetched_at = excluded.fetched_at,
        seen_at = excluded.seen_at,
        source_user = COALESCE(excluded.source_user, items.source_user),
        source_account = COALESCE(excluded.source_account, items.source_account)
    `).run(platform, String(data.id), text, options.body, sha256Hex(text), at, Date.now(), options.user ?? null, options.account ?? null)
    this.bump()
  }

  touchItem(platform: string, id: string, seed: Item, at = Date.now()): void {
    const existing = this.getItem(platform, id)
    if (!existing) return
    const next: Item = {
      ...existing.data,
      // 搜索页给的字段是新鲜的，但可能缺一半：只在非空时覆盖，别拿 null 把正文冲掉。
      url: seed.url ?? existing.data.url,
      title: seed.title ?? existing.data.title,
      cover: seed.cover ?? existing.data.cover,
      stats: {
        views: seed.stats?.views ?? existing.data.stats.views,
        likes: seed.stats?.likes ?? existing.data.stats.likes,
        comments: seed.stats?.comments ?? existing.data.stats.comments,
        collects: seed.stats?.collects ?? existing.data.stats.collects,
        shares: seed.stats?.shares ?? existing.data.stats.shares,
      },
      media: existing.data.media.length ? existing.data.media : (seed.media ?? []),
    }
    const text = JSON.stringify(next)
    if (text === JSON.stringify(existing.data)) {
      this.statement('UPDATE items SET seen_at = ? WHERE platform = ? AND id = ?').run(at, platform, id)
      return
    }
    this.statement('UPDATE items SET data = ?, hash = ?, seen_at = ? WHERE platform = ? AND id = ?')
      .run(text, sha256Hex(text), at, platform, id)
    this.bump()
  }

  // ------------------------------------------------------------------ 评论

  getCommentsState(platform: string, itemId: string): CommentsState | null {
    const row = this.statement('SELECT * FROM comments_state WHERE platform = ? AND item_id = ?').get(platform, itemId) as Record<string, unknown> | undefined
    if (!row) return null
    return { fetchedAt: Number(row.fetched_at), limit: Number(row.lim), complete: Number(row.complete) === 1, withReplies: Number(row.with_replies) === 1 }
  }

  listComments(platform: string, itemId: string, limit?: number): CommentRecord[] {
    const sql = limit && limit > 0
      ? 'SELECT data, first_seen_at FROM comments WHERE platform = ? AND item_id = ? ORDER BY rowid LIMIT ?'
      : 'SELECT data, first_seen_at FROM comments WHERE platform = ? AND item_id = ? ORDER BY rowid'
    const rows = (limit && limit > 0
      ? this.statement(sql).all(platform, itemId, limit)
      : this.statement(sql).all(platform, itemId)) as Array<Record<string, unknown>>
    return rows.map((row) => ({ ...commentRow(row), first_seen_at: Number(row.first_seen_at) }))
  }

  commentCount(platform: string, itemId: string): number {
    const row = this.statement('SELECT COUNT(*) AS n FROM comments WHERE platform = ? AND item_id = ?').get(platform, itemId) as Record<string, unknown> | undefined
    return row ? Number(row.n) : 0
  }

  newCommentCount(platform: string, itemId: string, since: number): number {
    const row = this.statement('SELECT COUNT(*) AS n FROM comments WHERE platform = ? AND item_id = ? AND first_seen_at >= ?').get(platform, itemId, since) as Record<string, unknown> | undefined
    return row ? Number(row.n) : 0
  }

  recentCommentCounts(platform: string, since: number): Map<string, number> {
    const rows = this.statement('SELECT item_id, COUNT(*) AS n FROM comments WHERE platform = ? AND first_seen_at >= ? GROUP BY item_id').all(platform, since) as Array<Record<string, unknown>>
    return new Map(rows.map((row) => [String(row.item_id), Number(row.n)]))
  }

  putComments(platform: string, itemId: string, comments: Comment[], state: { limit: number; complete: boolean; withReplies?: boolean }, at = Date.now()): { added: number; total: number } {
    if (!comments.length && !state.complete) return { added: 0, total: this.commentCount(platform, itemId) }
    return this.tx(() => {
      const before = this.commentCount(platform, itemId)
      const upsert = this.statement(`
        INSERT INTO comments(platform, item_id, id, data, fetched_at, first_seen_at) VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, item_id, id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at
      `)
      for (const comment of comments) upsert.run(platform, itemId, String(comment.id), JSON.stringify(comment), at, at)
      const previous = this.getCommentsState(platform, itemId)
      const limit = state.complete || previous?.limit === 0 ? 0 : Math.max(state.limit, previous?.limit ?? 0)
      const complete = state.complete || previous?.complete === true
      const withReplies = state.withReplies === true || previous?.withReplies === true
      this.statement(`
        INSERT INTO comments_state(platform, item_id, fetched_at, lim, complete, with_replies) VALUES(?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, item_id) DO UPDATE SET fetched_at = excluded.fetched_at, lim = excluded.lim, complete = excluded.complete, with_replies = excluded.with_replies
      `).run(platform, itemId, at, limit, complete ? 1 : 0, withReplies ? 1 : 0)
      this.bump()
      // 同一事务里前后差就是真正新增的条数（ON CONFLICT 的更新不计）。
      return { added: this.commentCount(platform, itemId) - before, total: this.commentCount(platform, itemId) }
    })
  }

  // ------------------------------------------------------------------ 博主

  getCreator(platform: string, id: string): User | null {
    const row = this.statement('SELECT data FROM creators WHERE platform = ? AND id = ?').get(platform, id) as Record<string, unknown> | undefined
    return row ? JSON.parse(String(row.data)) as User : null
  }

  putCreator(platform: string, data: User, at = Date.now()): void {
    this.statement(`
      INSERT INTO creators(platform, id, data, fetched_at) VALUES(?, ?, ?, ?)
      ON CONFLICT(platform, id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at
    `).run(platform, String(data.id), JSON.stringify(data), at)
    this.bump()
  }

  // ------------------------------------------------------------------ 媒体

  mediaRows(platform: string, itemId: string): MediaRow[] {
    const rows = this.statement('SELECT * FROM item_media WHERE platform = ? AND item_id = ? ORDER BY seq').all(platform, itemId) as Array<Record<string, unknown>>
    return rows.map(mediaRow)
  }

  putMediaRows(platform: string, itemId: string, media: Media[]): MediaRow[] {
    this.tx(() => {
      const existing = new Map(this.mediaRows(platform, itemId).map((row) => [row.seq, row]))
      const keep = new Set<number>()
      media.forEach((entry, index) => {
        const seq = index + 1
        keep.add(seq)
        const old = existing.get(seq)
        this.statement(`
          INSERT INTO item_media(platform, item_id, seq, kind, url, sha256, bytes, mime) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(platform, item_id, seq) DO UPDATE SET
            kind = excluded.kind, url = excluded.url,
            sha256 = COALESCE(item_media.sha256, excluded.sha256),
            bytes = COALESCE(item_media.bytes, excluded.bytes),
            mime = COALESCE(item_media.mime, excluded.mime)
        `).run(platform, itemId, seq, entry.type, entry.url ?? null, old?.sha256 ?? null, old?.bytes ?? null, old?.mime ?? null)
      })
      for (const seq of existing.keys()) {
        if (!keep.has(seq)) this.statement('DELETE FROM item_media WHERE platform = ? AND item_id = ? AND seq = ?').run(platform, itemId, seq)
      }
    })
    return this.mediaRows(platform, itemId)
  }

  completeMedia(platform: string, itemId: string, seq: number, blob: { sha256: string; bytes: number; mime: string | null }): void {
    this.statement('UPDATE item_media SET sha256 = ?, bytes = ?, mime = ? WHERE platform = ? AND item_id = ? AND seq = ?')
      .run(blob.sha256, blob.bytes, blob.mime, platform, itemId, seq)
  }

  // ------------------------------------------------------------------ 用户引用

  addRef(user: string, platform: string, itemId: string, meta: { jobId?: string | null; keyword?: string | null; account?: string | null; at?: number } = {}): void {
    const at = meta.at ?? Date.now()
    this.statement(`
      INSERT INTO refs(platform, item_id, user, first_at, last_at, job_id, keyword, account) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, item_id, user) DO UPDATE SET
        last_at = excluded.last_at,
        job_id = COALESCE(excluded.job_id, refs.job_id),
        keyword = COALESCE(excluded.keyword, refs.keyword),
        account = COALESCE(excluded.account, refs.account)
    `).run(platform, itemId, user, at, at, meta.jobId ?? null, meta.keyword ?? null, meta.account ?? null)
    if (meta.keyword) {
      this.statement(`
        INSERT INTO ref_keywords(platform, item_id, user, keyword, first_at, last_at, job_id) VALUES(?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, item_id, user, keyword) DO UPDATE SET
          last_at = excluded.last_at,
          job_id = COALESCE(excluded.job_id, ref_keywords.job_id)
      `).run(platform, itemId, user, meta.keyword, at, at, meta.jobId ?? null)
    }
    this.bump()
  }

  listRefKeywords(user: string, platform?: string): RefKeywordRow[] {
    const rows = platform
      ? this.statement('SELECT * FROM ref_keywords WHERE user = ? AND platform = ? ORDER BY last_at DESC').all(user, platform)
      : this.statement('SELECT * FROM ref_keywords WHERE user = ? ORDER BY last_at DESC').all(user)
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      platform: String(row.platform),
      itemId: String(row.item_id),
      user: String(row.user),
      keyword: String(row.keyword),
      firstAt: Number(row.first_at),
      lastAt: Number(row.last_at),
      jobId: row.job_id == null ? null : String(row.job_id),
    }))
  }

  listRefs(user: string, platform?: string): RefRow[] {
    const rows = platform
      ? this.statement('SELECT * FROM refs WHERE user = ? AND platform = ? ORDER BY last_at DESC').all(user, platform)
      : this.statement('SELECT * FROM refs WHERE user = ? ORDER BY last_at DESC').all(user)
    return (rows as Array<Record<string, unknown>>).map(refRow)
  }

  hasRef(user: string, platform: string, itemId: string): boolean {
    return Boolean(this.statement('SELECT 1 AS ok FROM refs WHERE user = ? AND platform = ? AND item_id = ?').get(user, platform, itemId))
  }

  refUsers(platform: string, itemId: string): string[] {
    const rows = this.statement('SELECT user FROM refs WHERE platform = ? AND item_id = ? ORDER BY first_at').all(platform, itemId) as Array<Record<string, unknown>>
    return rows.map((row) => String(row.user))
  }

  refCount(platform: string, itemId: string): number {
    const row = this.statement('SELECT COUNT(*) AS n FROM refs WHERE platform = ? AND item_id = ?').get(platform, itemId) as Record<string, unknown> | undefined
    return row ? Number(row.n) : 0
  }

  refsByJob(user: string, jobId: string): string[] {
    const rows = this.statement('SELECT item_id FROM refs WHERE user = ? AND job_id = ? ORDER BY last_at').all(user, jobId) as Array<Record<string, unknown>>
    return rows.map((row) => String(row.item_id))
  }

  clearRefs(user: string): number {
    this.statement('DELETE FROM ref_keywords WHERE user = ?').run(user)
    const result = this.statement('DELETE FROM refs WHERE user = ?').run(user)
    this.bump()
    return Number(result.changes)
  }

  userVersion(user: string, platform?: string): string {
    const refs = platform
      ? this.statement('SELECT COUNT(*) AS n, COALESCE(MAX(last_at), 0) AS last FROM refs WHERE user = ? AND platform = ?').get(user, platform)
      : this.statement('SELECT COUNT(*) AS n, COALESCE(MAX(last_at), 0) AS last FROM refs WHERE user = ?').get(user)
    const masks = platform
      ? this.statement('SELECT COUNT(*) AS n FROM user_masks WHERE user = ? AND platform = ?').get(user, platform)
      : this.statement('SELECT COUNT(*) AS n FROM user_masks WHERE user = ?').get(user)
    const r = refs as Record<string, unknown> | undefined
    const m = masks as Record<string, unknown> | undefined
    return `${r ? Number(r.n) : 0}:${r ? Number(r.last) : 0}:${m ? Number(m.n) : 0}:${this.version()}`
  }

  // ------------------------------------------------------------------ 并发租约

  claim(platform: string, itemId: string, kind: string, owner: string, ttlMs: number): boolean {
    const now = Date.now()
    this.statement(`
      INSERT INTO claims(platform, item_id, kind, owner, expires_at) VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(platform, item_id, kind) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
      WHERE claims.expires_at <= ?
    `).run(platform, itemId, kind, owner, now + ttlMs, now)
    const row = this.statement('SELECT owner FROM claims WHERE platform = ? AND item_id = ? AND kind = ?').get(platform, itemId, kind) as Record<string, unknown> | undefined
    return row ? String(row.owner) === owner : false
  }

  release(platform: string, itemId: string, kind: string, owner: string): void {
    this.statement('DELETE FROM claims WHERE platform = ? AND item_id = ? AND kind = ? AND owner = ?').run(platform, itemId, kind, owner)
  }

  // ------------------------------------------------------------------ 审计与统计

  logFetch(entry: FetchLogEntry): void {
    this.statement('INSERT INTO fetch_log(platform, item_id, kind, result, user, account, job_id, at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.platform, entry.itemId, entry.kind, entry.result, entry.user ?? null, entry.account ?? null, entry.jobId ?? null, entry.at ?? Date.now())
  }

  reuseStats(since = 0): { fetched: number; reused: number; byKind: Record<string, { fetched: number; reused: number }> } {
    const rows = this.statement('SELECT kind, result, COUNT(*) AS n FROM fetch_log WHERE at >= ? GROUP BY kind, result').all(since) as Array<Record<string, unknown>>
    const byKind: Record<string, { fetched: number; reused: number }> = {}
    let fetched = 0
    let reused = 0
    for (const row of rows) {
      const kind = String(row.kind)
      const n = Number(row.n)
      const bucket = byKind[kind] ?? { fetched: 0, reused: 0 }
      if (row.result === 'fetched') { bucket.fetched += n; fetched += n }
      if (row.result === 'reused') { bucket.reused += n; reused += n }
      byKind[kind] = bucket
    }
    return { fetched, reused, byKind }
  }

  // ------------------------------------------------------------------ 隐藏（清理）

  hideComments(user: string, platform: string, itemId: string, ids: string[]): number {
    if (!ids.length) return 0
    return this.tx(() => {
      const insert = this.statement('INSERT OR IGNORE INTO user_masks(user, platform, item_id, comment_id, hidden_at) VALUES(?, ?, ?, ?, ?)')
      const at = Date.now()
      for (const id of ids) insert.run(user, platform, itemId, id, at)
      this.bump()
      return ids.length
    })
  }

  hiddenComments(user: string, platform: string, itemId: string): Set<string> {
    const rows = this.statement('SELECT comment_id FROM user_masks WHERE user = ? AND platform = ? AND item_id = ?').all(user, platform, itemId) as Array<Record<string, unknown>>
    return new Set(rows.map((row) => String(row.comment_id)))
  }

  maskCount(user: string): number {
    const row = this.statement('SELECT COUNT(*) AS n FROM user_masks WHERE user = ?').get(user) as Record<string, unknown> | undefined
    return row ? Number(row.n) : 0
  }

  clearMasks(user: string): number {
    const result = this.statement('DELETE FROM user_masks WHERE user = ?').run(user)
    this.bump()
    return Number(result.changes)
  }

  // ------------------------------------------------------------------ 媒体字节

  private blobPathFor(sha256: string, ext: string | null): string {
    return join(this.dir, 'blobs', sha256.slice(0, 2), `${sha256}${ext ? `.${ext}` : ''}`)
  }

  saveBlob(data: Uint8Array, options: { mime?: string | null; ext?: string | null } = {}): Promise<BlobRef> {
    const sha256 = sha256Hex(data)
    const existing = this.blobFile(sha256)
    if (existing && this.blobExists(sha256)) return Promise.resolve(existing)
    const ext = safeExt(options.ext) ?? safeExt(EXT_BY_MIME[String(options.mime ?? '')]) ?? null
    const path = this.blobPathFor(sha256, ext)
    const temp = `${path}.part-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
    return (async () => {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(temp, data)
      await rename(temp, path)
      this.statement('INSERT OR REPLACE INTO blobs(sha256, path, bytes, mime, created_at) VALUES(?, ?, ?, ?, ?)')
        .run(sha256, path, data.byteLength, options.mime ?? null, Date.now())
      return { sha256, bytes: data.byteLength, path, mime: options.mime ?? null }
    })()
  }

  ingestFile(sourcePath: string, options: { mime?: string | null } = {}): Promise<BlobRef> {
    return (async () => {
      const sha256 = await sha256File(sourcePath)
      const existing = this.blobFile(sha256)
      if (existing && this.blobExists(sha256)) {
        // 同字节已经有一份：临时文件直接删掉，别占空间。
        await rm(sourcePath, { force: true })
        return existing
      }
      const ext = safeExt(extname(sourcePath)) ?? safeExt(EXT_BY_MIME[String(options.mime ?? '')]) ?? null
      const path = this.blobPathFor(sha256, ext)
      await mkdir(dirname(path), { recursive: true })
      const size = (await stat(sourcePath)).size
      try { await rename(sourcePath, path) } catch { await copyFile(sourcePath, path); await rm(sourcePath, { force: true }) }
      this.statement('INSERT OR REPLACE INTO blobs(sha256, path, bytes, mime, created_at) VALUES(?, ?, ?, ?, ?)')
        .run(sha256, path, size, options.mime ?? null, Date.now())
      return { sha256, bytes: size, path, mime: options.mime ?? null }
    })()
  }

  blobFile(sha256: string): BlobRef | null {
    const row = this.statement('SELECT * FROM blobs WHERE sha256 = ?').get(sha256) as Record<string, unknown> | undefined
    if (!row) return null
    return { sha256, path: String(row.path), bytes: Number(row.bytes), mime: row.mime == null ? null : String(row.mime) }
  }

  blobExists(sha256: string): boolean {
    const row = this.blobFile(sha256)
    if (!row) return false
    try { return statSync(row.path).isFile() } catch { return false }
  }

  // ------------------------------------------------------------------ 回收

  gc(options: { days: number; now?: number; apply?: boolean }): GcPlan {
    const days = Math.max(0, Math.trunc(options.days))
    const now = options.now ?? Date.now()
    const cutoff = now - days * 24 * 3600 * 1000
    const stale = this.statement(`
      SELECT platform, id FROM items
      WHERE seen_at < ? AND NOT EXISTS (
        SELECT 1 FROM refs r WHERE r.platform = items.platform AND r.item_id = items.id
      )
    `).all(cutoff) as Array<Record<string, unknown>>
    const items = stale.map((row) => ({ platform: String(row.platform), id: String(row.id) }))

    let comments = 0
    for (const item of items) comments += this.commentCount(item.platform, item.id)

    // 没人引用的 blob：不在任何 item_media 清单里。
    const orphan = this.statement(`
      SELECT sha256, bytes, path FROM blobs b
      WHERE NOT EXISTS (SELECT 1 FROM item_media m WHERE m.sha256 = b.sha256)
    `).all() as Array<Record<string, unknown>>
    const blobs = orphan.length
    const bytes = orphan.reduce((sum, row) => sum + Number(row.bytes ?? 0), 0)
    // 回收站里孤儿的注释：作品已被删或从来没导进来。
    const orphanComments = Number((this.statement('SELECT COUNT(*) AS n FROM comments WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.platform = comments.platform AND i.id = comments.item_id)').get() as Record<string, unknown>).n ?? 0)

    if (!options.apply) return { days, items, comments: comments + orphanComments, blobs, bytes, applied: false }

    this.tx(() => {
      for (const item of items) {
        this.statement('DELETE FROM comments WHERE platform = ? AND item_id = ?').run(item.platform, item.id)
        this.statement('DELETE FROM comments_state WHERE platform = ? AND item_id = ?').run(item.platform, item.id)
        this.statement('DELETE FROM item_media WHERE platform = ? AND item_id = ?').run(item.platform, item.id)
        this.statement('DELETE FROM items WHERE platform = ? AND id = ?').run(item.platform, item.id)
      }
      this.statement('DELETE FROM comments WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.platform = comments.platform AND i.id = comments.item_id)').run()
      for (const row of orphan) this.statement('DELETE FROM blobs WHERE sha256 = ?').run(String(row.sha256))
      this.statement('DELETE FROM claims WHERE expires_at < ?').run(now)
      this.bump()
    })
    for (const row of orphan) {
      const path = String(row.path ?? '')
      if (path) void rm(path, { force: true })
    }
    return { days, items, comments: comments + orphanComments, blobs, bytes, applied: true }
  }

  usage(): StoreUsage {
    const count = (sql: string): number => Number((this.statement(sql).get() as Record<string, unknown> | undefined)?.n ?? 0)
    const blobBytes = Number((this.statement('SELECT COALESCE(SUM(bytes), 0) AS n FROM blobs').get() as Record<string, unknown>).n ?? 0)
    let dbBytes = 0
    let walBytes = 0
    try { dbBytes = statSync(this.dbPath).size } catch { /* 还没落盘 */ }
    try { walBytes = statSync(`${this.dbPath}-wal`).size } catch { /* 没有 WAL */ }
    return {
      items: count('SELECT COUNT(*) AS n FROM items'),
      comments: count('SELECT COUNT(*) AS n FROM comments'),
      creators: count('SELECT COUNT(*) AS n FROM creators'),
      refs: count('SELECT COUNT(*) AS n FROM refs'),
      users: count('SELECT COUNT(DISTINCT user) AS n FROM refs'),
      blobs: count('SELECT COUNT(*) AS n FROM blobs'),
      blobBytes,
      dbBytes,
      walBytes,
    }
  }
}

export function openContentStore(dir: string): ContentStore {
  return new Store(dir)
}
