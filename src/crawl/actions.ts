import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export type ActionKind = 'comment' | 'dm'

export interface ActionInput { platform: string; kind: ActionKind; target: string; text: string; replyTo?: string; account?: string }
export interface ActionDeps { bin?: string; env?: NodeJS.ProcessEnv; now?: () => number; minIntervalMs?: number }
export type ActionResult = { ok: true; data: unknown } | { ok: false; code: string; message: string }

/**
 * 平台白名单，以 `mediacrawl platforms <平台>` 的能力矩阵为准：
 * comment add / msg send 已实现（implemented）的平台才放进来。
 */
export const ACTION_PLATFORMS: Record<ActionKind, readonly string[]> = {
  comment: ['douyin', 'bilibili'],
  dm: ['douyin', 'xhs', 'tiktok', 'xianyu', 'taobao', 'jd'],
}

interface Envelope { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } }

/** 评论 / 私信正文上限：再长平台侧会直接拒绝，提前挡住省一次风险操作。 */
const MAX_TEXT_LENGTH = 500
/** 同一账号两次动作之间的默认最小间隔，太快容易被风控盯上。 */
const DEFAULT_MIN_INTERVAL_MS = 3_000
/** 单次动作的子进程超时；卡住的平台请求不能拖死整个 UI。 */
const DEFAULT_TIMEOUT_MS = 60_000

/** 上次真正发起动作的时间（毫秒），key 为 `平台:账号`。被限流的调用不写这里。 */
const lastStartedAt = new Map<string, number>()

/** 清空限流记录，主要给测试和「换账号」这类场景用。 */
export function resetActionLimiter(): void { lastStartedAt.clear() }

function readNumber(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
}

function actionLabel(kind: ActionKind): string {
  return kind === 'comment' ? '发评论' : '发私信'
}

/**
 * 拼一次动作的 CLI 参数。账号是全局选项，放在平台后面、resource 前面
 * （`mediacrawl <平台> -a <账号> <resource> <action>`），位置参数按各自的 --help 排。
 */
function buildActionArgs(input: ActionInput, text: string, target: string): string[] {
  const head = [input.platform, ...(input.account ? ['-a', input.account] : [])]
  const replyTo = input.replyTo?.trim()
  if (input.kind === 'comment') {
    return [...head, 'comment', 'add', target, text, ...(replyTo ? ['--reply-to', replyTo] : []), '-o', 'json']
  }
  return [...head, 'msg', 'send', text, '--to', target, '-o', 'json']
}

/** stderr 可能是一整段 Node 栈，消息里只留开头，免得把 UI 撑爆。 */
function truncate(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 解析 stdout 里的 JSON 信封；CLI 偶尔会先打提示行，所以退一步只认最后一行。 */
function parseEnvelope(stdout: string): Envelope | undefined {
  const text = stdout.trim()
  if (!text) return undefined
  try { return JSON.parse(text) as Envelope } catch {}
  for (const line of text.split(/\r?\n/).reverse()) {
    const candidate = line.trim()
    if (!candidate.startsWith('{')) continue
    try { return JSON.parse(candidate) as Envelope } catch {}
  }
  return undefined
}

/**
 * 执行一次互动动作（发评论 / 发私信）。
 * 走 CLI 子进程，是为了复用 catbus 维护的登录态、签名和账号切换；
 * 不做重试：风控、验证码、登录失效重试只会让账号更像机器人，错误直接透回去。
 */
export async function runAction(input: ActionInput, deps: ActionDeps = {}): Promise<ActionResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, ...deps.env }
  const label = actionLabel(input.kind)
  const platforms = ACTION_PLATFORMS[input.kind]
  if (!platforms) return { ok: false, code: 'USAGE', message: `未知动作：${String(input.kind)}` }
  if (!platforms.includes(input.platform)) return { ok: false, code: 'UNSUPPORTED', message: `${input.platform} 不支持${label}` }

  const text = (input.text ?? '').trim()
  if (!text) return { ok: false, code: 'USAGE', message: `${label}内容不能为空` }
  if (text.length > MAX_TEXT_LENGTH) return { ok: false, code: 'USAGE', message: `${label}内容超过 ${MAX_TEXT_LENGTH} 字（当前 ${text.length} 字）` }

  const target = (input.target ?? '').trim()
  if (!target) return { ok: false, code: 'USAGE', message: input.kind === 'comment' ? '发评论需要 target（作品 ID 或链接）' : '发私信需要 target（对方用户）' }

  const now = deps.now ?? Date.now
  const minIntervalMs = deps.minIntervalMs ?? readNumber(env.MEDIACRAWL_ACTION_INTERVAL_MS, DEFAULT_MIN_INTERVAL_MS, 0)
  const key = `${input.platform}:${input.account ?? 'default'}`
  const startedAt = lastStartedAt.get(key)
  const at = now()
  if (startedAt !== undefined && at - startedAt < minIntervalMs) {
    const waitSeconds = ((minIntervalMs - (at - startedAt)) / 1000).toFixed(1)
    return { ok: false, code: 'TOO_FAST', message: `操作太快，还要等 ${waitSeconds} 秒（同一账号最小间隔 ${minIntervalMs}ms）` }
  }
  // 只在真正发起前记账；被限流的调用不占用时间戳，否则会越等越久。
  lastStartedAt.set(key, at)

  const args = buildActionArgs(input, text, target)
  const entry = deps.bin ?? env.MEDIACRAWL_BIN ?? fileURLToPath(new URL('../cli/main.js', import.meta.url))
  const timeoutMs = readNumber(env.MEDIACRAWL_ACTION_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1)

  return await new Promise<ActionResult>((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (result: ActionResult): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(process.execPath, [entry, ...args], { env: { ...env, OPENMEDIACRAWL_NO_NAG: '1' }, windowsHide: true })
    } catch (error) {
      finish({ ok: false, code: 'UPSTREAM', message: `${label}失败：${error instanceof Error ? error.message : String(error)}` })
      return
    }
    timer = setTimeout(() => {
      finish({ ok: false, code: 'UPSTREAM', message: `${label}超时（${timeoutMs}ms）：${input.platform} ${input.kind} ${target}` })
      child.kill()
    }, timeoutMs)

    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => finish({ ok: false, code: 'UPSTREAM', message: `${label}失败：${error.message}` }))
    child.on('close', (code) => {
      const envelope = parseEnvelope(stdout)
      if (code === 0 && envelope && envelope.ok !== false) {
        finish({ ok: true, data: envelope.data })
        return
      }
      const message = envelope?.error?.message ?? (truncate(stderr.trim()) || `${label}失败：子进程退出码 ${code ?? -1}`)
      finish({ ok: false, code: envelope?.error?.code ?? 'UPSTREAM', message })
    })
  })
}
