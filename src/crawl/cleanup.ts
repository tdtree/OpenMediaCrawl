import { copyFile, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '../core/fsutil.js'
import type { ContentStore } from './shared/types.js'
import { loadLexicon } from './lexicon.js'

/** 评论行：评论文件里没有 kind 字段的行。 */
export interface CommentRow {
  id?: unknown
  text?: unknown
  author?: { name?: unknown }
  created_at?: unknown
  parent_id?: unknown
}

export interface CleanupCandidate {
  file: string
  id: string
  text: string
  createdAt: string
  bytes: number
}

export interface CleanupPlan {
  /** 参与判断的筛选词（词库 + 历史使用过的） */
  terms: string[]
  days: number
  /** 评论总数（参与扫描的行） */
  total: number
  bytes: number
  candidates: CleanupCandidate[]
  /** 无法判断时间的行，跳过不删 */
  skipped: number
  /** 数据来源：文件（旧）或共享库（新）。 */
  source?: 'files' | 'shared'
}

const DAY = 24 * 3600 * 1000
const historyFile = (root: string) => join(root, 'filter-history.json')

/** 记录用过的筛选词（去重、最多 500 个），供清理判断“有没有被筛到过”。 */
export async function loadFilterHistory(root: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(historyFile(root), 'utf8')) as { terms?: unknown }
    return Array.isArray(parsed.terms) ? parsed.terms.map((term) => String(term)).filter(Boolean) : []
  } catch { return [] }
}

export async function addFilterTerms(root: string, terms: string[]): Promise<string[]> {
  const current = await loadFilterHistory(root)
  const seen = new Set(current)
  for (const raw of terms) {
    const term = String(raw ?? '').trim().slice(0, 40)
    if (term && !seen.has(term)) { seen.add(term); current.push(term) }
    if (current.length >= 500) break
  }
  await writeFileAtomic(historyFile(root), JSON.stringify({ terms: current }, null, 2) + '\n')
  return current
}

/** 某个用户实际使用的筛选词集合：词库里的过滤词 + 历史上用过的。 */
export async function effectiveTerms(root: string): Promise<string[]> {
  const [lexicon, history] = await Promise.all([loadLexicon(root), loadFilterHistory(root)])
  return [...new Set([...lexicon.filters, ...history].map((term) => term.trim()).filter(Boolean))]
}

function commentFiles(dir: string, files: string[]): string[] {
  return files.filter((name) => name.endsWith('.jsonl') && name.includes('comment'))
}

async function readRows(file: string): Promise<Array<{ raw: string; row: CommentRow; bytes: number }>> {
  const text = await readFile(file, 'utf8').catch(() => '')
  const out: Array<{ raw: string; row: CommentRow; bytes: number }> = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push({ raw: line, row: JSON.parse(line) as CommentRow, bytes: Buffer.byteLength(line, 'utf8') + 1 })
    } catch { /* 坏行留给人工 */ }
  }
  return out
}

function ageDays(createdAt: unknown, now: number): number | null {
  if (typeof createdAt !== 'string' || !createdAt) return null
  const at = Date.parse(createdAt)
  if (!Number.isFinite(at)) return null
  return (now - at) / DAY
}

function matched(text: string, terms: string[]): boolean {
  const haystack = text.toLowerCase()
  return terms.some((term) => term && haystack.includes(term.toLowerCase()))
}

/**
 * 找出「超过 N 天、且从未被任何筛选词命中」的评论。
 * 只读不写；时间以评论自身的 created_at 为准，缺时间的行跳过（不删）。
 */
export async function planCleanup(root: string, options: { days?: number; now?: number } = {}): Promise<CleanupPlan> {
  const days = Math.max(1, Math.trunc(options.days ?? 30))
  const now = options.now ?? Date.now()
  const terms = await effectiveTerms(root)
  const plan: CleanupPlan = { terms, days, total: 0, bytes: 0, candidates: [], skipped: 0 }
  for (const platform of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!platform.isDirectory() || platform.name.startsWith('.')) continue
    const dir = join(root, platform.name)
    const files = commentFiles(dir, await readdir(dir).catch(() => [] as string[]))
    for (const name of files) {
      const file = join(dir, name)
      for (const { row, bytes } of await readRows(file)) {
        plan.total += 1
        plan.bytes += bytes
        const age = ageDays(row.created_at, now)
        if (age === null) { plan.skipped += 1; continue }
        if (age < days) continue
        const text = String(row.text ?? '')
        if (matched(text, terms)) continue
        plan.candidates.push({
          file,
          id: String(row.id ?? ''),
          text: text.slice(0, 200),
          createdAt: String(row.created_at),
          bytes,
        })
      }
    }
  }
  return plan
}

