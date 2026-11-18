import { randomUUID } from 'node:crypto'
import type { Candidate, CandidateType } from './candidates.js'

export interface CampaignEvent {
  type: 'log' | 'sent' | 'failed' | 'done'
  message: string
  time: string
  index?: number
  total?: number
}

/** SSE 订阅者：结束时显式 end，避免群发完成后连接一直挂着。 */
export interface CampaignSubscriber {
  send: (event: CampaignEvent) => void
  end: () => void
}

export interface CampaignState {
  id: string
  owner: string
  type: CandidateType
  text: string
  status: 'running' | 'done' | 'stopped' | 'error'
  sent: number
  failed: number
  total: number
  message: string
  history: CampaignEvent[]
  subscribers: Set<CampaignSubscriber>
  stop: () => void
}

export interface SendResult { ok: boolean; code?: string; message?: string }

export interface CampaignDeps {
  send: (candidate: Candidate, text: string) => Promise<SendResult>
  now?: () => number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  random?: () => number
}

const STOP_CODES = new Set(['RISK_CONTROL', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'TOO_FAST'])

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'))
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    function onAbort(): void { clearTimeout(timer); reject(new Error('aborted')) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 顺序发送 + 随机间隔。间隔只在发送之间出现（第一条立即发），
 * 遇到风控/登录失效/限流立即停：继续发只会把账号推得更深。
 */
export async function runCampaign(
  items: Candidate[],
  text: string,
  options: { minSeconds: number; maxSeconds: number; signal: AbortSignal },
  deps: CampaignDeps,
  onEvent: (event: CampaignEvent) => void,
): Promise<{ sent: number; failed: number; status: CampaignState['status']; message: string }> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? defaultSleep
  const random = deps.random ?? Math.random
  const minMs = Math.max(0, options.minSeconds) * 1000
  const maxMs = Math.max(minMs, options.maxSeconds * 1000)
  const emit = (type: CampaignEvent['type'], message: string, index?: number): void => {
    onEvent({ type, message, time: new Date(now()).toISOString(), index, total: items.length })
  }

  let sent = 0
  let failed = 0
  let consecutiveFailures = 0
  for (let i = 0; i < items.length; i++) {
    if (options.signal.aborted) return { sent, failed, status: 'stopped', message: '已手动停止' }
    if (i > 0) {
      const wait = minMs + Math.floor(random() * (maxMs - minMs + 1))
      emit('log', `等待 ${(wait / 1000).toFixed(1)} 秒后发下一条`, i)
      try { await sleep(wait, options.signal) } catch { return { sent, failed, status: 'stopped', message: '已手动停止' } }
    }
    const candidate = items[i]!
    let result: SendResult
    try { result = await deps.send(candidate, text) } catch (error) { result = { ok: false, message: error instanceof Error ? error.message : String(error) } }
    if (result.ok) {
      sent++
      consecutiveFailures = 0
      emit('sent', `已发送 ${i + 1}/${items.length}${candidate.userName ? ` → ${candidate.userName}` : ''}`, i)
      continue
    }
    failed++
    consecutiveFailures++
    emit('failed', `第 ${i + 1} 条失败（${result.code ?? 'UPSTREAM'}）：${result.message ?? ''}`, i)
    if (result.code && STOP_CODES.has(result.code)) {
      return { sent, failed, status: 'stopped', message: `遇到 ${result.code}，已停止：${result.message ?? ''}` }
    }
    if (consecutiveFailures >= 3) {
      return { sent, failed, status: 'stopped', message: '连续 3 条失败，已停止' }
    }
  }
  return { sent, failed, status: 'done', message: `发完：成功 ${sent}，失败 ${failed}` }
}

export function newCampaign(owner: string, type: CandidateType, text: string, total: number): CampaignState {
  return { id: randomUUID(), owner, type, text, status: 'running', sent: 0, failed: 0, total, message: '开始', history: [], subscribers: new Set(), stop: () => {} }
}
