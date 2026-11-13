import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '../core/fsutil.js'
import { usersFilePath } from './users.js'

/** 群发参数：admin 统一设置，所有账号共用。 */
export interface SendConfig {
  /** 每账号每天最多发多少条 */
  dailyCap: number
  /** 一次群发最多排多少条 */
  batchMax: number
  /** 两条之间最短间隔（秒） */
  minSeconds: number
  /** 两条之间最长间隔（秒） */
  maxSeconds: number
}

export const DEFAULT_SEND_CONFIG: SendConfig = { dailyCap: 25, batchMax: 50, minSeconds: 30, maxSeconds: 90 }

/** 和 users.json 放同一层目录，容器里就是 /data/omc/send-config.json。 */
export function sendConfigPath(): string {
  return join(dirname(usersFilePath()), 'send-config.json')
}

export function normalizeSendConfig(input: Partial<SendConfig> | null | undefined, base: SendConfig = DEFAULT_SEND_CONFIG): SendConfig {
  const pick = (value: unknown, fallback: number): number => {
    const num = Number(value)
    return Number.isFinite(num) ? num : fallback
  }
  const dailyCap = Math.min(200, Math.max(1, Math.trunc(pick(input?.dailyCap, base.dailyCap))))
  const batchMax = Math.min(200, Math.max(1, Math.trunc(pick(input?.batchMax, base.batchMax))))
  const minSeconds = Math.min(3600, Math.max(5, Math.trunc(pick(input?.minSeconds, base.minSeconds))))
  const maxSeconds = Math.min(7200, Math.max(minSeconds, Math.trunc(pick(input?.maxSeconds, base.maxSeconds))))
  return { dailyCap, batchMax, minSeconds, maxSeconds }
}

export async function loadSendConfig(): Promise<SendConfig> {
  try {
    const parsed = JSON.parse(await readFile(sendConfigPath(), 'utf8')) as Partial<SendConfig>
    return normalizeSendConfig(parsed)
  } catch { return { ...DEFAULT_SEND_CONFIG } }
}

export async function saveSendConfig(patch: Partial<SendConfig>): Promise<SendConfig> {
  const next = normalizeSendConfig(patch, await loadSendConfig())
  await writeFileAtomic(sendConfigPath(), `${JSON.stringify(next, null, 2)}\n`)
  return next
}
