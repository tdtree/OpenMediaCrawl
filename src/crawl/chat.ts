import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { appendFile, mkdir } from 'node:fs/promises'
import { isoNow, readTextIfExists, writeFileAtomic } from '../core/fsutil.js'

export type ChatDirection = 'out' | 'in'

/** 一条私信记录。本地只存自己的发送记录；平台支持 history 时再补对方的消息。 */
export interface ChatMessage {
  id: string
  platform: string
  peerId: string
  peerName: string | null
  direction: ChatDirection
  text: string
  at: string
  status: 'sent' | 'failed' | 'received'
  /** 随消息带的媒体（图片/视频等）；历史同步和发图时写入，渲染层据此出缩略图。 */
  media?: Array<{ type: string; url: string }>
}

export interface ChatThread {
  platform: string
  peerId: string
  peerName: string | null
  count: number
  last: Pick<ChatMessage, 'text' | 'at' | 'direction' | 'status'>
}

const file = (root: string) => join(root, 'chat.jsonl')

export async function appendChat(root: string, input: {
  platform: string
  peerId: string
  peerName?: string | null
  direction: ChatDirection
  text: string
  status?: ChatMessage['status']
  media?: Array<{ type: string; url: string }>
  /** 平台返回的原始时间；历史同步必须传，否则所有旧消息都会被盖上「导入时刻」。 */
  at?: string
}): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: randomUUID(),
    platform: input.platform,
    peerId: input.peerId,
    peerName: input.peerName ?? null,
    direction: input.direction,
    text: input.text,
    at: input.at ?? isoNow(),
    status: input.status ?? (input.direction === 'out' ? 'sent' : 'received'),
    ...(input.media && input.media.length ? { media: input.media } : {}),
  }
  await mkdir(root, { recursive: true })
  await appendFile(file(root), JSON.stringify(message) + '\n', 'utf8')
  return message
}


/**
 * 有些平台的图片消息，正文本身就是一段 JSON（小红书就是 `imageDataMap` 那一坨）。
 * 直接当文本渲染会看到满屏花括号，所以读取时先试着还原成媒体：
 * 认得出来就把正文清空、media 补上；认不出来原样返回。
 */
const IMAGE_KEYS = ['imageDataMap', 'imageFileId', 'originSize', 'asset_length']

export function parseMediaText(text: string): { text: string; media: Array<{ type: string; url: string }> } {
  const raw = String(text ?? '').trim()
  if (!raw.startsWith('{') || raw.length < 40) return { text: raw, media: [] }
  let obj: Record<string, unknown>
  try { obj = JSON.parse(raw) as Record<string, unknown> } catch { return { text: raw, media: [] } }
  if (!obj || typeof obj !== 'object') return { text: raw, media: [] }
  const hit = IMAGE_KEYS.some((key) => key in obj) || 'picJumpLink' in obj
  if (!hit) return { text: raw, media: [] }
  const urls: string[] = []
  const push = (value: unknown): void => {
    const url = typeof value === 'string' ? value.trim() : ''
    if (!/^https?:\/\//i.test(url)) return
    if (!urls.includes(url)) urls.push(url)
  }
  const map = obj.imageDataMap as Record<string, { url?: string }> | undefined
  if (map && typeof map === 'object') {
    // 一张图在 imageDataMap 里有三个尺寸的同一地址，只取一个：
    // 优先 IM_PRV（640 宽，列表够用又不至于太大），没有再退 IM_ORG / IM_DTL
    for (const scene of ['IM_PRV', 'IM_ORG', 'IM_DTL']) {
      push(map[scene]?.url)
      if (urls.length) break
    }
  }
  // 只有拿不到 imageDataMap 时才回退到 link / pics，否则同一张图会被算成多条
  if (!urls.length) push(obj.link)
  if (!urls.length && Array.isArray(obj.pics)) for (const one of obj.pics) push(one)
  if (!urls.length) return { text: raw, media: [] }
  return { text: '', media: urls.slice(0, 9).map((url) => ({ type: 'image', url })) }
}

/** 整份重写 chat.jsonl（原子替换）：只在修正历史时间这类迁移场景用。 */
export async function rewriteChat(root: string, messages: ChatMessage[]): Promise<void> {
  await mkdir(root, { recursive: true })
  const body = messages.map((message) => JSON.stringify(message)).join('\n')
  await writeFileAtomic(file(root), body ? `${body}\n` : '')
}

export async function listChat(root: string, filter: { platform?: string; peerId?: string } = {}): Promise<ChatMessage[]> {
  const raw = await readTextIfExists(file(root))
  if (!raw) return []
  const out: ChatMessage[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as ChatMessage
      if (!row?.id || !row.platform || !row.peerId) continue
      if (filter.platform && row.platform !== filter.platform) continue
      if (filter.peerId && row.peerId !== filter.peerId) continue
      // 旧数据里图片消息的正文是 JSON，读取时还原成媒体（不迁移文件也能正常显示）
      if (row.text && row.text.trim().startsWith('{') && !(row.media && row.media.length)) {
        const parsed = parseMediaText(row.text)
        if (parsed.media.length) {
          row.text = parsed.text
          row.media = parsed.media
        }
      }
      out.push(row)
    } catch {
      // 坏行跳过，别让一行脏数据让整个会话打不开
    }
  }
  // 按真实时间升序排（旧的在上、新的在下）。
  // 不能直接 a.at.localeCompare(b.at)：历史同步写入的 at 有 ISO 带时区(+08:00)、
  // 有 UTC 带 Z、还有平台原样返回的字符串，纯字符串比较会把同一时刻排错位，
  // 看起来就是「聊天记录混乱」。先解析成时间戳再比，解析不了的退回文件顺序。
  const decorated = out.map((message, index) => ({ message, index, t: Date.parse(message.at) }))
  decorated.sort((a, b) => {
    const aOk = Number.isFinite(a.t)
    const bOk = Number.isFinite(b.t)
    if (aOk && bOk && a.t !== b.t) return a.t - b.t
    if (aOk !== bOk) return aOk ? -1 : 1 // 能解析的排前面，脏数据沉底
    return a.index - b.index            // 同一时刻保持写入顺序
  })
  return decorated.map((item) => item.message)
}

