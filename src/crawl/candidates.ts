import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readTextIfExists, writeFileAtomic } from '../core/fsutil.js'
import { CatbusError } from '../core/errors.js'

export type CandidateType = 'reply' | 'dm'

/** 候选池里的一个人：要么是「回复某条评论」，要么是「给某个用户发私信」。 */
export interface Candidate {
  id: string
  type: CandidateType
  platform: string
  itemId: string
  commentId: string | null
  userId: string | null
  userName: string | null
  note: string | null
  added_at: string
}

interface File { version: number; items: Candidate[] }

const file = (root: string) => join(root, 'candidates.json')

export async function listCandidates(root: string): Promise<Candidate[]> {
  const raw = await readTextIfExists(file(root))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Partial<File>
    return Array.isArray(parsed.items) ? parsed.items : []
  } catch { throw new CatbusError('ERROR', '候选池文件损坏，可以先删掉 candidates.json', { hint: file(root) }) }
}

async function save(root: string, items: Candidate[]): Promise<void> {
  await writeFileAtomic(file(root), JSON.stringify({ version: 1, items }, null, 2) + '\n')
}

/** 同一个人同一条评论只留一份；返回是否新增。 */
export async function addCandidate(root: string, input: { type: CandidateType; platform: string; itemId: string; commentId?: string; userId?: string; userName?: string; note?: string }): Promise<{ candidate: Candidate; added: boolean }> {
  if (!input.platform || !input.itemId) throw new CatbusError('USAGE', '候选需要 platform 和 itemId')
  if (input.type === 'reply' && !input.commentId) throw new CatbusError('USAGE', '回复候选需要 commentId')
  if (input.type === 'dm' && !input.userId) throw new CatbusError('USAGE', '私信候选需要 userId')
  const items = await listCandidates(root)
  const hit = items.find((c) => c.type === input.type && c.platform === input.platform && c.itemId === input.itemId && (c.commentId ?? '') === (input.commentId ?? '') && (c.userId ?? '') === (input.userId ?? ''))
  if (hit) return { candidate: hit, added: false }
  const candidate: Candidate = {
    id: randomUUID(),
    type: input.type,
    platform: input.platform,
    itemId: input.itemId,
    commentId: input.commentId ?? null,
    userId: input.userId ?? null,
    userName: input.userName ?? null,
    note: input.note ?? null,
    added_at: new Date().toISOString(),
  }
  items.push(candidate)
  await save(root, items)
  return { candidate, added: true }
}

export async function removeCandidate(root: string, id: string): Promise<boolean> {
  const items = await listCandidates(root)
  const next = items.filter((c) => c.id !== id)
  if (next.length === items.length) return false
  await save(root, next)
  return true
}

export async function clearCandidates(root: string, type?: CandidateType): Promise<number> {
  const items = await listCandidates(root)
  const next = type ? items.filter((c) => c.type !== type) : []
  await save(root, next)
  return items.length - next.length
}
