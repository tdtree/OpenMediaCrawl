import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileSignature } from '../core/fsutil.js'
import type { Comment, Item } from '../core/schemas.js'
import type { ContentStore } from './shared/types.js'

/**
 * 读某个用户能看到的采集结果，供 Web UI 回看。
 *
 * 两条来源：
 * - 共享库（推荐）：refs 决定「这个用户采到过哪些作品」，正文/评论从共享库回填，媒体不在用户目录里复制。
 * - 旧的按用户落盘文件：带 `item_id` 且没有 `kind` 的记录是评论；带 `kind` 的是作品。
 *   共享模式没迁移的老数据仍然能看，迁移后也不会重复。
 * 使用前先看 mtime+size 组成的 signature，变了才重新解析；共享库再加一个内容版本号。
 */
export interface RecordItem {
  id: string
  title: string | null
  cover: string | null
  url: string | null
  author: string | null
  created_at: string | null
  stats: Item['stats']
  comments: number
  /** 最近 7 天首次出现的评论条数（增量采集时给列表打「新」用）。 */
  new_comments: number
}

export interface RecordIndex {
  signature: string
  items: RecordItem[]
  comments: Map<string, Comment[]>
}

/** 视图来源：只给 root 就是旧行为；带 store+user 就在文件结果上叠加共享库。 */
export interface IndexSource {
  root: string
  store?: ContentStore
  user?: string
}

interface RawIndex {
  items: Map<string, Item>
  comments: Map<string, Comment[]>
}

/** 缓存条数上限：每个平台/用户目录一份完整索引，只保留最近用过的。 */
const DEFAULT_RECORD_CACHE_MAX = 64
const cache = new Map<string, RecordIndex>()

/**
 * 缓存条数上限：一个条目是「某个用户某个平台」的完整解析结果，
 * 键的数量随「用户 × 平台」增长，必须封顶，否则长期运行会一直涨。
 *
 * 用条数而不是字节：条目内存不好精确估算，而且空目录解析出来是 0 字节，
 * 按字节算永远不会淘汰它们（键照样增长）。单条大小由平台数据规模决定，
 * 条数封顶更简单可预测。默认 8 是内存保守取值，可用环境变量放大。
 */
const DEFAULT_CACHE_MAX = 8

function cacheMax(env: NodeJS.ProcessEnv = process.env): number {
  // 两个名字都认：OMC_RECORDS_CACHE_MAX 是后加的规范名，
  // MEDIACRAWL_RECORD_CACHE_MAX 是之前那版实现用的，别让用户配置失效。
  for (const key of ['OMC_RECORDS_CACHE_MAX', 'MEDIACRAWL_RECORD_CACHE_MAX'] as const) {
    const raw = Number(env[key])
    if (Number.isFinite(raw) && raw >= 1) return Math.trunc(raw)
  }
  return DEFAULT_CACHE_MAX
}

/** 供状态查询复用（与淘汰用的是同一口径）。 */
function cacheLimit(): number {
  return cacheMax()
}

/** 命中 / 新增后挪到末尾（最近使用），超出上限时从头部淘汰最久没用的。 */
function touch(key: string, index: RecordIndex): void {
  cache.delete(key)
  cache.set(key, index)
  const max = cacheMax()
  while (cache.size > max) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function isComment(value: unknown): value is Comment {
  const v = value as Comment & { kind?: string }
  return Boolean(v) && typeof v === 'object' && typeof v.item_id === 'string' && v.kind === undefined
}

async function filesOf(dir: string): Promise<string[]> {
  try {
    const names = await readdir(dir)
    return names.filter((name) => /\.(jsonl|json)$/i.test(name)).sort().map((name) => join(dir, name))
  } catch { return [] }
}

function parseLines(text: string): unknown[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed) as unknown[] } catch { return [] }
  }
  return trimmed.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line) as unknown] } catch { return [] }
  })
}

/** 只有引用、正文已经被回收时的占位：列表里还能看到 id，点开是空的。 */
function placeholder(id: string): Item {
  return {
    id, kind: 'video', url: null, title: null, text: null, author: null, created_at: null, cover: null,
    media: [], stats: { views: null, likes: null, comments: null, collects: null, shares: null }, price: null, status: null,
  }
}

async function signatureOf(files: string[]): Promise<string> {
  return (await Promise.all(files.map(fileSignature))).join('|')
}

async function readFiles(files: string[]): Promise<RawIndex> {
  const items = new Map<string, Item>()
  const comments = new Map<string, Comment[]>()
  for (const file of files) {
    let text: string
    try { text = await readFile(file, 'utf8') } catch { continue }
    for (const record of parseLines(text)) {
      if (!record || typeof record !== 'object') continue
      if (isComment(record)) {
        const list = comments.get(record.item_id) ?? []
        if (!list.some((c) => c.id === record.id)) list.push(record)
        comments.set(record.item_id, list)
      } else {
        const value = record as Item
        if (value.id) items.set(String(value.id), value)
      }
    }
  }
  return { items, comments }
}

