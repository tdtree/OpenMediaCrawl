#!/usr/bin/env node
/**
 * dy-capture.mjs — 独立版抖音 bd-ticket-guard 抓取器（零 npm 依赖，Node 22+）
 *
 * 由 OpenMediaCrawl 控制台的「下载抓取工具」下发；也可以手动运行：
 *   node dy-capture.mjs                 # 复用临时 profile 的登录态
 *   DY_FORCE_SCAN=1 node dy-capture.mjs # 启动就清 cookie，强制扫码
 *   DY_GRACE_MS=0 node dy-capture.mjs   # 抓齐立刻关（默认保留 60 秒）
 *   CHROME_PATH=... DY_OUT=... node dy-capture.mjs
 *
 * 产物：dy.json（cookie / ticket / ts_sign / client_cert / private_key）
 * 只用 Node 内置 WebSocket + Chrome DevTools Protocol，不装 puppeteer。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execFileSync, spawn } from 'node:child_process'

const CHROME = process.env.CHROME_PATH || defaultChrome()
const CHROME_TAG = (String(CHROME).split(/[\\/]/).pop() || 'browser').replace(/\.exe$/i, '')
const PROFILE = path.resolve(process.env.DY_PROFILE || path.join(os.tmpdir(), `omc-dy-profile-${CHROME_TAG}`))
const OUT = path.resolve(process.env.DY_OUT || path.join(os.homedir(), 'dy.json'))
const TIMEOUT_MS = Number(process.env.DY_TIMEOUT_MS || 900000)
const ORDER = ['cookie', 'ticket', 'ts_sign', 'client_cert', 'private_key']
const bag = {}
const log = (...a) => console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}]`, ...a)
const mask = (v) => (!v ? '' : v.length <= 26 ? v : `${v.slice(0, 18)}…${v.slice(-6)}`)

// 选浏览器：不写死 Chrome。很多人装的是 Edge（Windows 自带的默认浏览器），
// 或者 Chrome 装在非标准路径。顺序：注册表默认浏览器 → 常见 Chromium 兜底。
// 注意 Firefox / Safari 内核不同，无法用 --remote-debugging-port 驱动，不要选。
function regProgId() {
  try {
    const out = execFileSync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
      '/v',
      'ProgId',
    ], { encoding: 'utf8', windowsHide: true })
    const m = out.match(/ProgId\s+REG_SZ\s+(.+)/)
    return m ? m[1].trim() : ''
  } catch {
    return ''
  }
}

function fromProgId(progId) {
  const pf = process.env['ProgramFiles'] || 'C:/Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)'
  const local = process.env.LOCALAPPDATA || ''
  const map = {
    MSEdgeHTM: [`${pf86}/Microsoft/Edge/Application/msedge.exe`, `${pf}/Microsoft/Edge/Application/msedge.exe`],
    MSEdgeDHTML: [`${pf86}/Microsoft/Edge/Application/msedge.exe`],
    ChromeHTML: [`${pf}/Google/Chrome/Application/chrome.exe`, `${pf86}/Google/Chrome/Application/chrome.exe`, `${local}/Google/Chrome/Application/chrome.exe`],
    BraveHTML: [`${pf}/BraveSoftware/Brave-Browser/Application/brave.exe`, `${local}/BraveSoftware/Brave-Browser/Application/brave.exe`],
    VivaldiHTML: [`${pf}/Vivaldi/Application/vivaldi.exe`, `${local}/Vivaldi/Application/vivaldi.exe`],
  }
  for (const c of map[progId] || []) if (c && fs.existsSync(c)) return c
  return ''
}

function defaultChrome() {
  if (process.platform === 'win32') {
    const progId = regProgId()
    const viaDefault = fromProgId(progId)
    if (viaDefault) return viaDefault
    for (const id of ['MSEdgeHTM', 'ChromeHTML', 'BraveHTML', 'VivaldiHTML']) {
      const p = fromProgId(id)
      if (p) return p
    }
  }
  if (process.platform === 'darwin') {
    for (const p of [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]) if (fs.existsSync(p)) return p
  }
  return 'google-chrome'
}

function save() {
  if (!bag.cookie) return
  const data = {}
  for (const k of ORDER) if (bag[k]) data[k] = bag[k]
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8')
  try { fs.chmodSync(OUT, 0o600) } catch {}
}

/**
 * 同一个字段可能出现在多处，可信度不同：
 *   web_protect / bd_ticket_guard_server_data 是「真正用于签名」的那份，
 *   .../login 那份只是登录瞬间落的快照，拿它去签名会被平台静默丢弃。
 * 所以不是"先到先得"，而是按来源优先级覆盖。
 */
