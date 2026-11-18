import type { Comment, Item, User } from '../core/schemas.js'

export type CrawlPlatform = 'xhs' | 'douyin' | 'kuaishou' | 'bilibili' | 'weibo' | 'tiktok' | 'x'
export type CrawlType = 'search' | 'detail' | 'creator'
export type SaveFormat = 'json' | 'jsonl' | 'csv' | 'sqlite'

export interface CrawlOptions {
  platform: CrawlPlatform
  type: CrawlType
  keywords: string[]
  ids: string[]
  creators: string[]
  maxItems: number
  comments: boolean
  subComments: boolean
  maxComments: number
  media: boolean
  save: SaveFormat
  out: string
  sleep: string
  sort?: string
  quiet: boolean
  config?: string
  /** 共享内容库目录；false 表示按用户落盘，true 表示用 <out>/shared。 */
  shared?: string | boolean
  /** 复用策略：auto 按 TTL、always 强制重抓、never 有就不抓。 */
  refresh?: 'auto' | 'always' | 'never'
}

export interface SearchPage<T> {
  items: T[]
  hasMore: boolean
  cursor?: string | null
}

/** One platform's read operations, as the crawl job needs them. `cursor` is opaque (from the previous page). */
export interface CrawlPlatformClient {
  search(keyword: string, cursor: string | null): Promise<SearchPage<Item> | Item[]>
  detail(idOrUrl: string): Promise<Item>
  comments(itemIdOrUrl: string, limit: number, cursor?: string | null): Promise<SearchPage<Comment> | Comment[]>
  subComments(itemIdOrUrl: string, commentId: string, limit: number): Promise<SearchPage<Comment> | Comment[]>
  creator(idOrUrl: string): Promise<User>
  creatorItems(idOrUrl: string, cursor: string | null): Promise<SearchPage<Item> | Item[]>
  /** Downloads the item's images/videos into `dir`, skipping files that already exist. Returns files written. */
  download(item: Item, dir: string): Promise<number>
}

export interface CrawlEvent {
  type: 'log' | 'item' | 'comment' | 'error' | 'done'
  message: string
  data?: unknown
  time: string
}

export interface CrawlResult {
  jobId: string
  platform: CrawlPlatform
  type: CrawlType
  counts: {
    items: number
    comments: number
    creators: number
    skipped: number
    /** 本次真正新增的评论条数（按评论 id 去重后），增量采集看这个。 */
    newComments: number
    /** 复用的作品条数（没有发 detail）。 */
    reusedItems: number
    /** 复用的评论条数。 */
    reusedComments: number
    /** 媒体已经齐全、没有重新下载的作品数。 */
    reusedMedia: number
  }
  files: string[]
  stateFile: string
  /** 这个平台没有 `comment list`（CLI 报 UNSUPPORTED / NOT_IMPLEMENTED）：评论没采，其余照常。 */
  commentsUnsupported?: boolean
}

export function pageItems<T>(value: SearchPage<T> | T[]): SearchPage<T> {
  return Array.isArray(value) ? { items: value, hasMore: false } : value
}

export function splitValues(value: string | string[] | undefined): string[] {
  if (value == null) return []
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)
}
