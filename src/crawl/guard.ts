import { dayKey } from './stats.js'
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { fileSignature, isoNow, readTextIfExists, writeFileAtomic } from '../core/fsutil.js'

/** 发送类型：reply = 评论回复，dm = 私信。 */
export type SendKind = 'reply' | 'dm'

/** 账本里的一条发送记录。at 是带本地时区偏移的 ISO 8601。 */
export interface SentRecord {
  platform: string
  target: string
  kind: SendKind
  at: string
  ok: boolean
  /** 失败时的错误码（如 TOO_FAST / AUTH_EXPIRED）。只记 ok=false 的那次，
   *  没有它就只剩「发失败了」三个字，线上根本没法定位。 */
  code?: string
  /** 失败原因原文，直接来自平台信封或限流器。 */
  message?: string
}

export interface CanSendOptions {
  /** 单日上限，默认 25（admin 可在群发参数里改）。按本地日期切换。 */
  dailyCap?: number
  /** 注入「现在」，测试用；默认 new Date()。 */
  now?: Date
}

export interface CanSendResult {
  ok: boolean
  reason?: string
}

export interface AccountStatusOptions {
  env?: NodeJS.ProcessEnv
  /** CLI 入口，优先于 MEDIACRAWL_BIN；默认是编译后的 dist/cli/main.js。 */
  bin?: string
  timeoutMs?: number
}

export interface AccountStatus {
  logged_in: boolean
  user: string | null
  method: string | null
  message?: string
}

/** 单个平台一天最多发多少条（评论 + 私信合计）。 */
export const DEFAULT_DAILY_CAP = 25

/** auth status 子进程默认超时：登录态检测只是读本地凭据，20 秒足够。 */
const DEFAULT_AUTH_TIMEOUT_MS = 20_000

/** 失败信息里保留的 stderr 长度，避免把整段报错塞进 UI。 */
const MAX_MESSAGE_DETAIL = 300

// 本地日口径统一放在 stats.ts，这里不再自己算（避免两套实现走歧）
const localDateKey = (date: Date): string => dayKey(date)

/**
 * 解析一行账本。坏行（不是 JSON、字段缺失或类型不对）返回 null 由调用方跳过：
 * 账本是「发过什么」的旁路记录，一行损坏不应该让整个发送流程不可用。
 */
function parseRecord(line: string): SentRecord | null {
  const text = line.trim()
  if (!text) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { platform, target, kind, at, ok } = raw as Record<string, unknown>
  if (typeof platform !== 'string' || platform === '') return null
  if (typeof target !== 'string' || target === '') return null
  if (kind !== 'reply' && kind !== 'dm') return null
  if (typeof at !== 'string' || at === '') return null
  if (typeof ok !== 'boolean') return null
  return { platform, target, kind, at, ok }
}

/**
 * 账本的内存索引：一次读盘建好，之后 canSend 只看内存。
 *
 * - `sent`：已经成功发过的 `platform/kind/target`（ok=false 的不在里面，失败可以重试）
 * - `counts`：`platform/日期` → 当天成功条数
 * - `signature`：文件指纹，外部改过账本（另一个进程 / 手工编辑）就整体重载
 */
interface LedgerIndex {
  signature: string
  records: SentRecord[]
  sent: Set<string>
  counts: Map<string, number>
}

function sentKey(platform: string, target: string, kind: SendKind): string {
  return `${platform}\u0000${kind}\u0000${target}`
}

function countKey(platform: string, day: string): string {
  return `${platform}\u0000${day}`
}

/** 把一条记录并进索引；坏时间戳（at 解析不了）不计日计数，和原来 `sentToday` 的行为一致。 */
function indexOne(index: LedgerIndex, record: SentRecord): void {
  if (!record.ok) return
  index.sent.add(sentKey(record.platform, record.target, record.kind))
  const at = new Date(record.at)
  if (Number.isNaN(at.getTime())) return
  const key = countKey(record.platform, localDateKey(at))
  index.counts.set(key, (index.counts.get(key) ?? 0) + 1)
}

