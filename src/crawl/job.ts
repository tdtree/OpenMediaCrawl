import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Comment, Item } from '../core/schemas.js'
import { CatbusError } from '../core/errors.js'
import { contentTypeOf } from '../core/files.js'
import { createStorage, type StorageWriter, type StoredRecord } from './storage.js'
import { decideReuse, mediaReady } from './shared/reuse.js'
import { DEFAULT_POLICY } from './shared/types.js'
import type { ContentStore, ItemBody, ReusePolicy } from './shared/types.js'
import { pageItems, type CrawlEvent, type CrawlOptions, type CrawlPlatformClient, type CrawlResult, type SearchPage } from './types.js'

interface TaskState { cursor: string | null; done: boolean }
interface CrawlState { items: string[]; comments: string[]; creators: string[]; tasks: Record<string, TaskState>; finished: boolean }

export function parseSleep(value: string): [number, number] {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?$/)
  if (!match) return [2000, 5000]
  const min = Math.max(0, Number(match[1]) * 1000)
  const max = Math.max(min, Number(match[2] ?? match[1]) * 1000)
  return [min, max]
}

async function pause(range: [number, number]): Promise<void> {
  if (range[1] <= 0) return
  const delay = range[0] + Math.random() * (range[1] - range[0])
  await new Promise((done) => setTimeout(done, delay))
}

/** Auth / captcha / usage errors are final: retrying would only make the account look more like a bot. */
function isFatal(error: unknown): boolean {
  return error instanceof CatbusError && ['AUTH_REQUIRED', 'RISK_CONTROL', 'USAGE', 'UNSUPPORTED', 'NOT_IMPLEMENTED'].includes(error.code)
}

/** Errors that must abort the whole job (logged-out or platform risk control); others only skip one step. */
function stopsJob(error: unknown): boolean {
  return error instanceof CatbusError && ['AUTH_REQUIRED', 'AUTH_EXPIRED', 'RISK_CONTROL'].includes(error.code)
}

/** 平台压根没有这个能力（注册表标 none 的 comment list）：不是失败，记下来照常跑完。 */
function isUnsupported(error: unknown): boolean {
  return error instanceof CatbusError && ['UNSUPPORTED', 'NOT_IMPLEMENTED'].includes(error.code)
}

export async function retry<T>(fn: () => Promise<T>, retries = 2, baseMs = 2000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn() } catch (error) {
      if (isFatal(error) || attempt >= retries) throw error
      await new Promise((done) => setTimeout(done, baseMs * 2 ** attempt))
    }
  }
}

function statePath(options: CrawlOptions): string {
  return join(resolve(options.out), `.crawl-state-${options.platform}-${options.type}.json`)
}

async function loadState(path: string): Promise<CrawlState> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<CrawlState>
    return {
      items: value.items ?? [],
      comments: value.comments ?? [],
      creators: value.creators ?? [],
      tasks: value.tasks ?? {},
      finished: value.finished === true,
    }
  } catch { return { items: [], comments: [], creators: [], tasks: {}, finished: false } }
}

async function saveState(path: string, state: CrawlState): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, JSON.stringify(state) + '\n', 'utf8')
  await rename(tmp, path)
}

export interface RunCrawlDeps {
  client: CrawlPlatformClient
  storage?: StorageWriter
  onEvent?: (event: CrawlEvent) => void
  signal?: AbortSignal
  /** 共享内容库；不传就是原来的「按用户落盘」。 */
  content?: ContentStore
  /** 归属用户与当前登录账号，只写进 refs / fetch_log，用来回答「谁采的」。 */
  user?: string | null
  account?: string | null
  jobId?: string
  policy?: ReusePolicy
}

/** 用户点了停止：不是失败，单独一类，UI 里显示“已停止”。 */
export class CrawlStoppedError extends Error {
  constructor() { super('已手动停止') ; this.name = 'CrawlStoppedError' }
}

/** 用户侧只留「这条我采到过」的轻量记录，正文/评论/媒体都在共享库里。 */
function thinItem(item: Item): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    url: item.url,
    title: item.title,
    cover: item.cover,
    author: item.author,
    created_at: item.created_at,
    stats: item.stats,
    shared: true,
  }
}

/** 租约时长要盖住单次平台调用的超时（默认 120 秒）。 */
const CLAIM_TTL_MS = 180_000
/** 抢不到租约时最多等这么久，等不到就自己抓（对方可能已经挂了）。 */
const CLAIM_WAIT_MS = 20_000

