import { isoNow, readTextIfExists, writeFileAtomic } from '../core/fsutil.js'

/**
 * 线索（lead）：把已经采集下来的评论再过一遍，捞出「有购买意向 / 留了联系方式」的人，
 * 供 Web UI 做筛选、分页和导出。不去请求平台接口，只做文本处理和本地落盘。
 */

export interface Contact {
  type: 'phone' | 'wechat' | 'qq'
  value: string
}

export interface Lead {
  /** `${platform}:${commentId}`，跨平台唯一。 */
  id: string
  platform: string
  comment_id: string
  item_id: string
  item_title: string | null
  item_url: string | null
  author_id: string | null
  author_name: string | null
  text: string
  created_at: string | null
  province: string | null
  /** 命中的意向词；没填意向词时为空数组。 */
  matched: string[]
  contacts: Contact[]
  collected_at: string
}

export interface LeadFilter {
  platform?: string
  /** 关键词，匹配评论内容或评论者昵称（不区分大小写）。 */
  q?: string
  province?: string
  hasContact?: boolean
  /** 评论时间的下界 / 上界（ISO 字串，闭区间比较）。 */
  from?: string
  to?: string
  limit?: number
  offset?: number
}

// ---- 文本归一化 ----

/** 全角 → 半角，顺带把各种破折号、不换行空格、零宽字符归一，后面只用一套正则。 */
function normalizeText(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\u3000\u00a0]/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
}

const CN_DIGIT: Record<string, string> = {
  '零': '0', '〇': '0', '○': '0',
  '一': '1', '壹': '1', '幺': '1',
  '二': '2', '贰': '2', '两': '2',
  '三': '3', '叁': '3',
  '四': '4', '肆': '4',
  '五': '5', '伍': '5',
  '六': '6', '陆': '6',
  '七': '7', '柒': '7',
  '八': '8', '捌': '8',
  '九': '9', '玖': '9',
}

/**
 * 至少 4 个中文数字才转（数字之间可以夹一个空格或短横线），
 * 避免把「一起」「一个人」「三五个」这类词改坏。
 */
const CN_RUN = /[零〇○一壹幺二贰两三叁四肆五伍六陆七柒八捌九玖](?:[ -]?[零〇○一壹幺二贰两三叁四肆五伍六陆七柒八捌九玖]){3,}/g

function digitsFromChinese(text: string): string {
  return text.replace(CN_RUN, (run) => [...run].map((ch) => CN_DIGIT[ch] ?? ch).join(''))
}

// ---- 联系方式 ----

interface Hit {
  type: Contact['type']
  value: string
  index: number
  end: number
  /** 同一位置上的优先级：显式前缀 > 手机号 > 上下文推断。 */
  rank: number
}

/** 已脱敏的 `138****1234`，先整段抹掉，免得被后面的规则拆出来。 */
const MASKED_PHONE = /1[3-9]\d[ -]{0,2}\*{2,}[ -]{0,2}\d{4}/g
/** 11 位手机号，允许空格 / 短横线分隔，允许 +86 前缀。 */
const PHONE = /(?<!\d)(?:\+?86[ -]?)?(1[3-9]\d(?:[ -]?\d){8})(?!\d)/g
/** QQ：数字前面必须有 qq / 扣扣 / 企鹅。 */
const QQ_PREFIX = /(?<![A-Za-z])(?:qq|扣扣|企鹅)(?:\s*号)?\s*(?:[:：=]\s*)?(?:是|为)?\s*(?<!\d)(\d{5,12})(?!\d)/gi
/** 纯数字串，给「上下文里有 qq」的兜底用。 */
const DIGIT_RUN = /(?<!\d)\d{5,12}(?!\d)/g
/** 中文前缀的微信：后面可以直接跟账号，也可以跟「号：」「是」。 */
const WECHAT_CN = /(?:微信|薇信|威信)(?:\s*号)?\s*(?:[:：=]\s*)?(?:是|为)?\s*([A-Za-z][A-Za-z0-9_-]{3,29})(?![A-Za-z0-9_-])/g
/** 字母前缀的微信，`wxid_xxx` 这种内部 id 不算。 */
const WECHAT_LATIN = /(?<![A-Za-z])(?:wx|vx|weixin|wechat)(?![A-Za-z])(?:\s*号)?\s*(?:[:：=]\s*)?(?:是|为)?\s*([A-Za-z][A-Za-z0-9_-]{3,29})(?![A-Za-z0-9_-])/gi
/** 单个 v 必须带冒号，否则满篇的英文单词都会中招。 */
const WECHAT_V = /(?<![A-Za-z])v\s*[:：=]\s*(?:是|为)?\s*([A-Za-z][A-Za-z0-9_-]{3,29})(?![A-Za-z0-9_-])/gi

