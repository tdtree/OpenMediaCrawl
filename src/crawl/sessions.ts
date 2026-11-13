import { randomBytes } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 浏览器里的会话 cookie 名。 */
export const SESSION_COOKIE = 'omc_session'

/** 默认 7 天（秒）。 */
const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60

export interface SessionInfo {
  username: string
  created_at: number
}

/**
 * 会话表：内存 + 落盘（sessions.json，和 users.json 同目录）。
 * 落盘是为了容器/进程重启后不用重新登录；过期按 created_at + 7 天判断。
 */
const sessions = new Map<string, SessionInfo>()
const SESSION_TTL_MS = DEFAULT_MAX_AGE * 1000
let storeFile: string | null = null

/** 指定落盘位置并读回未过期的会话；传 null 只保留内存（测试用）。 */
export function restoreSessions(file: string | null): void {
  sessions.clear()
  storeFile = file
  if (!file) return
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, SessionInfo>
    const now = Date.now()
    for (const [token, info] of Object.entries(parsed)) {
      if (!info || typeof info.username !== 'string') continue
      if (now - Number(info.created_at ?? 0) > SESSION_TTL_MS) continue
      sessions.set(token, { username: info.username, created_at: Number(info.created_at ?? now) })
    }
  } catch { /* 没有文件或坏文件：从空表开始 */ }
}

function persist(): void {
  if (!storeFile) return
  try {
    const tmp = join(storeFile + '.tmp')
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(sessions), null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, storeFile)
  } catch { /* 磁盘只读或权限问题：内存里还能用 */ }
}

export function createSession(username: string, deps: { now?: () => number } = {}): string {
  const now = deps.now ?? Date.now
  const token = randomBytes(32).toString('base64url')
  sessions.set(token, { username, created_at: now() })
  persist()
  return token
}

export function readSession(token: string): SessionInfo | null {
  if (typeof token !== 'string' || token === '') return null
  const info = sessions.get(token)
  return info ? { ...info } : null
}

export function dropSession(token: string): void {
  sessions.delete(token)
  persist()
}

export function dropUserSessions(username: string): void {
  let changed = false
  for (const [token, info] of sessions) {
    if (info.username === username) { sessions.delete(token); changed = true }
  }
  if (changed) persist()
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
