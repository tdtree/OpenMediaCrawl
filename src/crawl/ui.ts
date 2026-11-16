import { spawn, type ChildProcess } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { isoNow } from '../core/fsutil.js'
import { appendFile, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CrawlPlatform, CrawlPlatformClient } from './types.js'
import { runCrawl, CrawlStoppedError } from './job.js'
import { CRAWL_PLATFORMS, CRAWL_TYPES, normalizeCrawlOptions } from './config.js'
import { createSubprocessClient, runCatbus } from './client.js'
import { renderPage } from './ui/index.js'
import { ACTION_PLATFORMS, runAction, type ActionKind } from './actions.js'
import { loadIndex, threadOf } from './records.js'
import { LeadStore, buildLeads, toCsv } from './leads.js'
import { SendLedger, accountStatus, DEFAULT_DAILY_CAP } from './guard.js'
import { loadLexicon, saveLexicon, sanitizeLexicon } from './lexicon.js'
import { appendChat, hasMessage, listChat, listThreads } from './chat.js'
import { addFilterTerms, applyCleanup, applySharedCleanup, effectiveTerms, isSharedPlan, planCleanup, planCleanupFromStore, type CleanupPlan, type SharedCleanupPlan } from './cleanup.js'
import { openContentStore } from './shared/store.js'
import { loadSharedConfig, parseRefresh, policyFrom, sharedEnabled } from './shared/config.js'
import { DEFAULT_SEND_CONFIG, loadSendConfig, saveSendConfig } from './send-config.js'
import { summarize } from './stats.js'
import { addCandidate, clearCandidates, listCandidates, removeCandidate, type CandidateType } from './candidates.js'
import { deleteTemplate, listTemplates, saveTemplate } from './templates.js'
import { newCampaign, runCampaign, type CampaignEvent, type CampaignState } from './campaign.js'
import { changePassword, createUser, ensureAdmin, listUsers, removeUser, setRole, setStatus, usersFilePath, verifyUser, type Role, type UserStatus } from './users.js'
import { SESSION_COOKIE, createSession, dropSession, dropUserSessions, parseCookieHeader, readSession, restoreSessions, sessionCookie } from './sessions.js'
import type { ContentStore } from './shared/types.js'
import { staticFile } from '../core/paths.js'
import { PLATFORMS, findPlatform } from '../platforms/index.js'

const STAR = '⭐ If OpenMediaCrawl helped you, please star https://github.com/Tommyapi/OpenMediaCrawl — donations: see README "Support".'
const ACCOUNT_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

interface Job { id: string; owner: string; status: 'running' | 'done' | 'error' | 'stopped'; options: Record<string, unknown>; result?: unknown; events: Set<ServerResponse>; history: string[]; controller?: AbortController }

interface LoginJob {
  id: string
  owner: string
  platform: string
  account: string | null
  home: string
  status: 'pending' | 'ok' | 'error'
  stage: 'waiting' | 'scanned' | 'confirming'
  message: string
  deadline: number
  qr: number | null
  child?: ChildProcess
}

export interface UiHandle {
  server: Server
  port: number
  host: string
  close: () => Promise<void>
  jobs: Map<string, Job>
  logins: Map<string, LoginJob>
  /** 首次启动自动建的 admin；CLI 负责把密码打出来。 */
  bootstrap?: { username: string; password: string }
}

async function body(req: IncomingMessage): Promise<string> {
  let value = ''
  for await (const chunk of req) value += String(chunk)
  return value
}

/** 可登录的平台：web 端声明了 auth login。 */
function loginPlatforms(): Array<{ id: string; name: string }> {
  const list: Array<{ id: string; name: string }> = []
  for (const platform of PLATFORMS) {
    const endpoint = platform.endpoints.web
    if (endpoint === 'planned' || !endpoint.commands.get('auth login')) continue
    list.push({ id: platform.id, name: platform.name })
  }
  return list
}

const LOGIN_TIMEOUT_DEFAULT = Number(process.env.MEDIACRAWL_LOGIN_TIMEOUT_MS ?? 180_000)

/** 抖音二维码 55 秒换一张、整轮 5 分钟；其余平台沿用 3 分钟（env 可改）。 */
function LOGIN_TIMEOUT_MS(platform: string): number {
  const seconds = Number(process.env.MEDIACRAWL_LOGIN_TIMEOUT_SECONDS ?? '')
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000
  return platform === 'douyin' ? 300_000 : LOGIN_TIMEOUT_DEFAULT
}

/** 从子进程 stderr 里认出「已扫码 / 换码 / 正在校验」这些中间态，前端才有东西可显示。 */
function applyLoginStage(login: LoginJob, chunk: string): void {
  const text = chunk.replace(/\u001b\[[0-9;]*[mK]/g, '')
  if (/已扫码|请在手机上确认/.test(text)) {
    login.stage = 'scanned'
    login.message = '已扫码，请在手机上确认'
  } else if (/过期|换一张|换码/.test(text)) {
    login.stage = 'waiting'
    login.message = '二维码过期，正在换新码'
  } else if (/正在登录|校验|获取用户|确认中/.test(text)) {
    login.stage = 'confirming'
    login.message = '已确认，正在校验登录态'
  }
}
const SESSION_MAX_AGE = 10 * 365 * 24 * 3600


/** 扫一个用户目录，统计使用情况（给 admin 的账户面板用）。 */
async function scanUsage(base: string, name: string, store?: ContentStore | null): Promise<{ items: number; comments: number; leads: number; sent: number; bytes: number; authBytes: number; logins: number; lastActive: string | null }> {
  const dir = join(base, 'users', name)
  const out = { items: 0, comments: 0, leads: 0, sent: 0, bytes: 0, authBytes: 0, logins: 0, lastActive: null as string | null }
  // 共享模式：作品/评论不在用户目录里，按引用统计；此时别再叠加旧文件里的行数，否则迁移后会翻倍。
  const refs = store ? store.listRefs(name) : []
  const useShared = refs.length > 0
  if (store && useShared) {
    out.items = refs.length
    out.comments = refs.reduce((sum, ref) => sum + store.commentCount(ref.platform, ref.itemId), 0)
  }
  let entries
  try { entries = await readdir(dir, { recursive: true, withFileTypes: true }) } catch { return out }
  let last = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const full = join(entry.parentPath ?? dir, entry.name)
    const info = await stat(full).catch(() => null)
    if (!info) continue
    const rel = relative(dir, full).split(sep).join('/')
    last = Math.max(last, info.mtimeMs)
    if (rel.startsWith('.catbus/')) {
      out.authBytes += info.size
      if (rel.includes('/auth/') && rel.endsWith('.json')) out.logins++
      continue
    }
    out.bytes += info.size
    if (!rel.endsWith('.jsonl')) continue
    const lines = (await readFile(full, 'utf8').catch(() => '')).split('\n').filter((line) => line.trim()).length
    if (!useShared) {
      if (rel.includes('comment')) out.comments += lines
      else if (rel.includes('item')) out.items += lines
    }
    if (rel === 'leads.jsonl') out.leads = lines
    if (rel === 'sent.jsonl') out.sent = lines
  }
  out.lastActive = last ? new Date(last).toISOString() : null
  return out
}


/** 读 jsonl，坏行跳过；用于 admin 的按天统计。 */
async function readRows(file: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(file, 'utf8').catch(() => '')
  const rows: Array<Record<string, unknown>> = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try { rows.push(JSON.parse(line) as Record<string, unknown>) } catch { /* 跳过坏行 */ }
  }
  return rows
}

interface DayStat { date: string; keywords: string[]; items: number; comments: number; sent: number; customers: string[] }