export async function listThreads(root: string): Promise<ChatThread[]> {
  const all = await listChat(root)
  const map = new Map<string, ChatThread>()
  for (const message of all) {
    const key = `${message.platform}:${message.peerId}`
    const thread = map.get(key)
    if (!thread) {
      map.set(key, {
        platform: message.platform,
        peerId: message.peerId,
        peerName: message.peerName,
        count: 1,
        last: { text: message.text, at: message.at, direction: message.direction, status: message.status },
      })
      continue
    }
    thread.count += 1
    thread.peerName = message.peerName ?? thread.peerName
    thread.last = { text: message.text, at: message.at, direction: message.direction, status: message.status }
  }
  return [...map.values()].sort((a, b) => b.last.at.localeCompare(a.last.at))
}

/** 同一个 peer 同一条文本同方向算重复，避免 history 反复同步堆重复消息。 */
export async function hasMessage(
  root: string,
  input: { platform: string; peerId: string; text: string; direction: ChatDirection; at?: string; withinMs?: number },
): Promise<boolean> {
  const list = await listChat(root, { platform: input.platform, peerId: input.peerId })
  const want = input.at ? Date.parse(input.at) : NaN
  return list.some((row) => {
    if (row.text !== input.text || row.direction !== input.direction) return false
    if (!input.at) return true
    // 发送记录（本地时间）与历史同步（平台时间）能差好几分钟，
    // 精确到分钟会把同一条消息判成两条，历史里就出现重复。
    const got = Date.parse(row.at)
    if (!Number.isFinite(want) || !Number.isFinite(got)) return row.at.slice(0, 16) === input.at.slice(0, 16)
    const tolerance = Math.max(60_000, input.withinMs ?? 60_000)
    return Math.abs(got - want) <= tolerance
  })
}

/** 找到同一会话里「内容+方向相同、时间接近」的那条，用于修正历史时间。 */
export async function findNear(
  root: string,
  input: { platform: string; peerId: string; text: string; direction: ChatDirection; at: string; withinMs: number },
): Promise<ChatMessage | undefined> {
  const list = await listChat(root, { platform: input.platform, peerId: input.peerId })
  const want = Date.parse(input.at)
  return list.find((row) => {
    if (row.text !== input.text || row.direction !== input.direction) return false
    const got = Date.parse(row.at)
    return Number.isFinite(want) && Number.isFinite(got) && Math.abs(got - want) <= input.withinMs
  })
}
