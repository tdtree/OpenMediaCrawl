import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { rm } from 'node:fs/promises'
import { CatbusError } from '../core/errors.js'
import { isoNow, readTextIfExists, writeFileAtomic } from '../core/fsutil.js'

export type Role = 'admin' | 'user'
/** 自助注册的账号先 pending，admin 通过后才是 active。 */
export type UserStatus = 'pending' | 'active' | 'disabled'

export interface User {
  username: string
  role: Role
  status: UserStatus
  password_hash: string
  created_at: string
}

/** scrypt 参数写进哈希串，将来调参数也还能校验旧密码。 */
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_BYTES = 32
const SALT_BYTES = 16
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128

/** 3-32 位：小写字母/数字开头，后面可带下划线和短横线（机器账号名）。 */
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/
/** 2-30 位中文姓名，允许间隔号（阿依古丽·买买提）。 */
const REALNAME_RE = /^[一-龥][一-龥·]{1,29}$/
const HEX_RE = /^(?:[0-9a-f]{2})+$/
/** 生成随机初始密码用的字符集：去掉 0/O、1/l/I 这类看错的字符。 */
const READABLE = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'

interface UsersFile {
  version: number
  users: User[]
}

/**
 * 用户文件：OMC_USERS_FILE 优先，否则 <OMC_HOME|~/.openmediacrawl>/users.json。
 * 环境变量为空串时当作没设（避免 `OMC_USERS_FILE=` 这种写法落到当前目录）。
 */
export function usersFilePath(): string {
  const explicit = process.env.OMC_USERS_FILE
  if (explicit) return explicit
  const home = process.env.OMC_HOME || join(homedir(), '.openmediacrawl')
  return join(home, 'users.json')
}

export function checkUsername(name: string): string {
  const username = typeof name === 'string' ? name.trim() : ''
  if (REALNAME_RE.test(username) || USERNAME_RE.test(username)) return username
  throw new CatbusError('USAGE', '账号需为真实姓名：2-30 位中文（可用间隔号），或 3-32 位小写字母/数字/下划线/短横线')
}

function checkStatus(status: unknown): UserStatus {
  if (status === 'pending' || status === 'active' || status === 'disabled') return status
  throw new CatbusError('USAGE', `未知状态：${String(status)}`)
}

function checkPassword(password: string): string {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new CatbusError('USAGE', `密码长度需在 ${PASSWORD_MIN}-${PASSWORD_MAX} 位之间`)
  }
  return password
}

function checkRole(role: string): Role {
  if (role !== 'admin' && role !== 'user') throw new CatbusError('USAGE', `未知角色：${role}`)
  return role
}

function corrupt(cause?: unknown): CatbusError {
  return new CatbusError('ERROR', '用户数据文件损坏', {
    hint: `检查或删除 ${usersFilePath()}`,
    cause,
  })
}

/**
 * 解析用户文件。文件不存在/为空当空列表；内容损坏抛 CatbusError('ERROR')。
 * 选抛错而不是当空列表：当成空列表会让人误以为用户被删光，
 * 而且下一次写入会把还能人工修好的数据覆盖掉。
 * 也兼容顶层直接是数组的旧格式。
 */
function parseUsersFile(text: string | null): User[] {
  if (text === null || text.trim() === '') return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw corrupt(err)
  }
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null
      ? (raw as { users?: unknown }).users
      : undefined
  if (!Array.isArray(list)) throw corrupt()
  const users: User[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) throw corrupt()
    const { username, role, status, password_hash: passwordHash, created_at: createdAt } = item as Record<string, unknown>
    if (typeof username !== 'string' || typeof passwordHash !== 'string' || typeof createdAt !== 'string') throw corrupt()
    if (role !== 'admin' && role !== 'user') throw corrupt()
    // 旧文件没有 status 字段：默认 active，避免升级后全员被锁在外面
    if (status !== undefined && status !== 'pending' && status !== 'active' && status !== 'disabled') throw corrupt()
    users.push({ username, role, status: (status as UserStatus | undefined) ?? 'active', password_hash: passwordHash, created_at: createdAt })
  }
  return users
}