/** 某个用户最近 N 天的抓取 / 群发 / 沟通统计（按本地日期切）。 */
async function userActivity(base: string, username: string, days: number): Promise<{ days: DayStat[]; totals: { items: number; comments: number; sent: number; customers: number; activeDays: number } }> {
  const dir = join(base, 'users', username)
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const map = new Map<string, { keywords: Set<string>; items: number; comments: number; sent: number; customers: Set<string> }>()
  const bucket = (date: string) => {
    let row = map.get(date)
    if (!row) { row = { keywords: new Set(), items: 0, comments: 0, sent: 0, customers: new Set() }; map.set(date, row) }
    return row
  }
  for (const job of await readRows(join(dir, 'jobs.jsonl'))) {
    const date = String(job.at ?? '').slice(0, 10)
    if (!date || date < cutoff) continue
    const row = bucket(date)
    for (const word of Array.isArray(job.keywords) ? job.keywords : []) row.keywords.add(String(word))
    row.items += Number(job.items ?? 0)
    row.comments += Number(job.comments ?? 0)
  }
  for (const sent of await readRows(join(dir, 'sent.jsonl'))) {
    const date = String(sent.at ?? '').slice(0, 10)
    if (!date || date < cutoff || sent.ok !== true) continue
    bucket(date).sent += 1
  }
  for (const message of await readRows(join(dir, 'chat.jsonl'))) {
    const date = String(message.at ?? '').slice(0, 10)
    if (!date || date < cutoff) continue
    const peer = String(message.peerId ?? '')
    if (peer) bucket(date).customers.add(peer)
  }
  const list: DayStat[] = [...map.entries()]
    .map(([date, row]) => ({ date, keywords: [...row.keywords], items: row.items, comments: row.comments, sent: row.sent, customers: [...row.customers] }))
    .sort((a, b) => b.date.localeCompare(a.date))
  const customers = new Set<string>()
  for (const day of list) for (const peer of day.customers) customers.add(peer)
  return {
    days: list,
    totals: {
      items: list.reduce((sum, day) => sum + day.items, 0),
      comments: list.reduce((sum, day) => sum + day.comments, 0),
      sent: list.reduce((sum, day) => sum + day.sent, 0),
      customers: customers.size,
      activeDays: list.filter((day) => day.items || day.comments || day.sent || day.customers.length).length,
    },
  }
}