/** 共享库覆盖：引用决定可见范围，正文/评论来自共享库，用户掩码过滤评论。 */
function overlayShared(raw: RawIndex, store: ContentStore, user: string, platform: string): RawIndex {
  const items = new Map(raw.items)
  const comments = new Map(raw.comments)
  /** 用户掩码（数据清理「只对自己隐藏」）要去掉，别把删掉的正文又露出来。 */
  const visible = (itemId: string): Comment[] => {
    const hidden = store.hiddenComments(user, platform, itemId)
    return store.listComments(platform, itemId).filter((comment) => !hidden.has(String(comment.id)))
  }
  const covered = new Set<string>()
  for (const ref of store.listRefs(user, platform)) {
    covered.add(ref.itemId)
    const shared = store.getItem(platform, ref.itemId)
    if (shared) items.set(ref.itemId, shared.data)
    else if (!items.has(ref.itemId)) items.set(ref.itemId, placeholder(ref.itemId))

    const list = visible(ref.itemId)
    // 共享库里有这个作品的评论状态（哪怕是 0 条）就以它为准，别把旧文件里的残留又混进来。
    if (list.length || store.getCommentsState(platform, ref.itemId)) comments.set(ref.itemId, list)
  }
  // 兜底：作品已经在用户自己的记录里（文件里能看到），但引用没写进来
  // （旧数据没迁移、CLI 忘了设 OMC_USER、清空引用之后）。这时评论照样从共享库回填，
  // 否则列表里「评 N」显示得好好的，点开却没有评论。
  for (const itemId of items.keys()) {
    if (covered.has(itemId)) continue
    const list = visible(itemId)
    if (list.length || store.getCommentsState(platform, itemId)) comments.set(itemId, list)
  }
  return { items, comments }
}

/**
 * 只算指纹（目录列表 + 每个文件的 mtime/size + 共享库版本号），不解析内容。
 * 给「内容没变就别重算」的调用方用（例如线索同步的脏检查）。
 */
export async function indexSignature(source: string | IndexSource, platform: string): Promise<string> {
  const root = typeof source === 'string' ? source : source.root
  const store = typeof source === 'string' ? undefined : source.store
  const user = typeof source === 'string' ? undefined : source.user
  const files = await filesOf(join(root, platform))
  const sharedVersion = store && user ? store.userVersion(user, platform) : ''
  return `${await signatureOf(files)}|${sharedVersion}`
}

export async function loadIndex(source: string | IndexSource, platform: string): Promise<RecordIndex> {
  const root = typeof source === 'string' ? source : source.root
  const store = typeof source === 'string' ? undefined : source.store
  const user = typeof source === 'string' ? undefined : source.user
  const files = await filesOf(join(root, platform))
  const sharedVersion = store && user ? store.userVersion(user, platform) : ''
  const signature = `${await signatureOf(files)}|${sharedVersion}`
  const key = `${root}|${platform}`

  const cached = cache.get(key)
  if (cached && cached.signature === signature) {
    // 命中也要刷新 LRU 位置，常用的索引不会被新目录挤掉。
    touch(key, cached)
    return cached
  }

  const raw = await readFiles(files)
  const merged = store && user ? overlayShared(raw, store, user, platform) : raw
  // 最近 7 天首次出现的评论，一次聚合查询算完（别按作品逐条查）。
  const recent = store && user ? store.recentCommentCounts(platform, Date.now() - 7 * 24 * 3600 * 1000) : new Map<string, number>()
  for (const list of merged.comments.values()) {
    list.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  }
  const index: RecordIndex = {
    signature,
    comments: merged.comments,
    items: [...merged.items.values()].map((item) => ({
      id: String(item.id),
      title: item.title ?? null,
      cover: item.cover ?? null,
      url: item.url ?? null,
      author: item.author?.name ?? item.author?.id ?? null,
      created_at: item.created_at ?? null,
      stats: item.stats,
      comments: merged.comments.get(String(item.id))?.length ?? 0,
      new_comments: recent.get(String(item.id)) ?? 0,
    })),
  }
  touch(key, index)
  return index
}

/**
 * 一级评论在前、各自的二级评论跟在后面（保持时间顺序）。
 *
 * 「没有父评论」在各平台上的写法并不统一：有的是 null，有的是 `0`（抖音的 reply_id），
 * 有的是作品 id 或评论自己的 id。父评论不在这一批里的，也必须算一级评论露出来 ——
 * 一条都不能凭空从列表里消失（之前整体判成二级时，评论树就是空的）。
 */
export function threadOf(list: Comment[]): Array<Comment & { children: Comment[] }> {
  const ids = new Set(list.map((comment) => String(comment.id)))
  const parentOf = (comment: Comment): string => (comment.parent_id == null ? '' : String(comment.parent_id).trim())
  const isRoot = (comment: Comment): boolean => {
    const parent = parentOf(comment)
    if (!parent || parent === '0' || parent === 'null' || parent === 'undefined') return true
    if (parent === String(comment.id)) return true
    return !ids.has(parent)
  }
  const roots = list.filter(isRoot)
  const kids = new Map<string, Comment[]>()
  for (const comment of list) {
    if (isRoot(comment)) continue
    const parent = parentOf(comment)
    const bucket = kids.get(parent) ?? []
    bucket.push(comment)
    kids.set(parent, bucket)
  }
  return roots.map((comment) => ({ ...comment, children: kids.get(String(comment.id)) ?? [] }))
}

/** 清掉缓存，测试用。 */
export function resetRecordCache(): void { cache.clear() }

/** 缓存观测，测试和排查内存占用用。 */
export function recordCacheStats(): { size: number; max: number } {
  return { size: cache.size, max: cacheLimit() }
}
