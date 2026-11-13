import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Comment, Item, User } from '../core/schemas.js'
import { CatbusError } from '../core/errors.js'
import type { CrawlPlatform, CrawlPlatformClient, SearchPage } from './types.js'

interface Envelope { ok?: boolean; data?: unknown; page?: { cursor?: string | null; has_more?: boolean } | null; error?: { code?: string; message?: string } }

/** Per-call hard timeout so a hung platform request can never stall a whole job. */
const CALL_TIMEOUT_MS = Number(process.env.MEDIACRAWL_CALL_TIMEOUT_MS ?? 120_000)

/**
 * Runs one catbus command in a child process and returns its JSON envelope.
 * Reusing the CLI keeps signing, cookies and login state exactly as catbus maintains them.
 * `env` 用来给不同用户指定独立的 CATBUS_HOME（登录态按用户隔离）。
 */
export async function runCatbus(platform: CrawlPlatform, args: string[], env?: NodeJS.ProcessEnv): Promise<Envelope> {
  const entry = process.env.MEDIACRAWL_BIN ?? fileURLToPath(new URL('../cli/main.js', import.meta.url))
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, platform, ...args, '-q', '-o', 'json'], { env: { ...process.env, ...env, OPENMEDIACRAWL_NO_NAG: '1' }, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new CatbusError('UPSTREAM', `timeout after ${CALL_TIMEOUT_MS}ms: ${platform} ${args.slice(0, 2).join(' ')}`)) }, CALL_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      let envelope: Envelope | undefined
      try { envelope = JSON.parse(stdout.trim()) as Envelope } catch {}
      if (code === 0 && envelope && envelope.ok !== false) return resolve(envelope)
      const detail = envelope?.error?.message ?? (stderr.trim() || `child exited with code ${code ?? -1}`)
      const errorCode = envelope?.error?.code
      if (errorCode === 'AUTH_REQUIRED' || errorCode === 'AUTH_EXPIRED') return reject(new CatbusError('AUTH_REQUIRED', detail))
      if (errorCode === 'RISK_CONTROL' || /captcha|验证码|风控/i.test(detail)) return reject(new CatbusError('RISK_CONTROL', detail))
      reject(new CatbusError('UPSTREAM', detail))
    })
  })
}

function asPage<T>(envelope: Envelope): SearchPage<T> {
  const items = Array.isArray(envelope.data) ? (envelope.data as T[]) : []
  const cursor = envelope.page?.cursor ?? null
  return { items, cursor, hasMore: Boolean(envelope.page?.has_more && cursor) }
}

function pagingArgs(cursor: string | null | undefined): string[] {
  return cursor ? ['--cursor', cursor] : []
}

export function createSubprocessClient(platform: CrawlPlatform, extra: { sort?: string; env?: NodeJS.ProcessEnv } = {}): CrawlPlatformClient {
  const sortArgs = extra.sort ? ['--sort', extra.sort] : []
  const env = extra.env
  return {
    async search(keyword, cursor) {
      return asPage<Item>(await runCatbus(platform, ['item', 'search', keyword, ...sortArgs, ...pagingArgs(cursor)], env))
    },
    async detail(idOrUrl) { return (await runCatbus(platform, ['item', 'get', idOrUrl], env)).data as Item },
    async comments(itemIdOrUrl, limit) {
      const args = limit > 0 ? ['--limit', String(limit)] : ['--all']
      return asPage<Comment>(await runCatbus(platform, ['comment', 'list', itemIdOrUrl, ...args], env))
    },
    async subComments(itemIdOrUrl, commentId, limit) {
      const args = limit > 0 ? ['--limit', String(limit)] : ['--all']
      return asPage<Comment>(await runCatbus(platform, ['comment', 'replies', itemIdOrUrl, commentId, ...args], env))
    },
    async creator(idOrUrl) { return (await runCatbus(platform, ['user', 'get', idOrUrl], env)).data as User },
    async creatorItems(idOrUrl, cursor) {
      return asPage<Item>(await runCatbus(platform, ['user', 'items', idOrUrl, ...pagingArgs(cursor)], env))
    },
    async download(item, dir) {
      const envelope = await runCatbus(platform, ['item', 'download', item.url ?? item.id, '--dir', dir], env)
      return Array.isArray(envelope.data) ? envelope.data.length : 0
    },
  }
}