function sourceRank(from) {
  const s = String(from || '')
  if (/server_data|web_protect/.test(s)) return 3
  if (/login/.test(s)) return 1
  return 2
}
const fieldRank = {}

function setField(k, v, from = '') {
  if (!k || !v) return false
  const rank = sourceRank(from)
  if (bag[k] && (fieldRank[k] ?? 0) >= rank) return false
  bag[k] = v
  fieldRank[k] = rank
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
    // ticket 的形态固定是 hash.<base64>：它可能和 ts_sign 在同一个 localStorage 值里，
    // 也可能单独一个 key（只按 ts_sign|pub.|cert 过滤就会漏掉）。
    const tk = t.match(/hash\.[A-Za-z0-9+/=_-]{20,}/)
    if (tk) setField('ticket', tk[0], src || 'body')
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
    const hit = (x) => typeof x === 'string' && x.length < 20000 && /ts\.2\.|pub\.|BEGIN PRIVATE KEY|sdk_cert|client_cert|ticket|hash\./.test(x)
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


/**
 * 页面内悬浮状态条（Shadow DOM，避免和抖音站点样式打架）。
 *
 * 为什么做在页面里而不是终端：抓取这件事本身是「在这个浏览器窗口完成一次登录」，
 * 状态和操作都该出现在用户正在看的地方；终端只留一行摘要。
 *
 * 按钮通过 __dyAction 绑定回主进程：
 *   换号重扫 → 清 cookie + 重新加载，已抓结果清空
 *   完成并关闭 → 立刻结束（已抓到的照常写盘）
 */
const BAR_ID = '__dy_capture_bar'
function barSource() {
  return `(() => {
    if (window.__dySetStatus) return;
    // addScriptToEvaluateOnNewDocument 在 DOM 建立之前就跑，
    // 这时 documentElement 可能还不可用；挂载要等 DOM 就绪。
    function mount() {
    if (window.__dySetStatus) return true;
    if (!document.documentElement) return false;
    const host = document.createElement('div');
    host.id = '${BAR_ID}';
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = \`
      <style>
        .card{box-sizing:border-box;width:264px;padding:12px 14px;border-radius:12px;
              background:#161823;color:#fff;font:13px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;
              box-shadow:0 8px 28px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.08)}
        .row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
        .row b{font-size:13px;font-weight:600;letter-spacing:.2px}
        .cnt{font-variant-numeric:tabular-nums;font-size:12px;padding:1px 8px;border-radius:999px;
             background:rgba(255,255,255,.12)}
        .cnt.ok{background:#16a34a}
        .miss{font-size:12px;color:rgba(255,255,255,.72);min-height:18px;word-break:break-all}
        .hint{margin-top:6px;font-size:12px;color:rgba(255,255,255,.55)}
        .btns{display:flex;gap:8px;margin-top:10px}
        button{flex:1;cursor:pointer;border-radius:8px;padding:7px 0;font-size:12px;
               border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#fff}
        button:hover{background:rgba(255,255,255,.14)}
        button.primary{background:#fe2c55;border-color:#fe2c55;font-weight:600}
        button.primary:hover{filter:brightness(1.08)}
      </style>
      <div class="card">
        <div class="row"><b>抖音凭证抓取</b><span class="cnt" id="cnt">0/5</span></div>
        <div class="miss" id="miss">等待扫码登录…</div>
        <div class="hint" id="hint"></div>
        <div class="btns">
          <button id="relogin">换号重扫</button>
          <button id="done" class="primary">完成并关闭</button>
        </div>
      </div>\`;
    document.documentElement.appendChild(host);
    root.getElementById('relogin').onclick = () => { try { window.__dyAction('relogin') } catch {} };
    root.getElementById('done').onclick = () => { try { window.__dyAction('done') } catch {} };
    window.__dySetStatus = (state) => {
      const cnt = root.getElementById('cnt');
      cnt.textContent = state.count + '/5';
      cnt.className = 'cnt' + (state.count === 5 ? ' ok' : '');
      root.getElementById('miss').textContent = state.missing || '已抓齐，可以关闭窗口';
      root.getElementById('hint').textContent = state.hint || '';
    };
    return true;
    }
    if (!mount()) {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
      const timer = setInterval(() => { if (mount()) clearInterval(timer) }, 300);
      setTimeout(() => clearInterval(timer), 20000);
      window.addEventListener('load', mount, { once: true });
    }
  })()`
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const exists = (p) => { try { fs.accessSync(p); return true } catch { return false } }

if (!fs.existsSync(CHROME) && process.platform !== 'linux') {
  console.error(`找不到可用的浏览器：${CHROME}`)
  console.error('支持 Edge / Chrome / Brave / Vivaldi（Chromium 内核）。Firefox、Safari 不行。')
  console.error('如果确实装了，用 CHROME_PATH 指定完整路径，例如：')
  console.error('  set CHROME_PATH=C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
  process.exit(2)
}
if (typeof WebSocket !== 'function') {
  console.error('需要 Node.js 22 或更高版本（内置 WebSocket）。到 https://nodejs.org/ 装 LTS。')
  process.exit(2)
}

fs.mkdirSync(PROFILE, { recursive: true })
const portFile = path.join(PROFILE, 'DevToolsActivePort')
fs.rmSync(portFile, { force: true })
log(`启动浏览器：${CHROME}`)
log('使用独立配置，不会动你日常浏览器的登录态（但需要在该窗口里登录抖音）…')
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
// 浏览器关闭 / WebSocket 断开时，把还挂着的 CDP 请求全部 reject。
// 不做的话，退出的那一刻 top-level await 永远等不到结果，Node 会打
// "Detected unsettled top-level await" 警告，用户看到会以为脚本崩了。
let wsClosed = false
ws.addEventListener('close', () => {
  wsClosed = true
  for (const [, item] of pending) {
    try { item.reject(new Error('CDP 连接已断开')) } catch {}
  }
  pending.clear()
})

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

const ready = new Set()
async function setupSession(sid) {
  if (!sid || ready.has(sid)) return
  ready.add(sid)
  await cmd('Page.enable', {}, sid)
  await cmd('Runtime.enable', {}, sid)
  await cmd('Network.enable', {}, sid)
  await cmd('Runtime.addBinding', { name: '__dyReport' }, sid)
  await cmd('Runtime.addBinding', { name: '__dyAction' }, sid)
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `(${pageHook.toString()})()` }, sid)
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: barSource() }, sid)
}
await setupSession(sessionId)

