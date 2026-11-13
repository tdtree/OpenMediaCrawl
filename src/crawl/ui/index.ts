import { APP_HTML, LOGIN_HTML } from './shell.js'
import { KIT_JS } from './kit.js'
import { THEME_CSS } from './theme.js'
import type { View } from './types.js'
import { overview } from './views/overview.js'
import { crawl } from './views/crawl.js'
import { leads } from './views/leads.js'
import { reach } from './views/reach.js'
import { account } from './views/account.js'

/** 侧栏顺序即数组顺序。 */
export const VIEWS: View[] = [overview, crawl, leads, reach, account]

/** 把主题、壳、各视图拼成一整页（零依赖：服务端一次性拼字符串）。 */
export function renderPage(): string {
  const css = [THEME_CSS, ...VIEWS.map((view) => view.css ?? '')].join('\n')
  const sections = VIEWS.map((view) => `<section class="view" data-view="${view.id}" hidden>${view.html}</section>`).join('\n')
  const meta = JSON.stringify(Object.fromEntries(VIEWS.map((view) => [view.id, { title: view.title, sub: view.sub }])))
  const register = `omc.views={${VIEWS.map((view) => `${JSON.stringify(view.id)}:{}`).join(',')}};omc.meta=${meta};`
  const viewJs = VIEWS.map((view) => `/* ---- view: ${view.id} ---- */\n${view.js}`).join('\n')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f6f6f3" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0f1216" media="(prefers-color-scheme: dark)"><title>OpenMediaCrawl</title>
<style>${css}</style></head><body>
${LOGIN_HTML}
${APP_HTML.replace('<!--VIEWS-->', sections)}
<script>
${KIT_JS}
${register}
${viewJs}
boot();
</script>
</body></html>`
}