function buildIndex(records: SentRecord[], signature: string): LedgerIndex {
  const index: LedgerIndex = { signature, records, sent: new Set(), counts: new Map() }
  for (const record of records) indexOne(index, record)
  return index
}

/**
 * 发送账本：jsonl 文件，一行一条 SentRecord。
 *
 * 三条规则：
 * - 只有 ok=true 才算「已发送」——失败的那次可以重试；
 * - 每天按本地日期重新计数；
 * - 读不到文件当空账本，坏行直接跳过（见 {@link parseRecord}）。
 *
 * 读走内存索引（群发校验 300 人不再读 600 遍文件），文件被外部改动时按 mtime + size 重载。
 */
export class SendLedger {
  private readonly file: string

  /** 同进程内的读-改-写串行化，避免两条 record 并发时互相覆盖。 */
  private tail: Promise<unknown> = Promise.resolve()

  private index: LedgerIndex | null = null

  private readonly onRead: (() => void) | undefined

  constructor(
    file: string,
    options: { /** 测试用：每次真正从磁盘读文件时回调（用来确认连续 canSend 没重复读盘）。 */ onRead?: () => void } = {},
  ) {
    this.file = file
    this.onRead = options.onRead
  }

  /** 全部有效记录（按写入顺序）。 */
  async records(): Promise<SentRecord[]> {
    return [...(await this.current()).records]
  }

  /** 是否已经成功发过这条；ok=false 的记录不算。 */
  async isSent(platform: string, target: string, kind: SendKind): Promise<boolean> {
    return (await this.current()).sent.has(sentKey(platform, target, kind))
  }

  /** 该平台今天（本地日期，按 now 决定是哪天）成功发送的条数。 */
  async sentToday(platform: string, now: Date = new Date()): Promise<number> {
    return (await this.current()).counts.get(countKey(platform, localDateKey(now))) ?? 0
  }

  /**
   * 发送前的准入判断，按顺序检查：已发送过 → 单日上限。
   * 只读不写，真正的发送动作成功后由调用方调用 {@link record} 记账。
   * 命中内存索引时这里没有任何文件 IO。
   */
  async canSend(
    platform: string,
    target: string,
    kind: SendKind,
    options: CanSendOptions = {},
  ): Promise<CanSendResult> {
    const cap = options.dailyCap ?? DEFAULT_DAILY_CAP
    const index = await this.current()
    if (index.sent.has(sentKey(platform, target, kind))) return { ok: false, reason: '已发送过' }
    const today = index.counts.get(countKey(platform, localDateKey(options.now ?? new Date()))) ?? 0
    if (today >= cap) return { ok: false, reason: '今天已到上限' }
    return { ok: true }
  }

  /** 追加一条记录并原子重写文件（读不到文件当空，坏行在重写时被丢弃），随后增量更新索引。 */
  async record(entry: Omit<SentRecord, 'at'> & { at?: string }): Promise<void> {
    const full: SentRecord = {
      platform: entry.platform,
      target: entry.target,
      kind: entry.kind,
      at: entry.at ?? isoNow(),
      ok: entry.ok,
    }
    // 只有失败才写原因：成功的记录保持原样，账本体积不会因为多了两个空字段膨胀
    if (entry.code) full.code = entry.code
    if (entry.message) full.message = entry.message
    await this.enqueue(async () => {
      const index = await this.current()
      index.records.push(full)
      await writeFileAtomic(this.file, index.records.map((item) => JSON.stringify(item)).join('\n') + '\n')
      // 写盘后签名变了，重新取一次，否则下一次 canSend 会以为文件被别人改过而整体重读。
      index.signature = await fileSignature(this.file)
      indexOne(index, full)
    })
  }

  /** 清空账本（文件不存在也算成功）。 */
  async clear(): Promise<void> {
    await this.enqueue(async () => {
      await rm(this.file, { force: true })
      this.index = null
    })
  }

  /** 当前索引；文件指纹变了就重读。 */
  private async current(): Promise<LedgerIndex> {
    const signature = await fileSignature(this.file)
    if (this.index && this.index.signature === signature) return this.index
    this.onRead?.()
    const records = await this.read()
    this.index = buildIndex(records, signature)
    return this.index
  }