/** 订单号、运单号这类长数字不是联系方式。 */
const ORDER_NOISE = /(订单|单号|运单|快件|快递|物流|编号|票号|流水|工单|order|tracking|invoice)/i
const DATE_LIKE = /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/

function hasOrderNoise(text: string, index: number): boolean {
  return ORDER_NOISE.test(text.slice(Math.max(0, index - 10), index))
}

/**
 * 从一条评论里抽手机号 / 微信 / QQ。
 * 顺序按在原文中出现的先后，重复的只留一次；同一串数字只归一类。
 */
export function extractContacts(text: string): Contact[] {
  if (typeof text !== 'string' || !text) return []
  const source = digitsFromChinese(normalizeText(text)).replace(MASKED_PHONE, (m) => ' '.repeat(m.length))
  const hits: Hit[] = []

  for (const match of source.matchAll(PHONE)) {
    const raw = match[1]
    const value = raw.replace(/[ -]/g, '')
    if (!/^1[3-9]\d{9}$/.test(value)) continue
    const index = (match.index ?? 0) + match[0].lastIndexOf(raw)
    if (hasOrderNoise(source, index)) continue
    hits.push({ type: 'phone', value, index, end: index + raw.length, rank: 1 })
  }

  for (const match of source.matchAll(QQ_PREFIX)) {
    const value = match[1]
    const index = (match.index ?? 0) + match[0].lastIndexOf(value)
    hits.push({ type: 'qq', value, index, end: index + value.length, rank: 0 })
  }

  for (const regex of [WECHAT_CN, WECHAT_LATIN, WECHAT_V]) {
    for (const match of source.matchAll(regex)) {
      const value = match[1]
      const index = match.index ?? 0
      hits.push({ type: 'wechat', value, index, end: index + match[0].length, rank: 0 })
    }
  }

  // 兜底：数字串前面 14 个字里出现过 qq / 扣扣 / 企鹅，也算 QQ（例如「qq 联系我 123456」）。
  for (const match of source.matchAll(DIGIT_RUN)) {
    const value = match[0]
    const index = match.index ?? 0
    const before = source.slice(Math.max(0, index - 14), index)
    if (!/qq|扣扣|企鹅/i.test(before)) continue
    if (DATE_LIKE.test(value)) continue
    if (hasOrderNoise(source, index)) continue
    hits.push({ type: 'qq', value, index, end: index + value.length, rank: 2 })
  }

  hits.sort((a, b) => a.index - b.index || a.rank - b.rank || b.value.length - a.value.length)

  const keyOf = (hit: Hit) => (hit.type === 'wechat' ? `wechat:${hit.value.toLowerCase()}` : `num:${hit.value}`)
  const kept: Hit[] = []
  for (const hit of hits) {
    if (kept.some((k) => hit.index < k.end && k.index < hit.end)) continue
    const key = keyOf(hit)
    if (kept.some((k) => keyOf(k) === key)) continue
    kept.push(hit)
  }
  return kept.map(({ type, value }) => ({ type, value }))
}

// ---- 意向词 ----

/**
 * 意向词 OR 匹配，不区分大小写。返回命中的词（去掉重复，保持传入顺序）。
 * 没填意向词时返回空数组（表示「不做意向过滤」，不是「没命中」）。
 */
export function matchIntent(text: string, intent: string[]): string[] {
  if (!text || !Array.isArray(intent) || !intent.length) return []
  const haystack = text.toLowerCase()
  const seen = new Set<string>()
  const matched: string[] = []
  for (const word of intent) {
    const needle = typeof word === 'string' ? word.trim() : ''
    if (!needle) continue
    const key = needle.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (haystack.includes(key)) matched.push(needle)
  }
  return matched
}

// ---- 组装线索 ----

