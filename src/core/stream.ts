import { websocket, type WebSocketOptions } from 'wreq-js'
import { CatbusError } from './errors.js'
import { toNetworkError } from './http.js'
import { now, random, sleep } from './rand.js'
import type { HandlerContext } from './registry.js'

/** 长连接（AGENTS 4.9「长连接」）：WebSocket 包装成异步迭代，断线自动重连。 */

export interface Socket {
  send(data: string | Uint8Array): Promise<void>
  close(): void
  messages: AsyncIterable<string | Buffer>
}

/** 打开一个 WebSocket。消息按到达顺序进入 messages；连接关闭或 signal 中止时迭代结束，出错时抛出。 */
export async function openSocket(url: string, options: WebSocketOptions & { signal?: AbortSignal } = {}): Promise<Socket> {
  const { signal, ...rest } = options
  // ws/wreq 的握手头不允许手工设置 Sec-WebSocket-Protocol（会报
  // "Do not set `Sec-WebSocket-Protocol` header manually"），必须走 protocols 选项。
  // 抖音 frontier 长连接把子协议写在 header 里传进来，这里做一次搬运。
  const wsOptions = { ...rest } as Record<string, unknown>
  const rawHeaders = (wsOptions.headers ?? {}) as Record<string, string>
  let protocols = wsOptions.protocols as string | string[] | undefined
  const kept: Record<string, string> = {}
  for (const [k, v] of Object.entries(rawHeaders)) {
    if (k.toLowerCase() === 'sec-websocket-protocol') {
      if (!protocols) protocols = v.split(',').map((s) => s.trim()).filter(Boolean)
      continue
    }
    kept[k] = v
  }
  if (wsOptions.headers) wsOptions.headers = kept
  if (protocols) wsOptions.protocols = protocols
  const queue: (string | Buffer)[] = []
  let wake: (() => void) | null = null
  let done = false
  let failure: unknown = null
  const notify = () => {
    const w = wake
    wake = null
    w?.()
  }
  let ws
  try {
    ws = await websocket(url, { browser: 'chrome', os: 'windows', ...wsOptions, binaryType: 'nodebuffer' } as WebSocketOptions)
  } catch (err) {
    throw toNetworkError(err)
  }
  ws.onmessage = (e) => {
    queue.push(e.data as string | Buffer)
    notify()
  }
  ws.onclose = () => {
    done = true
    notify()
  }
  ws.onerror = (e) => {
    failure = new Error(String((e as { message?: string }).message ?? 'WebSocket 出错'))
    done = true
    notify()
  }
  const onAbort = () => {
    ws.close()
    done = true
    notify()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  return {
    send: async (data) => {
      await ws.send(data as never)
    },
    // 已经关闭/从未连上的 socket 再 close 会抛 "WebSocket connection not found"，
    // 这个错误会穿透到 reconnecting() 被当成断线，白丢一次连接。幂等处理掉。
    close: () => {
      try {
        ws.close()
      } catch {
        /* already closed */
      }
    },
    messages: {
      async *[Symbol.asyncIterator]() {
        try {
          for (;;) {
            while (queue.length) yield queue.shift()!
            if (done) break
            await new Promise<void>((r) => (wake = r))
          }
          if (failure) throw failure
        } finally {
          signal?.removeEventListener('abort', onAbort)
          if (!done) {
            try {
              ws.close()
            } catch {
              /* already closed */
            }
          }
        }
      },
    },
  }
}

/** 连续多少次 UPSTREAM 错误后不再重连。 */
const MAX_UPSTREAM_FAILURES = 5

/** 重连退避的参数。 */
export interface ReconnectOptions {
  /** 首次等待（毫秒），之后每次翻倍，默认 1 秒。 */
  baseDelay?: number
  /** 单次等待上限（毫秒），默认 30 秒。 */
  maxDelay?: number
  /** 是否叠加 jitter（默认开启）：实际等待落在 [等待的一半, 等待] 之间，多实例不会同一秒一起重连。 */
  jitter?: boolean
}

/**
 * 第 attempt 次重连前等待多久（毫秒）：`baseDelay × 2^(attempt-1)`，不超过 maxDelay，再叠加半抖动。
 * 抖动只向下取，所以算出来的值仍然不超过 maxDelay，上限是真的。
 */
export function backoffDelay(attempt: number, options: ReconnectOptions = {}): number {
  const target = Math.min((options.baseDelay ?? 1000) * 2 ** (Math.max(attempt, 1) - 1), options.maxDelay ?? 30_000)
  if (options.jitter === false) return target
  return Math.round(target / 2 + random() * (target / 2))
}

/**
 * 重连告警的字段（一行 JSON 打到 stderr）。`disconnected_at` 是断线时刻、`delay_ms` 是要等多久，
 * 两者之间的窗口没有连接：推送型的流（私信、弹幕）这段里服务端发的消息收不到，上层按它判断可能漏了什么。
 */
export interface ReconnectNotice {
  /** 本次运行的第几次重连（不清零）。 */
  reconnects: number
  /** 连续重连次数：重连后收到过数据就归零，用来判断是不是一直连不上。 */
  attempt: number
  /** 断线时刻，ISO 8601。 */
  disconnected_at: string
  /** 这次重连前等待的毫秒数（已含 jitter）。 */
  delay_ms: number
  /** 断线原因；服务端正常关闭时为空字符串。 */
  reason: string
}

/** 重连告警的文本形式：`[catbus] 警告：` 之后是一行 JSON。 */
export const reconnectNotice = (n: ReconnectNotice): string => JSON.stringify({ event: 'reconnect', may_lose_messages: true, ...n })

/**
 * 断线自动重连：connect 每次返回一段事件流，流结束或出错后按指数退避（+jitter）重连，直到 signal 中止。
 * 重连解决不了的错误直接抛出：登录态失效、风控、参数错误等（NETWORK、UPSTREAM 以外的 CatbusError）；
 * UPSTREAM（例如房间不存在）连续 5 次、中间一条事件都没收到时也抛出。其余错误（断线）一直重连。
 */
export async function* reconnecting<T>(ctx: HandlerContext, connect: (attempt: number) => AsyncIterable<T>, options: ReconnectOptions = {}): AsyncIterable<T> {
  let attempt = 0
  let reconnects = 0
  let upstreamFailures = 0
  while (!ctx.signal.aborted) {
    let reason = ''
    try {
      for await (const value of connect(attempt)) {
        attempt = 0
        upstreamFailures = 0
        yield value
      }
    } catch (err) {
      if (ctx.signal.aborted) return
      if (err instanceof CatbusError && err.code !== 'NETWORK') {
        if (err.code !== 'UPSTREAM' || ++upstreamFailures >= MAX_UPSTREAM_FAILURES) throw err
      }
      reason = err instanceof Error ? err.message : String(err)
    }
    if (ctx.signal.aborted) return
    const disconnectedAt = new Date(now()).toISOString()
    attempt++
    reconnects++
    const delay = backoffDelay(attempt, options)
    ctx.log.warn(reconnectNotice({ reconnects, attempt, disconnected_at: disconnectedAt, delay_ms: delay, reason }))
    await sleep(delay, ctx.signal)
  }
}
