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

export interface CandidateInput {
  type: CandidateType
  platform: string
  itemId: string
  commentId?: string
  userId?: string
  userName?: string
  note?: string
}

export interface AddCandidatesResult {
  /** 这次新加进去的候选（顺序和输入一致）。 */
  added: Candidate[]
  /** 已经存在、被去重挡下的那一条（用来回显原来的 id）。 */
  existing: Candidate[]
  /** 输入不合法（缺 platform/itemId，或 reply 缺 commentId、dm 缺 userId）被跳过的条数。 */
  invalid: number
}

function validate(input: CandidateInput): void {
  if (!input.platform || !input.itemId) throw new CatbusError('USAGE', '候选需要 platform 和 itemId')
  if (input.type === 'reply' && !input.commentId) throw new CatbusError('USAGE', '回复候选需要 commentId')
  if (input.type === 'dm' && !input.userId) throw new CatbusError('USAGE', '私信候选需要 userId')
}

/** 去重键：同一个人同一条评论只留一份（私信按用户去重，所以不带 commentId）。 */
function keyOf(input: { type: CandidateType; platform: string; itemId: string; commentId?: string | null; userId?: string | null }): string {
  return [input.type, input.platform, input.itemId, input.commentId ?? '', input.userId ?? ''].join('\u0000')
}

/**
 * 批量入池：一次读、内存里判重、一次写。
 * 逐条调用会变成「每条都整份读 + 整份重写」，勾 300 条就是 600 次全量文件 IO。
 */
export async function addCandidates(root: string, inputs: CandidateInput[]): Promise<AddCandidatesResult> {
  const result: AddCandidatesResult = { added: [], existing: [], invalid: 0 }
  if (!inputs.length) return result

  const items = await listCandidates(root)
  const known = new Map(items.map((item) => [keyOf(item), item]))
  const at = new Date().toISOString()
  for (const input of inputs) {
    try { validate(input) } catch { result.invalid++; continue }
    const key = keyOf(input)
    const hit = known.get(key)
    if (hit) { result.existing.push(hit); continue }
    const candidate: Candidate = {
      id: randomUUID(),
      type: input.type,
      platform: input.platform,
      itemId: input.itemId,
      commentId: input.commentId ?? null,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      note: input.note ?? null,
      added_at: at,
    }
    items.push(candidate)
    known.set(key, candidate)
    result.added.push(candidate)
  }
  if (result.added.length) await save(root, items)
  return result
}

/** 单条入池（保留原有语义）：重复时回传已有的那条，输入不合法抛 USAGE。 */
export async function addCandidate(root: string, input: CandidateInput): Promise<{ candidate: Candidate; added: boolean }> {
  validate(input)
  const result = await addCandidates(root, [input])
  return result.added.length
    ? { candidate: result.added[0]!, added: true }
    : { candidate: result.existing[0]!, added: false }
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