// 登录可能开新标签页：自动挂上所有 page，保证 network / crypto hook 都装上
await cmd('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }).catch(() => {})
handlers.push((msg) => {
  if (msg.method !== 'Target.attachedToTarget') return
  const p = msg.params || {}
  const target = p.targetInfo || {}
  if (target.type !== 'page') {
    cmd('Runtime.runIfWaitingForDebugger', {}, p.sessionId).catch(() => {})
    return
  }
  setupSession(p.sessionId)
    .then(() => cmd('Runtime.runIfWaitingForDebugger', {}, p.sessionId))
    .catch(() => {})
})

// 页面里的两个按钮走这里：relogin = 清登录态重扫；done = 立刻收工
let finished = false
handlers.push((msg) => {
  if (msg.method === 'Runtime.bindingCalled' && msg.params && msg.params.name === '__dyAction') {
    const action = String(msg.params.payload || '')
    if (action === 'done') {
      finished = true
      log('收到「完成并关闭」：立刻收工')
    } else if (action === 'relogin') {
      resetBag('手动换号重扫')
      cmd('Network.clearBrowserCookies', {}, msg.sessionId).catch(() => {})
      cmd('Page.navigate', { url: 'https://www.douyin.com/' }, msg.sessionId).catch(() => {})
      log('已清除登录态并重新加载，请重新扫码')
    }
    return
  }
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

// 不强制清登录态：有些场景（换电脑、重装）本来就要复用已有登录。
// 但要让你看见「现在是旧凭证」——检测到已有登录就在悬浮条上标出来，
// 并提供一键「换号重扫」。设 DY_FORCE_SCAN=1 则启动就清空，回到强制扫码。
const FORCE_SCAN = process.env.DY_FORCE_SCAN === '1'
if (FORCE_SCAN) {
  await cmd('Network.clearBrowserCookies', {}, sessionId).catch(() => {})
  log('DY_FORCE_SCAN=1：已清除登录态，本次必须重新扫码')
}

// 抓齐 5 项后窗口保留多久再关（给你留时间登出 / 换号重扫）
const GRACE_MS = Math.max(0, Number(process.env.DY_GRACE_MS ?? 60000))

log('打开 www.douyin.com …')
await cmd('Page.navigate', { url: 'https://www.douyin.com/' }, sessionId).catch(() => {})
log('没登录就点右上角「登录」扫码；有二次验证按页面提示完成。抓齐 5 项后窗口还会保留一会儿。')

const deadline = Date.now() + TIMEOUT_MS
let probeAt = 0
let fullAt = 0
let lastCookieSig = ''
/** 重新登录的判据：cookie 里的 sessionid 变了。 */
function cookieSig(list) {
  const sid = (list || []).find((c) => c.name === 'sessionid')
  return sid ? String(sid.value) : ''
}
/** 换号重扫时把已抓的东西全清掉，重新来一轮。 */
function resetBag(why) {
  for (const k of ORDER) { delete bag[k]; delete fieldRank[k] }
  fullAt = 0
  log(`检测到${why}，已清空上一轮结果，重新抓取…`)
}

// 这三个 cookie 缺一个，导出的凭证就不自洽：平台照样返回成功，私信却被静默丢弃。
// sessionid 登录即出现，UIFID / bd_ticket_guard_client_data 要等页面安全 SDK 跑起来才写入，
// 所以不能"看到 sessionid 就快照一次"，必须等齐。
const CRITICAL_COOKIES = ['sessionid', 'UIFID', 'bd_ticket_guard_client_data']
const missingCritical = (list) => CRITICAL_COOKIES.filter((name) => !list.some((c) => c.name === name))
let lastCookieNames = ''
let reloadAt = 0

while (Date.now() < deadline) {
  await sleep(2500)
  // 浏览器已经关了（用户手动关窗 / 完成按钮）：别再往死连接上发请求，
  // 否则会留下永远 settle 不了的 top-level await。
  if (wsClosed) break
  try {
    const { cookies } = await cmd('Network.getAllCookies', {}, sessionId)
    const mine = (cookies || []).filter((c) => /(^|\.)douyin\.com$/.test(c.domain))
    const sig = cookieSig(mine)
    if (sig && lastCookieSig && sig !== lastCookieSig && ORDER.some((k) => bag[k])) resetBag('重新登录（sessionid 变化）')
    if (sig) lastCookieSig = sig
    // 名字集合一变就刷新：晚到的 UIFID / ticket_guard 必须补进来，不能沿用首次快照
    const names = mine.map((c) => c.name).sort().join(',')
    if (names !== lastCookieNames) {
      lastCookieNames = names
      if (mine.some((c) => c.name === 'sessionid' || c.name === 'sessionid_ss')) {
        setField('cookie', mine.map((c) => `${c.name}=${c.value}`).join('; '), 'cookies')
      }
    }
    // 还缺关键 cookie 就重载一次首页，逼页面安全 SDK 把它们写下来（每 5 秒最多一次）
    if (missingCritical(mine).length && Date.now() - reloadAt > 5000) {
      reloadAt = Date.now()
      cmd('Page.reload', {}, sessionId).catch(() => {})
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
      // ts_sign 变了也说明换了登录：旧的一套不能再和新的混用
      const fresh = Object.values(found || {}).join(' ').match(/ts\.2\.[A-Za-z0-9_.-]{20,}/)
      if (fresh && bag.ts_sign && fresh[0] !== bag.ts_sign) resetBag('重新登录（ts_sign 变化）')
      for (const [k, v] of Object.entries(found || {})) harvest(v, k)
    } catch {}
  }
  const full = ORDER.every((k) => bag[k]) && missingCritical(mine).length === 0
  if (full && !fullAt) {
    fullAt = Date.now()
    save()
    // 抓齐就顺手回传，省掉「复制 dy.json → 粘贴到网页」这一步。
    // 令牌是网页点「一键抓取」时签发的一次性凭证，20 分钟过期。
    if (process.env.OMC_IMPORT_URL && process.env.OMC_IMPORT_TOKEN) {
      try {
        const five = {}
        for (const k of ORDER) five[k] = bag[k]
        const res = await fetch(process.env.OMC_IMPORT_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: process.env.OMC_IMPORT_TOKEN, five }),
        })
        const text = await res.text()
        let info = null
        try { info = JSON.parse(text) } catch {}
        if (res.ok && info && info.ok) log('✓ 已自动导入到账号（网页「账号与设置」里可以直接看到）')
        else log(`自动导入失败：${(info && info.error) || text.slice(0, 200)}`)
      } catch (err) {
        log(`自动导入失败：${err && err.message ? err.message : err}（本地 dy.json 已保存，可手动粘贴）`)
      }
    }
    if (GRACE_MS > 0) {
      log(`✓ 已抓齐 5 项并写盘。窗口保留 ${Math.round(GRACE_MS / 1000)} 秒（也可点页面里的「完成并关闭」）`)
    }
  }
  // 刷新页面内状态条
  {
    const missing = ORDER.filter((k) => !bag[k])
    const left = full && fullAt ? Math.max(0, Math.ceil((GRACE_MS - (Date.now() - fullAt)) / 1000)) : 0
    const state = {
      count: ORDER.length - missing.length,
      missing: missing.length ? `缺：${missing.join('、')}` : '',
      hint: full
        ? (left > 0 ? `${left} 秒后自动关闭 · 可换号重扫` : '已写盘')
        : (lastCookieSig ? '已登录：等私钥/证书就位' : '请扫码登录'),
    }
    cmd('Runtime.evaluate', { expression: `window.__dySetStatus && window.__dySetStatus(${JSON.stringify(state)})`, returnByValue: true }, sessionId).catch(() => {})
  }
  if (process.env.DY_SHOT && !globalThis.__dyShotTaken) {
    globalThis.__dyShotTaken = true
    try {
      const shot = await cmd('Page.captureScreenshot', { format: 'png' }, sessionId)
      if (shot && shot.data) {
        fs.writeFileSync(process.env.DY_SHOT, Buffer.from(shot.data, 'base64'))
        log(`已截图：${process.env.DY_SHOT}`)
      }
    } catch (err) {
      log(`截图失败：${err && err.message ? err.message : err}`)
    }
  }
  if (finished) break
  if (full && fullAt && Date.now() - fullAt >= GRACE_MS) break
}

const got = ORDER.filter((k) => bag[k])
const lack = ORDER.filter((k) => !bag[k])
log(`结束，命中 ${got.length}/5：${got.join(', ') || '无'}`)
if (lack.length) log(`缺：${lack.join(', ')}`)
if (got.length === 5) {
  log(`已写入 ${OUT}；到控制台「账号与设置 → 粘贴 Cookie → 导入 dy.json」。`)
} else if (bag.cookie) {
  log('只有会话没有私钥/证书：能看不能发，发消息会报 AUTH_EXPIRED。')
  log('处理：重跑本脚本，务必在窗口里完成一次新的扫码登录。')
}
save()
try { await cmd('Browser.close') } catch {}
try { child.kill() } catch {}
process.exit(got.length >= 4 ? 0 : 1)
