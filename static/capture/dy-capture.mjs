#!/usr/bin/env node
/**
 * dy-capture.mjs — 独立版抖音 bd-ticket-guard 抓取器（零 npm 依赖，Node 22+）
 *
 * 由 OpenMediaCrawl 控制台的「下载抓取工具」下发；也可以手动运行：
 *   node dy-capture.mjs                 # 复用临时 profile 的登录态
 *   DY_FRESH=1 node dy-capture.mjs      # 清 cookie 重扫
 *   CHROME_PATH=... DY_OUT=... node dy-capture.mjs
 *
 * 产物：dy.json（cookie / ticket / ts_sign / client_cert / private_key）
 * 只用 Node 内置 WebSocket + Chrome DevTools Protocol，不装 puppeteer。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'

const CHROME = process.env.CHROME_PATH || defaultChrome()
const PROFILE = path.resolve(process.env.DY_PROFILE || path.join(os.tmpdir(), 'omc-dy-profile'))
const OUT = path.resolve(process.env.DY_OUT || path.join(os.homedir(), 'dy.json'))
const TIMEOUT_MS = Number(process.env.DY_TIMEOUT_MS || 900000)
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

function pageHook() {
  const report = (k, v) => { try { window.__dyReport(JSON.stringify({ k, v })) } catch {} }
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
      s.generateKey = async (alg, extractable, usages) => {
        let kp
        try { kp = await gen(alg, true, usages) } catch { return gen(alg, extractable, usages) }
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
          const k = st.key(i)
          let v = null
          try { v = st.getItem(k) } catch {}
          if (hit(v)) out[`ls:${k}`] = v
        }
      }
    } catch {}
    return out
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const exists = (p) => { try { fs.accessSync(p); return true } catch { return false } }

if (!fs.existsSync(CHROME) && process.platform !== 'linux') {
  console.error(`找不到 Chrome：${CHROME}\n用 CHROME_PATH 指定 chrome.exe 的完整路径。`)
  process.exit(2)
}
if (typeof WebSocket !== 'function') {
  console.error('需要 Node.js 22 或更高版本（内置 WebSocket）。到 https://nodejs.org/ 装 LTS。')
  process.exit(2)
}

fs.mkdirSync(PROFILE, { recursive: true })
const portFile = path.join(PROFILE, 'DevToolsActivePort')
fs.rmSync(portFile, { force: true })
log('启动 Chrome（独立配置，不会动你日常浏览器的登录态）…')
const child = spawn(CHROME, [
  '--remote-debugging-port=0',
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore' })

process.on('SIGINT', () => { save(); try { child.kill() } catch {}; process.exit(0) })
process.on('exit', () => { try { child.kill() } catch {} })

let port = 0
let wsPath = ''
for (let i = 0; i < 100; i++) {
  await sleep(200)
  if (!exists(portFile)) continue
  const lines = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/)
  if (lines.length >= 2) { port = Number(lines[0]); wsPath = lines[1]; break }
}
if (!port) {
  console.error('Chrome 没有打开调试端口；检查 Chrome 是否被其他实例占用，或换一个 DY_PROFILE。')
  process.exit(2)
}

const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', () => reject(new Error('连接 Chrome 调试端口失败')), { once: true })
})

let seq = 0
const pending = new Map()
const handlers = []
ws.addEventListener('message', (ev) => {
  let msg
  try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()) } catch { return }
  if (msg.id) {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'))
    else p.resolve(msg.result || {})
    return
  }
  for (const h of handlers) { try { h(msg) } catch {} }
})
function cmd(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
  })
}

const { targetId } = await cmd('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cmd('Target.attachToTarget', { targetId, flatten: true })
await cmd('Page.enable', {}, sessionId)
await cmd('Runtime.enable', {}, sessionId)
await cmd('Network.enable', {}, sessionId)
await cmd('Runtime.addBinding', { name: '__dyReport' }, sessionId)
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `(${pageHook.toString()})()` }, sessionId)

handlers.push((msg) => {
  if (msg.method === 'Runtime.bindingCalled' && msg.params && msg.params.name === '__dyReport') {
    try {
      const d = JSON.parse(msg.params.payload)
      if (d.k === '__body') harvest(d.v, 'fetch-hook')
      else setField(d.k, d.v, 'crypto-hook')
    } catch {}
    return
  }
  if (msg.method === 'Network.responseReceived' && msg.params) {
    const { requestId, response, type } = msg.params
    const mime = (response && response.mimeType) || ''
    if (!/json|text|javascript/i.test(mime) && !['XHR', 'Fetch', 'Document', 'Script', 'Other'].includes(type)) return
    cmd('Network.getResponseBody', { requestId }, msg.sessionId)
      .then((r) => harvest(r && r.body, type || ''))
      .catch(() => {})
  }
})

if (process.env.DY_FRESH === '1') {
  await cmd('Network.clearBrowserCookies', {}, sessionId).catch(() => {})
  log('已清除登录态')
}

log('打开 www.douyin.com …')
await cmd('Page.navigate', { url: 'https://www.douyin.com/' }, sessionId).catch(() => {})
log('没登录就点右上角「登录」扫码；有二次验证按页面提示完成。抓齐 5 项会自动退出。')

const deadline = Date.now() + TIMEOUT_MS
let probeAt = 0
while (Date.now() < deadline) {
  await sleep(2500)
  try {
    const { cookies } = await cmd('Network.getAllCookies', {}, sessionId)
    const mine = (cookies || []).filter((c) => /(^|\.)douyin\.com$/.test(c.domain))
    if (!bag.cookie && mine.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss')) {
      setField('cookie', mine.map((c) => `${c.name}=${c.value}`).join('; '), 'cookies')
    }
  } catch {}
  if (Date.now() - probeAt > 6000) {
    probeAt = Date.now()
    try {
      const r = await cmd('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__dyProbe ? window.__dyProbe() : {})',
        returnByValue: true,
      }, sessionId)
      const found = JSON.parse((r.result && r.result.value) || '{}')
      for (const [k, v] of Object.entries(found || {})) harvest(v, k)
    } catch {}
  }
  if (ORDER.every((k) => bag[k])) break
}

const got = ORDER.filter((k) => bag[k])
log(`结束，命中 ${got.length}/5：${got.join(', ') || '无'}`)
if (got.length) log(`已写入 ${OUT}；到控制台「账号与设置 → 粘贴 Cookie → 导入 dy.json」。`)
save()
try { await cmd('Browser.close') } catch {}
try { child.kill() } catch {}
process.exit(got.length >= 4 ? 0 : 1)