/**
 * 执行清理：按 (文件, 评论 id) 删掉候选行，其余行原样保留。
 * 不动 `.crawl-state-*.json` —— 断点状态里仍记着这些评论 id，重跑采集会跳过，不会重复抓取。
 * 返回删除条数与释放字节数。
 */
export async function applyCleanup(plan: CleanupPlan): Promise<{ removed: number; freedBytes: number; files: number }> {
  const byFile = new Map<string, Set<string>>()
  for (const item of plan.candidates) {
    const set = byFile.get(item.file) ?? new Set<string>()
    set.add(item.id)
    byFile.set(item.file, set)
  }
  let removed = 0
  let freedBytes = 0
  for (const [file, ids] of byFile) {
    const info = await stat(file).catch(() => null)
    if (!info) continue
    if (info.size < 50 * 1024 * 1024) await copyFile(file, `${file}.bak`).catch(() => {})
    const text = await readFile(file, 'utf8').catch(() => '')
    const kept: string[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let row: CommentRow | null = null
      try { row = JSON.parse(line) as CommentRow } catch { row = null }
      if (row && ids.has(String(row.id ?? ''))) {
        removed += 1
        freedBytes += Buffer.byteLength(line, 'utf8') + 1
        continue
      }
      kept.push(line)
    }
    await writeFileAtomic(file, kept.length ? kept.join('\n') + '\n' : '')
  }
  return { removed, freedBytes, files: byFile.size }
}

// ------------------------------------------------------------------ 共享库模式

/** 共享库模式下的一条清理候选：删的不是数据，是这个用户「不再看它」。 */
export interface SharedCleanupEntry {
  platform: string
  itemId: string
  commentId: string
  text: string
  createdAt: string
  bytes: number
}

export interface SharedCleanupPlan extends CleanupPlan {
  source: 'shared'
  entries: SharedCleanupEntry[]
}

/**
 * 共享库里的清理预览：只看这个用户引用过的作品，评论从共享库读。
 * 语义和旧版一样（超过 N 天 + 没被任何筛选词命中），区别是结果写进用户掩码，而不是删共享数据。
 */
export async function planCleanupFromStore(
  store: ContentStore,
  user: string,
  terms: string[],
  options: { days?: number; now?: number } = {},
): Promise<SharedCleanupPlan> {
  const days = Math.max(1, Math.trunc(options.days ?? 30))
  const now = options.now ?? Date.now()
  const plan: SharedCleanupPlan = { terms, days, total: 0, bytes: 0, candidates: [], skipped: 0, source: 'shared', entries: [] }
  for (const ref of store.listRefs(user)) {
    const hidden = store.hiddenComments(user, ref.platform, ref.itemId)
    for (const comment of store.listComments(ref.platform, ref.itemId)) {
      if (hidden.has(String(comment.id))) continue
      plan.total += 1
      const bytes = Buffer.byteLength(JSON.stringify(comment), 'utf8') + 1
      plan.bytes += bytes
      const age = ageDays(comment.created_at, now)
      if (age === null) { plan.skipped += 1; continue }
      if (age < days) continue
      const text = String(comment.text ?? '')
      if (matched(text, terms)) continue
      plan.candidates.push({ file: '', id: String(comment.id), text: text.slice(0, 200), createdAt: String(comment.created_at), bytes })
      plan.entries.push({ platform: ref.platform, itemId: ref.itemId, commentId: String(comment.id), text, createdAt: String(comment.created_at), bytes })
    }
  }
  return plan
}

/**
 * 执行共享库模式的清理：按 (平台, 作品) 写掩码，只影响这个用户的视图。
 * 返回 freedBytes = 0（共享字节还在给别人用），removed 是隐藏的评论条数。
 */
export async function applySharedCleanup(store: ContentStore, user: string, plan: SharedCleanupPlan): Promise<{ removed: number; freedBytes: number; files: number }> {
  const byItem = new Map<string, { platform: string; itemId: string; ids: string[] }>()
  for (const entry of plan.entries) {
    const key = `${entry.platform}\u0000${entry.itemId}`
    const bucket = byItem.get(key) ?? { platform: entry.platform, itemId: entry.itemId, ids: [] }
    bucket.ids.push(entry.commentId)
    byItem.set(key, bucket)
  }
  let removed = 0
  for (const bucket of byItem.values()) {
    store.hideComments(user, bucket.platform, bucket.itemId, bucket.ids)
    removed += bucket.ids.length
  }
  return { removed, freedBytes: 0, files: 0 }
}

/** 类型收窄：UI 用一个端点处理两种清理来源。 */
export function isSharedPlan(plan: CleanupPlan | SharedCleanupPlan): plan is SharedCleanupPlan {
  return plan.source === 'shared' && Array.isArray((plan as SharedCleanupPlan).entries)
}
