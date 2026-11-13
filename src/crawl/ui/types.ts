/**
 * 视图契约：每个页面一个模块，只导出这一个对象。
 *
 * 组装方式（index.ts）：theme.css + 各 view.css → 一段 <style>；
 * 各 view.html 按 data-view 包进 #viewRoot；kit.js + 各 view.js 拼成一段 <script>。
 * 因此 view.js 与其它视图共享同一个全局作用域，可以用 $ / esc / api 等全局函数。
 */
export interface View {
  /** 路由 id，与 data-go 一致 */
  id: string
  /** 侧栏文案 */
  nav: string
  /** 页头标题 */
  title: string
  /** 页头副标题（一句话说明这页干什么） */
  sub: string
  /** 本视图专属 CSS，追加在全局主题之后 */
  css?: string
  /** 静态 HTML（挂载时只插入一次） */
  html: string
  /** 视图内 JS：在页面加载时执行一次，用于绑定事件 */
  js: string
}
