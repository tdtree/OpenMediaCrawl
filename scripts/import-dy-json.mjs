#!/usr/bin/env node
/**
 * import-dy-json.mjs — 把 dy.json（dy-capture.mjs 的五件套）直接导入 catbus 账号库。
 *
 * 只新增这一个文件，不改任何现有源码。
 *
 * 用法：
 *   node scripts/import-dy-json.mjs C:/Users/tdtre/dy.json
 *   node scripts/import-dy-json.mjs dy.json --account main
 *
 * 做的事：
 *   1. 解析 dy.json → cookie / ticket / ts_sign / client_cert / private_key
 *   2. 按 core/schemas.ts 的 CredentialSchema 组装凭证
 *      - cookies  → scopes.web.cookies[]（domain 统一 .douyin.com）
 *      - ts_sign / ticket / client_cert → scopes.web.tokens{}
 *      - private_key → device.private_key（client.ts 的 get privateKey 就取这里）
 *   3. 写到 ~/.catbus/auth/douyin/web/<account>.json，并把 _current 指过去
 *
 * 导入后用：
 *   node dist/cli/main.js auth list
 *   node dist/cli/main.js douyin user get "<主页URL>"
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const ROOT_DOMAIN = '.douyin.com'
// 这些 cookie 在上游是 host-only（只发给 www），导入时保持首页域名即可；
// client.ts 的 cookiesFor 会按名字再筛，所以统一 ROOT_DOMAIN 也能工作。
const HOST_ONLY = new Set(['s_v_web_id', 'x-web-secsdk-uid', 'csrf_session_id', 'gd_random'])

function home() {
  return process.env.CATBUS_HOME || path.join(os.homedir(), '.catbus')
}
function authDir(...parts) {
  return path.join(home(), 'auth', ...parts)
}
function isoNow() {
  return new Date().toISOString()
}

function parseCookieString(s) {
  const out = []
  for (const part of s.split(';')) {
    const t = part.trim()
    if (!t || !t.includes('=')) continue
    const i = t.indexOf('=')
    const name = t.slice(0, i).trim()
    const value = t.slice(i + 1).trim()
    if (!name) continue
    out.push({
      name,
      value,
      domain: HOST_ONLY.has(name) ? 'www.douyin.com' : ROOT_DOMAIN,
      path: '/',
      expires: null,
    })
  }
  return out
}

function main() {
  const args = process.argv.slice(2)
  const src = args.find((a) => !a.startsWith('--')) || 'dy.json'
  const ai = args.indexOf('--account')
  const account = ai >= 0 ? args[ai + 1] : 'default'

  const abs = path.resolve(src)
  if (!fs.existsSync(abs)) {
    console.error(`找不到 ${abs}`)
    process.exit(2)
  }
  const raw = JSON.parse(fs.readFileSync(abs, 'utf8'))
  const missing = ['cookie', 'ticket', 'ts_sign', 'client_cert', 'private_key'].filter((k) => !raw[k])
  if (missing.length) {
    console.error(`dy.json 缺字段：${missing.join(', ')}`)
    process.exit(1)
  }

  const cookies = parseCookieString(raw.cookie)
  const hasSession = cookies.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss')
  if (!hasSession) {
    console.error('cookie 里没有 sessionid / sessionid_ss，不是登录态')
    process.exit(1)
  }

  const now = isoNow()
  const credential = {
    schema: 1,
    platform: 'douyin',
    endpoint: 'web',
    account,
    user: null,
    method: 'cookie',
    created_at: now,
    updated_at: now,
    scopes: {
      web: {
        cookies,
        tokens: {
          ts_sign: raw.ts_sign,
          ticket: raw.ticket,
          client_cert: raw.client_cert,
        },
      },
    },
    device: { private_key: raw.private_key },
    extra: { source: 'dy.json', imported_at: now },
  }

  const dir = authDir('douyin', 'web')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${account}.json`)
  fs.writeFileSync(file, JSON.stringify(credential, null, 2) + '\n', 'utf8')
  try {
    fs.chmodSync(file, 0o600)
  } catch {}
  fs.writeFileSync(path.join(dir, '_current'), `${account}\n`, 'utf8')

  const mask = (v) => (v.length <= 18 ? v : `${v.slice(0, 12)}…${v.slice(-4)}`)
  console.log(`✓ 已导入 ${account}`)
  console.log(`  文件      ${file}`)
  console.log(`  cookies   ${cookies.length} 个（sessionid=${cookies.some((c) => c.name === 'sessionid')}）`)
  console.log(`  ts_sign   ${mask(raw.ts_sign)}`)
  console.log(`  ticket    ${mask(raw.ticket)}`)
  console.log(`  cert      ${mask(raw.client_cert)}`)
  console.log(`  prv_key   ${raw.private_key.includes('PRIVATE KEY') ? 'PEM' : 'raw'} (${raw.private_key.length} 字符)`)
  console.log('')
  console.log('下一步：')
  console.log('  node dist/cli/main.js auth list')
  console.log('  node dist/cli/main.js douyin user get "<主页URL>"')
}

main()
