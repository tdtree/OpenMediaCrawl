import { randomBytes } from 'node:crypto'

/** 浏览器里的会话 cookie 名。 */
export const SESSION_COOKIE = 'omc_session'

/** 默认 7 天（秒）。 */
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60

export interface SessionInfo {
  username: string
  created_at: number
}

/**
 * 进程内会话表。本地单进程 UI 够用：进程重启后所有登录失效是预期行为，
 * 过期由 cookie 的 Max-Age 控制，服务端不再单独记 TTL。
 */
const sessions = new Map<string, SessionInfo>()

export function createSession(username: string, deps: { now?: () => number } = {}): string {
  const now = deps.now ?? Date.now
  const token = randomBytes(32).toString('base64url')
  sessions.set(token, { username, created_at: now() })
  return token
}

export function readSession(token: string): SessionInfo | null {
  if (typeof token !== 'string' || token === '') return null
  const info = sessions.get(token)
  return info ? { ...info } : null
}

export function dropSession(token: string): void {
  sessions.delete(token)
}

export function dropUserSessions(username: string): void {
  for (const [token, info] of sessions) {
    if (info.username === username) sessions.delete(token)
  }
}

/**
 * 解析 Cookie 请求头。容忍空值、多余空格、没有 `=` 的片段和带引号的值；
 * 同名的键后出现的覆盖先出现的。百分号编码解不开时保留原文。
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out = new Map<string, string>()
  if (typeof header !== 'string' || header === '') return Object.fromEntries(out)
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (name === '') continue
    let value = part.slice(eq + 1).trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    try {
      value = decodeURIComponent(value)
    } catch {
      // 保持原样
    }
    out.set(name, value)
  }
  return Object.fromEntries(out)
}

/** 生成 Set-Cookie 的值；maxAgeSeconds 传 0 即让浏览器立刻丢弃。 */
export function sessionCookie(token: string, maxAgeSeconds: number = DEFAULT_MAX_AGE): string {
  const maxAge = Math.trunc(maxAgeSeconds)
  // base64url 里没有需要转义的字符；这里编码只为挡住外部拼进来的怪字符（如 `;`）
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`
}
