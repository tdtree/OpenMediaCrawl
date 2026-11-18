import protobuf from 'protobufjs'
import { CatbusError } from '../../../core/errors.js'
import * as n from '../../../core/normalize.js'
import { jsonLoads, urlencode } from '../../../core/py.js'
import type { HandlerContext } from '../../../core/registry.js'
import type { Event, Message, Media } from '../../../core/schemas.js'
import { openSocket, reconnecting } from '../../../core/stream.js'
import * as api from './api.js'
import type { Douyin } from './client.js'
import { frontierUrl } from './im.js'
import * as norm from './normalize.js'
import * as proto from './proto.js'
import { APP_VERSION, LIVE, Params, PROFILE, WWW } from './profile.js'
import { liveSignature } from './sign.js'

/** 直播弹幕与私信的长连接（上游 dy_live/server.py、dy_apis/douyin_recv_msg.py）。 */

// ================================================================ 直播弹幕

export interface LiveSocket {
  url: string
  headers: Record<string, string>
}

/** im/fetch 的响应（LiveResponse）；不是 protobuf 时多为登录态失效或被风控，报 UPSTREAM。 */
export function decodeFetch(raw: Uint8Array): any {
  try {
    return proto.decode('Live', 'LiveResponse', proto.inflate(raw))
  } catch {
    throw new CatbusError('UPSTREAM', `im/fetch 返回的不是 protobuf（${raw.length} 字节），多为登录态失效或被风控`, { detail: { bytes: raw.length } })
  }
}

/** 先 im/fetch 取 cursor / internalExt，再拼 wss 地址（上游 DouyinLive.start_ws）。 */
export async function liveSocket(d: Douyin, info: api.LiveInfo, webRid: string): Promise<LiveSocket> {
  const fetched = decodeFetch(await api.webcastFetch(d, info.user_id, info.room_id, `${LIVE}/${webRid}`))
  const p = new Params()
  p.add('app_name', 'douyin_web').add('version_code', '180800').add('webcast_sdk_version', '1.0.15').add('update_version_code', '1.0.15')
  p.add('compress', 'gzip').add('device_platform', 'web').add('cookie_enabled', 'true').add('screen_width', '1707').add('screen_height', '960')
  p.add('browser_language', 'zh-CN').add('browser_platform', 'Win32').add('browser_name', 'Mozilla').add('browser_version', APP_VERSION)
  p.add('browser_online', 'true').add('tz_name', 'Etc/GMT-8').add('cursor', fetched.cursor ?? '').add('internal_ext', fetched.internalExt ?? '')
  p.add('host', LIVE).add('aid', '6383').add('live_id', '1').add('did_rule', '3').add('endpoint', 'live_pc').add('support_wrds', '1')
  p.add('user_unique_id', info.user_id).add('im_path', '/webcast/im/fetch/').add('identity', 'audience').add('need_persist_msg_count', '15')
  p.add('insert_task_id', '').add('live_reason', '').add('room_id', info.room_id).add('heartbeatDuration', '0')
  p.add('signature', liveSignature(d.xb, info.room_id, info.user_id))
  return {
    url: `wss://webcast100-ws-web-hl.douyin.com/webcast/im/push/v2/?${urlencode(p.pairs())}`,
    headers: {
      Pragma: 'no-cache',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      'User-Agent': PROFILE.ua,
      'Cache-Control': 'no-cache',
      Cookie: d.cookieStr,
      Origin: LIVE,
    },
  }
}

const LIVE_TYPES: Record<string, string> = {
  WebcastChatMessage: 'ChatMessage',
  WebcastGiftMessage: 'GiftMessage',
  WebcastMemberMessage: 'MemberMessage',
  WebcastLikeMessage: 'LikeMessage',
  WebcastSocialMessage: 'SocialMessage',
  WebcastRoomStatsMessage: 'RoomStatsMessage',
}

/**
 * 消息的发送时间：各 Webcast*Message 的字段 1 是公共头 Common，其中字段 4 是 createTime（毫秒）。
 * 随包的 Live.proto（上游原样）没有声明 Common，这里用 protobufjs 的 Reader 直接读，取不到时为 null。
 */
export function messageTime(payload: Uint8Array): string | null {
  try {
    const r = protobuf.Reader.create(payload)
    while (r.pos < r.len) {
      const tag = r.uint32()
      if (tag >>> 3 !== 1 || (tag & 7) !== 2) {
        r.skipType(tag & 7)
        continue
      }
      const common = protobuf.Reader.create(r.bytes())
      while (common.pos < common.len) {
        const t = common.uint32()
        if (t >>> 3 === 4 && (t & 7) === 0) return n.time(common.uint64().toString())
        common.skipType(t & 7)
      }
      return null
    }
  } catch {}
  return null
}

