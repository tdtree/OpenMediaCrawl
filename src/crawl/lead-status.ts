import { join } from 'node:path'
import { listCandidates, type Candidate } from './candidates.js'
import { SendLedger, type SentRecord } from './guard.js'
import type { Lead } from './leads.js'

/**
 * 线索 / 候选的「已私聊、已入池」状态。
 *
 * 两条读取原则：
 * - **账本和候选池是唯一真源**。这两个状态不写进 leads.jsonl（线索文件只存采集到的事实），
 *   每次读线索时按索引关联出来；
 * - 一次把两份集合读进来建索引，再逐条标注，**绝不「每条线索去读一次文件」**。
 */

/** 一次性建好的索引，给一次请求内的所有线索复用。 */
export interface LeadStatusIndex {
  /** `${platform}:${userId}` → 最近一次**成功**私信的时间（ISO 8601）。 */
  dmSentAt: Map<string, string>
  /** `${platform}:${userId ?? commentId}`：私信候选按用户、回复候选按评论。 */
  inPool: Set<string>
}

/** `${platform}:${id}`；缺一边就返回 null，免得把空 id 拼成一个能误命中的键。 */
function statusKey(platform: string, id: string | null | undefined): string | null {
  const p = String(platform ?? '').trim()
  const v = String(id ?? '').trim()
  return p && v ? `${p}:${v}` : null
}

/** 时间比较：解析不了的当「更旧」，不让一条坏时间盖掉真实的最新时间。 */
function newerThan(candidate: string, current: string | undefined): boolean {
  if (current === undefined) return true
  const a = Date.parse(candidate)
  const b = Date.parse(current)
  if (Number.isNaN(a)) return false
  if (Number.isNaN(b)) return true
  return a > b
}

/**
 * 账本 → 私信索引。
 *
 * 只认 `kind === 'dm'` 且 `ok === true`：`canSend` 也是这么判「已发送过」的，
 * 失败过的那次应该还能再发一次（见 SendLedger）。
 */
export function indexSent(records: SentRecord[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const record of records) {
    if (record.kind !== 'dm' || record.ok !== true) continue
    const key = statusKey(record.platform, record.target)
    if (!key) continue
    if (newerThan(record.at, out.get(key))) out.set(key, record.at)
  }
  return out
}

/** 候选池 → 入池索引：私信候选记 userId，回复候选记 commentId。 */
export function indexPool(candidates: Candidate[]): Set<string> {
  const out = new Set<string>()
  for (const candidate of candidates) {
    const key = statusKey(candidate.platform, candidate.userId ?? candidate.commentId)
    if (key) out.add(key)
  }
  return out
}

/**
 * 读一次账本 + 候选池，建好索引。读失败不吞：宁可让调用方看见错误，
 * 也不要把「读不出来」静默渲染成「都没私聊过」。
 */
export async function loadLeadStatus(root: string): Promise<LeadStatusIndex> {
  const [records, candidates] = await Promise.all([
    new SendLedger(join(root, 'sent.jsonl')).records(),
    listCandidates(root),
  ])
  return { dmSentAt: indexSent(records), inPool: indexPool(candidates) }
}

/** 某人最近一次成功私信的时间；没发过返回 null。 */
export function dmSentAt(index: LeadStatusIndex, platform: string, target: string | null | undefined): string | null {
  const key = statusKey(platform, target)
  return key ? index.dmSentAt.get(key) ?? null : null
}

/**
 * 这条线索的人 / 这条评论是不是已经在候选池里：
 * 私信候选按评论作者匹配，回复候选按评论 id 匹配。
 */
export function leadInPool(index: LeadStatusIndex, lead: Lead): boolean {
  for (const id of [lead.author_id, lead.comment_id]) {
    const key = statusKey(lead.platform, id)
    if (key && index.inPool.has(key)) return true
  }
  return false
}

/**
 * 给每条线索挂上两个**只读**关联字段（`dm_sent_at` / `in_pool`），返回新对象。
 *
 * 结果只用于这次响应，不要回写 leads.jsonl：账本才是「发过没有」的唯一真源，
 * 写进线索文件会和账本各说一套（比如换了账号重发、账本被清空）。
 */
export function annotateLeads(leads: Lead[], index: LeadStatusIndex): Lead[] {
  return leads.map((lead) => {
    const sentAt = dmSentAt(index, lead.platform, lead.author_id)
    const pooled = leadInPool(index, lead)
    const out: Lead = { ...lead }
    // 只挂有值的字段：没有就是没有，不写 null 让调用方多一层判断。
    if (sentAt) out.dm_sent_at = sentAt
    if (pooled) out.in_pool = true
    return out
  })
}