/** 每次都重新读文件，不做缓存（多进程/手工编辑也能立刻生效）。 */
async function readUsers(): Promise<User[]> {
  return parseUsersFile(await readTextIfExists(usersFilePath()))
}

async function saveUsers(users: User[]): Promise<void> {
  const body: UsersFile = { version: 1, users }
  await writeFileAtomic(usersFilePath(), `${JSON.stringify(body, null, 2)}\n`)
}

/**
 * 读-改-写串行化，避免同一进程内两个请求互相覆盖（跨进程不保证，本地单进程 UI 够用）。
 * 注意：队列内的动作不能再去调另一个走队列的导出函数，否则会自己等自己。
 */
let mutationTail: Promise<unknown> = Promise.resolve()

function mutate<T>(action: () => Promise<T>): Promise<T> {
  const run = mutationTail.then(action, action)
  mutationTail = run.catch(() => undefined)
  return run
}

function deriveKey(
  password: string,
  salt: Buffer,
  keylen: number,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keylen,
      { N: params.N, r: params.r, p: params.p, maxmem: Math.max(64 * 1024 * 1024, 256 * params.N * params.r) },
      (err, key) => (err ? reject(err) : resolve(key)),
    )
  })
}

/** 哈希格式：scrypt$N$r$p$<saltHex>$<hashHex>。 */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await deriveKey(password, salt, KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`
}

/** 解析不了/参数离谱的哈希直接视为校验失败（返回 false），不抛错。 */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, rawN, rawR, rawP, saltHex, hashHex] = parts
  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  // N 必须是 2 的幂且设个上限，防止被改坏的文件拖死内存
  if (N < 2 || (N & (N - 1)) !== 0 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false
  if (!HEX_RE.test(saltHex) || !HEX_RE.test(hashHex)) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  if (salt.length === 0 || expected.length < 16) return false
  let actual: Buffer
  try {
    actual = await deriveKey(password, salt, expected.length, { N, r, p })
  } catch {
    return false
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function randomPassword(length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += READABLE[randomInt(READABLE.length)]
  return out
}

function countAdmins(users: User[]): number {
  return users.filter((user) => user.role === 'admin').length
}

export async function listUsers(): Promise<User[]> {
  return (await readUsers()).map((user) => ({ ...user }))
}

export async function createUser(input: { username: string; password: string; role?: Role; status?: UserStatus }): Promise<User> {
  const username = checkUsername(input.username)
  const password = checkPassword(input.password)
  const role = checkRole(input.role ?? 'user')
  const status = input.status ? checkStatus(input.status) : 'active'
  // 哈希放在队列外算，别让 scrypt 的几十毫秒堵住其他请求
  const password_hash = await hashPassword(password)
  return mutate(async () => {
    const users = await readUsers()
    if (users.some((user) => user.username === username)) throw new CatbusError('USAGE', '用户已存在')
    const user: User = { username, role, status, password_hash, created_at: isoNow() }
    users.push(user)
    await saveUsers(users)
    return { ...user }
  })
}

/** 校验密码；用户不存在、密码错误、哈希损坏都返回 null。 */
export async function verifyUser(username: string, password: string): Promise<User | null> {
  if (typeof username !== 'string' || !(REALNAME_RE.test(username) || USERNAME_RE.test(username))) return null
  if (typeof password !== 'string' || password.length === 0) return null
  const user = (await readUsers()).find((item) => item.username === username)
  if (!user) return null
  return (await verifyPassword(password, user.password_hash)) ? { ...user } : null
}

export async function setStatus(username: string, status: UserStatus): Promise<User> {
  const next = checkStatus(status)
  return mutate(async () => {
    const users = await readUsers()
    const user = users.find((item) => item.username === username)
    if (!user) throw new CatbusError('USAGE', '用户不存在')
    if (user.role === 'admin' && next !== 'active' && users.filter((u) => u.role === 'admin' && u.status === 'active').length <= 1) {
      throw new CatbusError('USAGE', '至少要保留一个可用的管理员')
    }
    user.status = next
    await saveUsers(users)
    return { ...user }
  })
}

export async function setRole(username: string, role: Role): Promise<User> {
  const next = checkRole(role)
  return mutate(async () => {
    const users = await readUsers()
    const user = users.find((item) => item.username === username)
    if (!user) throw new CatbusError('USAGE', '用户不存在')
    if (user.role === 'admin' && next !== 'admin' && countAdmins(users) <= 1) {
      throw new CatbusError('USAGE', '至少要保留一个 admin')
    }
    user.role = next
    await saveUsers(users)
    return { ...user }
  })
}

export interface RemoveUserOptions {
  /** 同时删除该用户的数据目录。默认 false：只删账号，数据保留。 */
  purgeData?: boolean
  /** 数据根目录（即 --out）；默认 OMC_DATA_DIR，再退回 ./data。 */
  dataRoot?: string
}

/**
 * 计算并校验要删除的用户目录。用户名必须能通过正常账号校验，
 * 且解析后的路径必须仍在 `<dataRoot>/users/` 里面；`..`、绝对路径、空用户名都会被拒。
 */
function userDataDir(dataRoot: string, username: string): string {
  if (typeof username !== 'string' || username.trim() === '') {
    throw new CatbusError('USAGE', '用户名不能为空')
  }
  if (isAbsolute(username) || username.includes('/') || username.includes('\\') || username === '.' || username === '..') {
    throw new CatbusError('USAGE', `用户名不合法，拒绝删除数据目录：${username}`)
  }
  if (!USERNAME_RE.test(username) && !REALNAME_RE.test(username)) {
    throw new CatbusError('USAGE', `用户名不合法，拒绝删除数据目录：${username}`)
  }
  const usersRoot = resolve(dataRoot, 'users')
  const dir = resolve(usersRoot, username)
  if (dir === usersRoot || !dir.startsWith(usersRoot + sep)) {
    throw new CatbusError('USAGE', `用户名不合法，拒绝删除数据目录：${username}`)
  }
  return dir
}

export async function removeUser(username: string, options: RemoveUserOptions = {}): Promise<void> {
  const purgeData = options.purgeData === true
  // 先做路径校验（即使后面发现用户不存在），保证破坏性操作的参数永远是安全的。
  const dataDir = purgeData ? userDataDir(options.dataRoot ?? process.env.OMC_DATA_DIR ?? './data', username) : null
  await mutate(async () => {
    const users = await readUsers()
    const index = users.findIndex((item) => item.username === username)
    if (index < 0) throw new CatbusError('USAGE', '用户不存在')
    if (users[index].role === 'admin' && countAdmins(users) <= 1) {
      throw new CatbusError('USAGE', '至少要保留一个 admin')
    }
    users.splice(index, 1)
    await saveUsers(users)
  })
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
}

export async function changePassword(username: string, password: string): Promise<void> {
  const password_hash = await hashPassword(checkPassword(password))
  await mutate(async () => {
    const users = await readUsers()
    const user = users.find((item) => item.username === username)
    if (!user) throw new CatbusError('USAGE', '用户不存在')
    user.password_hash = password_hash
    await saveUsers(users)
  })
}

/**
 * 首次启动引导：用户列表为空时建一个 admin。
 * 密码取 OMC_ADMIN_PASSWORD（设了但太短会直接报错，而不是悄悄换成随机密码——否则没人知道密码）；
 * 没设就生成 12 位可读随机密码，由调用方打印一次。
 * 并发首启时可能双双看到空列表，后一个会撞「用户已存在」，这里当成已存在处理。
 */
export async function ensureAdmin(): Promise<{ created: boolean; username: string; password?: string }> {
  if ((await listUsers()).length > 0) return { created: false, username: 'admin' }
  const password = process.env.OMC_ADMIN_PASSWORD || randomPassword(12)
  try {
    const user = await createUser({ username: 'admin', password, role: 'admin' })
    return { created: true, username: user.username, password }
  } catch (err) {
    if (err instanceof CatbusError && err.message === '用户已存在') return { created: false, username: 'admin' }
    throw err
  }
}
