/**
 * dy-capture.mjs — 本机 Chrome 抓取抖音 bd-ticket-guard 五件套
 *
 * 用法（在 OpenMediaCrawl 仓库根目录）：
 *   npm run capture:douyin              # 复用 .chrome-dy 的登录态
 *   DY_FRESH=1 npm run capture:douyin   # 清 cookie，重新扫码
 *
 * 产物：dy.json（cookie / ticket / ts_sign / client_cert / private_key）
 *      前端「粘贴 Cookie」里点「导入 dy.json」即可自动填好五个输入。
 *
 * 说明：
 * - 必须在本机（有 Chrome、能弹窗）运行；Docker 容器里没有浏览器，跑不了。
 * - 私钥由浏览器 security-sdk 在扫码登录时生成，脚本通过 hook crypto.subtle 导出 PKCS8，
 *   不读取、也不依赖浏览器的 localStorage 文件。
 * - 只写本地文件；日志里的值都做了掩码。dy.json 是账号凭证，别提交、别外传。
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'

const CHROME = process.env.CHROME_PATH || defaultChrome()
const PROFILE = path.resolve(process.env.DY_PROFILE || '.chrome-dy')
const OUT = path.resolve(process.env.DY_OUT || 'dy.json')
const TIMEOUT_MS = Number(process.env.DY_TIMEOUT_MS || 900000)
const DUMP = process.env.DY_DUMP === '1'
const ORDER = ['cookie', 'ticket', 'ts_sign', 'client_cert', 'private_key']

const bag = {}
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}]`, ...a)
const mask = (v) => (!v ? '' : v.length <= 26 ? v : `${v.slice(0, 18)}…${v.slice(-6)}`)

function defaultChrome() {
  if (process.platform === 'win32') {
    for (const p of [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    ]) if (p && fs.existsSync(p)) return p
  }
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  return 'google-chrome'
}

function save() {
  if (!bag.cookie) return
  const data = {}
  for (const k of ORDER) if (bag[k]) data[k] = bag[k]
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8')
  try { fs.chmodSync(OUT, 0o600) } catch {}
}

function setField(k, v, from = '') {
  if (!k || !v || bag[k]) return false
  bag[k] = v
  log(`✓ ${k}  ${mask(v)}${from ? `  (${from})` : ''}`)
  save()
  return true
}

function decodeB64(s) {
  if (!s) return null
  s = String(s).replace(/\\\//g, '/').replace(/-/g, '+').replace(/_/g, '/')
  try { return Buffer.from(s, 'base64').toString('utf8') } catch { return null }
}

function absorb(obj) {
  if (!obj || typeof obj !== 'object') return
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k).toLowerCase().replace(/[-_\s]/g, '')
    const hit = key === 'tssign' ? 'ts_sign'
      : key === 'ticket' ? 'ticket'
      : key === 'clientcert' || key === 'sdkcert' ? 'client_cert'
      : key === 'privatekey' ? 'private_key'
      : null
    if (hit && typeof v === 'string' && v) setField(hit, v)
    if (v && typeof v === 'object') absorb(v)
  }
}

function harvest(text, src = '') {
  if (!text || typeof text !== 'string') return
  if (!/bd_ticket|client_cert|sdk_cert|ts\.2\.|pub\.|BEGIN PRIVATE KEY/i.test(text)) return
  const variants = [text]
  if (text.includes('\\"')) variants.push(text.replace(/\\{1,3}"/g, '"'))
  for (const t of variants) {
    for (const m of t.matchAll(/bd_ticket_guard_server_data\W{0,6}([A-Za-z0-9+/=_-]{60,})/g)) {
      const txt = decodeB64(m[1])
      if (!txt) continue
      try { absorb(JSON.parse(txt)) } catch {}
      const mm = txt.match(/"ts_sign"\s*:\s*"([^"]+)"/)
      if (mm) setField('ts_sign', mm[1], 'server_data')
    }
    for (const m of t.matchAll(/"(ts_sign|ticket|client_cert|sdk_cert|private_key)"\s*:\s*"([^"]{8,})"/g)) {
      const k = m[1] === 'sdk_cert' ? 'client_cert' : m[1]
      if (!/^\$/.test(m[2])) setField(k, m[2], src || 'body')
    }
    const ts = t.match(/ts\.2\.[A-Za-z0-9_.-]{20,}/)
    if (ts) setField('ts_sign', ts[0], src || 'body')
    const cert = t.match(/pub\.[A-Za-z0-9+/=_-]{40,}/)
    if (cert) setField('client_cert', cert[0], src || 'body')
  }
}

/** 页面注入：hook crypto.subtle，导出 security-sdk 生成的私钥（PKCS8 PEM）。 */
function pageHook() {
  const report = (k, v) => { try { window.__dyReport && window.__dyReport(k, v) } catch {} }
  try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }) } catch {}
  const s = window.crypto && window.crypto.subtle
  const pemOf = async (key) => {
    const der = await s.exportKey('pkcs8', key)
    const b64 = btoa(String.fromCharCode(...new Uint8Array(der)))
    const lines = b64.match(/.{1,64}/g) || []
    return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`
  }
  if (s) {
    const gen = s.generateKey && s.generateKey.bind(s)
    if (gen) {
      s.generateKey = async (alg, _extractable, usages) => {
        const kp = await gen(alg, true, usages)
        if (kp && kp.privateKey) { try { report('private_key', await pemOf(kp.privateKey)) } catch {} }
        return kp
      }
    }
    const imp = s.importKey && s.importKey.bind(s)
    if (imp) {
      s.importKey = async (...a) => {
        const k = await imp(...a)
        if (a[0] === 'pkcs8' && a[3]) { try { report('private_key', await pemOf(k)) } catch {} }
        return k
      }
    }
  }
  const _fetch = window.fetch
  if (_fetch) {
    window.fetch = async function (...a) {
      const r = await _fetch.apply(this, a)
      try { const t = await r.clone().text(); if (t) report('__body', t) } catch {}
      return r
    }
  }
  window.__dyProbe = () => {
    const out = {}
    const hit = (x) => typeof x === 'string' && x.length < 20000 && /ts\.2\.|pub\.|BEGIN PRIVATE KEY|sdk_cert|client_cert/.test(x)
    try {
      for (const st of [localStorage, sessionStorage]) {
        for (let i = 0; i < st.length; i++) {
          const k = st.key(i); let v = null
          try { v = st.getItem(k) } catch {}
          if (hit(v)) out[`ls:${k}`] = v
        }
      }
    } catch {}
    return out
  }
}

function attach(page) {
  if (page.__dyHooked) return
  page.__dyHooked = true
  page.on('request', (req) => {
    const raw = req.headers()['bd-ticket-guard-client-data']
    if (!raw) return
    const txt = decodeB64(raw)
    if (txt) { try { absorb(JSON.parse(txt)) } catch {} }
  })
  page.on('response', async (res) => {
    try {
      const rt = res.request().resourceType()
      const ct = res.headers()['content-type'] || ''
      if (!['xhr', 'fetch', 'document', 'script', 'other'].includes(rt) && !/json|text/i.test(ct)) return
      harvest(await res.text(), `${rt} ${res.url().slice(0, 60)}`)
    } catch {}
  })
}

if (!fs.existsSync(CHROME) && process.platform !== 'linux') {
  console.error(`找不到 Chrome：${CHROME}\n用 CHROME_PATH 指定可执行文件，例如 CHROME_PATH="C:/.../chrome.exe"。`)
  process.exit(2)
}

let puppeteer
try {
  puppeteer = (await import('puppeteer-core')).default
} catch {
  console.error('缺少依赖 puppeteer-core。先运行：npm install')
  process.exit(2)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  defaultViewport: null,
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check', '--window-size=1280,900'],
})

const page = await browser.newPage()
const cdp = await page.createCDPSession()
await page.exposeFunction('__dyReport', (k, v) => {
  if (k === '__body') return harvest(v, 'fetch-hook')
  setField(k, v, 'crypto-hook')
})
await page.evaluateOnNewDocument(`(${pageHook.toString()})()`)
attach(page)

process.on('SIGINT', () => { save(); process.exit(0) })

if (process.env.DY_FRESH === '1') {
  await cdp.send('Network.clearBrowserCookies').catch(() => {})
  log('已清除登录态')
}

log('打开 www.douyin.com …')
await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
log('没登录就点右上角「登录」扫码；有二次验证按页面提示完成。抓齐 5 项会自动退出。')

const deadline = Date.now() + TIMEOUT_MS
let probeAt = 0
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2500))
  try {
    const { cookies } = await cdp.send('Network.getAllCookies')
    const mine = (cookies || []).filter((c) => /(^|\.)douyin\.com$/.test(c.domain))
    if (!bag.cookie && mine.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss')) {
      setField('cookie', mine.map((c) => `${c.name}=${c.value}`).join('; '), 'cookies')
    }
  } catch {}
  for (const p of await browser.pages()) if (p.url().includes('douyin.com')) attach(p)
  if (Date.now() - probeAt > 6000) {
    probeAt = Date.now()
    try {
      const found = await page.evaluate(() => (window.__dyProbe ? window.__dyProbe() : {}))
      for (const [k, v] of Object.entries(found || {})) harvest(v, k)
    } catch {}
  }
  if (ORDER.every((k) => bag[k])) break
}

const got = ORDER.filter((k) => bag[k])
log(`结束，命中 ${got.length}/5：${got.join(', ') || '无'}`)
if (got.length) log(`已写入 ${OUT}；到控制台「账号与设置 → 粘贴 Cookie → 导入 dy.json」。`)
save()
await browser.close()
process.exit(got.length >= 4 ? 0 : 1)
