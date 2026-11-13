import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Comment, Item } from '../core/schemas.js'

/**
 * 读某个用户某个平台已经落盘的采集结果（jsonl / json），供 Web UI 回看。
 * 约定：带 `item_id` 且没有 `kind` 的记录是评论；带 `kind` 的是作品。
 * 使用前先看 mtime+size 组成的 signature，变了才重新解析。
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
}

export interface RecordIndex {
  signature: string
  items: RecordItem[]
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

export async function loadIndex(root: string, platform: string): Promise<RecordIndex> {
  const dir = join(root, platform)
  const files = await filesOf(dir)
  const stats = await Promise.all(files.map(async (file) => {
    try { const s = await stat(file); return `${file}:${s.mtimeMs}:${s.size}` } catch { return `${file}:0:0` }
  }))
  const signature = stats.join('|')
  const cached = cache.get(`${root}|${platform}`)
  if (cached && cached.signature === signature) return cached

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
        const item = record as Item
        if (item.id) items.set(String(item.id), item)
      }
    }
  }
  for (const list of comments.values()) {
    list.sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  }
  const index: RecordIndex = {
    signature,
    comments,
    items: [...items.values()].map((item) => ({
      id: String(item.id),
      title: item.title ?? null,
      cover: item.cover ?? null,
      url: item.url ?? null,
      author: item.author?.name ?? item.author?.id ?? null,
      created_at: item.created_at ?? null,
      stats: item.stats,
      comments: comments.get(String(item.id))?.length ?? 0,
    })),
  }
  cache.set(`${root}|${platform}`, index)
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
