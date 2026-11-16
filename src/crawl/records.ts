import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
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

const cache = new Map<string, RecordIndex>()

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
  const stats = await Promise.all(files.map(async (file) => {
    try { const s = await stat(file); return `${file}:${s.mtimeMs}:${s.size}` } catch { return `${file}:0:0` }
  }))
  return stats.join('|')
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
  for (const ref of store.listRefs(user, platform)) {
    const shared = store.getItem(platform, ref.itemId)
    if (shared) items.set(ref.itemId, shared.data)
    else if (!items.has(ref.itemId)) items.set(ref.itemId, placeholder(ref.itemId))

    const hidden = store.hiddenComments(user, platform, ref.itemId)
    const list = store.listComments(platform, ref.itemId).filter((comment) => !hidden.has(String(comment.id)))
    // 共享库里有这个作品的评论状态（哪怕是 0 条）就以它为准，别把旧文件里的残留又混进来。
    if (list.length || store.getCommentsState(platform, ref.itemId)) comments.set(ref.itemId, list)
  }
  return { items, comments }
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
  if (cached && cached.signature === signature) return cached

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
  cache.set(key, index)
  return index
}

/** 一级评论在前、各自的二级评论跟在后面（保持时间顺序）。 */
export function threadOf(list: Comment[]): Array<Comment & { children: Comment[] }> {
  const roots = list.filter((c) => !c.parent_id)
  const kids = new Map<string, Comment[]>()
  for (const c of list) {
    if (!c.parent_id) continue
    const bucket = kids.get(c.parent_id) ?? []
    bucket.push(c)
    kids.set(c.parent_id, bucket)
  }
  return roots.map((c) => ({ ...c, children: kids.get(c.id) ?? [] }))
}

/** 清掉缓存，测试用。 */
export function resetRecordCache(): void { cache.clear() }