/** LiveResponse 的 messagesList → Event[]，不关心的消息跳过。时间取消息自带的 createTime。 */
function responseEvents(res: any): Event[] {
  const events: Event[] = []
  for (const item of res.messagesList ?? []) {
    const name = LIVE_TYPES[item.method]
    if (!name) continue
    const event = norm.liveEvent(item.method, proto.decode('Live', name, item.payload))
    if (!event) continue
    const time = messageTime(item.payload)
    if (time) event.time = time
    events.push(event)
  }
  return events
}

/** 一帧推送 → 事件；需要 ack 时返回 ack 帧（上游 on_message）。 */
export function liveFrame(raw: Uint8Array): { events: Event[]; ack: Uint8Array | null } {
  const t = proto.type('Live', 'PushFrame')
  const frame = t.decode(raw) as any
  if (frame.payloadType === 'hb' || frame.payloadType === 'ack' || !frame.payload?.length) return { events: [], ack: null }
  const res = proto.decode('Live', 'LiveResponse', proto.inflate(frame.payload))
  const ack = res.needAck ? t.encode(t.fromObject({ payloadType: 'ack', payload: Buffer.from(String(res.internalExt ?? ''), 'utf8'), logId: frame.logId })).finish() : null
  return { events: responseEvents(res), ack }
}

/** 进房时 im/fetch 的响应（LiveResponse，need_persist_msg_count=15）里带回的最近消息。 */
export function fetchEvents(raw: Uint8Array): Event[] {
  return responseEvents(decodeFetch(raw))
}

export const heartbeatFrame = () => proto.encode('Live', 'PushFrame', { payloadType: 'hb' })

/** 直播间页面解析不出房间信息：房间号不对，或者直播已经结束。 */
export function roomNotFound(webRid: string): CatbusError {
  return new CatbusError('UPSTREAM', `未能解析直播间信息：${webRid}`, { hint: '确认直播间号，或者直播已经结束' })
}

/**
 * 弹幕长连。进入重连循环之前先解析一次房间：房间号无效时直接报 UPSTREAM，不当成断线一直重连。
 * 重连时重新取房间信息（重新开播后 room_id 会变），取不到同样报 UPSTREAM，由 core 连续 5 次后放弃。
 */
export async function* listenLive(ctx: HandlerContext, d: Douyin, webRid: string): AsyncIterable<Event> {
  const first = await api.liveInfo(d, webRid)
  if (!first) throw roomNotFound(webRid)
  yield* reconnecting(ctx, async function* (attempt) {
    const info = attempt === 0 ? first : await api.liveInfo(d, webRid)
    if (!info) throw roomNotFound(webRid)
    const s = await liveSocket(d, info, webRid)
    const socket = await openSocket(s.url, { headers: s.headers, proxy: ctx.config.proxy ?? undefined, signal: ctx.signal })
    const beat = setInterval(() => void socket.send(heartbeatFrame()).catch(() => {}), 5000).unref()
    try {
      for await (const raw of socket.messages) {
        if (typeof raw === 'string') continue
        try {
          const { events, ack } = liveFrame(raw)
          if (ack) await socket.send(ack).catch(() => {})
          yield* events
        } catch (err) {
          ctx.log.debug(`解析直播消息失败：${(err as Error).message}`)
        }
      }
    } finally {
      clearInterval(beat)
      socket.close()
    }
  })
}

// ================================================================ 私信

/** frontier-im 的 wss 地址与握手头（上游 DouyinRecvMsg）。 */
export async function frontierSocket(d: Douyin): Promise<LiveSocket> {
  const deviceId = await api.deviceId(d)
  return {
    url: frontierUrl(String(deviceId), d.cookie('sessionid') ?? ''),
    headers: {
      Pragma: 'no-cache',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
      'User-Agent': PROFILE.ua,
      'Cache-Control': 'no-cache',
      'Sec-WebSocket-Protocol': 'binary, base64, pbbp2',
      Cookie: d.cookieStr,
      Origin: WWW,
    },
  }
}

const MSG_TYPES: Record<number, Message['type']> = { 7: 'text', 27: 'image', 30: 'video', 8: 'card', 77: 'card', 25: 'card', 26: 'card' }