  private async read(): Promise<SentRecord[]> {
    const text = await readTextIfExists(this.file)
    if (text === null) return []
    const records: SentRecord[] = []
    for (const line of text.split(/\r?\n/)) {
      const record = parseRecord(line)
      if (record) records.push(record)
    }
    return records
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action, action)
    this.tail = run.catch(() => undefined)
    return run
  }
}

interface AuthEnvelope {
  ok?: boolean
  data?: unknown
  error?: { code?: string; message?: string } | null
}

/** data.user 可能是字符串，也可能是 {id,name} 这类对象，统一取一个可读的名字。 */
function pickUser(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  for (const key of ['name', 'username', 'nickname', 'id'] as const) {
    const field = raw[key]
    if (typeof field === 'string' && field.trim() !== '') return field
    if (typeof field === 'number') return String(field)
  }
  return null
}

/** 从 stdout 里找最后一个能解析成 JSON 的对象（json 格式下 stdout 只有一个信封）。 */
function lastEnvelope(stdout: string): AuthEnvelope | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed: unknown = JSON.parse(lines[i]!)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as AuthEnvelope
    } catch {
      // 这一行不是 JSON，继续往前找
    }
  }
  return null
}

function resolveBin(bin: string | undefined, env: NodeJS.ProcessEnv): string {
  // 编译后本模块位于 dist/crawl/，`../cli/main.js` 就是 dist/cli/main.js。
  return bin ?? env.MEDIACRAWL_BIN ?? fileURLToPath(new URL('../cli/main.js', import.meta.url))
}

/**
 * 调 `mediacrawl <platform> auth status -o json` 检测账号是否仍然有效。
 *
 * 任何异常（子进程起不来、超时、输出解析不了、信封 ok=false）都当作「未登录」返回，
 * 不抛错——调用方是在发送前做一次健康检查，不应该因为检查失败而中断整批任务。
 */
export async function accountStatus(
  platform: string,
  options: AccountStatusOptions = {},
): Promise<AccountStatus> {
  const env = options.env ?? process.env
  const bin = resolveBin(options.bin, env)
  const timeoutMs = options.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS
  const args = [bin, platform, 'auth', 'status', '-o', 'json']
  const fail = (message: string): AccountStatus => ({ logged_in: false, user: null, method: null, message })

  return await new Promise<AccountStatus>((resolve) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    let timer: NodeJS.Timeout | undefined
    const finish = (result: AccountStatus): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    let child
    try {
      child = spawn(process.execPath, args, {
        env: { ...env, OPENMEDIACRAWL_NO_NAG: '1' },
        windowsHide: true,
      })
    } catch (err) {
      finish(fail(`检测登录态失败：${err instanceof Error ? err.message : String(err)}`))
      return
    }

    timer = setTimeout(() => {
      finish(fail(`检测登录态超时（${timeoutMs}ms）：${platform} auth status`))
      child.kill()
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      finish(fail(`检测登录态失败：${err.message}`))
    })
    child.on('close', (code) => {
      const detail = stderr.trim().slice(0, MAX_MESSAGE_DETAIL)
      const envelope = lastEnvelope(stdout)
      if (!envelope) {
        finish(fail(detail || `检测登录态失败：子进程退出码 ${code ?? -1}，输出不是 JSON 信封`))
        return
      }
      if (envelope.ok === false) {
        finish(fail(envelope.error?.message ?? (detail || `检测登录态失败：${platform} auth status 返回 ok=false`)))
        return
      }
      if (code !== 0) {
        finish(fail(detail || `检测登录态失败：子进程退出码 ${code ?? -1}`))
        return
      }
      const data = envelope.data
      if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).logged_in !== 'boolean') {
        finish(fail('检测登录态失败：auth status 没有返回 logged_in 字段'))
        return
      }
      const raw = data as Record<string, unknown>
      finish({
        logged_in: raw.logged_in === true,
        user: pickUser(raw.user),
        method: typeof raw.method === 'string' ? raw.method : null,
      })
    })
  })
}
