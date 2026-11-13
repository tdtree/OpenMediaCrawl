import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { appendFile, mkdir } from 'node:fs/promises'
import { isoNow, readTextIfExists } from '../core/fsutil.js'

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
}): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: randomUUID(),
    platform: input.platform,
    peerId: input.peerId,
    peerName: input.peerName ?? null,
    direction: input.direction,
    text: input.text,
    at: isoNow(),
    status: input.status ?? (input.direction === 'out' ? 'sent' : 'received'),
  }
  await mkdir(root, { recursive: true })
  await appendFile(file(root), JSON.stringify(message) + '\n', 'utf8')
  return message
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
      out.push(row)
    } catch {
      // 坏行跳过，别让一行脏数据让整个会话打不开
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
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
export async function hasMessage(root: string, input: { platform: string; peerId: string; text: string; direction: ChatDirection; at?: string }): Promise<boolean> {
  const list = await listChat(root, { platform: input.platform, peerId: input.peerId })
  return list.some((row) => row.text === input.text && row.direction === input.direction && (input.at ? row.at.slice(0, 16) === input.at.slice(0, 16) : true))
}