/** 新消息推送 → Message；已读回执等返回 null（上游 on_message）。 */
export function imFrame(raw: Uint8Array): Message | null {
  const frame = proto.decode('Live', 'PushFrame', raw)
  if (frame.payloadType !== 'pb' || !frame.payload) return null
  const res = proto.decode('Response', 'Response', frame.payload)
  const m = res.body?.new_message_notify?.message
  if (!m) return null
  const type = Number(m.message_type)
  if (type === 50001) return null
  let content: any = {}
  try {
    content = jsonLoads(m.content ?? '{}')
  } catch {}
  const media: Media[] = []
  const url = (x: any) => n.url(x?.origin_url_list?.[0] ?? x?.url_list?.[0])
  if (type === 27 && url(content.resource_url)) media.push(n.media({ type: 'image', url: url(content.resource_url)! }))
  if (type === 5 && url(content.url)) media.push(n.media({ type: 'image', url: url(content.url)! }))
  if (type === 17 && url(content.resource_url)) media.push(n.media({ type: 'audio', url: url(content.resource_url)! }))
  const msg = n.message(
    {
      id: n.id(m.server_message_id),
      conversation_id: String(m.conversation_id ?? ''),
      from: n.userRef({ id: m.sender }),
      type: MSG_TYPES[type] ?? 'other',
      text: type === 7 ? n.str(content.text) : type === 8 ? n.str(content.itemId) : null,
      media,
    },
    m,
  )
  // 推送帧自带 create_time（秒），但 normalize 只从下载器字段取时间，这里补一次，
  // 免得自动回复要自己按收到时刻估算。
  if (!msg.created_at && m.create_time) {
    const sec = Number(m.create_time)
    if (Number.isFinite(sec) && sec > 0) msg.created_at = new Date(sec * 1000).toISOString()
  }
  return msg
}

/**
 * 最近见过的消息 id（有界去重）。重连后服务端会重放最近的消息（实测：一次重连连收两条旧消息），
 * 同一个 id 只输出一次。服务端没给 server_message_id（空或 0）的帧不参与去重，否则会被并成一条。
 */
export class RecentIds {
  private readonly ids = new Set<string>()

  constructor(private readonly limit: number = 2000) {}

  /** 第一次见到返回 true；窗口内重复返回 false。超出窗口时丢掉最早的那个 id。 */
  add(id: string): boolean {
    if (!id || id === '0') return true
    if (this.ids.has(id)) return false
    this.ids.add(id)
    if (this.ids.size > this.limit) {
      const oldest = this.ids.values().next().value
      if (oldest != null) this.ids.delete(oldest)
    }
    return true
  }

  get size(): number {
    return this.ids.size
  }
}

export interface ListenMessagesOptions {
  /** 按 message id 去重，默认开启。关掉后重连重放的消息会重复输出（与加这个开关之前一样）。 */
  dedupe?: boolean
  /** 去重窗口：记住最近多少条 id，默认 2000。 */
  dedupeWindow?: number
  /** 重连退避上限（毫秒），默认 15 秒。 */
  maxDelay?: number
}

/** 推送帧流 → Message 流：解析失败只记 debug 跳过；`recent` 不为空时丢掉窗口内重复的 id。 */
export async function* frameMessages(ctx: HandlerContext, frames: AsyncIterable<string | Buffer>, recent: RecentIds | null): AsyncGenerator<Message> {
  for await (const raw of frames) {
    if (typeof raw === 'string') continue
    let msg: Message | null
    try {
      msg = imFrame(raw)
    } catch (err) {
      ctx.log.debug(`解析私信推送失败：${(err as Error).message}`)
      continue
    }
    if (!msg) continue
    if (recent && !recent.add(String(msg.id))) {
      ctx.log.debug(`跳过重连重放的私信：${msg.id}`)
      continue
    }
    yield msg
  }
}

/**
 * 私信长连：断线自动重连，重连后服务端重放的消息按 id 去重（见 {@link RecentIds}）。
 * 退避上限 15 秒（比弹幕的 30 秒短）：私信是推送型的，连不上就一直漏，宁可多试几次。
 */
export function listenMessages(ctx: HandlerContext, d: Douyin, options: ListenMessagesOptions = {}): AsyncIterable<Message> {
  // 去重窗口挂在重连循环外面：重连后服务端会重放最近的消息，跨连接也要认得出同一个 id。
  const recent = (options.dedupe ?? true) ? new RecentIds(options.dedupeWindow ?? 2000) : null
  return reconnecting(
    ctx,
    async function* () {
      const s = await frontierSocket(d)
      const socket = await openSocket(s.url, { headers: s.headers, proxy: ctx.config.proxy ?? undefined, signal: ctx.signal })
      try {
        yield* frameMessages(ctx, socket.messages, recent)
      } finally {
        socket.close()
      }
    },
    { maxDelay: options.maxDelay ?? 15_000 },
  )
}