export async function startUiServer(options: { port?: number; host?: string; out?: string; clientFactory?: (platform: CrawlPlatform, extra: { sort?: string; env?: NodeJS.ProcessEnv }) => CrawlPlatformClient } = {}): Promise<UiHandle> {
  const host = options.host ?? '127.0.0.1'
  const base = resolve(options.out ?? './data')
  // 容器镜像自检：Dockerfile 漏拷 static/ 时，抖音扫码登录会报
  // ENOENT: /app/static/douyin/challenge_profile.json。启动时先说清楚，别等用户去点登录。
  const challengeFile = staticFile('douyin', 'challenge_profile.json')
  if (!existsSync(challengeFile)) {
    process.stderr.write(`[omc] 警告：缺少 ${challengeFile}；抖音扫码登录/采集会失败。容器请重建镜像（Dockerfile 需要 COPY static/），或把仓库的 static 目录挂到 /app/static。\n`)
  }
  // 会话落盘：进程/容器重启后原来的 cookie 仍然有效，不用重新登录。
  restoreSessions(join(dirname(usersFilePath()), 'sessions.json'))
  const jobs = new Map<string, Job>()
  const logins = new Map<string, LoginJob>()
  const campaigns = new Map<string, { state: CampaignState; controller: AbortController }>()
  const failures = new Map<string, { count: number; until: number }>()
  const registrations = new Map<string, number[]>()

  const userRoot = (username: string) => join(base, 'users', username)
  const userHome = (username: string) => join(userRoot(username), '.catbus')

  /**
   * 共享内容库：默认开（OMC_SHARED=0 关闭，退回按用户落盘）。
   * 一个库给所有用户共用；每个用户只有自己的 refs、线索、候选池和发送记录。
   */
  const sharedDir = join(base, 'shared')
  const sharedConfig = await loadSharedConfig(sharedDir)
  const content = sharedEnabled(sharedConfig) ? openContentStore(sharedDir) : null
  /** 用户视图 = 自己的引用 + 共享库正文/评论（旧 jsonl 仍作为兜底）。 */
  const loadUserIndex = (username: string, platform: string) =>
    loadIndex({ root: userRoot(username), store: content ?? undefined, user: username }, platform)
  /** 当前登录的平台账号（写进 refs / fetch_log，只用于回查来源）。 */
  async function currentAccount(username: string, platform: string): Promise<string | null> {
    try {
      const value = (await readFile(join(userHome(username), 'auth', platform, 'web', '_current'), 'utf8')).trim()
      return value || null
    } catch { return null }
  }

  /**
   * 清理预览：这个用户在共享库里有引用就按共享库算（结果是隐藏掩码），
   * 没有引用（还没迁移的老数据）就退回按文件算，行为和升级前一致。
   */
  async function cleanupPlanFor(username: string, days: number): Promise<CleanupPlan | SharedCleanupPlan> {
    if (content && content.listRefs(username).length) {
      return await planCleanupFromStore(content, username, await effectiveTerms(userRoot(username)), { days })
    }
    return await planCleanup(userRoot(username), { days })
  }

  /** 群发参数：admin 统一设置，所有账号共用（send-config.json，和 users.json 同目录）。 */
  interface UserSettings { dailyCap: number; batchMax: number; minSeconds: number; maxSeconds: number }
  async function loadSettings(_username: string): Promise<UserSettings> {
    const config = await loadSendConfig()
    return { dailyCap: config.dailyCap, batchMax: config.batchMax, minSeconds: config.minSeconds, maxSeconds: config.maxSeconds }
  }
  async function saveSettings(_username: string, next: Partial<UserSettings>): Promise<UserSettings> {
    return saveSendConfig(next)
  }

  const admin = await ensureAdmin()

  /** 当前登录用户；角色每次都从 users.json 现读，降权立刻生效。 */
  async function currentUser(req: IncomingMessage): Promise<{ username: string; role: Role } | null> {
    const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE]
    const session = token ? readSession(token) : null
    if (!session) return null
    const user = (await listUsers()).find((u) => u.username === session.username)
    return user ? { username: user.username, role: user.role } : null
  }

  /** 账号列表直接从用户自己的 CATBUS_HOME 读，不动全局 ~/.catbus。 */
  async function listUserAccounts(home: string, platform: string): Promise<Array<{ account: string; current: boolean; user: unknown; method: string | null }>> {
    const dir = join(home, 'auth', platform, 'web')
    let files: string[]
    try { files = await readdir(dir) } catch { return [] }
    let current: string | null = null
    try { current = (await readFile(join(dir, '_current'), 'utf8')).trim() || null } catch {}
    const accounts: Array<{ account: string; current: boolean; user: unknown; method: string | null }> = []
    for (const file of files.sort()) {
      if (!file.endsWith('.json')) continue
      const name = file.slice(0, -5)
      if (!ACCOUNT_RE.test(name) || name === 'guest') continue
      let credential: { user?: unknown; method?: string } | null = null
      try { credential = JSON.parse(await readFile(join(dir, file), 'utf8')) as { user?: unknown; method?: string } } catch {}
      accounts.push({ account: name, current: name === current, user: credential?.user ?? null, method: credential?.method ?? null })
    }
    return accounts
  }

  /** 把固定路径的二维码复制成这次 login 专属的一份；页面只显示自己这次登录的码。 */
  async function snapshotQr(login: LoginJob): Promise<number | null> {
    const dir = join(login.home, 'cache', login.platform)
    try {
      const mtime = Math.round((await stat(join(dir, 'qrcode.png'))).mtimeMs)
      if (login.qr != null && mtime <= login.qr) return login.qr
      await copyFile(join(dir, 'qrcode.png'), join(dir, `qrcode-${login.id}.png`))
      login.qr = mtime
      return mtime
    } catch { return login.qr }
  }

  const server = createServer((req, res) => { handle(req, res).catch((error: unknown) => { if (!res.headersSent) json(res, { error: error instanceof Error ? error.message : String(error) }, 500); else res.end() }) })

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${host}`)

    // ---------------------------------------------------------------- 公开
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', renderPage())

    if (req.method === 'POST' && url.pathname === '/api/register') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const ip = req.socket.remoteAddress ?? 'local'
      const now = Date.now()
      const recent = (registrations.get(ip) ?? []).filter((at) => now - at < 60 * 60 * 1000)
      if (recent.length >= 5) return json(res, { error: '注册太频繁，1 小时后再试' }, 429)
      try {
        const created = await createUser({ username: String(input.username ?? ''), password: String(input.password ?? ''), role: 'user', status: 'pending' })
        await mkdir(userHome(created.username), { recursive: true })
        registrations.set(ip, [...recent, now])
        return json(res, { ok: true, username: created.username, status: created.status }, 201)
      } catch (error) { return json(res, { error: error instanceof Error ? error.message : String(error) }, 400) }
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const username = String(input.username ?? '')
      const password = String(input.password ?? '')
      const guard = failures.get(username)
      if (guard && guard.until > Date.now()) return json(res, { error: `尝试过多，${Math.ceil((guard.until - Date.now()) / 1000)} 秒后再试` }, 429)
      const user = await verifyUser(username, password).catch(() => null)
      if (!user) {
        const next = { count: (guard?.count ?? 0) + 1, until: 0 }
        if (next.count >= 5) { next.until = Date.now() + 30_000; next.count = 0 }
        failures.set(username, next)
        return json(res, { error: '用户名或密码不对' }, 401)
      }
      if (user.status === 'pending') return json(res, { error: '账号等待管理员审核，通过后才能登录' }, 403)
      if (user.status === 'disabled') return json(res, { error: '账号已停用，请联系管理员' }, 403)
      failures.delete(username)
      res.setHeader('set-cookie', sessionCookie(createSession(user.username), SESSION_MAX_AGE))
      return json(res, { username: user.username, role: user.role })
    }

    if (req.method === 'GET' && url.pathname === '/api/me') {
      const who = await currentUser(req)
      return who ? json(res, who) : json(res, { error: '未登录' }, 401)
    }

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token = parseCookieHeader(req.headers.cookie)[SESSION_COOKIE]
      if (token) dropSession(token)
      res.setHeader('set-cookie', sessionCookie('', 0))
      return json(res, { ok: true })
    }

    // ---------------------------------------------------------------- 以下都要登录
    const user = await currentUser(req)
    if (!user) return json(res, { error: '未登录' }, 401)
    const home = userHome(user.username)
    await mkdir(home, { recursive: true })

    if (req.method === 'GET' && url.pathname === '/api/actions/platforms') return json(res, ACTION_PLATFORMS)

    if (req.method === 'POST' && url.pathname === '/api/action') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const kind = String(input.kind ?? '')
      if (kind !== 'comment' && kind !== 'dm') return json(res, { error: '未知动作' }, 400)
      return json(res, await runAction({
        platform: String(input.platform ?? ''),
        kind: kind as ActionKind,
        target: String(input.target ?? ''),
        text: String(input.text ?? ''),
        replyTo: input.replyTo ? String(input.replyTo) : undefined,
      }, { env: { CATBUS_HOME: home } }))
    }

    // ---------------------------------------------------------------- 账号
    if (req.method === 'GET' && url.pathname === '/api/platforms') return json(res, loginPlatforms())

    if (req.method === 'GET' && url.pathname === '/api/accounts') {
      const platform = String(url.searchParams.get('platform') ?? '')
      if (!findPlatform(platform)) return json(res, { error: 'unknown platform' }, 400)
      return json(res, { platform, accounts: await listUserAccounts(home, platform) })
    }

    if (req.method === 'POST' && url.pathname === '/api/accounts/use') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const platform = String(input.platform ?? '')
      const account = String(input.account ?? '')
      if (!findPlatform(platform)) return json(res, { error: 'unknown platform' }, 400)
      if (!ACCOUNT_RE.test(account)) return json(res, { error: '账号名不合法' }, 400)
      const dir = join(home, 'auth', platform, 'web')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, '_current'), account + '\n', 'utf8')
      return json(res, { ok: true, platform, account })
    }

    if (req.method === 'POST' && url.pathname === '/api/login/start') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const platform = String(input.platform ?? '')
      if (!loginPlatforms().some((p) => p.id === platform)) return json(res, { error: `平台 ${platform} 不支持登录` }, 400)
      const method = input.method === 'cookie' ? 'cookie' : 'qrcode'
      const cookie = method === 'cookie' ? String(input.cookie ?? '') : ''
      if (method === 'cookie' && !cookie.trim()) return json(res, { error: 'cookie 为空' }, 400)
      // 同一用户同一平台只允许一个进行中的登录：两个子进程会抢同一个 cache/<平台>/qrcode.png，
      // 页面显示的码和正在轮询的 token 一旦不是同一次登录，扫码确认后永远等不到结果。
      const active = [...logins.values()].find((l) => l.owner === user.username && l.platform === platform && l.status === 'pending' && l.deadline > Date.now())
      if (active) return json(res, { id: active.id, reused: true }, 200)
      const timeout = LOGIN_TIMEOUT_MS(platform)
      const id = randomUUID()
      const login: LoginJob = { id, owner: user.username, platform, account: null, home, status: 'pending', stage: 'waiting', message: '等待二维码', deadline: Date.now() + timeout, qr: null }
      logins.set(id, login)
      json(res, { id, timeout: Math.round(timeout / 1000) }, 202)
      const entry = process.env.MEDIACRAWL_BIN ?? fileURLToPath(new URL('../cli/main.js', import.meta.url))
      const args = [platform, 'auth', 'login', ...(method === 'cookie' ? ['--method', 'cookie', '--cookie', '-'] : [])]
      const child = spawn(process.execPath, [entry, ...args], { env: { ...process.env, CATBUS_HOME: home, OPENMEDIACRAWL_NO_NAG: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      login.child = child
      let stderr = ''
      let stdout = ''
      child.stdout?.on('data', (chunk) => { stdout = (stdout + String(chunk)).slice(-8000) })
      child.stderr?.on('data', (chunk) => {
        const text = String(chunk)
        stderr = (stderr + text).slice(-8000)
        applyLoginStage(login, text)
      })
      child.stdin?.end(method === 'cookie' ? cookie : undefined)
      const timer = setTimeout(() => { login.status = 'error'; login.message = `扫码超时（${Math.round(timeout / 1000)} 秒内没收到手机确认），重新点扫码`; child.kill() }, timeout)
      timer.unref?.()
      child.on('error', (error) => { clearTimeout(timer); login.status = 'error'; login.message = error.message })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (login.status === 'error') return
        if (code === 0) { login.status = 'ok'; login.message = '登录成功'; return }
        login.status = 'error'
        login.message = describeLoginFailure(stdout, stderr, code)
      })
      return
    }

    const loginMatch = url.pathname.match(/^\/api\/login\/([^/]+)$/)
    if (req.method === 'GET' && loginMatch) {
      const login = logins.get(loginMatch[1]!)
      if (!login || (login.owner !== user.username && user.role !== 'admin')) return json(res, { error: '登录任务已丢失（服务可能重启过），重新点一次扫码' }, 404)
      const qr = await snapshotQr(login)
      const left = Math.max(0, Math.ceil((login.deadline - Date.now()) / 1000))
      return json(res, { id: login.id, platform: login.platform, account: login.account, status: login.status, stage: login.status === 'pending' ? login.stage : null, message: login.message, qr, left })
    }

    if (req.method === 'GET' && url.pathname === '/api/qrcode') {
      const loginId = String(url.searchParams.get('login') ?? '')
      if (loginId) {
        const login = logins.get(loginId)
        if (!login || (login.owner !== user.username && user.role !== 'admin')) return json(res, { error: 'not found' }, 404)
        try {
          const data = await readFile(join(login.home, 'cache', login.platform, `qrcode-${login.id}.png`))
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
          res.end(data)
          return
        } catch { return json(res, { error: '二维码还没生成' }, 404) }
      }
      const platform = String(url.searchParams.get('platform') ?? '')
      if (!findPlatform(platform)) return json(res, { error: 'unknown platform' }, 400)
      try {
        const data = await readFile(join(home, 'cache', platform, 'qrcode.png'))
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
        res.end(data)
        return
      } catch { return json(res, { error: '还没有二维码，先点扫码登录' }, 404) }
    }

    // ---------------------------------------------------------------- 用户管理
    if (url.pathname === '/api/filters/used' && req.method === 'POST') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const terms = Array.isArray(input.terms) ? input.terms.map((term) => String(term)) : []
      const all = await addFilterTerms(userRoot(user.username), terms)
      return json(res, { ok: true, terms: all.length })
    }

    if (url.pathname === '/api/admin/cleanup' && req.method === 'GET') {
      if (user.role !== 'admin') return json(res, { error: '只有 admin 能看' }, 403)
      const days = Math.min(3650, Math.max(1, Number(url.searchParams.get('days') ?? 30)))
      const rows: Array<{ username: string; days: number; total: number; candidates: number; bytes: number; candidateBytes: number; skipped: number; terms: number }> = []
      for (const item of await listUsers()) {
        const plan = await cleanupPlanFor(item.username, days)
        rows.push({ username: item.username, days, total: plan.total, candidates: plan.candidates.length, bytes: plan.bytes, candidateBytes: plan.candidates.reduce((sum, one) => sum + one.bytes, 0), skipped: plan.skipped, terms: plan.terms.length })
      }
      const sum = (key: 'total' | 'candidates' | 'bytes' | 'candidateBytes' | 'skipped') => rows.reduce((total, row) => total + row[key], 0)
      return json(res, { days, users: rows, totals: { total: sum('total'), candidates: sum('candidates'), bytes: sum('bytes'), candidateBytes: sum('candidateBytes'), skipped: sum('skipped') } })
    }
    if (url.pathname === '/api/admin/cleanup' && req.method === 'POST') {
      if (user.role !== 'admin') return json(res, { error: '只有 admin 能清理' }, 403)
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      if (String(input.confirm ?? '') !== '确认清理') return json(res, { error: '需要输入「确认清理」' }, 400)
      const days = Math.min(3650, Math.max(1, Number(input.days ?? 30)))
      const only = input.user ? String(input.user) : ''
      const rows: Array<{ username: string; removed: number; freedBytes: number }> = []
      let removed = 0
      let freedBytes = 0
      for (const item of await listUsers()) {
        if (only && item.username !== only) continue
        const plan = await cleanupPlanFor(item.username, days)
        if (!plan.candidates.length) { rows.push({ username: item.username, removed: 0, freedBytes: 0 }); continue }
        const result = content && isSharedPlan(plan)
          ? await applySharedCleanup(content, item.username, plan)
          : await applyCleanup(plan)
        removed += result.removed
        freedBytes += result.freedBytes
        rows.push({ username: item.username, removed: result.removed, freedBytes: result.freedBytes })
      }
      return json(res, { days, removed, freedBytes, users: rows })
    }

    if (url.pathname === '/api/admin/day' && req.method === 'GET') {
      if (user.role !== 'admin') return json(res, { error: '只有 admin 能看' }, 403)
      const who = String(url.searchParams.get('user') ?? '')
      const date = String(url.searchParams.get('date') ?? '')
      if (!who || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, { error: '需要 user 和 date（YYYY-MM-DD）' }, 400)
      const users = await listUsers()
      if (!users.some((item) => item.username === who)) return json(res, { error: '用户不存在' }, 404)
      const dir = userRoot(who)
      const dayOf = (value: unknown) => String(value ?? '').slice(0, 10)
      const jobs = (await readRows(join(dir, 'jobs.jsonl')))
        .filter((row) => dayOf(row.at) === date)
        .map((row) => ({
          at: row.at,
          platform: row.platform,
          type: row.type,
          keywords: Array.isArray(row.keywords) ? row.keywords : [],
          items: Number(row.items ?? 0),
          comments: Number(row.comments ?? 0),
          status: row.status,
          itemIds: Array.isArray(row.itemIds) ? row.itemIds : [],
        }))
      const allLeads = await new LeadStore(join(dir, 'leads.jsonl')).load()
      const leads = allLeads
        .filter((lead) => dayOf(lead.collected_at) === date)
        .slice(0, 300)
        .map((lead) => ({
          id: lead.id,
          author_name: lead.author_name,
          text: lead.text,
          province: lead.province,
          contacts: lead.contacts,
          item_title: lead.item_title,
          item_id: lead.item_id,
          collected_at: lead.collected_at,
        }))
      const sent = (await readRows(join(dir, 'sent.jsonl')))
        .filter((row) => dayOf(row.at) === date)
        .map((row) => ({ platform: row.platform, target: row.target, kind: row.kind, ok: row.ok, at: row.at }))
      const chats = (await readRows(join(dir, 'chat.jsonl')))
        .filter((row) => dayOf(row.at) === date)
        .map((row) => ({ platform: row.platform, peerId: row.peerId, peerName: row.peerName, direction: row.direction, text: row.text, at: row.at, status: row.status }))
      return json(res, { user: who, date, jobs, leads, sent, chats, totals: { leads: leads.length, sent: sent.length, chats: chats.length } })
    }
    if (url.pathname === '/api/admin/activity' && req.method === 'GET') {
      if (user.role !== 'admin') return json(res, { error: '只有 admin 能看' }, 403)
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 14)))
      const users = await listUsers()
      const rows = []
      for (const item of users) {
        const activity = await userActivity(base, item.username, days)
        rows.push({ username: item.username, role: item.role, status: item.status, totals: activity.totals, days: activity.days })
      }
      return json(res, { days, users: rows })
    }
    if (url.pathname === '/api/admin/usage' && req.method === 'GET') {
      if (user.role !== 'admin') return json(res, { error: '只有 admin 能看' }, 403)
      const users = await listUsers()
      const rows = []
      for (const item of users) {
        rows.push({ username: item.username, role: item.role, status: item.status, created_at: item.created_at, ...(await scanUsage(base, item.username, content)) })
      }
      return json(res, { users: rows })
    }
    if (url.pathname === '/api/users' && req.method === 'GET') {
      if (user.role !== 'admin') return json(res, { error: '只有 admin 能看用户列表' }, 403)
      return json(res, { users: (await listUsers()).map(({ username, role, status, created_at }) => ({ username, role, status, created_at })) })
    }
    if (url.pathname === '/api/users' && req.method === 'POST') {
      if (user.role !== 'admin') return json(res, { error: '只有 admin 能建用户' }, 403)
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      try {
        const created = await createUser({ username: String(input.username ?? ''), password: String(input.password ?? ''), role: input.role === 'admin' ? 'admin' : 'user' })
        await mkdir(userHome(created.username), { recursive: true })
        return json(res, { username: created.username, role: created.role }, 201)
      } catch (error) { return json(res, { error: error instanceof Error ? error.message : String(error) }, 400) }
    }
    const userMatch = url.pathname.match(/^\/api\/users\/([^/]+)(\/role|\/password|\/status)?$/)
    if (userMatch) {
      if (user.role !== 'admin' && decodeURIComponent(userMatch[1]!) !== user.username) return json(res, { error: '没有权限' }, 403)
      const target = decodeURIComponent(userMatch[1]!)
      const action = userMatch[2]
      if (req.method === 'DELETE' && !action) {
        if (user.role !== 'admin') return json(res, { error: '没有权限' }, 403)
        try { await removeUser(target); dropUserSessions(target) } catch (error) { return json(res, { error: error instanceof Error ? error.message : String(error) }, 400) }
        return json(res, { ok: true })
      }
      if (req.method === 'POST' && action === '/status') {
        if (user.role !== 'admin') return json(res, { error: '没有权限' }, 403)
        let input: Record<string, unknown>
        try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
        try {
          const updated = await setStatus(target, String(input.status ?? '') as UserStatus)
          if (updated.status !== 'active') dropUserSessions(target)
          return json(res, { username: updated.username, status: updated.status })
        } catch (error) { return json(res, { error: error instanceof Error ? error.message : String(error) }, 400) }
      }
      if (req.method === 'POST' && action === '/role') {
        if (user.role !== 'admin') return json(res, { error: '没有权限' }, 403)
        let input: Record<string, unknown>
        try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
        try { const updated = await setRole(target, input.role === 'admin' ? 'admin' : 'user'); dropUserSessions(target); return json(res, { username: updated.username, role: updated.role }) } catch (error) { return json(res, { error: error instanceof Error ? error.message : String(error) }, 400) }
      }
      if (req.method === 'POST' && action === '/password') {
        let input: Record<string, unknown>
        try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
        try { await changePassword(target, String(input.password ?? '')); dropUserSessions(target); return json(res, { ok: true }) } catch (error) { return json(res, { error: error instanceof Error ? error.message : String(error) }, 400) }
      }
      return json(res, { error: 'not found' }, 404)
    }

    // ---------------------------------------------------------------- 已采数据（回看 + 候选池 + 群发）
    const root = userRoot(user.username)
    if (req.method === 'GET' && url.pathname === '/api/records') {
      const platform = String(url.searchParams.get('platform') ?? '')
      if (!findPlatform(platform)) return json(res, { error: 'unknown platform' }, 400)
      const index = await loadUserIndex(user.username, platform)
      return json(res, { platform, items: index.items })
    }
    if (req.method === 'GET' && url.pathname === '/api/records/comments') {
      const platform = String(url.searchParams.get('platform') ?? '')
      const item = String(url.searchParams.get('item') ?? '')
      if (!findPlatform(platform) || !item) return json(res, { error: '需要 platform 和 item' }, 400)
      const index = await loadUserIndex(user.username, platform)
      return json(res, { platform, item, comments: threadOf(index.comments.get(item) ?? []) })
    }
    if (req.method === 'GET' && url.pathname === '/api/media') {
      const platform = String(url.searchParams.get('platform') ?? '')
      const item = String(url.searchParams.get('item') ?? '')
      const seq = Math.trunc(Number(url.searchParams.get('seq') ?? 1))
      if (!content) return json(res, { error: '共享库未启用（OMC_SHARED=0）' }, 409)
      if (!findPlatform(platform) || !item || !Number.isFinite(seq) || seq < 1) return json(res, { error: '需要 platform、item 和 seq' }, 400)
      if (user.role !== 'admin' && !content.hasRef(user.username, platform, item)) return json(res, { error: '没有权限' }, 403)
      const row = content.mediaRows(platform, item).find((one) => one.seq === seq)
      if (!row?.sha256) return json(res, { error: '媒体还没下载', hint: '采集时勾选「下载媒体」' }, 404)
      const blob = content.blobFile(row.sha256)
      if (!blob) return json(res, { error: 'not found' }, 404)
      try {
        const info = await stat(blob.path)
        res.writeHead(200, { 'content-type': row.mime ?? blob.mime ?? 'application/octet-stream', 'content-length': String(info.size), 'cache-control': 'private, max-age=3600' })
        createReadStream(blob.path).pipe(res)
      } catch { json(res, { error: 'not found' }, 404) }
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/media/list') {
      const platform = String(url.searchParams.get('platform') ?? '')
      const item = String(url.searchParams.get('item') ?? '')
      if (!content) return json(res, { error: '共享库未启用（OMC_SHARED=0）' }, 409)
      if (!findPlatform(platform) || !item) return json(res, { error: '需要 platform 和 item' }, 400)
      if (user.role !== 'admin' && !content.hasRef(user.username, platform, item)) return json(res, { error: '没有权限' }, 403)
      return json(res, {
        platform,
        item,
        media: content.mediaRows(platform, item).map((row) => ({
          seq: row.seq,
          kind: row.kind,
          mime: row.mime,
          bytes: row.bytes,
          ready: Boolean(row.sha256 && content.blobExists(row.sha256)),
        })),
      })
    }

    // ---------------------------------------------------------------- 线索
    if (req.method === 'POST' && url.pathname === '/api/leads/build') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const platform = String(input.platform ?? '')
      if (!findPlatform(platform)) return json(res, { error: 'unknown platform' }, 400)
      const list = (value: unknown): string[] => Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean)
      const index = await loadUserIndex(user.username, platform)
      const comments = [...index.comments.values()].flat()
      const leads = buildLeads({ platform, items: index.items, comments, intent: list(input.intent), provinces: list(input.provinces) })
      const store = new LeadStore(join(root, 'leads.jsonl'))
      const { added, total } = await store.upsert(leads)
      return json(res, { platform, built: leads.length, added, total })
    }
    if (url.pathname === '/api/leads/sync' && req.method === 'POST') {
      const store = new LeadStore(join(root, 'leads.jsonl'))
      let built = 0
      let added = 0
      const touched: string[] = []
      for (const platform of CRAWL_PLATFORMS) {
        const index = await loadUserIndex(user.username, platform)
        const comments = [...index.comments.values()].flat()
        if (!index.items.length && !comments.length) continue
        const leads = buildLeads({ platform, items: index.items, comments })
        const result = await store.upsert(leads)
        built += leads.length
        added += result.added
        touched.push(platform)
      }
      const total = (await store.load()).length
      return json(res, { platforms: touched, built, added, total })
    }
    if (req.method === 'GET' && url.pathname === '/api/leads') {
      const store = new LeadStore(join(root, 'leads.jsonl'))
      const { items, total } = await store.query({
        platform: url.searchParams.get('platform') || undefined,
        q: url.searchParams.get('q') || undefined,
        province: url.searchParams.get('province') || undefined,
        hasContact: url.searchParams.get('hasContact') === '1' ? true : undefined,
        from: url.searchParams.get('from') || undefined,
        to: url.searchParams.get('to') || undefined,
        limit: Number(url.searchParams.get('limit') ?? 50),
        offset: Number(url.searchParams.get('offset') ?? 0),
      })
      return json(res, { items, total })
    }
    if (req.method === 'GET' && url.pathname === '/api/leads/stats') {
      const leads = await new LeadStore(join(root, 'leads.jsonl')).load()
      const provinces = new Set(leads.map((lead) => lead.province).filter((value): value is string => Boolean(value)))
      return json(res, {
        total: leads.length,
        withContact: leads.filter((lead) => (lead.contacts?.length ?? 0) > 0).length,
        provinces: [...provinces].sort(),
      })
    }
    if (req.method === 'GET' && url.pathname === '/api/leads/export.csv') {
      const store = new LeadStore(join(root, 'leads.jsonl'))
      const wanted = (url.searchParams.get('ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean)
      const { items: found } = await store.query({
        platform: url.searchParams.get('platform') || undefined,
        q: url.searchParams.get('q') || undefined,
        province: url.searchParams.get('province') || undefined,
        hasContact: url.searchParams.get('hasContact') === '1' ? true : undefined,
        limit: 5000,
        offset: 0,
      }, 20000)
      const items = wanted.length ? found.filter((lead) => wanted.includes(lead.id)) : found
      if (wanted.length && !items.length) return json(res, { error: '选中的线索不在当前筛选结果里' }, 400)
      const csv = toCsv(items, { mask: url.searchParams.get('mask') !== '0' })
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="leads-${Date.now()}.csv"` })
      res.end(csv)
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/leads/candidates') {
      // 线索里勾选的人直接进私信候选池：按 (平台, 作品, 用户) 去重，重复点不会多出人。
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const ids = Array.isArray(input.ids) ? input.ids.map((value) => String(value)).filter(Boolean) : []
      if (!ids.length) return json(res, { error: '需要 ids' }, 400)
      const wanted = new Set(ids.slice(0, 500))
      const leads = await new LeadStore(join(root, 'leads.jsonl')).load()
      const picked = leads.filter((lead) => wanted.has(lead.id))
      let added = 0
      let skipped = 0
      let missing = 0
      for (const lead of picked) {
        if (!lead.author_id) { missing++; continue }
        try {
          const result = await addCandidate(root, {
            type: 'dm',
            platform: lead.platform,
            itemId: lead.item_id,
            // 私信候选按用户去重：不带 commentId，同一个人从两条评论进来只留一个。
            userId: lead.author_id,
            userName: lead.author_name ?? undefined,
            note: lead.item_title ? String(lead.item_title).slice(0, 80) : undefined,
          })
          if (result.added) added++
          else skipped++
        } catch { skipped++ }
      }
      return json(res, { added, skipped, missing, total: picked.length })
    }

    if (req.method === 'GET' && url.pathname === '/api/dashboard') {
      const leads = await new LeadStore(join(root, 'leads.jsonl')).load()
      const tasks = [...jobs.values()].filter((job) => job.owner === user.username || user.role === 'admin').map((job) => ({ status: job.status }))
      const settings = await loadSettings(user.username)
      return json(res, { ...summarize({ leads, tasks }), settings })
    }
    if (req.method === 'GET' && url.pathname === '/api/content/stats') {
      if (user.role !== 'admin') return json(res, { error: '只有 admin 能看' }, 403)
      if (!content) return json(res, { enabled: false, hint: 'OMC_SHARED=0 时为按用户落盘' })
      const since = Date.now() - 30 * 24 * 3600 * 1000
      return json(res, {
        enabled: true,
        dir: sharedDir,
        config: await loadSharedConfig(sharedDir),
        usage: content.usage(),
        reuse: content.reuseStats(since),
        accounts: (await listUsers()).length,
      })
    }
    if (url.pathname === '/api/content/gc' && (req.method === 'GET' || req.method === 'POST')) {
      if (user.role !== 'admin') return json(res, { error: '只有 admin 能回收' }, 403)
      if (!content) return json(res, { error: '共享库未启用（OMC_SHARED=0）' }, 409)
      let input: Record<string, unknown> = {}
      if (req.method === 'POST') {
        try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
        if (String(input.confirm ?? '') !== '确认回收') return json(res, { error: '需要输入「确认回收」' }, 400)
      } else {
        input = { days: url.searchParams.get('days') }
      }
      const days = Math.min(3650, Math.max(1, Number(input.days ?? 30)))
      const plan = content.gc({ days, apply: req.method === 'POST' })
      return json(res, { ...plan, enabled: true })
    }

    // ---------------------------------------------------------------- 账号健康与设置
    if (req.method === 'GET' && url.pathname === '/api/accounts/health') {
      const platform = String(url.searchParams.get('platform') ?? '')
      if (!findPlatform(platform)) return json(res, { error: 'unknown platform' }, 400)
      return json(res, { platform, ...(await accountStatus(platform, { env: { ...process.env, CATBUS_HOME: home } })) })
    }
    if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, await loadSettings(user.username))
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      if (user.role !== 'admin') return json(res, { error: '群发参数由 admin 统一设置' }, 403)
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const current = await loadSettings(user.username)
      const next = await saveSettings(user.username, {
        dailyCap: Number(input.dailyCap ?? current.dailyCap),
        batchMax: Number(input.batchMax ?? current.batchMax),
        minSeconds: Number(input.minSeconds ?? current.minSeconds),
        maxSeconds: Number(input.maxSeconds ?? current.maxSeconds),
      })
      return json(res, next)
    }
    if (url.pathname === '/api/settings/clear' && req.method === 'POST') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      if (String(input.confirm ?? '') !== '确认清空') return json(res, { error: '需要输入「确认清空」' }, 400)
      const removed: string[] = []
      for (const name of ['leads.jsonl', 'sent.jsonl', 'candidates.json']) {
        await rm(join(root, name), { force: true }).then(() => removed.push(name)).catch(() => {})
      }
      for (const name of await readdir(root)) {
        if (name.startsWith('.crawl-state-')) { await rm(join(root, name), { force: true }); removed.push(name) }
      }
      // 共享模式下「我的采集结果」就是 refs，清空前先删；线索/候选/发送记录已在上面清掉。
      if (content) {
        const refs = content.clearRefs(user.username)
        const masks = content.clearMasks(user.username)
        if (refs) removed.push(`shared:refs:${refs}`)
        if (masks) removed.push(`shared:masks:${masks}`)
      }
      return json(res, { removed })
    }

    if (url.pathname === '/api/candidates' && req.method === 'GET') return json(res, { candidates: await listCandidates(root) })
    if (url.pathname === '/api/candidates' && req.method === 'POST') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      try {
        const type = input.type === 'dm' ? 'dm' : 'reply'
        const result = await addCandidate(root, {
          type,
          platform: String(input.platform ?? ''),
          itemId: String(input.itemId ?? ''),
          commentId: input.commentId ? String(input.commentId) : undefined,
          userId: input.userId ? String(input.userId) : undefined,
          userName: input.userName ? String(input.userName) : undefined,
          note: input.note ? String(input.note).slice(0, 200) : undefined,
        })
        return json(res, result, result.added ? 201 : 200)
      } catch (error) { return json(res, { error: error instanceof Error ? error.message : String(error) }, 400) }
    }
    if (url.pathname === '/api/candidates/bulk' && req.method === 'POST') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const type = input.type === 'dm' ? 'dm' : 'reply'
      const platform = String(input.platform ?? '')
      const itemId = String(input.itemId ?? '')
      const rows = Array.isArray(input.items) ? input.items as Array<Record<string, unknown>> : []
      if (!platform || !itemId || !rows.length) return json(res, { error: '需要 platform、itemId 和 items' }, 400)
      let added = 0
      let skipped = 0
      for (const row of rows.slice(0, 500)) {
        try {
          const result = await addCandidate(root, {
            type,
            platform,
            itemId,
            commentId: row.commentId ? String(row.commentId) : undefined,
            userId: row.userId ? String(row.userId) : undefined,
            userName: row.userName ? String(row.userName) : undefined,
            note: row.note ? String(row.note) : undefined,
          })
          if (result.added) added++
          else skipped++
        } catch { skipped++ }
      }
      return json(res, { added, skipped })
    }
    if (url.pathname === '/api/lexicon' && req.method === 'GET') return json(res, await loadLexicon(root))
    if (url.pathname === '/api/lexicon' && req.method === 'POST') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      return json(res, await saveLexicon(root, sanitizeLexicon({ keywords: input.keywords as string[], filters: input.filters as string[] })))
    }

    if (url.pathname === '/api/chat/threads' && req.method === 'GET') return json(res, { threads: await listThreads(root) })
    if (url.pathname === '/api/chat/messages' && req.method === 'GET') {
      const platform = String(url.searchParams.get('platform') ?? '')
      const peerId = String(url.searchParams.get('peerId') ?? '')
      if (!platform || !peerId) return json(res, { error: '需要 platform 和 peerId' }, 400)
      return json(res, { platform, peerId, messages: await listChat(root, { platform, peerId }) })
    }
    if (url.pathname === '/api/chat/send' && req.method === 'POST') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const platform = String(input.platform ?? '')
      const peerId = String(input.peerId ?? '')
      const text = String(input.text ?? '').trim()
      if (!findPlatform(platform)) return json(res, { error: 'unknown platform' }, 400)
      if (!peerId) return json(res, { error: '缺少 peerId' }, 400)
      if (!text) return json(res, { error: '内容不能为空' }, 400)
      if (text.length > 500) return json(res, { error: '内容上限 500 字' }, 400)
      const outcome = await runAction({ platform, kind: 'dm', target: peerId, text }, { env: { CATBUS_HOME: home } })
      const message = await appendChat(root, {
        platform,
        peerId,
        peerName: input.peerName ? String(input.peerName) : null,
        direction: 'out',
        text,
        status: outcome.ok ? 'sent' : 'failed',
      })
      if (!outcome.ok) return json(res, { error: outcome.message, code: outcome.code, message }, 502)
      return json(res, { ok: true, message }, 201)
    }
    if (url.pathname === '/api/chat/sync' && req.method === 'POST') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const platform = String(input.platform ?? '')
      const peerId = String(input.peerId ?? '')
      if (!findPlatform(platform) || !peerId) return json(res, { error: '需要 platform 和 peerId' }, 400)
      let envelope: { ok?: boolean; data?: unknown; error?: { message?: string } }
      try {
        envelope = await runCatbus(platform as typeof CRAWL_PLATFORMS[number], ['msg', 'history', peerId, '--limit', '50'], { CATBUS_HOME: home })
      } catch (error) {
        return json(res, { error: error instanceof Error ? error.message : String(error) }, 502)
      }
      if (envelope.ok === false) return json(res, { error: envelope.error?.message ?? '这个平台暂不支持拉取聊天记录' }, 400)
      const rows = Array.isArray(envelope.data) ? envelope.data as Array<Record<string, unknown>> : []
      let imported = 0
      for (const row of rows) {
        const text = String((row.text ?? row.content ?? (row.message as Record<string, unknown> | undefined)?.text ?? '')).trim()
        if (!text) continue
        const self = Boolean(row.is_self ?? row.from_me ?? row.self)
        const rawAt = row.created_at ?? row.create_time ?? row.time
        const at = typeof rawAt === 'number' ? new Date(rawAt > 1e12 ? rawAt : rawAt * 1000).toISOString() : typeof rawAt === 'string' ? rawAt : undefined
        if (await hasMessage(root, { platform, peerId, text, direction: self ? 'out' : 'in', at })) continue
        await appendChat(root, {
          platform,
          peerId,
          peerName: input.peerName ? String(input.peerName) : null,
          direction: self ? 'out' : 'in',
          text,
          status: self ? 'sent' : 'received',
        })
        imported++
      }
      return json(res, { ok: true, imported, messages: await listChat(root, { platform, peerId }) })
    }

    if (url.pathname === '/api/candidates/clear' && req.method === 'POST') {
      let input: Record<string, unknown> = {}
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch {}
      const type = input.type === 'reply' || input.type === 'dm' ? input.type as CandidateType : undefined
      return json(res, { removed: await clearCandidates(root, type) })
    }
    const candidateMatch = url.pathname.match(/^\/api\/candidates\/([^/]+)$/)
    if (candidateMatch && req.method === 'DELETE') {
      return (await removeCandidate(root, candidateMatch[1]!)) ? json(res, { ok: true }) : json(res, { error: 'not found' }, 404)
    }

    if (url.pathname === '/api/templates' && req.method === 'GET') {
      return json(res, { items: await listTemplates(root) })
    }
    if (url.pathname === '/api/templates' && req.method === 'POST') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      if (input.action === 'delete') {
        return json(res, { deleted: await deleteTemplate(root, String(input.id ?? '')) })
      }
      try {
        const result = await saveTemplate(root, { id: input.id ? String(input.id) : undefined, name: String(input.name ?? ''), text: String(input.text ?? '') })
        return json(res, result)
      } catch (error) { return json(res, { error: error instanceof Error ? error.message : String(error) }, 400) }
    }

    if (req.method === 'POST' && url.pathname === '/api/campaigns') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      const type = input.type === 'dm' ? 'dm' : 'reply'
      const text = String(input.text ?? '').trim()
      if (!text) return json(res, { error: '文案不能为空' }, 400)
      if (text.length > 500) return json(res, { error: '文案最多 500 字' }, 400)
      const settings = await loadSettings(user.username)
      const minSeconds = Math.max(5, Number(input.minSeconds ?? settings.minSeconds))
      const maxSeconds = Math.max(minSeconds, Number(input.maxSeconds ?? settings.maxSeconds))
      const ledger = new SendLedger(join(root, 'sent.jsonl'))
      const all = (await listCandidates(root)).filter((c) => c.type === type)
      const queue: typeof all = []
      const skipped = { sent: 0, cap: 0, other: 0 }
      for (const candidate of all) {
        const target = candidate.type === 'reply' ? candidate.commentId ?? '' : candidate.userId ?? ''
        const check = await ledger.canSend(candidate.platform, target, candidate.type, { dailyCap: settings.dailyCap })
        if (check.ok) { queue.push(candidate); continue }
        if (check.reason === '已发送过') skipped.sent++
        else if (check.reason === '今天已到上限') skipped.cap++
        else skipped.other++
      }
      if (!queue.length) return json(res, { error: '没有可发的候选（已发送过或今天到上限）', skipped }, 400)
      if (queue.length > settings.batchMax) return json(res, { error: '一次最多 ' + settings.batchMax + ' 条，先清一清候选池' }, 400)
      const state = newCampaign(type, text, queue.length)
      const controller = new AbortController()
      state.stop = () => controller.abort()
      campaigns.set(state.id, { state, controller })
      json(res, { id: state.id, total: queue.length, minSeconds, maxSeconds, dailyCap: settings.dailyCap, batchMax: settings.batchMax, skipped }, 202)
      void (async () => {
        const push = (event: CampaignEvent): void => {
          state.history.push(event)
          for (const subscriber of state.subscribers) subscriber(event)
        }
        const result = await runCampaign(queue, text, { minSeconds, maxSeconds, signal: controller.signal }, {
          send: async (candidate, message) => {
            const target = candidate.type === 'reply' ? candidate.commentId ?? '' : candidate.userId ?? ''
            const outcome = candidate.type === 'reply'
              ? await runAction({ platform: candidate.platform, kind: 'comment', target: candidate.itemId, text: message, replyTo: candidate.commentId ?? undefined }, { env: { CATBUS_HOME: home } })
              : await runAction({ platform: candidate.platform, kind: 'dm', target: candidate.userId ?? '', text: message }, { env: { CATBUS_HOME: home } })
            await ledger.record({ platform: candidate.platform, target, kind: candidate.type, ok: outcome.ok }).catch(() => {})
            return outcome.ok ? { ok: true } : { ok: false, code: outcome.code, message: outcome.message }
          },
        }, push)
        state.status = result.status
        state.sent = result.sent
        state.failed = result.failed
        state.message = result.message
        push({ type: 'done', message: result.message, time: new Date().toISOString() })
      })()
      return
    }
    const campaignMatch = url.pathname.match(/^\/api\/campaigns\/([^/]+)(\/events|\/stop)?$/)
    if (campaignMatch) {
      const campaign = campaigns.get(campaignMatch[1]!)
      if (!campaign) return json(res, { error: 'not found' }, 404)
      const { state, controller } = campaign
      if (req.method === 'POST' && campaignMatch[2] === '/stop') { controller.abort(); return json(res, { ok: true }) }
      if (req.method === 'GET' && campaignMatch[2] === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const send = (event: CampaignEvent): void => { res.write(`data: ${JSON.stringify(event)}\n\n`) }
        for (const event of state.history) send(event)
        if (state.status === 'running') state.subscribers.add(send)
        else res.end()
        req.on('close', () => state.subscribers.delete(send))
        return
      }
      if (req.method === 'GET' && !campaignMatch[2]) {
        const { subscribers, stop, ...rest } = state
        return json(res, rest)
      }
    }

    // ---------------------------------------------------------------- 任务与文件（按用户隔离）
    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      const list = [...jobs.values()].filter((job) => job.owner === user.username || user.role === 'admin')
      return json(res, list.map(({ events, ...job }) => job))
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      if (!CRAWL_PLATFORMS.includes(String(input.platform) as never) || !CRAWL_TYPES.includes(String(input.type) as never)) return json(res, { error: 'unknown platform or type' }, 400)
      const id = randomUUID()
      const controller = new AbortController()
      const job: Job = { id, owner: user.username, status: 'running', options: input, events: new Set(), history: [], controller }
      jobs.set(id, job)
      json(res, { id }, 202)
      void (async () => {
        const opts = normalizeCrawlOptions({ ...input, out: userRoot(user.username), quiet: true })
        const env = { CATBUS_HOME: home }
        const itemIds: string[] = []
        const policy = policyFrom(await loadSharedConfig(sharedDir), parseRefresh(input.refresh))
        try {
          job.result = await runCrawl(opts, {
            client: (options.clientFactory ?? createSubprocessClient)(opts.platform, { sort: opts.sort, env }),
            signal: controller.signal,
            content: content ?? undefined,
            user: user.username,
            account: await currentAccount(user.username, opts.platform),
            jobId: id,
            policy,
            onEvent: (event) => {
              if (event.type === 'item' && itemIds.length < 300) {
                const saved = String((event.data as { id?: unknown } | undefined)?.id ?? '')
                if (saved) itemIds.push(saved)
              }
              job.history.push(JSON.stringify(event))
              for (const client of job.events) client.write(`data: ${JSON.stringify(event)}\n\n`)
            },
          })
          job.status = 'done'
        } catch (error) {
          if (error instanceof CrawlStoppedError) {
            job.status = 'stopped'
            const event = { type: 'error' as const, message: '已手动停止', time: new Date().toISOString() }
            job.history.push(JSON.stringify(event))
            for (const client of job.events) client.write(`data: ${JSON.stringify(event)}\n\n`)
          } else {
            job.status = 'error'
            const event = { type: 'error' as const, message: error instanceof Error ? error.message : String(error), time: new Date().toISOString() }
            job.history.push(JSON.stringify(event))
            for (const client of job.events) client.write(`data: ${JSON.stringify(event)}\n\n`)
          }
        }
        for (const client of job.events) client.end()
        const counts = (job.result as { counts?: { items?: number; comments?: number; newComments?: number; reusedItems?: number; reusedComments?: number; reusedMedia?: number } } | undefined)?.counts
        const refs = content ? content.refsByJob(user.username, id) : []
        await appendFile(join(userRoot(user.username), 'jobs.jsonl'), JSON.stringify({
          id,
          at: isoNow(),
          platform: opts.platform,
          type: opts.type,
          keywords: opts.keywords ?? [],
          items: counts?.items ?? 0,
          comments: counts?.comments ?? 0,
          newComments: counts?.newComments ?? 0,
          reused: { items: counts?.reusedItems ?? 0, comments: counts?.reusedComments ?? 0, media: counts?.reusedMedia ?? 0 },
          itemIds: refs.length ? refs : itemIds,
          status: job.status,
        }) + '\n', 'utf8').catch(() => {})
      })()
      return
    }
    const stopMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/stop$/)
    if (req.method === 'POST' && stopMatch) {
      const job = jobs.get(stopMatch[1]!)
      if (!job || (job.owner !== user.username && user.role !== 'admin')) return json(res, { error: 'not found' }, 404)
      job.controller?.abort()
      return json(res, { ok: true })
    }
    const logMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/log$/)
    if (req.method === 'GET' && logMatch) {
      const job = jobs.get(logMatch[1]!)
      if (!job || (job.owner !== user.username && user.role !== 'admin')) return json(res, { error: 'not found' }, 404)
      const lines = job.history.map((raw) => {
        try {
          const event = JSON.parse(raw) as { time?: string; message?: string; type?: string }
          return { time: event.time ?? '', message: event.message ?? raw, type: event.type ?? 'log' }
        } catch { return { time: '', message: raw, type: 'log' } }
      })
      return json(res, { id: job.id, status: job.status, lines })
    }
    const eventMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/)
    if (req.method === 'GET' && eventMatch) {
      const job = jobs.get(eventMatch[1]!)
      if (!job || (job.owner !== user.username && user.role !== 'admin')) return json(res, { error: 'not found' }, 404)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      for (const event of job.history) res.write(`data: ${event}\n\n`)
      if (job.status === 'running') job.events.add(res); else res.end()
      req.on('close', () => job.events.delete(res))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/files') {
      const who = String(url.searchParams.get('user') ?? user.username)
      if (who !== user.username && user.role !== 'admin') return json(res, { error: '没有权限' }, 403)
      const fileRoot = resolve(userRoot(who))
      const requested = resolve(String(url.searchParams.get('path') ?? ''))
      if (!requested.startsWith(fileRoot + sep)) return json(res, { error: 'forbidden' }, 403)
      try { const data = await readFile(requested); res.writeHead(200, { 'content-type': mime(extname(requested)) }); res.end(data) } catch { json(res, { error: 'not found' }, 404) }
      return
    }
    json(res, { error: 'not found' }, 404)
  }

  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(options.port ?? 8080, host, () => resolveListen()) })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port ?? 8080
  return {
    server, port, host, jobs, logins,
    ...(admin.created ? { bootstrap: { username: admin.username, password: admin.password ?? '' } } : {}),
    close: () => new Promise((resolveClose, reject) => {
      for (const login of logins.values()) login.child?.kill()
      content?.close()
      server.close((error) => error ? reject(error) : resolveClose())
    }),
  }
}

