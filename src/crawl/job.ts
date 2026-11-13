import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Item } from '../core/schemas.js'
import { CatbusError } from '../core/errors.js'
import { createStorage, type StorageWriter, type StoredRecord } from './storage.js'
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

export interface RunCrawlDeps { client: CrawlPlatformClient; storage?: StorageWriter; onEvent?: (event: CrawlEvent) => void; signal?: AbortSignal }

/** 用户点了停止：不是失败，单独一类，UI 里显示“已停止”。 */
export class CrawlStoppedError extends Error {
  constructor() { super('已手动停止') ; this.name = 'CrawlStoppedError' }
}

export async function runCrawl(options: CrawlOptions, deps: RunCrawlDeps): Promise<CrawlResult> {
  const path = statePath(options)
  const state = await loadState(path)
  // 上一轮正常跑完的 state 只用来跨批次去重，不阻止这一轮把同样的关键词重新采一遍；
  // 只有上一轮是中断的（finished 为 false）才按任务和游标继续。
  if (state.finished) { state.tasks = {}; state.finished = false }
  const seen = { item: new Set(state.items), comment: new Set(state.comments), creator: new Set(state.creators) }
  const storage = deps.storage ?? await createStorage(options.save, options.out, options.platform, options.type)
  const range = parseSleep(options.sleep)
  const emit = (type: CrawlEvent['type'], message: string, data?: unknown) => deps.onEvent?.({ type, message, data, time: new Date().toISOString() })
  const counts = { items: 0, comments: 0, creators: 0, skipped: 0 }
  const client = deps.client
  /** 每个可中断点都检查一次：停止最多等到当前这一条处理完。 */
  const stopped = (): void => { if (deps.signal?.aborted) throw new CrawlStoppedError() }

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

  const processComments = async (item: Item) => {
    if (!options.comments) return
    const ref = item.url ?? item.id
    const cap = options.maxComments > 0 ? options.maxComments : Number.POSITIVE_INFINITY
    const top = pageItems(await retry(() => client.comments(ref, options.maxComments)))
    for (const comment of top.items.slice(0, cap)) {
      const saved = await save({ platform: options.platform, kind: 'comment', id: String(comment.id), data: comment })
      const replies = comment.stats?.replies
      if (saved && options.subComments && (replies == null || replies > 0)) {
        await pause(range)
        try {
          const children = pageItems(await retry(() => client.subComments(ref, String(comment.id), options.maxComments)))
          for (const child of children.items.slice(0, cap)) await save({ platform: options.platform, kind: 'comment', id: String(child.id), data: child })
        } catch (error) {
          if (stopsJob(error)) throw error
          emit('log', `sub-comments unavailable for ${comment.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  /** `fetched` = the item already came from `detail`, so don't request it twice. */
  const processItem = async (seed: Item, fetched = false) => {
    const seedId = seed?.id == null ? null : String(seed.id)
    if (!seedId) return
    if (seen.item.has(seedId)) { counts.skipped++; return }
    let item = seed
    if (!fetched) {
      try { item = await retry(() => client.detail(seed.url ?? seed.id)) } catch (error) {
        if (stopsJob(error)) throw error
        emit('log', `detail failed, keeping search result for ${seedId}`)
      }
    }
    await save({ platform: options.platform, kind: 'item', id: String(item.id ?? seedId), data: item })
    await processComments(item)
    if (options.media) {
      const dir = join(resolve(options.out), options.platform, 'media', String(item.id ?? seedId))
      await mkdir(dir, { recursive: true })
      try {
        const written = await retry(() => client.download(item, dir))
        emit('log', `media ${item.id}: ${written} file(s)`)
      } catch (error) {
        if (stopsJob(error)) throw error
        emit('log', `media download failed for ${item.id}: ${error instanceof Error ? error.message : String(error)}`)
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
    if (task?.done) { emit('log', `skip ${key}（上一轮已完成）`); return }
    let cursor: string | null = task?.cursor ?? null
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
    if (options.type === 'search') {
      if (!options.keywords.length) throw new CatbusError('USAGE', 'search needs --keywords')
      for (const keyword of options.keywords) {
        stopped()
        emit('log', `search "${keyword}"`)
        await walk(`search:${keyword}`, (cursor) => client.search(keyword, cursor), options.maxItems)
      }
    } else if (options.type === 'detail') {
      if (!options.ids.length) throw new CatbusError('USAGE', 'detail needs --ids')
      for (const id of options.ids.slice(0, options.maxItems)) {
        stopped()
        if (seen.item.has(id)) { counts.skipped++; continue }
        await processItem(await retry(() => client.detail(id)), true)
      }
    } else {
      if (!options.creators.length) throw new CatbusError('USAGE', 'creator needs --creators')
      for (const id of options.creators) {
        stopped()
        const creator = await retry(() => client.creator(id))
        await save({ platform: options.platform, kind: 'creator', id: String(creator.id ?? id), data: creator })
        await walk(`creator:${id}`, (cursor) => client.creatorItems(id, cursor), options.maxItems)
      }
    }
    state.finished = true
    await saveState(path, state)
    emit('done', 'crawl finished', counts)
    return { jobId: `${options.platform}-${options.type}-${Date.now()}`, platform: options.platform, type: options.type, counts, files: storage.files(), stateFile: path }
  } catch (error) {
    emit('error', error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    await storage.close()
  }
}
