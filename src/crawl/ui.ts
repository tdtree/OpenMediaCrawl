import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { CrawlPlatform, CrawlPlatformClient } from './types.js'
import { runCrawl } from './job.js'
import { CRAWL_PLATFORMS, CRAWL_TYPES, normalizeCrawlOptions } from './config.js'
import { createSubprocessClient } from './client.js'

const STAR = '⭐ If OpenMediaCrawl helped you, please star https://github.com/Tommyapi/OpenMediaCrawl — donations: see README "Support".'
const HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenMediaCrawl</title>
<style>:root{color-scheme:light dark;--bg:#f8fafc;--fg:#0f172a;--card:#fff;--line:#cbd5e1;--acc:#d97706}@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--fg:#e2e8f0;--card:#111827;--line:#334155;--acc:#fbbf24}}
body{font:15px/1.5 system-ui,sans-serif;max-width:980px;margin:0 auto;padding:24px 16px;background:var(--bg);color:var(--fg)}h1{margin:0 0 4px}form{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}
label{display:flex;flex-direction:column;font-size:13px;gap:4px}label.c{flex-direction:row;align-items:center}input,select,button{font:inherit;padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}button{background:var(--acc);color:#111;border:0;font-weight:600;cursor:pointer}
pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;min-height:180px;max-height:420px;overflow:auto;white-space:pre-wrap}a{color:var(--acc)}footer{margin-top:24px;font-size:14px}</style></head><body>
<h1>OpenMediaCrawl</h1><p>批量采集任务。先在命令行登录：<code>mediacrawl &lt;平台&gt; auth login</code></p>
<form id="f"><label>平台<select name="platform"><option value="xhs">小红书 xhs</option><option value="douyin">抖音 douyin</option><option value="kuaishou">快手 kuaishou</option><option value="bilibili">B站 bilibili</option><option value="weibo">微博 weibo</option><option value="tiktok">TikTok</option><option value="x">X</option></select></label>
<label>类型<select name="type"><option value="search">关键词搜索</option><option value="detail">指定作品</option><option value="creator">指定博主</option></select></label>
<label>关键词<input name="keywords" placeholder="逗号分隔"></label><label>作品 ID / 链接<input name="ids" placeholder="逗号分隔"></label><label>博主 ID / 链接<input name="creators" placeholder="逗号分隔"></label>
<label>最多条数<input name="maxItems" type="number" min="1" value="20"></label><label>排序<input name="sort" placeholder="如 latest，可留空"></label>
<label>保存格式<select name="save"><option>jsonl</option><option>json</option><option>csv</option><option>sqlite</option></select></label><label>间隔秒数<input name="sleep" value="2-5"></label>
<label class="c"><input name="comments" type="checkbox"> 评论</label><label class="c"><input name="subComments" type="checkbox"> 二级评论</label><label class="c"><input name="media" type="checkbox"> 下载图片/视频</label><button>开始采集</button></form>
<h2>日志</h2><pre id="log"></pre><h2>任务</h2><ul id="jobs"></ul>
<footer>⭐ 觉得好用请 <a href="https://github.com/Tommyapi/OpenMediaCrawl" target="_blank" rel="noopener">给仓库点个 Star</a> · <a href="https://github.com/Tommyapi/OpenMediaCrawl#support--打赏" target="_blank" rel="noopener">打赏支持</a></footer>
<script>const f=document.querySelector('#f'),log=document.querySelector('#log'),jobs=document.querySelector('#jobs');
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function refresh(){const list=await (await fetch('/api/jobs')).json();jobs.innerHTML=list.map(j=>'<li>'+esc(j.options.platform+' '+j.options.type)+' — '+esc(j.status)+' '+((j.result&&j.result.files)||[]).map(x=>'<a href="/api/files?path='+encodeURIComponent(x)+'">'+esc(x.split(/[\\/]/).pop())+'</a>').join(' ')+'</li>').join('')}
f.onsubmit=async e=>{e.preventDefault();const o=Object.fromEntries(new FormData(f));for(const k of ['comments','subComments','media'])o[k]=f.elements[k].checked;const r=await fetch('/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o)});const j=await r.json();if(!r.ok){log.textContent+=(j.error||'error')+'\n';return}const s=new EventSource('/api/jobs/'+j.id+'/events');s.onmessage=e=>{const ev=JSON.parse(e.data);log.textContent+=ev.time.slice(11,19)+' '+ev.message+'\n';log.scrollTop=log.scrollHeight;if(ev.type==='done'||ev.type==='error'){s.close();refresh()}};refresh()};refresh()</script></body></html>`

interface Job { id: string; status: 'running' | 'done' | 'error'; options: Record<string, unknown>; result?: unknown; events: Set<ServerResponse>; history: string[] }

export interface UiHandle { server: Server; port: number; host: string; close: () => Promise<void>; jobs: Map<string, Job> }

async function body(req: IncomingMessage): Promise<string> {
  let value = ''
  for await (const chunk of req) value += String(chunk)
  return value
}

export async function startUiServer(options: { port?: number; host?: string; out?: string; clientFactory?: (platform: CrawlPlatform, extra: { sort?: string }) => CrawlPlatformClient } = {}): Promise<UiHandle> {
  const host = options.host ?? '127.0.0.1'
  const jobs = new Map<string, Job>()
  const server = createServer((req, res) => { handle(req, res).catch((error: unknown) => { if (!res.headersSent) json(res, { error: error instanceof Error ? error.message : String(error) }, 500); else res.end() }) })
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${host}`)
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', HTML)
    if (req.method === 'GET' && url.pathname === '/api/jobs') return json(res, [...jobs.values()].map(({ events, ...job }) => job))
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      let input: Record<string, unknown>
      try { input = JSON.parse(await body(req) || '{}') as Record<string, unknown> } catch { return json(res, { error: 'invalid JSON' }, 400) }
      if (!CRAWL_PLATFORMS.includes(String(input.platform) as never) || !CRAWL_TYPES.includes(String(input.type) as never)) return json(res, { error: 'unknown platform or type' }, 400)
      const id = randomUUID()
      const job: Job = { id, status: 'running', options: input, events: new Set(), history: [] }
      jobs.set(id, job)
      json(res, { id }, 202)
      void (async () => {
        const opts = normalizeCrawlOptions({ ...input, out: options.out ?? './data', quiet: true })
        try {
          job.result = await runCrawl(opts, { client: (options.clientFactory ?? createSubprocessClient)(opts.platform, { sort: opts.sort }), onEvent: (event) => { job.history.push(JSON.stringify(event)); for (const client of job.events) client.write(`data: ${JSON.stringify(event)}\n\n`) } })
          job.status = 'done'
        } catch (error) { job.status = 'error'; const event = { type: 'error', message: error instanceof Error ? error.message : String(error), time: new Date().toISOString() }; job.history.push(JSON.stringify(event)); for (const client of job.events) client.write(`data: ${JSON.stringify(event)}\n\n`) }
        for (const client of job.events) client.end()
      })()
      return
    }
    const eventMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/)
    if (req.method === 'GET' && eventMatch) {
      const job = jobs.get(eventMatch[1]!)
      if (!job) return json(res, { error: 'not found' }, 404)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      for (const event of job.history) res.write(`data: ${event}\n\n`)
      if (job.status === 'running') job.events.add(res); else res.end()
      req.on('close', () => job.events.delete(res))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/files') {
      const requested = resolve(String(url.searchParams.get('path') ?? ''))
      const root = resolve(options.out ?? './data')
      if (!requested.startsWith(root + sep)) return json(res, { error: 'forbidden' }, 403)
      try { const data = await readFile(requested); res.writeHead(200, { 'content-type': mime(extname(requested)) }); res.end(data) } catch { json(res, { error: 'not found' }, 404) }
      return
    }
    json(res, { error: 'not found' }, 404)
  }
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(options.port ?? 8080, host, () => resolveListen()) })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port ?? 8080
  return { server, port, host, jobs, close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())) }
}

function json(res: ServerResponse, value: unknown, status = 200): void { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
function send(res: ServerResponse, status: number, contentType: string, value: string): void { res.writeHead(status, { 'content-type': contentType }); res.end(value) }
function mime(ext: string): string { return ext === '.json' ? 'application/json' : ext === '.csv' ? 'text/csv; charset=utf-8' : 'application/octet-stream' }

export { STAR }