export async function runCrawl(options: CrawlOptions, deps: RunCrawlDeps): Promise<CrawlResult> {
  const path = statePath(options)
  const state = await loadState(path)
  // 上一轮正常跑完的 state 只用来跨批次去重，不阻止这一轮把同样的关键词重新采一遍；
  // 只有上一轮是中断的（finished 为 false）才按任务和游标继续。
  if (state.finished) { state.tasks = {}; state.finished = false }
  const seen = { item: new Set(state.items), comment: new Set(state.comments), creator: new Set(state.creators) }
  const content = deps.content
  const policy = deps.policy ?? DEFAULT_POLICY
  const platform = options.platform
  const storage = deps.storage ?? await createStorage(options.save, options.out, platform, options.type)
  const range = parseSleep(options.sleep)
  const emit = (type: CrawlEvent['type'], message: string, data?: unknown) => deps.onEvent?.({ type, message, data, time: new Date().toISOString() })
  const counts = { items: 0, comments: 0, creators: 0, skipped: 0, newComments: 0, reusedItems: 0, reusedComments: 0, reusedMedia: 0 }
  /** 平台没有 `comment list` 时就别每条作品都试一次；也不该因此把整个任务判失败。 */
  let commentsUnsupported = false
  const client = deps.client
  /** 每个可中断点都检查一次：停止最多等到当前这一条处理完。 */
  const stopped = (): void => { if (deps.signal?.aborted) throw new CrawlStoppedError() }
  /** 当前任务来源（关键词或博主），写进 refs 方便回查「这条是怎么来的」。 */
  let source: string | null = null
  const owner = `${deps.jobId ?? 'job'}-${process.pid}-${randomUUID().slice(0, 8)}`

  const logFetch = (itemId: string, kind: 'item' | 'comments' | 'media', result: 'fetched' | 'reused' | 'skipped' | 'failed'): void => {
    content?.logFetch({ platform, itemId, kind, result, user: deps.user ?? null, account: deps.account ?? null, jobId: deps.jobId ?? null })
  }

  /**
   * 同一条作品只让一个执行体真去请求：抢到租约的干活，抢不到的等它落库。
   * 多账号并行采同一批视频时，重复请求在这里被挡住。
   * 返回 true 表示「本次真的做了工作」，false 表示复用了别人刚抓到的结果。
   */
  const withClaim = async (
    itemId: string,
    kind: string,
    startedAt: number,
    ready: () => boolean,
    work: () => Promise<void>,
  ): Promise<boolean> => {
    if (!content) { await work(); return true }
    if (content.claim(platform, itemId, kind, owner, CLAIM_TTL_MS)) {
      try { await work(); return true } finally { content.release(platform, itemId, kind, owner) }
    }
    const deadline = Date.now() + CLAIM_WAIT_MS
    while (Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 250))
      if (ready()) return false
    }
    await work()
    return true
  }

  const save = async (record: StoredRecord): Promise<boolean> => {
    const set = seen[record.kind]
    if (set.has(record.id)) { counts.skipped++; return false }
    await storage.write(record)
    set.add(record.id)
    ;(record.kind === 'item' ? state.items : record.kind === 'comment' ? state.comments : state.creators).push(record.id)
    await saveState(path, state)
    if (record.kind === 'item') counts.items++
    else if (record.kind === 'comment') counts.comments++
    else counts.creators++
    emit(record.kind === 'creator' ? 'log' : record.kind, `saved ${record.kind} ${record.id}`, record.data)
    return true
  }

  /** 原来的按用户落盘逻辑，保持一字不差，只在没有共享库时走。 */
  const processCommentsLegacy = async (item: Item) => {
    if (!options.comments) return
    const ref = item.url ?? item.id
    const cap = options.maxComments > 0 ? options.maxComments : Number.POSITIVE_INFINITY
    const top = pageItems(await retry(() => client.comments(ref, options.maxComments)))
    for (const comment of top.items.slice(0, cap)) {
      const saved = await save({ platform, kind: 'comment', id: String(comment.id), data: comment })
      const replies = comment.stats?.replies
      if (saved && options.subComments && (replies == null || replies > 0)) {
        await pause(range)
        try {
          const children = pageItems(await retry(() => client.subComments(ref, String(comment.id), options.maxComments)))
          for (const child of children.items.slice(0, cap)) await save({ platform, kind: 'comment', id: String(child.id), data: child })
        } catch (error) {
          if (stopsJob(error)) throw error
          emit('log', `sub-comments unavailable for ${comment.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  /** 共享模式：一次抓完一级 + 楼中楼，整批 upsert，只开一次写事务。 */
  const collectComments = async (item: Item): Promise<{ list: Comment[]; complete: boolean; withReplies: boolean }> => {
    const ref = item.url ?? item.id
    const cap = options.maxComments > 0 ? options.maxComments : Number.POSITIVE_INFINITY
    const top = pageItems(await retry(() => client.comments(ref, options.maxComments)))
    const list: Comment[] = []
    // complete 只管一级评论是否翻完；楼中楼单独记 withReplies。
    let complete = options.maxComments === 0 && !top.hasMore
    let withReplies = options.subComments === true
    for (const comment of top.items.slice(0, cap)) {
      list.push(comment)
      const replies = comment.stats?.replies
      if (options.subComments && (replies == null || replies > 0)) {
        await pause(range)
        try {
          const children = pageItems(await retry(() => client.subComments(ref, String(comment.id), options.maxComments)))
          if (children.hasMore) withReplies = false
          for (const child of children.items.slice(0, cap)) list.push(child)
        } catch (error) {
          withReplies = false
          if (stopsJob(error)) throw error
          emit('log', `sub-comments unavailable for ${comment.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    return { list, complete, withReplies }
  }

  /** 媒体：临时目录下载 → 逐个算 sha256 收进 blob 库 → 删临时目录。 */
  const ingestMedia = async (item: Item, itemId: string): Promise<number> => {
    if (!content) return 0
    const tmpDir = join(content.dir, 'tmp', `${platform}-${itemId}-${randomUUID().slice(0, 8)}`)
    await mkdir(tmpDir, { recursive: true })
    try {
      await retry(() => client.download(item, tmpDir))
      content.putMediaRows(platform, itemId, item.media ?? [])
      let done = 0
      for (const name of await readdir(tmpDir)) {
        const seq = Number(name.match(/_(\d+)\.[^.]+$/)?.[1] ?? 0)
        const blob = await content.ingestFile(join(tmpDir, name), { mime: contentTypeOf(name) })
        if (seq > 0) content.completeMedia(platform, itemId, seq, { sha256: blob.sha256, bytes: blob.bytes, mime: blob.mime })
        done++
      }
      return done
    } finally {
      await rm(tmpDir, { recursive: true, force: true })
    }
  }

  /** `fetched` = the item already came from `detail`, so don't request it twice. */
  const processItem = async (seed: Item, fetched = false) => {
    const seedId = seed?.id == null ? null : String(seed.id)
    if (!seedId) return
    if (seen.item.has(seedId)) {
      // 旧的断点文件记着这条，但共享库里这个用户还没有引用（刚切到共享模式）——
      // 这时跳过会让任务「什么都没发生」，所以补一次：处理它、建引用，之后再跳过。
      const covered = content && deps.user ? content.hasRef(deps.user, platform, seedId) : false
      if (!content || covered) { counts.skipped++; return }
      seen.item.delete(seedId)
    }

    const existing = content?.getItem(platform, seedId) ?? null
    let item = seed
    let body: ItemBody = fetched ? 'full' : 'summary'
    let didFetchItem = fetched

    const itemDecision = content && !fetched
      ? decideReuse(
        { item: existing ? { body: existing.body, fetchedAt: existing.fetchedAt } : null, comments: null, media: null },
        { wantComments: false, wantSubComments: false, wantMedia: false, maxComments: 0 },
        policy,
      )
      : null

    if (fetched) {
      item = seed
      body = 'full'
    } else if (content && existing && itemDecision && !itemDecision.fetchItem) {
      item = existing.data
      content.touchItem(platform, seedId, seed)
      counts.reusedItems++
      logFetch(seedId, 'item', 'reused')
      emit('log', `复用已有作品 ${seedId}（${itemDecision.reasons.join('；')}）`)
    } else {
      const startedAt = Date.now()
      let fetchedNow = false
      const didWork = await withClaim(seedId, 'item', startedAt, () => {
        const ready = content?.getItem(platform, seedId)
        return Boolean(ready && ready.body === 'full' && ready.fetchedAt >= startedAt - 1000)
      }, async () => {
        try {
          item = await retry(() => client.detail(seed.url ?? seed.id))
          body = 'full'
          fetchedNow = true
        } catch (error) {
          if (stopsJob(error)) throw error
          emit('log', `detail failed, keeping search result for ${seedId}`)
          // 抓失败不要拿搜索摘要把库里的正文降级。
          if (existing) { item = existing.data; body = existing.body }
        }
      })
      if (!fetchedNow && !didWork) {
        const ready = content?.getItem(platform, seedId)
        if (ready?.body === 'full') {
          item = ready.data
          body = 'full'
          counts.reusedItems++
          logFetch(seedId, 'item', 'reused')
        }
      }
      didFetchItem = fetchedNow
    }

    if (content) {
      if (didFetchItem) content.putItem(platform, item, { body: 'full', user: deps.user ?? null, account: deps.account ?? null })
      else if (!existing) content.putItem(platform, item, { body, user: deps.user ?? null, account: deps.account ?? null })
      else content.touchItem(platform, seedId, seed)
      if (didFetchItem) logFetch(seedId, 'item', 'fetched')
      content.addRef(deps.user ?? 'unknown', platform, seedId, { jobId: deps.jobId ?? null, keyword: source, account: deps.account ?? null })
    }

    await save({ platform, kind: 'item', id: seedId, data: content ? thinItem(item) : item })

    // ---- 评论 ----
    if (options.comments && commentsUnsupported) {
      // 前面已经确认这个平台没有 `comment list`，别再一条作品试一次。
    } else if (options.comments) {
      try {
        const commentState = content?.getCommentsState(platform, seedId) ?? null
        const commentDecision = content
          ? decideReuse(
            { item: null, comments: commentState, media: null },
            { wantComments: true, wantSubComments: options.subComments, wantMedia: false, maxComments: options.maxComments },
            policy,
          )
          : null
        if (content && commentDecision && !commentDecision.fetchComments) {
          counts.reusedComments += content.commentCount(platform, seedId)
          logFetch(seedId, 'comments', 'reused')
        } else {
          emit('log', `拉取评论 ${seedId}（${options.maxComments > 0 ? `最多 ${options.maxComments} 条` : '不限，热门作品可能很慢'}）`)
          const startedAt = Date.now()
          const didWork = await withClaim(seedId, 'comments', startedAt, () => {
            const ready = content?.getCommentsState(platform, seedId)
            return Boolean(ready && ready.fetchedAt >= startedAt - 1000)
          }, async () => {
            if (content) {
              const { list, complete, withReplies } = await collectComments(item)
              const written = content.putComments(platform, seedId, list, { limit: options.maxComments, complete, withReplies })
              counts.comments += list.length
              counts.newComments += written.added
              if (written.added > 0) emit('log', `评论 ${seedId}：新增 ${written.added} 条（本次抓到 ${list.length} 条，库里共 ${written.total} 条）`)
              logFetch(seedId, 'comments', 'fetched')
            } else {
              await processCommentsLegacy(item)
            }
          })
          if (!didWork) {
            counts.reusedComments += content?.commentCount(platform, seedId) ?? 0
            logFetch(seedId, 'comments', 'reused')
          }
        }
      } catch (error) {
        if (!isUnsupported(error)) throw error
        commentsUnsupported = true
        logFetch(seedId, 'comments', 'skipped')
        emit('log', `该平台暂不支持评论采集（${error instanceof Error ? error.message : String(error)}）`)
      }
    }

    // ---- 媒体 ----
    if (options.media) {
      if (content) {
        content.putMediaRows(platform, seedId, item.media ?? [])
        const rows = content.mediaRows(platform, seedId)
        const ready = mediaReady(rows, (sha) => content.blobExists(sha))
        if (rows.length > 0 && ready >= rows.length) {
          counts.reusedMedia++
          logFetch(seedId, 'media', 'reused')
        } else if (rows.length > 0) {
          emit('log', `下载媒体 ${seedId}（${rows.length} 个）…`)
          try {
            const written = await ingestMedia(item, seedId)
            logFetch(seedId, 'media', 'fetched')
            emit('log', `media ${seedId}: ${written} file(s)`)
          } catch (error) {
            if (stopsJob(error)) throw error
            logFetch(seedId, 'media', 'failed')
            emit('log', `media download failed for ${seedId}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      } else {
        const dir = join(resolve(options.out), platform, 'media', seedId)
        await mkdir(dir, { recursive: true })
        try {
          const written = await retry(() => client.download(item, dir))
          emit('log', `media ${item.id}: ${written} file(s)`)
        } catch (error) {
          if (stopsJob(error)) throw error
          emit('log', `media download failed for ${item.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    await pause(range)
  }

  /**
   * Walks an opaque-cursor listing until `limit` items were processed or the listing ends.
   * `key` 是这个任务在 state 里的名字（如 `search:露营`）：已完成的任务整段跳过，中断的任务从存下的游标接着走。
   */
  const walk = async (key: string, fetchPage: (cursor: string | null) => Promise<SearchPage<Item> | Item[]>, limit: number) => {
    const task = state.tasks[key]
    if (task?.done) {
      // 共享模式下「这一轮跑完过」不等于「共享库里有这批数据」：旧版断点可能一个引用都没建。
      // 只有这个来源确实留下过引用，才整段跳过；否则按没跑过处理。
      const covered = !content || !deps.user || content.listRefs(deps.user, platform).some((ref) => ref.keyword === source)
      if (covered) { emit('log', `skip ${key}（上一轮已完成）`); return }
      emit('log', `重跑 ${key}（断点里记过，但共享库还没有这批数据）`)
      state.tasks[key] = { cursor: null, done: false }
    }
    let cursor: string | null = state.tasks[key]?.cursor ?? null
    if (cursor) emit('log', `resume ${key}（从存下的游标继续）`)
    let total = 0
    while (total < limit) {
      stopped()
      const page = pageItems(await retry(() => fetchPage(cursor)))
      if (!page.items.length) break
      for (const item of page.items) {
        if (total >= limit) break
        stopped()
        total++
        await processItem(item)
      }
      if (!page.hasMore || !page.cursor || page.cursor === cursor) break
      cursor = page.cursor
      // 翻页游标一拿到就落盘：进程被杀/断网重跑时从这里继续，而不是从第 1 页重走一遍风控
      state.tasks[key] = { cursor, done: false }
      await saveState(path, state)
      await pause(range)
    }
    state.tasks[key] = { cursor: null, done: true }
    await saveState(path, state)
  }

  try {
    if (options.comments && options.maxComments === 0) {
      emit('log', '评论上限为 0（不限）：会把一级评论翻完；热门视频可能上万条，看起来像卡住，需要快采可在表单填 20/100')
    }
    if (options.type === 'search') {
      if (!options.keywords.length) throw new CatbusError('USAGE', 'search needs --keywords')
      for (const keyword of options.keywords) {
        stopped()
        source = keyword
        emit('log', `search "${keyword}"`)
        await walk(`search:${keyword}`, (cursor) => client.search(keyword, cursor), options.maxItems)
      }
    } else if (options.type === 'detail') {
      if (!options.ids.length) throw new CatbusError('USAGE', 'detail needs --ids')
      source = null
      for (const id of options.ids.slice(0, options.maxItems)) {
        stopped()
        if (seen.item.has(id)) {
          const covered = content && deps.user ? content.hasRef(deps.user, platform, id) : false
          if (!content || covered) { counts.skipped++; continue }
          seen.item.delete(id)
        }
        await processItem(await retry(() => client.detail(id)), true)
      }
    } else {
      if (!options.creators.length) throw new CatbusError('USAGE', 'creator needs --creators')
      for (const id of options.creators) {
        stopped()
        source = `creator:${id}`
        const creator = await retry(() => client.creator(id))
        if (content) content.putCreator(platform, creator)
        else await save({ platform, kind: 'creator', id: String(creator.id ?? id), data: creator })
        await walk(`creator:${id}`, (cursor) => client.creatorItems(id, cursor), options.maxItems)
      }
    }
    state.finished = true
    await saveState(path, state)
    emit('done', 'crawl finished', counts)
    if (content && (counts.reusedItems || counts.reusedComments || counts.reusedMedia)) {
      emit('log', `复用：作品 ${counts.reusedItems} 条、评论 ${counts.reusedComments} 条、媒体 ${counts.reusedMedia} 个（没有重复请求平台）`)
    }
    if (commentsUnsupported) emit('log', `注意：${platform} 暂不支持评论采集（CLI 没有 comment list），这次只采了作品`)
    return {
      jobId: `${platform}-${options.type}-${Date.now()}`,
      platform,
      type: options.type,
      counts,
      files: storage.files(),
      stateFile: path,
      ...(commentsUnsupported ? { commentsUnsupported: true } : {}),
    }
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    await storage.close()
  }
}
