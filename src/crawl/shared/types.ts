import type { Comment, Item, Media, User } from '../../core/schemas.js'

/**
 * 共享内容库的对外类型。
 *
 * 身份：作品以 `(platform, id)` 唯一（用户口中的「独立视频」），跨平台不合并；
 * 媒体再按 sha256 去重，同一个视频被多个账号搬运也能只存一份字节。
 */

/** full = 抓过 detail；summary = 只在搜索结果里见过。 */
export type ItemBody = 'full' | 'summary'

/** 复用策略：auto 按 TTL，always 忽略 TTL 重抓正文/评论，never 有就不抓。 */
export type RefreshMode = 'auto' | 'always' | 'never'

export interface SharedItem {
  platform: string
  id: string
  data: Item
  body: ItemBody
  /** 上次真正抓 detail 的时间（毫秒）。summary 也有值，表示「试过」。 */
  fetchedAt: number
  /** 上次在任何来源里遇到它的时间。 */
  seenAt: number
  sourceUser: string | null
  sourceAccount: string | null
}

export interface CommentsState {
  fetchedAt: number
  /** 0 = 一级评论全量；>0 = 只抓了这么多条一级评论。 */
  limit: number
  /** 一级评论是否已翻完（不包含楼中楼）。 */
  complete: boolean
  /** 楼中楼是否都采过（false 时，要回复的任务还会再抓一次）。 */
  withReplies: boolean
}

export interface MediaRow {
  seq: number
  kind: Media['type']
  url: string | null
  sha256: string | null
  bytes: number | null
  mime: string | null
}

/** 评论 + 库里附带的时间戳：`first_seen_at` 用来标记「这次才出现的新评论」。 */
export type CommentRecord = Comment & { first_seen_at?: number }

export interface RefRow {
  platform: string
  itemId: string
  user: string
  firstAt: number
  lastAt: number
  jobId: string | null
  keyword: string | null
  account: string | null
}

export interface ReusePolicy {
  /** 作品正文复用窗口（毫秒）。 */
  itemTtlMs: number
  /** 评论复用窗口（毫秒）。 */
  commentTtlMs: number
  reuseItems: boolean
  reuseComments: boolean
  reuseMedia: boolean
  refresh: RefreshMode
}

export const DEFAULT_POLICY: ReusePolicy = {
  itemTtlMs: 30 * 24 * 3600 * 1000,
  commentTtlMs: 24 * 3600 * 1000,
  reuseItems: true,
  reuseComments: true,
  reuseMedia: true,
  refresh: 'auto',
}

export interface FetchLogEntry {
  platform: string
  itemId: string
  kind: 'item' | 'comments' | 'media' | 'creator'
  result: 'fetched' | 'reused' | 'skipped' | 'failed'
  user?: string | null
  account?: string | null
  jobId?: string | null
  at?: number
}

export interface StoreUsage {
  items: number
  comments: number
  creators: number
  refs: number
  users: number
  blobs: number
  blobBytes: number
  dbBytes: number
  walBytes: number
}

export interface BlobRef {
  sha256: string
  bytes: number
  path: string
  mime: string | null
}

export interface GcPlan {
  days: number
  /** 没有任何用户引用的作品。 */
  items: Array<{ platform: string; id: string }>
  comments: number
  blobs: number
  bytes: number
  applied: boolean
}

export interface PutItemOptions {
  body: ItemBody
  user?: string | null
  account?: string | null
  /** 指定抓取时间（导入旧数据时用文件 mtime）。 */
  fetchedAt?: number
}

/** 共享库写入/读取接口。除文件相关的异步方法外都是同步的（node:sqlite 本身同步）。 */
export interface ContentStore {
  readonly dir: string
  readonly dbPath: string
  /** 内容版本号：item/comment/ref 任一写入都会 +1，用于失效 UI 缓存。 */
  version(): number
  close(): void

  getItem(platform: string, id: string): SharedItem | null
  putItem(platform: string, data: Item, options: PutItemOptions): void
  /** 只在搜索结果里又见到它：合并统计/封面等便宜字段，不碰正文和 media。 */
  touchItem(platform: string, id: string, seed: Item, at?: number): void
  listItems(platform: string, ids: string[]): SharedItem[]

  getCommentsState(platform: string, itemId: string): CommentsState | null
  listComments(platform: string, itemId: string, limit?: number): CommentRecord[]
  commentCount(platform: string, itemId: string): number
  /** 首次被采到的时间 >= since 的评论条数（按作品）。 */
  newCommentCount(platform: string, itemId: string, since: number): number
  /** 一个平台下、指定时间后首次出现的评论，按作品聚合：itemId → 条数。 */
  recentCommentCounts(platform: string, since: number): Map<string, number>
  /** 返回本次真正新增的条数（按 id 去重后）。 */
  putComments(platform: string, itemId: string, comments: Comment[], state: { limit: number; complete: boolean; withReplies?: boolean }, at?: number): { added: number; total: number }

  getCreator(platform: string, id: string): User | null
  putCreator(platform: string, data: User, at?: number): void

  mediaRows(platform: string, itemId: string): MediaRow[]
  putMediaRows(platform: string, itemId: string, media: Media[]): MediaRow[]
  completeMedia(platform: string, itemId: string, seq: number, blob: { sha256: string; bytes: number; mime: string | null }): void

  addRef(user: string, platform: string, itemId: string, meta?: { jobId?: string | null; keyword?: string | null; account?: string | null; at?: number }): void
  listRefs(user: string, platform?: string): RefRow[]
  hasRef(user: string, platform: string, itemId: string): boolean
  refUsers(platform: string, itemId: string): string[]
  refCount(platform: string, itemId: string): number
  refsByJob(user: string, jobId: string): string[]
  clearRefs(user: string): number
  userVersion(user: string, platform?: string): string

  claim(platform: string, itemId: string, kind: string, owner: string, ttlMs: number): boolean
  release(platform: string, itemId: string, kind: string, owner: string): void

  logFetch(entry: FetchLogEntry): void
  reuseStats(since?: number): { fetched: number; reused: number; byKind: Record<string, { fetched: number; reused: number }> }

  hideComments(user: string, platform: string, itemId: string, ids: string[]): number
  hiddenComments(user: string, platform: string, itemId: string): Set<string>
  maskCount(user: string): number
  clearMasks(user: string): number

  saveBlob(data: Uint8Array, options?: { mime?: string | null; ext?: string | null }): Promise<BlobRef>
  /** 把下载好的临时文件收进 blob 库（流式算哈希，不整段读进内存），原文件会被移走。 */
  ingestFile(sourcePath: string, options?: { mime?: string | null }): Promise<BlobRef>
  blobFile(sha256: string): BlobRef | null
  blobExists(sha256: string): boolean

  gc(options: { days: number; now?: number; apply?: boolean }): GcPlan
  usage(): StoreUsage
}
