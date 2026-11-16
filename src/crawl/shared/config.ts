import { join } from 'node:path'
import { readTextIfExists, writeFileAtomic } from '../../core/fsutil.js'
import { DEFAULT_POLICY, type RefreshMode, type ReusePolicy } from './types.js'

/** 共享库的复用策略，落在 <共享库目录>/config.json，admin 改一次所有用户生效。 */
export interface SharedConfig {
  enabled: boolean
  itemTtlDays: number
  commentTtlHours: number
  reuseItems: boolean
  reuseComments: boolean
  reuseMedia: boolean
}

export const DEFAULT_SHARED_CONFIG: SharedConfig = {
  enabled: true,
  itemTtlDays: 30,
  commentTtlHours: 24,
  reuseItems: true,
  reuseComments: true,
  reuseMedia: true,
}

export const sharedConfigPath = (dir: string): string => join(dir, 'config.json')

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const bool = (value: unknown, fallback: boolean): boolean => (value == null ? fallback : value === true || value === 'true' || value === 1)

export function normalizeSharedConfig(input: Partial<SharedConfig> | Record<string, unknown>): SharedConfig {
  return {
    enabled: bool(input.enabled, DEFAULT_SHARED_CONFIG.enabled),
    itemTtlDays: clampNumber(input.itemTtlDays, DEFAULT_SHARED_CONFIG.itemTtlDays, 0, 3650),
    commentTtlHours: clampNumber(input.commentTtlHours, DEFAULT_SHARED_CONFIG.commentTtlHours, 0, 24 * 365),
    reuseItems: bool(input.reuseItems, DEFAULT_SHARED_CONFIG.reuseItems),
    reuseComments: bool(input.reuseComments, DEFAULT_SHARED_CONFIG.reuseComments),
    reuseMedia: bool(input.reuseMedia, DEFAULT_SHARED_CONFIG.reuseMedia),
  }
}

export async function loadSharedConfig(dir: string): Promise<SharedConfig> {
  const raw = await readTextIfExists(sharedConfigPath(dir))
  if (!raw) return { ...DEFAULT_SHARED_CONFIG }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return normalizeSharedConfig((parsed.shared ?? parsed) as Record<string, unknown>)
  } catch {
    // 配置坏掉不该让采集停摆：退回默认值，下次写回时自动修好。
    return { ...DEFAULT_SHARED_CONFIG }
  }
}

export async function saveSharedConfig(dir: string, patch: Partial<SharedConfig>): Promise<SharedConfig> {
  const next = normalizeSharedConfig({ ...(await loadSharedConfig(dir)), ...patch })
  await writeFileAtomic(sharedConfigPath(dir), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

export function policyFrom(config: SharedConfig, refresh: RefreshMode = 'auto'): ReusePolicy {
  return {
    ...DEFAULT_POLICY,
    itemTtlMs: config.itemTtlDays * 24 * 3600 * 1000,
    commentTtlMs: config.commentTtlHours * 3600 * 1000,
    reuseItems: config.reuseItems,
    reuseComments: config.reuseComments,
    reuseMedia: config.reuseMedia,
    refresh,
  }
}

export function parseRefresh(value: unknown): RefreshMode {
  return value === 'always' || value === 'never' ? value : 'auto'
}

/** 环境变量优先：OMC_SHARED=0 可以整体退回「按用户落盘」。 */
export function sharedEnabled(config: SharedConfig, env = process.env): boolean {
  if (env.OMC_SHARED === '0' || env.OMC_SHARED === 'false') return false
  return config.enabled
}