/** 把登录子进程的失败原因讲清楚：优先用 stdout 里的 JSON 信封，其次过滤掉二维码的终端字符。 */
function describeLoginFailure(stdout: string, stderr: string, code: number | null): string {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const envelope = JSON.parse(lines[i]!) as { error?: { code?: string; message?: string; hint?: string } }
      const message = envelope.error?.message
      if (message) {
        if (/过期/.test(message)) return '二维码已过期，重新点扫码'
        if (/超时/.test(message)) return '扫码后没有在有效期内收到手机上的确认，重新点扫码再试'
        if (/风控|验证码|captcha/i.test(message)) return `平台风控：${message}`
        return envelope.error?.hint ? `${message}（${envelope.error.hint}）` : message
      }
    } catch {}
  }
  const clean = stderr
    .replace(/\u001b\[[0-9;]*[mK]/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/[▀▄█]/.test(line) && !/二维码图片/.test(line))
  const tail = clean.slice(-2).join(' ')
  if (tail) return tail
  return `登录进程退出（code ${code ?? -1}），没有拿到具体原因，重试一次或改用 Cookie 登录`
}

function json(res: ServerResponse, value: unknown, status = 200): void { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
function send(res: ServerResponse, status: number, contentType: string, value: string): void { res.writeHead(status, { 'content-type': contentType }); res.end(value) }
function mime(ext: string): string { return ext === '.json' ? 'application/json' : ext === '.csv' ? 'text/csv; charset=utf-8' : 'application/octet-stream' }

export { STAR }
