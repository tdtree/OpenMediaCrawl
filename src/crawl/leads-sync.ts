import { fileSignature } from '../core/fsutil.js'
import { indexSignature, type IndexSource } from './records.js'

/**
 * 线索同步的脏检查。
 *
 * `/api/leads/sync` 每次都把所有平台的采集结果重新拼一遍线索，再整份重写 leads.jsonl：
 * 内容一点没变也要花 1 秒多。这里记住上次同步时的指纹（每个平台的 index 文件
 * mtime + size + 共享库版本号，加上 leads.jsonl 自己的指纹），没变就直接跳过。
 *
 * 指纹存在进程内存里：重启后第一次同步照常全量重算，不会把状态卡死。
 * 想强制重算（例如接口层清空线索后）就调 {@link resetLeadsSyncState}。
 */

interface SyncState {
  /** 上次同步完成时的完整指纹。 */
  full: string
  /** 上次同步实际动过的平台，跳过的时候原样回给前端。 */
  platforms: string[]
}

/** username → 上次同步完成时的状态。 */
const state = new Map<string, SyncState>()

export interface LeadsSyncFingerprint {
  /** 采集结果部分（各平台 index 内容指纹）。 */
  index: string
  /** 采集结果 + leads.jsonl 的完整指纹。 */
  full: string
}

/**
 * 算当前指纹。`index` 部分在同步开始前取，`leads.jsonl` 的签名单独取，
 * 因为同步过程本身会重写 leads.jsonl：完成后要用「写完之后」的签名落账。
 */
export async function leadsSyncFingerprint(
  source: IndexSource | string,
  platforms: readonly string[],
  leadsFile: string,
): Promise<LeadsSyncFingerprint> {
  const parts: string[] = []
  for (const platform of platforms) parts.push(`${platform}=${await indexSignature(source, platform)}`)
  const index = parts.join('|')
  return { index, full: `${index}|leads=${await fileSignature(leadsFile)}` }
}

/**
 * 和上次同步完成时相比没变化？是的话返回上次同步的平台列表（可以跳过重算），否则 null。
 * 线索被删 / 采集结果变了都会让指纹变化，所以跳过不会把状态卡死。
 */
export function leadsSyncedPlatforms(username: string, fingerprint: LeadsSyncFingerprint): string[] | null {
  const known = state.get(username)
  return known && known.full === fingerprint.full ? known.platforms : null
}

/**
 * 记下同步完成后的状态：采集结果用同步前的指纹（这批数据已经全部处理过），
 * leads.jsonl 用写完之后重新取的签名。
 */
export async function rememberLeadsSync(
  username: string,
  indexFingerprint: string,
  leadsFile: string,
  platforms: string[],
): Promise<void> {
  state.set(username, {
    full: `${indexFingerprint}|leads=${await fileSignature(leadsFile)}`,
    platforms: [...platforms],
  })
}

/** 清空指纹（不传 username 就全清）。下次同步会全量重算。 */
export function resetLeadsSyncState(username?: string): void {
  if (username === undefined) state.clear()
  else state.delete(username)
}