/** 评论 + 作品 → 线索。province / intent 非空时按它们过滤，按 comment_id 去重。 */
export function buildLeads(input: {
  platform: string
  items: Array<{ id: string; title?: string | null; url?: string | null }>
  comments: Array<{
    id: string
    item_id: string
    parent_id: string | null
    author?: { id?: string | null; name?: string | null } | null
    text: string
    created_at?: string | null
    province?: string | null
  }>
  intent?: string[]
  provinces?: string[]
  collected_at?: string
}): Lead[] {
  const items = new Map<string, { title?: string | null; url?: string | null }>()
  for (const item of input.items) items.set(String(item.id), item)

  const provinces = new Set((input.provinces ?? []).map((p) => String(p).trim()).filter(Boolean))
  const intent = (input.intent ?? []).map((w) => String(w).trim()).filter(Boolean)
  const collectedAt = input.collected_at ?? isoNow()

  const leads: Lead[] = []
  const seen = new Set<string>()
  for (const comment of input.comments) {
    if (!comment?.id || seen.has(comment.id)) continue
    seen.add(comment.id)

    const province = typeof comment.province === 'string' ? comment.province.trim() : ''
    // 省份为空视为不匹配：宁可漏，也不要把不知道地域的人塞进某个省。
    if (provinces.size && (!province || !provinces.has(province))) continue

    const text = typeof comment.text === 'string' ? comment.text : ''
    const matched = intent.length ? matchIntent(text, intent) : []
    if (intent.length && !matched.length) continue

    const item = items.get(String(comment.item_id))
    leads.push({
      id: `${input.platform}:${comment.id}`,
      platform: input.platform,
      comment_id: comment.id,
      item_id: comment.item_id,
      item_title: item?.title ?? null,
      item_url: item?.url ?? null,
      author_id: comment.author?.id ?? null,
      author_name: comment.author?.name ?? null,
      text,
      created_at: comment.created_at ?? null,
      province: province || null,
      matched,
      contacts: extractContacts(text),
      collected_at: collectedAt,
    })
  }
  return leads
}

// ---- CSV ----

const CSV_COLUMNS = ['平台', '评论者', '评论内容', '联系方式', '地域', '命中词', '评论时间', '作品标题', '作品链接', '评论者ID', '采集时间'] as const

function escapeCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** 手机号 138****1234；微信 / QQ 保留首尾，中间打星（长度 ≤ 5 不遮）。 */
function maskContact(contact: Contact): string {
  const { value } = contact
  if (contact.type === 'phone') {
    return value.length < 8 ? value : `${value.slice(0, 3)}****${value.slice(-4)}`
  }
  if (value.length <= 5) return value
  return `${value.slice(0, 2)}${'*'.repeat(value.length - 4)}${value.slice(-2)}`
}

function contactsCell(contacts: Contact[], mask: boolean): string {
  return contacts.map((c) => `${c.type}:${mask ? maskContact(c) : c.value}`).join(';')
}

/** 导出 CSV：带 UTF-8 BOM 给 Excel，字段按 RFC 4180 转义，行尾 CRLF。 */
export function toCsv(leads: Lead[], options: { mask?: boolean } = {}): string {
  const mask = options.mask === true
  const rows = leads.map((lead) => [
    lead.platform,
    lead.author_name ?? lead.author_id ?? '',
    lead.text,
    contactsCell(lead.contacts ?? [], mask),
    lead.province ?? '',
    (lead.matched ?? []).join(';'),
    lead.created_at ?? '',
    lead.item_title ?? '',
    lead.item_url ?? '',
    lead.author_id ?? '',
    lead.collected_at,
  ])
  const lines = [CSV_COLUMNS.join(','), ...rows.map((row) => row.map(escapeCsv).join(','))]
  return `\ufeff${lines.map((line) => `${line}\r\n`).join('')}`
}

// ---- 存储 ----

const CONTACT_TYPES = new Set<Contact['type']>(['phone', 'wechat', 'qq'])

