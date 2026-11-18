import type { Comment } from '../core/schemas.js'
import type { ContentStore } from './shared/types.js'
import { pageItems, type CrawlPlatformClient, type SearchPage } from './types.js'

export interface CheckCommentsInput {
  client: CrawlPlatformClient
  store: ContentStore
  platform: string
  itemId: string
  user: string
  account?: string | null
  /** 每页拉多少条；默认 50。 */
  pageSize?: number
  /** 连续遇到多少条已知评论就认为“已经追上”，默认 20。 */
  stopAfterKnown?: number
  /** 最多翻多少页，防止异常响应无限循环；默认 20。 */
  maxPages?: number
}

export interface CheckCommentsResult {
  added: number
  total: number
  scanned: number
  pages: number
  /** known = 追上已知评论；end = 到末页；empty = 没有评论；no-cursor = 平台没给游标；limit = 翻到页数上限。 */
  stopped: 'known' | 'end' | 'empty' | 'no-cursor' | 'limit'
}

/**
 * 只检查某个作品的新评论：从第一页开始翻，连续遇到已知评论就停。
 *
 * 与全量采集的区别：
 * - 不复用 TTL（调用方显式触发，就是要发请求）；
 * - 不下载媒体、不改作品正文；
 * - 不把 `comments_state.complete` 设成 true（一次增量不能证明历史已经采全）。
 */
export async function checkNewComments(input: CheckCommentsInput): Promise<CheckCommentsResult> {
  const pageSize = Math.max(1, Math.trunc(input.pageSize ?? 50))
  const stopAfterKnown = Math.max(1, Math.trunc(input.stopAfterKnown ?? 20))
  const maxPages = Math.max(1, Math.trunc(input.maxPages ?? 20))
  const { store, platform, itemId } = input
  const item = store.getItem(platform, itemId)
  const ref = item?.data.url ?? itemId

  const before = store.commentCount(platform, itemId)
  const known = new Set(store.listComments(platform, itemId).map((comment) => String(comment.id)))
  const state = store.getCommentsState(platform, itemId)

  let cursor: string | null = null
  let pages = 0
  let scanned = 0
  let stopped: CheckCommentsResult['stopped'] = 'end'

  while (pages < maxPages) {
    const page: SearchPage<Comment> = pageItems(await input.client.comments(ref, pageSize, cursor))
    pages++
    if (!page.items.length) { stopped = 'empty'; break }
    scanned += page.items.length

    const fresh: Comment[] = []
    let knownRun = 0
    let longestKnownRun = 0
    for (const comment of page.items) {
      if (known.has(String(comment.id))) {
        knownRun++
        longestKnownRun = Math.max(longestKnownRun, knownRun)
      } else {
        knownRun = 0
        fresh.push(comment)
      }
    }
    if (fresh.length) {
      store.putComments(platform, itemId, page.items, {
        limit: state?.limit ?? pageSize,
        complete: state?.complete === true,
        withReplies: state?.withReplies === true,
      })
    }
    for (const comment of page.items) known.add(String(comment.id))

    if (longestKnownRun >= stopAfterKnown) { stopped = 'known'; break }
    if (!page.hasMore) { stopped = 'end'; break }
    cursor = page.cursor ?? null
    if (!cursor) { stopped = 'no-cursor'; break }
  }
  if (pages >= maxPages && stopped === 'end') stopped = 'limit'

  // 刷新引用时间：让作品列表按“最近检查”排序时有依据；不改关键词。
  store.addRef(input.user, platform, itemId, { keyword: null, account: input.account ?? null })

  return { added: store.commentCount(platform, itemId) - before, total: store.commentCount(platform, itemId), scanned, pages, stopped }
}