/** 从 jsonl 里读回来的一行；字段缺了补默认值，结构不对就整行丢掉。 */
function coerceLead(value: unknown): Lead | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const nullable = (v: unknown) => (typeof v === 'string' ? v : null)
  const id = nullable(raw.id)
  const commentId = nullable(raw.comment_id)
  const platform = nullable(raw.platform)
  if (!id || !commentId || !platform) return null

  const contacts: Contact[] = []
  if (Array.isArray(raw.contacts)) {
    for (const entry of raw.contacts) {
      if (!entry || typeof entry !== 'object') continue
      const { type, value: contactValue } = entry as { type?: unknown; value?: unknown }
      if (typeof type !== 'string' || !CONTACT_TYPES.has(type as Contact['type'])) continue
      if (typeof contactValue !== 'string' || !contactValue) continue
      contacts.push({ type: type as Contact['type'], value: contactValue })
    }
  }

  return {
    id,
    platform,
    comment_id: commentId,
    item_id: nullable(raw.item_id) ?? '',
    item_title: nullable(raw.item_title),
    item_url: nullable(raw.item_url),
    author_id: nullable(raw.author_id),
    author_name: nullable(raw.author_name),
    text: typeof raw.text === 'string' ? raw.text : '',
    created_at: nullable(raw.created_at),
    province: nullable(raw.province),
    matched: Array.isArray(raw.matched) ? raw.matched.filter((m): m is string => typeof m === 'string') : [],
    contacts,
    collected_at: nullable(raw.collected_at) ?? isoNow(),
  }
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

/**
 * 线索库：一行一个 Lead 的 jsonl，读的时候跳过坏行，写的时候整份原子重写。
 * 数据量是「评论级」的（万级以内），整读整写足够，不需要索引。
 */
export class LeadStore {
  constructor(private readonly file: string) {}

  async load(): Promise<Lead[]> {
    const raw = await readTextIfExists(this.file)
    if (!raw) return []
    const leads = new Map<string, Lead>()
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let parsed: unknown
      try { parsed = JSON.parse(trimmed) } catch { continue }
      const lead = coerceLead(parsed)
      // 同一个 id 以最后一行为准（upsert 会重写整份文件，正常不会有重复）。
      if (lead) leads.set(lead.id, lead)
    }
    return [...leads.values()]
  }

  /** 按 id 合并后原子重写；返回新增了多少条（更新不算新增）。 */
  async upsert(leads: Lead[]): Promise<{ added: number; total: number }> {
    const current = await this.load()
    const byId = new Map(current.map((lead) => [lead.id, lead]))
    let added = 0
    for (const lead of leads) {
      if (!lead?.id) continue
      if (!byId.has(lead.id)) added++
      byId.set(lead.id, lead)
    }
    const lines = [...byId.values()].map((lead) => JSON.stringify(lead))
    await writeFileAtomic(this.file, lines.length ? `${lines.join('\n')}\n` : '')
    return { added, total: byId.size }
  }

  /** 过滤 + 倒序（新的在前，时间为空的排最后）+ 分页；total 是过滤后的总数。 */
  async query(filter: LeadFilter = {}, maxLimit = MAX_LIMIT): Promise<{ items: Lead[]; total: number }> {
    const leads = await this.load()
    const terms = (filter.q ?? '').trim().toLowerCase().split(/[\s/]+/).filter(Boolean)
    const province = filter.province?.trim()
    const from = filter.from?.trim()
    const to = filter.to?.trim()

    const matched = leads.filter((lead) => {
      if (filter.platform && lead.platform !== filter.platform) return false
      if (province && lead.province !== province) return false
      if (filter.hasContact !== undefined && (lead.contacts.length > 0) !== filter.hasContact) return false
      if (from || to) {
        if (!lead.created_at) return false
        if (from && lead.created_at < from) return false
        if (to && lead.created_at > to) return false
      }
      if (terms.length) {
        const haystack = `${lead.text} ${lead.author_name ?? ''}`.toLowerCase()
        if (!terms.some((term) => haystack.includes(term))) return false
      }
      return true
    })

    const order = new Map(leads.map((lead, index) => [lead.id, index]))
    matched.sort((a, b) =>
      (b.created_at ?? '').localeCompare(a.created_at ?? '') ||
      (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    )

    const offset = Math.max(0, Math.trunc(filter.offset ?? 0))
    const cap = Math.max(MAX_LIMIT, Math.trunc(maxLimit))
    const limit = Math.min(cap, Math.max(0, Math.trunc(filter.limit ?? DEFAULT_LIMIT)))
    return { items: matched.slice(offset, offset + limit), total: matched.length }
  }

  async clear(): Promise<void> {
    await writeFileAtomic(this.file, '')
  }
}
